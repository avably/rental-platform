/**
 * SONDA IZOLACJI LISTY KATALOGU (U8a, ADR-145) na żywym, lokalnym Supabase.
 *
 * Pytanie brzmi: co ten ekran UDOSTĘPNIA, czego wcześniej nie udostępniał?
 * Dwie rzeczy — wyszukiwarkę (parametr `q` od operatora) i miniatury
 * (ścieżki w PUBLICZNYM buckecie `product-images`). Obie sondy są tu.
 *
 * ================== DLACZEGO KLIENT SERVICE-ROLE ==================
 *
 * Sonda uruchamiana klientem z sesją tenanta B dowodzi tylko tego, że działa
 * RLS — i byłaby ZIELONA również wtedy, gdyby zapytanie ekranu straciło
 * zawężenie po tenancie. Dlatego GŁÓWNA sonda woła `fetchCatalogList`
 * klientem SERVICE-ROLE, który RLS omija: wtedy jedyną rzeczą, która trzyma
 * wynik przy jednym najemcy, jest samo zapytanie. Zdjęcie `.eq("tenant_id",
 * …)` z `lib/catalog/list-query.ts` zapala te testy z imienia.
 *
 * Druga sonda (klientem z sesją B, z PODSTAWIONYM tenant_id tenanta A)
 * pokazuje, że RLS trzyma niezależnie od tego, co panel poda jako tenant.
 *
 * `fetchCatalogList` jest tu wołane DOKŁADNIE tak, jak woła je ekran — kopia
 * zapytania w teście broniłaby kopii, nie produkcji.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { productsFilterSchema } from "@/lib/catalog-validation";
import { fetchCatalogList } from "@/lib/catalog/list-query";
import { filterProductsBySearch, filterProductsByStatus } from "@/lib/catalog/product-search";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "CatalogList!12345678";
const SUPABASE_PUBLIC_URL = "http://127.0.0.1:54321";
const TODAY = "2026-08-12";

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function createAdminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

async function createTenantMember(
  admin: SupabaseClient,
  label: string,
): Promise<{ client: SupabaseClient; tenantId: string }> {
  const email = `catlist-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
    p_slug: `catlist-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja listy ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

/** Produkt + egzemplarze + zdjęcie; zwraca id i ścieżkę zdjęcia. */
async function seedProduct(
  admin: SupabaseClient,
  tenantId: string,
  name: string,
  units: number,
): Promise<{ productId: string; storagePath: string }> {
  const { data: product, error } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name,
      base_price_day_grosze: 10_000,
      deposit_grosze: 20_000,
      auto_increment_multiplier: 1.0,
      active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insert products(${name}): ${error.message}`);
  const productId = product!.id as string;

  for (let index = 0; index < units; index += 1) {
    const { error: unitError } = await admin
      .from("product_units")
      .insert({ tenant_id: tenantId, product_id: productId, serial_number: `${name}-${index}` });
    if (unitError) throw new Error(`insert product_units(${name}): ${unitError.message}`);
  }

  const storagePath = `${tenantId}/${productId}/${randomUUID()}.jpg`;
  const { error: imageError } = await admin.from("product_images").insert({
    tenant_id: tenantId,
    product_id: productId,
    storage_path: storagePath,
    sort_order: 0,
    alt_text: `Zdjęcie ${name}`,
  });
  if (imageError) throw new Error(`insert product_images(${name}): ${imageError.message}`);

  return { productId, storagePath };
}

/** Zamówienie w zadanym statusie + jedna pozycja wskazująca produkt. */
async function seedOrder(
  admin: SupabaseClient,
  tenantId: string,
  productId: string,
  orderStatus: string,
  startDate: string,
  endDate: string,
): Promise<void> {
  const { data: customer, error: customerError } = await admin
    .from("customers")
    .insert({ tenant_id: tenantId, email: `k-${randomUUID()}@test.local`, full_name: "Klient" })
    .select("id")
    .single();
  if (customerError) throw new Error(`insert customers: ${customerError.message}`);

  // Zamówienie RODZI SIĘ jako `pending` (bramka 0010) — do docelowego statusu
  // idziemy maszyną stanów, krok po kroku, tak jak robi to panel.
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      customer_id: customer!.id,
      start_date: startDate,
      end_date: endDate,
      delivery_method: "courier",
      total_rental_grosze: 10_000,
    })
    .select("id")
    .single();
  if (orderError) throw new Error(`insert orders: ${orderError.message}`);

  const { error: itemError } = await admin.from("order_items").insert({
    tenant_id: tenantId,
    order_id: order!.id,
    product_id: productId,
    rental_grosze: 10_000,
  });
  if (itemError) throw new Error(`insert order_items: ${itemError.message}`);

  const path: Record<string, readonly string[]> = {
    pending: [],
    reserved: ["reserved"],
    ready_for_pickup: ["reserved", "ready_for_pickup"],
    picked_up: ["reserved", "ready_for_pickup", "picked_up"],
    returned: ["reserved", "ready_for_pickup", "picked_up", "returned"],
  };
  for (const next of path[orderStatus] ?? []) {
    const { error: stepError } = await admin
      .from("orders")
      .update({ order_status: next })
      .eq("id", order!.id);
    if (stepError) throw new Error(`przejście ${next}: ${stepError.message}`);
  }
}

describe.skipIf(!hasEnv)("lista katalogu — izolacja najemców (U8a)", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };
  let productA: { productId: string; storagePath: string };
  let productB: { productId: string; storagePath: string };

  const options = { today: TODAY, supabaseUrl: SUPABASE_PUBLIC_URL };

  beforeAll(async () => {
    admin = createAdminClient();
    tenantA = await createTenantMember(admin, "a");
    tenantB = await createTenantMember(admin, "b");

    productA = await seedProduct(admin, tenantA.tenantId, "Rower najemcy A", 6);
    productB = await seedProduct(admin, tenantB.tenantId, "Rower najemcy B", 4);

    // A: trzy sztuki w terenie DZIŚ + jedna rezerwacja na przyszłość
    // (nie powinna się liczyć) + jeden najem zakończony wczoraj.
    await seedOrder(admin, tenantA.tenantId, productA.productId, "picked_up", "2026-08-10", "2026-08-14");
    await seedOrder(admin, tenantA.tenantId, productA.productId, "picked_up", TODAY, TODAY);
    await seedOrder(admin, tenantA.tenantId, productA.productId, "picked_up", "2026-08-12", "2026-08-20");
    await seedOrder(admin, tenantA.tenantId, productA.productId, "reserved", "2026-08-11", "2026-08-20");
    await seedOrder(admin, tenantA.tenantId, productA.productId, "picked_up", "2026-08-01", "2026-08-11");
    // B ma WŁASNE wydania — gdyby agregat przestał zawężać po tenancie,
    // liczba „w terenie" u A urosłaby o cudze zamówienia.
    await seedOrder(admin, tenantB.tenantId, productB.productId, "picked_up", "2026-08-10", "2026-08-20");
    await seedOrder(admin, tenantB.tenantId, productB.productId, "picked_up", "2026-08-10", "2026-08-20");
  }, 120_000);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  }, 60_000);

  it("kontrola pozytywna: dane obu najemców NAPRAWDĘ istnieją", async () => {
    // Bez tego dowody niżej byłyby dowodami po pustym zbiorze: „nie widzę
    // cudzego produktu" jest prawdą również wtedy, gdy cudzego produktu nie ma.
    const { data } = await admin.from("products").select("id, tenant_id").in("id", [
      productA.productId,
      productB.productId,
    ]);
    expect(data).toHaveLength(2);
    const { data: images } = await admin
      .from("product_images")
      .select("storage_path")
      .in("product_id", [productA.productId, productB.productId]);
    expect(images).toHaveLength(2);
  });

  it("odczyt listy jest zawężony do najemcy SAMYM ZAPYTANIEM (klient bez RLS)", async () => {
    const result = await fetchCatalogList(admin, tenantA.tenantId, options);

    // Produkt A jest…
    expect(result.rows.map((row) => row.id)).toContain(productA.productId);
    // …a produkt B NIE. Ta asercja pali po zdjęciu `.eq("tenant_id", …)`
    // z zapytania produktów w lib/catalog/list-query.ts.
    expect(result.rows.map((row) => row.id)).not.toContain(productB.productId);
    expect(result.rows).toHaveLength(1);
  });

  it("liczba „dziś w terenie” nie wchłania cudzych wydań", async () => {
    const result = await fetchCatalogList(admin, tenantA.tenantId, options);
    const row = result.rows.find((item) => item.id === productA.productId)!;

    // Trzy pozycje A obejmują dziś; rezerwacja i najem zakończony wczoraj nie.
    expect(row.deployedToday).toBe(3);
    expect(row.unitCount).toBe(6);

    // Kontrola z drugiej strony: B ma własne dwie sztuki w terenie i jego
    // liczba NIE jest liczbą A (gdyby agregat przestał zawężać po tenancie,
    // obie strony pokazałyby 5).
    const resultB = await fetchCatalogList(admin, tenantB.tenantId, options);
    expect(resultB.rows.find((item) => item.id === productB.productId)!.deployedToday).toBe(2);
  });

  it("fraza `q` nie ma czym zmienić zapytania — wynik zostaje przy najemcy", async () => {
    // Ładunki celujące w składnię filtrów PostgREST i w SQL. Fraza wchodzi
    // TAM, GDZIE WCHODZI NA EKRANIE: przez schemat parametrów i filtr
    // w pamięci, nigdy do budowy zapytania.
    const payloads = [
      "*",
      "'",
      "%",
      "tenant_id.neq.00000000-0000-0000-0000-000000000000",
      "name.ilike.*,tenant_id.not.is.null",
      "Rower najemcy B",
      "' or 1=1 --",
    ];

    for (const payload of payloads) {
      const filter = productsFilterSchema.parse({ q: payload });
      const result = await fetchCatalogList(admin, tenantA.tenantId, options);
      const visible = filterProductsBySearch(
        filterProductsByStatus(result.rows, filter.status),
        filter.q ?? "",
      );
      expect(
        visible.map((row) => row.id),
        `fraza „${payload}" wyniosła wiersz spoza najemcy`,
      ).not.toContain(productB.productId);
      expect(result.rows).toHaveLength(1);
    }

    // Kontrola pozytywna dla samej wyszukiwarki: fraza w OGÓLE działa —
    // inaczej testy wyżej byłyby zielone przy filtrze zwracającym pustkę.
    const own = await fetchCatalogList(admin, tenantA.tenantId, options);
    expect(filterProductsBySearch(own.rows, "najemcy A")).toHaveLength(1);
    expect(filterProductsBySearch(own.rows, "najemcy B")).toHaveLength(0);
  });

  it("miniatura powstaje ze ścieżki najemcy i nigdy z cudzej", async () => {
    const result = await fetchCatalogList(admin, tenantA.tenantId, options);
    const row = result.rows.find((item) => item.id === productA.productId)!;

    // URL jest zbudowany ze ścieżki PRZECZYTANEJ z bazy pod zawężeniem…
    expect(row.thumbnail).not.toBeNull();
    expect(row.thumbnail!.url).toContain(productA.storagePath);
    expect(row.thumbnail!.url).toContain("/storage/v1/object/public/product-images/");

    // …a ścieżka drugiego najemcy nie pojawia się NIGDZIE w wyniku. Bucket
    // jest publiczny, więc wyciek ścieżki = wyciek pliku.
    const serialized = JSON.stringify(result.rows);
    expect(serialized).not.toContain(productB.storagePath);
    expect(serialized).not.toContain(tenantB.tenantId);
  });

  it("cudza sesja nie dostaje ani wiersza, ani URL-a — nawet z podstawionym tenant_id", async () => {
    // Panel poda tu tenant_id z claimu, ale sonda podstawia CUDZY: RLS jest
    // bramką ostateczną i musi trzymać niezależnie od argumentu.
    const forged = await fetchCatalogList(tenantB.client, tenantA.tenantId, options);
    expect(forged.rows).toEqual([]);
    expect(forged.hasAnyProducts).toBe(false);

    // Ta sama sesja z WŁASNYM tenantem widzi wyłącznie swój produkt —
    // dowód, że pustka wyżej to odmowa, a nie zepsuty klient.
    const own = await fetchCatalogList(tenantB.client, tenantB.tenantId, options);
    expect(own.rows.map((row) => row.id)).toEqual([productB.productId]);
  });

  it("cudza sesja nie odczyta metadanych zdjęć drugiego najemcy", async () => {
    const { data, error } = await tenantB.client
      .from("product_images")
      .select("storage_path")
      .eq("product_id", productA.productId);
    expect(error).toBeNull();
    expect(data, "tenant B odczytał ścieżkę zdjęcia tenanta A").toEqual([]);
  });
});
