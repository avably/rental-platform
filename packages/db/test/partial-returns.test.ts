/**
 * ZWROTY CZĘŚCIOWE — egzemplarz wraca do puli PER-POZYCJA (migracja 0113,
 * ADR-272; naprawa double-bookingu, decyzja właściciela).
 *
 * To jest RDZEŃ DOSTĘPNOŚCI: pominięcie warunku `returned_at is null` w
 * KTÓREJKOLWIEK funkcji liczącej „czy egzemplarz zajęty w oknie" otwiera
 * double-booking. Dlatego suita pilnuje wszystkich pięciu ścieżek:
 *
 *   1. KLUCZOWY TEST DOUBLE-BOOKINGU. Zamówienie z 3 egzemplarzami (picked_up),
 *      zwróć 2 → te 2 są WOLNE w oknie, 3. wciąż ZAJĘTY — sprawdzone dla KAŻDEJ
 *      z 4 funkcji dostępności (get_public_availability, get_public_availability_days,
 *      get_public_catalog_availability) ORAZ dla WIĄŻĄCEJ bramki
 *      app.assert_unit_available.
 *   2. DOWÓD MUTACYJNY. Zdjęcie warunku `returned_at is null` z każdej z 4
 *      funkcji (podmiana ciała, przywrócenie w finally) czyni klucz RED —
 *      zwrócony egzemplarz znów raportowany jako zajęty.
 *   3. RE-REZERWACJA. Zwrócony egzemplarz jest bookowalny przez NOWE zamówienie:
 *      przez bramkę przypisania (order_items → assert_unit_available) ORAZ przez
 *      anonowy app.public_checkout; 3. egzemplarz odmawia (23P01 / brak sztuk).
 *   4. PEŁNY ZWROT. Przejście → returned dalej zwalnia wszystko I backfilluje
 *      returned_at na pozostałych pozycjach (trigger order_items_return_backfill).
 *   5. ODWRÓCENIE Z GUARDEM, IDEMPOTENCJA, IZOLACJA CROSS-TENANT.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_* — bez
 * nich plik jest pomijany jawnie (helpers/integration-env.ts).
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import { publishLegalDocuments } from "./helpers/publish-legal-documents";
import { cleanupSeeded, createAdminClient, seedTwoTenants, type TenantCtx } from "./helpers/seed-tenants";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

/** Termin bazowy — daleko w przyszłości, żeby nie zależeć od „dzisiaj". */
const START = "2027-06-10";
const END = "2027-06-14";

interface Seeded {
  productId: string;
  unitIds: string[];
  pickupId: string;
}

async function seedProductWithUnits(
  admin: SupabaseClient,
  tenantId: string,
  unitCount: number,
): Promise<Seeded> {
  const { data: product, error: productError } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: `Rower ${randomUUID().slice(0, 6)}`,
      base_price_day_grosze: 10_000,
      deposit_grosze: 5_000,
      // Bufory 0 — okno najmu bez marginesów, żeby dowód dostępności był o
      // returned_at, a nie o arytmetyce buforów (tę pilnuje inna suita).
      buffer_before_days: 0,
      buffer_after_days: 0,
    })
    .select("id")
    .single();
  if (productError || !product) throw new Error(`seedProduct: ${productError?.message}`);

  const rows = Array.from({ length: unitCount }, () => ({
    tenant_id: tenantId,
    product_id: product.id as string,
    serial_number: `SN-${randomUUID().slice(0, 8)}`,
  }));
  const { data: units, error: unitsError } = await admin
    .from("product_units")
    .insert(rows)
    .select("id")
    .order("id");
  if (unitsError || !units) throw new Error(`seedUnits: ${unitsError?.message}`);

  const { data: pickup, error: pickupError } = await admin
    .from("pickup_locations")
    .insert({ tenant_id: tenantId, name: "Magazyn", address_city: "Warszawa" })
    .select("id")
    .single();
  if (pickupError || !pickup) throw new Error(`seedPickup: ${pickupError?.message}`);

  return {
    productId: product.id as string,
    unitIds: units.map((u) => u.id as string),
    pickupId: pickup.id as string,
  };
}

