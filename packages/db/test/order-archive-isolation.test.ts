/**
 * Sonda izolacji archiwizacji zamówień (ADR-242, migracja 0100).
 *
 * Macierz `rls-isolation.test.ts` już dowodzi, że goła mutacja UPDATE na
 * `orders` nie dosięga wierszy cudzego tenanta (a archiwizacja to WŁAŚNIE
 * UPDATE kolumny `archived_at`). Ten plik dokłada dowód W KSZTAŁCIE, w jakim
 * archiwizuje PRODUKCJA: dokładnie te zapytania, które składa
 * `archiveOrderAction`/`restoreOrderAction` (zawężenie `tenant_id` + `id`,
 * `.select("id")` po UPDATE). Chroni to konkretną ścieżkę przed regresją, na
 * którą macierz — z natury ogólna — nie patrzy: „tenant A nie zarchiwizuje
 * ani nie przywróci zamówienia tenanta B" kończy się ZEROWYM wierszem (odmowa
 * czytelna dla akcji), a trwały stan wiersza B pozostaje nietknięty.
 *
 * Kontrola trwałego stanu idzie odczytem service-role (omija RLS) — nie
 * odpowiedzią PostgREST, która przez politykę SELECT potrafi zamaskować udaną
 * mutację (ta sama dyscyplina, co w macierzy).
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_*; bez nich plik jest
 * pomijany (jak reszta suity integracyjnej).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { integrationEnv } from "./helpers/integration-env";
import { cleanupSeeded, createAdminClient, seedTwoTenants, type TenantCtx } from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/** Wstawia zamówienie tenanta service-rolem i oddaje jego id (wzorzec createOrder). */
async function seedOrder(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data: customer, error: customerError } = await admin
    .from("customers")
    .insert({ tenant_id: tenantId, email: `archive-${randomUUID()}@test.local`, full_name: "Archiwum test" })
    .select("id")
    .single();
  if (customerError || !customer) throw new Error(`seedOrder: klient — ${customerError?.message}`);

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      customer_id: customer.id,
      start_date: "2026-08-01",
      end_date: "2026-08-03",
      delivery_method: "courier",
    })
    .select("id")
    .single();
  if (orderError || !order) throw new Error(`seedOrder: zamówienie — ${orderError?.message}`);
  return order.id as string;
}

/** Znacznik archived_at wiersza z odczytu service-role (omija RLS). */
async function archivedAtOf(admin: SupabaseClient, orderId: string): Promise<string | null> {
  const { data, error } = await admin.from("orders").select("archived_at").eq("id", orderId).single();
  if (error || !data) throw new Error(`archivedAtOf: ${error?.message}`);
  return (data.archived_at as string | null) ?? null;
}

describe.skipIf(!hasEnv)("izolacja archiwizacji zamówień (ADR-242)", () => {
  let admin: SupabaseClient;
  let a: TenantCtx;
  let b: TenantCtx;
  let orderB: string;

  beforeAll(async () => {
    admin = createAdminClient();
    ({ a, b } = await seedTwoTenants());
    orderB = await seedOrder(admin, b.tenantId);
  }, 60_000);

  afterAll(async () => {
    await cleanupSeeded(admin);
  }, 60_000);

  it("tenant B archiwizuje i przywraca WŁASNE zamówienie (kontrola pozytywna)", async () => {
    // Kształt dokładnie jak w akcji: tenant-scope z sesji + id, .select() po UPDATE.
    const stamp = new Date().toISOString();
    const { data: archived, error: archiveError } = await b.ownerClient
      .from("orders")
      .update({ archived_at: stamp })
      .eq("tenant_id", b.tenantId)
      .eq("id", orderB)
      .select("id");
    expect(archiveError, `archiwizacja własnego: ${archiveError?.message}`).toBeNull();
    expect(archived ?? [], "własne zamówienie nie zwróciło wiersza po archiwizacji").toHaveLength(1);
    expect(await archivedAtOf(admin, orderB), "archived_at nie zapisany").not.toBeNull();

    const { data: restored, error: restoreError } = await b.ownerClient
      .from("orders")
      .update({ archived_at: null })
      .eq("tenant_id", b.tenantId)
      .eq("id", orderB)
      .select("id");
    expect(restoreError, `przywrócenie własnego: ${restoreError?.message}`).toBeNull();
    expect(restored ?? [], "własne zamówienie nie zwróciło wiersza po przywróceniu").toHaveLength(1);
    expect(await archivedAtOf(admin, orderB), "archived_at nie wyzerowany").toBeNull();
  });

  it("tenant A nie zarchiwizuje zamówienia tenanta B (odmowa zerowego wiersza)", async () => {
    const before = await archivedAtOf(admin, orderB);

    // (1) Kształt akcji: A zawęża WŁASNYM tenantem — id należy do B, więc zero.
    const { data: actionShape, error: actionError } = await a.ownerClient
      .from("orders")
      .update({ archived_at: new Date().toISOString() })
      .eq("tenant_id", a.tenantId)
      .eq("id", orderB)
      .select("id");
    expect(actionError, "UPDATE kształtem akcji: nieoczekiwany błąd zamiast filtrowania").toBeNull();
    expect(actionShape ?? [], "A dosięgnął zamówienia B kształtem akcji").toHaveLength(0);

    // (2) Kształt sfałszowany: A podstawia tenant_id B — polityka USING (tenant
    // = app.tenant_id() = A) i tak nie dopuszcza wiersza B do UPDATE.
    const { data: forgedShape } = await a.ownerClient
      .from("orders")
      .update({ archived_at: new Date().toISOString() })
      .eq("tenant_id", b.tenantId)
      .eq("id", orderB)
      .select("id");
    expect(forgedShape ?? [], "A dosięgnął zamówienia B sfałszowanym tenant_id").toHaveLength(0);

    // Trwały stan B nietknięty (odczyt service-role, omija RLS).
    expect(await archivedAtOf(admin, orderB), "stan archived_at zamówienia B zmieniony przez A").toBe(before);
  });

  it("tenant A nie przywróci zarchiwizowanego zamówienia tenanta B", async () => {
    // Najpierw B archiwizuje własne (service-role, żeby mieć co przywracać).
    await admin.from("orders").update({ archived_at: new Date().toISOString() }).eq("id", orderB);
    const before = await archivedAtOf(admin, orderB);
    expect(before, "przygotowanie: zamówienie B powinno być zarchiwizowane").not.toBeNull();

    const { data: byAction } = await a.ownerClient
      .from("orders")
      .update({ archived_at: null })
      .eq("tenant_id", a.tenantId)
      .eq("id", orderB)
      .select("id");
    expect(byAction ?? [], "A przywrócił zamówienie B kształtem akcji").toHaveLength(0);

    const { data: byForged } = await a.ownerClient
      .from("orders")
      .update({ archived_at: null })
      .eq("tenant_id", b.tenantId)
      .eq("id", orderB)
      .select("id");
    expect(byForged ?? [], "A przywrócił zamówienie B sfałszowanym tenant_id").toHaveLength(0);

    expect(await archivedAtOf(admin, orderB), "A wyzerował archived_at zamówienia B").toBe(before);

    // Sprzątanie: przywróć własną instancją B, żeby kolejne reruny startowały czysto.
    await admin.from("orders").update({ archived_at: null }).eq("id", orderB);
  });
});
