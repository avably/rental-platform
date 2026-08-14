/**
 * Przedłużenie najmu na poziomie bazy (Zadanie 6, ADR-028): ZERO nowych
 * migracji — zmiana end_date przechodzi przez bramkę dat z 0010 (sekcja 4:
 * BEFORE UPDATE na orders woła app.assert_unit_available per pozycja,
 * z wykluczeniem własnej). Ten plik dowodzi scenariuszy PRZEDŁUŻENIA:
 *
 *   1. pojedynczy UPDATE end_date + total_rental_grosze: sukces zapisuje
 *      OBIE kolumny; własna pozycja nie koliduje sama ze sobą (wykluczenie
 *      p_exclude_item_id — bez niego stary termin zawsze nachodzi na nowy),
 *   2. przedłużenie w termin następnego najmu tego samego egzemplarza:
 *      23P01, którego treść NIE niesie już numeru kolidującego zamówienia
 *      (ADR-181/0082 — ta sama bramka odmawia klientowi sklepu), a odmowa
 *      wycofuje OBIE kolumny (atomowość jednej instrukcji),
 *   3. zamówienie wieloproduktowe: bramka re-waliduje każdą pozycję
 *      z wykluczeniem jej samej — przedłużenie bez kolizji przechodzi,
 *   4. dokumentacja residuum ADR-028: edycja dat zamówienia TERMINALNEGO
 *      nie przechodzi przez bramkę — returned/cancelled są poza listą
 *      statusów blokujących, więc nie mogą wytworzyć podwójnego wynajmu;
 *      pin świadomej decyzji „bez migracji 0012".
 *
 * Klient service-role (wzorzec order-gates.test.ts): bramka jest
 * zachowaniem SCHEMATU i obowiązuje każdą rolę; ścieżkę sesji członka
 * pokrywa apps/panel/test/extensions.test.ts. Mechanikę bramki (macierz
 * buforów, okna serwisowe, wyścig) dowodzi order-gates.test.ts — tu jej
 * nie powtarzamy.
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (docs/konwencje-
 * migracji.md). Bez nich strażnik integration-env failuje suitę.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";

const hasEnv = integrationEnv([
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
]);

/** Kod bramki 0010 — patrz nagłówek migracji. */
const PG_UNIT_CONFLICT = "23P01";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

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