async function seedCustomer(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data, error } = await admin
    .from("customers")
    .insert({
      tenant_id: tenantId,
      email: `k-${randomUUID().slice(0, 8)}@test.local`,
      full_name: "Klient testowy",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedCustomer: ${error?.message}`);
  return data.id as string;
}

const PICKUP_PATH: readonly string[] = ["reserved", "ready_for_pickup", "picked_up"];

/**
 * Zamówienie WYDANE (picked_up) z pozycjami przypisanymi do wskazanych
 * egzemplarzy. Rodzi się jako pending (jedyna droga na świat przez
 * orders_write_gate) i przechodzi krok po kroku — dokładnie jak w panelu.
 * Zwraca `itemIds` w kolejności `unitIds`.
 */
async function seedPickedUpOrder(
  admin: SupabaseClient,
  tenantId: string,
  seeded: Seeded,
  unitIds: string[],
  startDate = START,
  endDate = END,
): Promise<{ orderId: string; itemIds: string[] }> {
  const customerId = await seedCustomer(admin, tenantId);
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      start_date: startDate,
      end_date: endDate,
      order_status: "pending",
      delivery_method: "pickup",
      pickup_location_id: seeded.pickupId,
    })
    .select("id")
    .single();
  if (orderError || !order) throw new Error(`seedOrder: ${orderError?.message}`);

  const itemIds: string[] = [];
  for (const unitId of unitIds) {
    const { data: item, error: itemError } = await admin
      .from("order_items")
      .insert({
        tenant_id: tenantId,
        order_id: order.id,
        product_id: seeded.productId,
        unit_id: unitId,
        rental_grosze: 10_000,
        deposit_grosze: 5_000,
      })
      .select("id")
      .single();
    if (itemError || !item) throw new Error(`seedItem(${unitId}): ${itemError?.message}`);
    itemIds.push(item.id as string);
  }

  for (const status of PICKUP_PATH) {
    const { error } = await admin
      .from("orders")
      .update({ order_status: status })
      .eq("tenant_id", tenantId)
      .eq("id", order.id);
    if (error) throw new Error(`transition → ${status}: ${error.message}`);
  }

  return { orderId: order.id as string, itemIds };
}

// -------------------------------------------------------------------
// Odczyty dostępności (jak w public-availability-calendar.test.ts)
// -------------------------------------------------------------------
async function rangeFree(anon: SupabaseClient, tenantId: string, productId: string): Promise<number> {
  const { data, error } = await anon.schema("app").rpc("get_public_availability", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_start_date: START,
    p_end_date: END,
  });
  if (error) throw new Error(`get_public_availability: ${error.message}`);
  return (data as { available_units: number }).available_units;
}

async function daysFree(anon: SupabaseClient, tenantId: string, productId: string): Promise<number[]> {
  const { data, error } = await anon.schema("app").rpc("get_public_availability_days", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_start_date: START,
    p_end_date: END,
  });
  if (error) throw new Error(`get_public_availability_days: ${error.message}`);
  return Object.values((data as { days: Record<string, number> }).days);
}

async function catalogFree(anon: SupabaseClient, tenantId: string, productId: string): Promise<number> {
  const { data, error } = await anon.schema("app").rpc("get_public_catalog_availability", {
    p_tenant_id: tenantId,
    p_start_date: START,
    p_end_date: END,
  });
  if (error) throw new Error(`get_public_catalog_availability: ${error.message}`);
  const products = (data as { products: { product_id: string; available_units: number }[] }).products;
  const row = products.find((p) => p.product_id === productId);
  if (!row) throw new Error("katalog nie zawiera produktu");
  return row.available_units;
}

/** Czy WIĄŻĄCA bramka uznaje egzemplarz za wolny dla NOWEGO najmu w oknie. */
async function unitBookable(member: SupabaseClient, tenantId: string, unitId: string): Promise<boolean> {
  const { error } = await member.schema("app").rpc("assert_unit_available", {
    p_tenant_id: tenantId,
    p_unit_id: unitId,
    p_exclude_item_id: null,
    p_start_date: START,
    p_end_date: END,
  });
  if (!error) return true;
  if ((error as { code?: string }).code === "23P01") return false;
  throw new Error(`assert_unit_available nieoczekiwany błąd: ${error.message}`);
}

async function returnItems(
  member: SupabaseClient,
  orderId: string,
  itemIds: string[],
  returned: boolean,
): Promise<{ total_count: number; returned_count: number; all_returned: boolean }> {
  const { data, error } = await member.schema("app").rpc("return_order_items", {
    p_order_id: orderId,
    p_item_ids: itemIds,
    p_returned: returned,
  });
  if (error) throw new Error(`return_order_items: ${error.message} (${(error as { code?: string }).code})`);
  return data as { total_count: number; returned_count: number; all_returned: boolean };
}

describe.skipIf(!hasEnv)("Zwroty częściowe — dostępność per-pozycja (0113, ADR-272)", () => {
  const admin = hasEnv ? createAdminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);
  let ctx: { a: TenantCtx; b: TenantCtx };

  afterAll(async () => {
    if (!hasEnv) return;
    await cleanupSeeded(admin);
  });

  async function tenants(): Promise<{ a: TenantCtx; b: TenantCtx }> {
    if (!ctx) ctx = await seedTwoTenants();
    return ctx;
  }

  // -------------------------------------------------------------------
  // 1. KLUCZOWY TEST DOUBLE-BOOKINGU — dla KAŻDEJ z 4 funkcji
  // -------------------------------------------------------------------
  it("3 egzemplarze picked_up: zwróć 2 → te 2 WOLNE, 3. ZAJĘTY (wszystkie 4 funkcje)", async () => {
    const { a } = await tenants();
    const seeded = await seedProductWithUnits(admin, a.tenantId, 3);
    const { orderId, itemIds } = await seedPickedUpOrder(admin, a.tenantId, seeded, seeded.unitIds);

    // Stan wyjściowy: wszystkie 3 zajęte we wszystkich funkcjach.
    expect(await rangeFree(anon, a.tenantId, seeded.productId)).toBe(0);
    expect(await catalogFree(anon, a.tenantId, seeded.productId)).toBe(0);
    expect(await daysFree(anon, a.tenantId, seeded.productId)).toEqual([0, 0, 0, 0, 0]);
    for (const unitId of seeded.unitIds) {
      expect(await unitBookable(a.ownerClient, a.tenantId, unitId)).toBe(false);
    }

    // Zwróć pierwsze DWA egzemplarze.
    const progress = await returnItems(a.ownerClient, orderId, [itemIds[0], itemIds[1]], true);
    expect(progress).toEqual({ total_count: 3, returned_count: 2, all_returned: false });

    // Te 2 są teraz WOLNE, 3. wciąż ZAJĘTY — w każdej funkcji.
    expect(await rangeFree(anon, a.tenantId, seeded.productId)).toBe(2);
    expect(await catalogFree(anon, a.tenantId, seeded.productId)).toBe(2);
    expect(await daysFree(anon, a.tenantId, seeded.productId)).toEqual([2, 2, 2, 2, 2]);
    expect(await unitBookable(a.ownerClient, a.tenantId, seeded.unitIds[0])).toBe(true);
    expect(await unitBookable(a.ownerClient, a.tenantId, seeded.unitIds[1])).toBe(true);
    expect(await unitBookable(a.ownerClient, a.tenantId, seeded.unitIds[2])).toBe(false);

    // Zwróć 3. → wszystko wolne.
    const done = await returnItems(a.ownerClient, orderId, [itemIds[2]], true);
    expect(done.all_returned).toBe(true);
    expect(await rangeFree(anon, a.tenantId, seeded.productId)).toBe(3);
    expect(await unitBookable(a.ownerClient, a.tenantId, seeded.unitIds[2])).toBe(true);
  });

  // -------------------------------------------------------------------
  // 2. DOWÓD MUTACYJNY — zdjęcie `returned_at is null` z każdej z 4 funkcji
  // -------------------------------------------------------------------
  it("mutacja: usunięcie warunku returned_at is null z każdej funkcji → klucz RED", async () => {
    const { a } = await tenants();
    const seeded = await seedProductWithUnits(admin, a.tenantId, 3);
    const { orderId, itemIds } = await seedPickedUpOrder(admin, a.tenantId, seeded, seeded.unitIds);
    await returnItems(a.ownerClient, orderId, [itemIds[0], itemIds[1]], true);

    // Kontrola pozytywna: Z warunkiem 2 sztuki są wolne (inaczej mutacja nie
    // dowodzi niczego — narzędzie pomiaru najpierw musi pokazać zieleń).
    expect(await rangeFree(anon, a.tenantId, seeded.productId)).toBe(2);

    const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    // Każda funkcja z WŁASNYM przyrządem: mutacja assert_unit_available zmienia
    // wynik unitBookable, ale nie rangeFree — mierzenie każdej mutacji tym
    // samym odczytem byłoby ślepe na trzy z czterech (narzędzie pomiaru kłamie).
    // Kontrakt przyrządu: przy warunku „widać 2 wolne", bez warunku „widać 0".
    const cases: { signature: string; measure: () => Promise<number> }[] = [
      {
        signature: "app.assert_unit_available(uuid, uuid, uuid, date, date)",
        // Ile ZWRÓCONYCH egzemplarzy bramka uznaje za bookowalne (0 lub 2).
        measure: async () =>
          (await unitBookable(a.ownerClient, a.tenantId, seeded.unitIds[0]) ? 1 : 0) +
          (await unitBookable(a.ownerClient, a.tenantId, seeded.unitIds[1]) ? 1 : 0),
      },
      {
        signature: "app.get_public_availability(uuid, uuid, date, date)",
        measure: () => rangeFree(anon, a.tenantId, seeded.productId),
      },
      {
        signature: "app.get_public_catalog_availability(uuid, date, date)",
        measure: () => catalogFree(anon, a.tenantId, seeded.productId),
      },
      {
        signature: "app.get_public_availability_days(uuid, uuid, date, date)",
        measure: async () => Math.min(...(await daysFree(anon, a.tenantId, seeded.productId))),
      },
    ];
    try {
      for (const { signature, measure } of cases) {
        // Kontrola pozytywna PER FUNKCJA: z warunkiem przyrząd pokazuje 2.
        expect(await measure(), `${signature}: przyrząd przed mutacją`).toBe(2);
        // pg_get_functiondef zwraca pełne CREATE OR REPLACE — usuwamy JEDEN
        // wiersz warunku i wgrywamy mutanta, potem przywracamy oryginał.
        const [{ def }] = await sql<{ def: string }[]>`
          select pg_get_functiondef(${signature}::regprocedure) as def`;
        const mutant = def.replace(/^[ \t]*and oi\.returned_at is null\r?\n/m, "");
        expect(mutant, `${signature}: warunek returned_at nie znaleziony w ciele`).not.toBe(def);
        try {
          await sql.unsafe(mutant);
          // Bez warunku zwrócone egzemplarze znów „zajęte": przyrząd → 0. RED.
          expect(await measure(), `${signature}: mutant powinien dać 0`).toBe(0);
        } finally {
          await sql.unsafe(def); // przywróć wersję z warunkiem
        }
        // Po przywróceniu przyrząd znów pokazuje 2 — mutant nie został na bazie.
        expect(await measure(), `${signature}: po przywróceniu`).toBe(2);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  // -------------------------------------------------------------------
  // 3. RE-REZERWACJA — zwrócony egzemplarz bookowalny NOWYM zamówieniem
  // -------------------------------------------------------------------
  it("re-rezerwacja: zwrócony egzemplarz wchodzi w nowe zamówienie (bramka przypisania), 3. odmawia", async () => {
    const { a } = await tenants();
    const seeded = await seedProductWithUnits(admin, a.tenantId, 3);
    const { orderId, itemIds } = await seedPickedUpOrder(admin, a.tenantId, seeded, seeded.unitIds);
    await returnItems(a.ownerClient, orderId, [itemIds[0], itemIds[1]], true);

    // Nowe zamówienie na zwrócony egzemplarz w NAKŁADAJĄCYM się oknie → sukces.
    const customerId = await seedCustomer(admin, a.tenantId);
    const { data: newOrder } = await admin
      .from("orders")
      .insert({
        tenant_id: a.tenantId,
        customer_id: customerId,
        start_date: START,
        end_date: END,
        order_status: "pending",
        delivery_method: "pickup",
        pickup_location_id: seeded.pickupId,
      })
      .select("id")
      .single();

    const bookReturned = await admin.from("order_items").insert({
      tenant_id: a.tenantId,
      order_id: newOrder!.id,
      product_id: seeded.productId,
      unit_id: seeded.unitIds[0], // zwrócony
      rental_grosze: 10_000,
      deposit_grosze: 5_000,
    });
    expect(bookReturned.error, "zwrócony egzemplarz musi się zabookować").toBeNull();

    // 3. egzemplarz (wciąż wydany) → bramka przypisania odmawia 23P01.
    const bookOut = await admin.from("order_items").insert({
      tenant_id: a.tenantId,
      order_id: newOrder!.id,
      product_id: seeded.productId,
      unit_id: seeded.unitIds[2], // wciąż u klienta
      rental_grosze: 10_000,
      deposit_grosze: 5_000,
    });
    expect((bookOut.error as { code?: string } | null)?.code).toBe("23P01");
  });

  it("re-rezerwacja: anonowy public_checkout dobiera zwrócone egzemplarze, po wyczerpaniu odmawia", async () => {
    const { a } = await tenants();
    // public_checkout wymaga opublikowanych dokumentów prawnych (0086).
    await publishLegalDocuments(admin, a.tenantId);
    const seeded = await seedProductWithUnits(admin, a.tenantId, 3);
    const { orderId, itemIds } = await seedPickedUpOrder(admin, a.tenantId, seeded, seeded.unitIds);
    await returnItems(a.ownerClient, orderId, [itemIds[0], itemIds[1]], true);

    const checkoutArgs = (): Record<string, unknown> => ({
      p_tenant_id: a.tenantId,
      p_email: `co-${randomUUID().slice(0, 8)}@test.local`,
      p_full_name: "Kupujący",
      p_phone: null,
      p_start_date: START,
      p_end_date: END,
      p_delivery_method: "pickup",
      p_pickup_location_id: seeded.pickupId,
      p_items: [{ product_id: seeded.productId, quantity: 1 }],
      p_terms_version: "v1",
      p_locale: "pl",
    });

    // DWA zwrócone egzemplarze → dwa checkouty przechodzą.
    const first = await anon.schema("app").rpc("public_checkout", checkoutArgs());
    expect(first.error, `pierwszy checkout: ${first.error?.message}`).toBeNull();
    const second = await anon.schema("app").rpc("public_checkout", checkoutArgs());
    expect(second.error, `drugi checkout: ${second.error?.message}`).toBeNull();

    // Trzeci: został tylko egzemplarz wciąż u klienta → dobór kandydatów odmawia.
    const third = await anon.schema("app").rpc("public_checkout", checkoutArgs());
    expect((third.error as { code?: string } | null)?.code).toBe("23P01");
  });

  // -------------------------------------------------------------------
  // 4. PEŁNY ZWROT — przejście → returned zwalnia wszystko + backfill
  // -------------------------------------------------------------------
  it("pełny zwrot: → returned zwalnia wszystko I backfilluje returned_at wszystkim pozycjom", async () => {
    const { a } = await tenants();
    const seeded = await seedProductWithUnits(admin, a.tenantId, 3);
    const { orderId } = await seedPickedUpOrder(admin, a.tenantId, seeded, seeded.unitIds);

    // Dotychczasowy skrót „zwrot całości" — bez odznaczania pozycji.
    const { error } = await admin
      .from("orders")
      .update({ order_status: "returned" })
      .eq("tenant_id", a.tenantId)
      .eq("id", orderId);
    expect(error, `przejście → returned: ${error?.message}`).toBeNull();

    // Wszystkie egzemplarze wolne.
    expect(await rangeFree(anon, a.tenantId, seeded.productId)).toBe(3);

    // Backfill: KAŻDA pozycja ma returned_at.
    const { data: items } = await admin
      .from("order_items")
      .select("returned_at")
      .eq("tenant_id", a.tenantId)
      .eq("order_id", orderId);
    expect(items!.length).toBe(3);
    expect(items!.every((i) => i.returned_at !== null)).toBe(true);
  });

  // -------------------------------------------------------------------
  // 5a. ODWRÓCENIE Z GUARDEM
  // -------------------------------------------------------------------
  it("odwrócenie: odznaczenie wolnego egzemplarza OK; gdy zajęty w międzyczasie → odmowa", async () => {
    const { a } = await tenants();
    const seeded = await seedProductWithUnits(admin, a.tenantId, 1);
    const { orderId, itemIds } = await seedPickedUpOrder(admin, a.tenantId, seeded, seeded.unitIds);

    // Zwróć jedyny egzemplarz → wolny.
    await returnItems(a.ownerClient, orderId, [itemIds[0]], true);
    expect(await rangeFree(anon, a.tenantId, seeded.productId)).toBe(1);

    // Odznaczenie, gdy nikt nie zajął → OK (wraca do najmu).
    const back = await returnItems(a.ownerClient, orderId, [itemIds[0]], false);
    expect(back.returned_count).toBe(0);
    expect(await rangeFree(anon, a.tenantId, seeded.productId)).toBe(0);

    // Zwróć ponownie, a potem NIECH KTOŚ INNY zajmie egzemplarz w tym oknie.
    await returnItems(a.ownerClient, orderId, [itemIds[0]], true);
    const otherOrder = await seedPickedUpOrder(admin, a.tenantId, seeded, seeded.unitIds);
    expect(otherOrder.orderId).toBeTruthy();

    // Teraz odznaczenie pierwszego MUSI odmówić — nie wskrzeszamy konfliktu.
    await expect(returnItems(a.ownerClient, orderId, [itemIds[0]], false)).rejects.toThrow();
    // Egzemplarz nadal zwrócony w pierwszym zamówieniu (guard nie zmienił stanu).
    const { data: item } = await admin
      .from("order_items")
      .select("returned_at")
      .eq("tenant_id", a.tenantId)
      .eq("id", itemIds[0])
      .single();
    expect(item!.returned_at).not.toBeNull();
  });

  // -------------------------------------------------------------------
  // 5b. IDEMPOTENCJA
  // -------------------------------------------------------------------
  it("idempotencja: ponowne oznaczenie zwróconej pozycji nie przesuwa znacznika", async () => {
    const { a } = await tenants();
    const seeded = await seedProductWithUnits(admin, a.tenantId, 2);
    const { orderId, itemIds } = await seedPickedUpOrder(admin, a.tenantId, seeded, seeded.unitIds);

    await returnItems(a.ownerClient, orderId, [itemIds[0]], true);
    const { data: first } = await admin
      .from("order_items")
      .select("returned_at")
      .eq("tenant_id", a.tenantId)
      .eq("id", itemIds[0])
      .single();

    // Powtórne oznaczenie tej samej pozycji — znacznik BEZ ZMIAN.
    const again = await returnItems(a.ownerClient, orderId, [itemIds[0], itemIds[1]], true);
    expect(again.returned_count).toBe(2);
    const { data: second } = await admin
      .from("order_items")
      .select("returned_at")
      .eq("tenant_id", a.tenantId)
      .eq("id", itemIds[0])
      .single();
    expect(second!.returned_at).toBe(first!.returned_at);
  });

  // -------------------------------------------------------------------
  // 6. IZOLACJA CROSS-TENANT
  // -------------------------------------------------------------------
  it("izolacja: członek najemcy B nie zwróci pozycji zamówienia najemcy A", async () => {
    const { a, b } = await tenants();
    const seeded = await seedProductWithUnits(admin, a.tenantId, 2);
    const { orderId, itemIds } = await seedPickedUpOrder(admin, a.tenantId, seeded, seeded.unitIds);

    // Owner B celuje w zamówienie A → zamówienie „nie istnieje" w jego zakresie.
    await expect(
      returnItems(b.ownerClient, orderId, [itemIds[0]], true),
    ).rejects.toThrow();

    // Pozycja A nietknięta.
    const { data: item } = await admin
      .from("order_items")
      .select("returned_at")
      .eq("tenant_id", a.tenantId)
      .eq("id", itemIds[0])
      .single();
    expect(item!.returned_at).toBeNull();

    // Dostępność A liczona w kontekście B nie ujawnia sztuk A.
    const { data: catalogForB } = await anon.schema("app").rpc("get_public_catalog_availability", {
      p_tenant_id: b.tenantId,
      p_start_date: START,
      p_end_date: END,
    });
    const bProducts = (catalogForB as { products: { product_id: string }[] }).products;
    expect(bProducts.some((p) => p.product_id === seeded.productId)).toBe(false);
  });
});
