/**
 * Testy integracyjne zamówień (Zadanie 4) na żywym, lokalnym Supabase —
 * wzorzec catalog.test.ts: realni użytkownicy, realne sesje, zero mocków.
 *
 * Weryfikują ścieżkę PANELU (klient z sesją, zero service-role):
 *   1. członek tenanta tworzy zamówienie przez app.create_order z kwotami
 *      policzonymi silnikiem — dokładnie tak, jak robi to createOrderAction;
 *      wiersze w bazie niosą kwoty silnika co do grosza,
 *   2. tenant B nie widzi, nie zmieni i nie podepnie się pod zamówienia A
 *      (SELECT pusty, UPDATE dosięga zero wierszy, INSERT pozycji do cudzego
 *      zamówienia odrzuca klucz złożony — 23503),
 *   3. atomowość create_order z sesji członka: kolizja egzemplarza (23P01)
 *      nie zostawia zamówienia-sieroty,
 *   4. zmiana statusu jak w akcji panelu (optymistyczne expectedFrom):
 *      chybione expectedFrom dosięga zero wierszy — błąd, nie cichy sukces.
 *
 * Mechanikę bramek 0010 (36 par przejść, macierz scenariuszy dostępności,
 * wyścig dwóch sesji) dowodzi packages/db/test/order-gates.test.ts — tu jej
 * nie powtarzamy.
 */
import { randomUUID } from "node:crypto";

import { calculatePrice } from "@avably/core";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "OrdersTest!12345678";
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

function createAnonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