describe.skipIf(!hasEnv)("przedłużenie najmu przez bramkę dat z 0010", () => {
  let admin: SupabaseClient;
  let tenantId: string;
  let customerId: string;
  const createdTenantIds: string[] = [];

  async function createProduct(): Promise<string> {
    const { data, error } = await admin
      .from("products")
      .insert({
        tenant_id: tenantId,
        name: `Zagęszczarka ${randomUUID().slice(0, 8)}`,
        base_price_day_grosze: 10_000,
        buffer_before_days: 1,
        buffer_after_days: 1,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createProduct: ${error?.message}`);
    return data.id as string;
  }

  async function createUnit(productId: string): Promise<string> {
    const { data, error } = await admin
      .from("product_units")
      .insert({ tenant_id: tenantId, product_id: productId })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createUnit: ${error?.message}`);
    return data.id as string;
  }

  async function createOrder(
    start: string,
    end: string,
    totalRentalGrosze: number,
  ): Promise<{ orderId: string; orderNumber: string }> {
    const { data, error } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        start_date: start,
        end_date: end,
        delivery_method: "courier",
        total_rental_grosze: totalRentalGrosze,
      })
      .select("id, order_number")
      .single();
    if (error || !data) throw new Error(`createOrder: ${error?.message}`);
    return { orderId: data.id as string, orderNumber: data.order_number as string };
  }

  async function insertItem(orderId: string, productId: string, unitId: string): Promise<void> {
    const { error } = await admin.from("order_items").insert({
      tenant_id: tenantId,
      order_id: orderId,
      product_id: productId,
      unit_id: unitId,
      rental_grosze: 10_000,
    });
    if (error) throw new Error(`insertItem: ${error.message}`);
  }

  /** Legalny spacer po mapie przejść — bramka 0010 obowiązuje też service_role. */
  async function walkTo(orderId: string, steps: string[]): Promise<void> {
    for (const step of steps) {
      const { data, error } = await admin
        .from("orders")
        .update({ order_status: step })
        .eq("id", orderId)
        .select("id");
      if (error || !data || data.length === 0) {
        throw new Error(`walkTo na kroku ${step}: ${error?.message ?? "zero wierszy"}`);
      }
    }
  }

  beforeAll(async () => {
    admin = createAdminClient();

    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .insert({
        slug: `ext-${randomUUID()}`.slice(0, 39),
        name: "Tenant testów przedłużeń",
      })
      .select("id")
      .single();
    if (tenantError || !tenant) throw new Error(`createTenant: ${tenantError?.message}`);
    tenantId = tenant.id as string;
    createdTenantIds.push(tenantId);

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, email: `ext-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`createCustomer: ${customerError?.message}`);
    customerId = customer.id as string;
  }, 60_000);

  afterAll(async () => {
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
    }
  }, 60_000);

  it("przedłużenie bez kolizji: jeden UPDATE zapisuje end_date I total, własna pozycja wykluczona", async () => {
    const productId = await createProduct();
    const unitId = await createUnit(productId);
    const { orderId } = await createOrder("2027-03-01", "2027-03-05", 50_000);
    await insertItem(orderId, productId, unitId);
    // Sąsiad ZA przedłużeniem: 2027-03-10..12. Rozszerzony zakres po
    // przedłużeniu do 03-08 (bufory 1/1) = [02-28..03-09] — nie dotyka go.
    const neighbour = await createOrder("2027-03-10", "2027-03-12", 30_000);
    await insertItem(neighbour.orderId, productId, unitId);

    // Bez wykluczenia własnej pozycji ten UPDATE NIE MA PRAWA przejść:
    // stary termin (03-01..05) zawsze nachodzi na nowy (03-01..08).
    const { data, error } = await admin
      .from("orders")
      .update({ end_date: "2027-03-08", total_rental_grosze: 75_000 })
      .eq("id", orderId)
      .select("end_date, total_rental_grosze");
    expect(error).toBeNull();
    expect(data).toEqual([{ end_date: "2027-03-08", total_rental_grosze: 75_000 }]);
  });

  it("przedłużenie w kolizję z NASTĘPNYM najmem: 23P01 BEZ identyfikatorów, obie kolumny wycofane", async () => {
    const productId = await createProduct();
    const unitId = await createUnit(productId);
    const { orderId } = await createOrder("2027-03-01", "2027-03-05", 50_000);
    await insertItem(orderId, productId, unitId);
    const neighbour = await createOrder("2027-03-10", "2027-03-12", 30_000);
    await insertItem(neighbour.orderId, productId, unitId);

    // Przedłużenie do 03-09: rozszerzony koniec (bufor after 1) = 03-10
    // dotyka startu sąsiada — kolizja.
    const { error } = await admin
      .from("orders")
      .update({ end_date: "2027-03-09", total_rental_grosze: 85_000 })
      .eq("id", orderId);
    expect(error?.code).toBe(PG_UNIT_CONFLICT);
    // ADR-181 (0082): odmowa bramki niesie KOD, nie dane. Numer sąsiada wyszedł
    // z treści, bo ta sama funkcja odmawia też niezalogowanemu klientowi sklepu
    // (`app.public_checkout` nie łapie wyjątku) — pełny dowód w
    // public-checkout.test.ts. Tu pilnujemy, żeby nie wrócił tą drogą.
    expect(
      error?.message,
      "treść odmowy znów niesie numer kolidującego zamówienia (regres ADR-181)",
    ).not.toContain(neighbour.orderNumber);
    expect(error?.message).toBe("Egzemplarz jest zajęty w wybranym terminie.");

    // Atomowość jednej instrukcji: odmowa bramki wycofała OBIE kolumny.
    const { data: after } = await admin
      .from("orders")
      .select("end_date, total_rental_grosze")
      .eq("id", orderId)
      .single();
    expect(after).toEqual({ end_date: "2027-03-05", total_rental_grosze: 50_000 });
  });

  it("zamówienie wieloproduktowe: każda pozycja wykluczona z własnej listy kolizji", async () => {
    const productA = await createProduct();
    const productB = await createProduct();
    const unitA = await createUnit(productA);
    const unitB = await createUnit(productB);
    const { orderId } = await createOrder("2027-04-01", "2027-04-05", 100_000);
    await insertItem(orderId, productA, unitA);
    await insertItem(orderId, productB, unitB);

    const { data, error } = await admin
      .from("orders")
      .update({ end_date: "2027-04-08", total_rental_grosze: 160_000 })
      .eq("id", orderId)
      .select("end_date, total_rental_grosze");
    expect(error).toBeNull();
    expect(data).toEqual([{ end_date: "2027-04-08", total_rental_grosze: 160_000 }]);
  });

  it("dokumentacja ADR-028: daty zamówienia terminalnego nie przechodzą przez bramkę", async () => {
    const productId = await createProduct();
    const unitId = await createUnit(productId);
    const { orderId } = await createOrder("2027-05-01", "2027-05-05", 50_000);
    await insertItem(orderId, productId, unitId);
    await walkTo(orderId, ["reserved", "ready_for_pickup", "picked_up", "returned"]);

    // returned jest POZA listą statusów blokujących: nie blokuje egzemplarza,
    // więc edycja jego dat nie może wytworzyć podwójnego wynajmu — baza jej
    // ŚWIADOMIE nie bramkuje (zaakceptowane residuum, panel odmawia filtrem
    // statusów w akcji). Ten pin płonie, gdyby ktoś dołożył bramkę dat na
    // statusach terminalnych — wtedy ADR-028 wymaga rewizji, nie łatki.
    const { data, error } = await admin
      .from("orders")
      .update({ end_date: "2027-05-08" })
      .eq("id", orderId)
      .select("end_date");
    expect(error).toBeNull();
    expect(data).toEqual([{ end_date: "2027-05-08" }]);
  });
});