/** User + własna organizacja + ŚWIEŻA sesja (JWT z claimem tenant_id). */
async function createTenantMember(
  admin: SupabaseClient,
  label: string,
): Promise<{ client: SupabaseClient; tenantId: string }> {
  const email = `ord-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await bootstrap.schema("app").rpc("create_tenant", {
    p_slug: `ord-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja zamówień ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

describe.skipIf(!hasEnv)("zamówienia (RLS 0007 + bramki 0010, ścieżka panelu)", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };
  let customerId: string;
  let productId: string;
  let unitId: string;
  let orderId: string;

  /** Cennik jak w katalogu demo: baza 100 zł, próg 7 dni za 6.5×, kaucja 50 zł. */
  const PRICING = {
    basePriceDayGrosze: 10_000,
    depositGrosze: 5_000,
    autoIncrementMultiplier: 1.0,
    tiers: [{ tierDays: 7, multiplier: 6.5 }],
  };

  beforeAll(async () => {
    admin = createAdminClient();
    tenantA = await createTenantMember(admin, "a");
    tenantB = await createTenantMember(admin, "b");

    // Katalog tenanta A — z sesji członka, jak w panelu.
    const { data: customer, error: customerError } = await tenantA.client
      .from("customers")
      .insert({ tenant_id: tenantA.tenantId, email: `klient-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (customerError) throw new Error(`insert customers: ${customerError.message}`);
    customerId = customer!.id as string;

    const { data: product, error: productError } = await tenantA.client
      .from("products")
      .insert({
        tenant_id: tenantA.tenantId,
        name: "Zagęszczarka testowa",
        base_price_day_grosze: PRICING.basePriceDayGrosze,
        deposit_grosze: PRICING.depositGrosze,
        buffer_before_days: 1,
        buffer_after_days: 1,
      })
      .select("id")
      .single();
    if (productError) throw new Error(`insert products: ${productError.message}`);
    productId = product!.id as string;

    const { error: tierError } = await tenantA.client.from("pricing_tiers").insert({
      tenant_id: tenantA.tenantId,
      product_id: productId,
      tier_days: 7,
      multiplier: 6.5,
    });
    if (tierError) throw new Error(`insert pricing_tiers: ${tierError.message}`);

    const { data: unit, error: unitError } = await tenantA.client
      .from("product_units")
      .insert({ tenant_id: tenantA.tenantId, product_id: productId, serial_number: "ORD-001" })
      .select("id")
      .single();
    if (unitError) throw new Error(`insert product_units: ${unitError.message}`);
    unitId = unit!.id as string;
  }, 60_000);

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

  it("członek A tworzy zamówienie przez app.create_order — kwoty w bazie == silnik co do grosza", async () => {
    // Dokładnie ścieżka createOrderAction: wycena silnikiem, zapis RPC.
    const engine = calculatePrice("2026-09-01", "2026-09-07", PRICING);
    expect(engine.rentalGrosze, "pin ADR-018: 7 dni progu 6.5 przy bazie 100 zł").toBe(65_000);

    const { data, error } = await tenantA.client.schema("app").rpc("create_order", {
      p_customer_id: customerId,
      p_start_date: "2026-09-01",
      p_end_date: "2026-09-07",
      p_delivery_method: "courier",
      p_pickup_location_id: null,
      p_notes: "test integracyjny",
      p_total_rental_grosze: engine.rentalGrosze,
      p_total_deposit_grosze: engine.depositGrosze,
      p_items: [
        {
          product_id: productId,
          unit_id: unitId,
          rental_grosze: engine.rentalGrosze,
          deposit_grosze: engine.depositGrosze,
        },
      ],
    });
    expect(error, `create_order: ${error?.message}`).toBeNull();
    orderId = data as string;

    const { data: order } = await tenantA.client
      .from("orders")
      .select("order_number, order_status, total_rental_grosze, total_deposit_grosze, order_items(unit_id, rental_grosze)")
      .eq("id", orderId)
      .single();
    expect(order).toMatchObject({
      order_status: "pending",
      total_rental_grosze: 65_000,
      total_deposit_grosze: 5_000,
    });
    expect(order!.order_number as string).toMatch(/^AV-\d{4}-\d{3,}$/);
    expect(order!.order_items).toEqual([{ unit_id: unitId, rental_grosze: 65_000 }]);
  });

  it("tenant B nie widzi zamówień A (SELECT pusty na orders i order_items)", async () => {
    for (const table of ["orders", "order_items"]) {
      const { data, error } = await tenantB.client.from(table).select("id");
      expect(error, `${table}: ${error?.message}`).toBeNull();
      expect(data, `tenant B widzi wiersze ${table} tenanta A`).toEqual([]);
    }
  });

  it("tenant B nie zmieni zamówienia A: UPDATE dosięga zero wierszy, dane nietknięte", async () => {
    const { data, error } = await tenantB.client
      .from("orders")
      .update({ notes: "przejęte" })
      .eq("id", orderId)
      .select("id");
    expect(error).toBeNull();
    expect(data, "UPDATE cudzego zamówienia dosięgnął wierszy").toEqual([]);

    const { data: after } = await admin.from("orders").select("notes").eq("id", orderId).single();
    expect(after).toMatchObject({ notes: "test integracyjny" });
  });

  it("tenant B nie podepnie pozycji pod zamówienie A (klucz złożony — 23503)", async () => {
    const { data: ownProduct } = await tenantB.client
      .from("products")
      .insert({ tenant_id: tenantB.tenantId, name: "Cudzy produkt", base_price_day_grosze: 100 })
      .select("id")
      .single();

    const { error } = await tenantB.client.from("order_items").insert({
      tenant_id: tenantB.tenantId,
      order_id: orderId,
      product_id: ownProduct!.id,
      rental_grosze: 1,
    });
    expect(error?.code, "pozycja B podpięła się pod zamówienie A").toBe("23503");
  });

  it("kolizja egzemplarza z sesji członka: 23P01 i ZERO zamówień-sierot", async () => {
    const { count: before } = await tenantA.client
      .from("orders")
      .select("id", { count: "exact", head: true });

    // Ten sam egzemplarz, termin wewnątrz już wynajętego — bramka 0010.
    const { error } = await tenantA.client.schema("app").rpc("create_order", {
      p_customer_id: customerId,
      p_start_date: "2026-09-03",
      p_end_date: "2026-09-04",
      p_delivery_method: "courier",
      p_pickup_location_id: null,
      p_notes: null,
      p_total_rental_grosze: 20_000,
      p_total_deposit_grosze: 0,
      p_items: [
        { product_id: productId, unit_id: unitId, rental_grosze: 20_000, deposit_grosze: 0 },
      ],
    });
    expect(error?.code, "kolizja egzemplarza nie została odrzucona").toBe("23P01");

    const { count: after } = await tenantA.client
      .from("orders")
      .select("id", { count: "exact", head: true });
    expect(after, "odmowa bramki zostawiła zamówienie-sierotę").toBe(before);
  });

  it("zmiana statusu jak w panelu: expectedFrom trafia, chybione dosięga zero wierszy", async () => {
    // Ścieżka changeOrderStatusAction: UPDATE z .eq(order_status=expectedFrom).
    const { data: changed, error } = await tenantA.client
      .from("orders")
      .update({ order_status: "reserved" })
      .eq("tenant_id", tenantA.tenantId)
      .eq("id", orderId)
      .eq("order_status", "pending")
      .select("id");
    expect(error, `pending→reserved: ${error?.message}`).toBeNull();
    expect(changed).toHaveLength(1);

    // Drugi operator działa na nieświeżym stanie (wciąż widzi pending):
    // zero wierszy, żadnego przejścia — dokładnie po to jest expectedFrom.
    const { data: stale, error: staleError } = await tenantA.client
      .from("orders")
      .update({ order_status: "cancelled" })
      .eq("tenant_id", tenantA.tenantId)
      .eq("id", orderId)
      .eq("order_status", "pending")
      .select("id");
    expect(staleError).toBeNull();
    expect(stale, "UPDATE z nieaktualnym expectedFrom dosięgnął wierszy").toEqual([]);

    const { data: current } = await tenantA.client
      .from("orders")
      .select("order_status")
      .eq("id", orderId)
      .single();
    expect(current).toMatchObject({ order_status: "reserved" });
  });
});
