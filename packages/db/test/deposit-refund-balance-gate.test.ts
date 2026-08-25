/**
 * Bramka salda na WYSTAWIENIU żądania zwrotu kaucji
 * (packages/db/supabase/migrations/0111_deposit_refund_balance_gate.sql, ADR-269)
 * — dowód money-critical dla Finding 1 audytu cyklu zamówienia.
 *
 * DLACZEGO NA ŻYWEJ BAZIE. Reguła jest WŁASNOŚCIĄ BAZY: trigger BEFORE INSERT na
 * `deposit_refunds` odrzuca żądanie zwrotu większe niż saldo kaucji (pobrania
 * minus zwroty i potrącenia) ZANIM `requestDepositRefund` zdąży wywołać
 * `createRefund`. Atrapa klienta przepuściłaby suitę także wtedy, gdyby triggera
 * nie było. Zapisy idą kluczem service_role (BYPASSRLS): jeśli bramka trzyma rolę
 * omijającą polityki, trzyma każdą — ten sam dowód, co przy bramkach 0011.
 *
 * DOWÓD MUTACYJNY (wykonywany ręcznie, nie w suicie — DROP triggera na
 * współdzielonej bazie uderzyłby w równoległe sesje): po
 * `drop trigger deposit_refund_balance_gate on public.deposit_refunds;`
 * INSERT żądania z kwotą ponad saldo PRZECHODZI (zwrot dochodzi do dostawcy) —
 * czyli test „ponad saldo → 23514" świeci na czerwono. Po odtworzeniu triggera
 * wraca na zielono.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*
 * (patrz docs/konwencje-migracji.md). Bez nich cały plik jest pomijany.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import { createAdminClient } from "./helpers/seed-tenants";

const hasEnv = integrationEnv([
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
]);

/** 23514 = check_violation: żądany zwrot przekracza saldo kaucji (ADR-269). */
const PG_BALANCE_GATE = "23514";

describe.skipIf(!hasEnv)("bramka salda żądania zwrotu — 0111_deposit_refund_balance_gate.sql", () => {
  let admin: SupabaseClient;
  const createdTenantIds: string[] = [];

  beforeAll(() => {
    admin = createAdminClient();
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
  });

  async function createTenant(label: string): Promise<string> {
    const { data, error } = await admin
      .from("tenants")
      .insert({
        slug: `dep-refund-gate-${label}-${randomUUID()}`.slice(0, 39),
        name: `Deposit refund gate tenant ${label}`,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createTenant(${label}): ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  /** Zamówienie-nośnik + wybrane saldo kaucji w rejestrze zdarzeń. */
  async function seedOrderWithBalance(
    tenantId: string,
    events: readonly { kind: "collected" | "refunded" | "deducted"; amount_grosze: number; reason_code?: string }[],
  ): Promise<string> {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, email: `dep-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`seed/customer: ${customerError?.message}`);

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        start_date: "2026-09-01",
        end_date: "2026-09-03",
        delivery_method: "courier",
        total_deposit_grosze: 100_00,
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(`seed/order: ${orderError?.message}`);
    const orderId = order.id as string;

    for (const event of events) {
      const { error } = await admin
        .from("deposit_events")
        .insert({ tenant_id: tenantId, order_id: orderId, ...event })
        .select("id");
      if (error) throw new Error(`seed/event(${event.kind}): ${error.message}`);
    }
    return orderId;
  }

  async function insertRefundRequest(
    tenantId: string,
    orderId: string,
    amountGrosze: number,
  ): Promise<{ errorCode?: string; errorMessage?: string }> {
    const { error } = await admin
      .from("deposit_refunds")
      .insert({ tenant_id: tenantId, order_id: orderId, amount_grosze: amountGrosze })
      .select("id");
    return { errorCode: error?.code, errorMessage: error?.message };
  }

  it("zwrot RÓWNY saldu przechodzi, każdy grosz ponad płonie 23514 — PRZED wyjściem do dostawcy", async () => {
    const tenantId = await createTenant("equal");
    // Saldo = 100,00 (samo pobranie).
    const orderId = await seedOrderWithBalance(tenantId, [{ kind: "collected", amount_grosze: 100_00 }]);

    const overByOne = await insertRefundRequest(tenantId, orderId, 100_01);
    expect(overByOne.errorCode, `zwrot 100,01 ponad saldo przeszedł: ${overByOne.errorMessage}`).toBe(
      PG_BALANCE_GATE,
    );

    // Kwota dokładnie równa saldu jest legalna — granica nie jest odmową.
    const exact = await insertRefundRequest(tenantId, orderId, 100_00);
    expect(exact.errorMessage, `zwrot równy saldu odrzucony: ${exact.errorMessage}`).toBeUndefined();
  });

  it("saldo liczy się z pobrań MINUS zwroty i potrącenia, nie z samego pobrania", async () => {
    const tenantId = await createTenant("net");
    // Pobrano 100,00, potrącono 40,00 → saldo 60,00.
    const orderId = await seedOrderWithBalance(tenantId, [
      { kind: "collected", amount_grosze: 100_00 },
      { kind: "deducted", amount_grosze: 40_00, reason_code: "damage" },
    ]);

    const overNet = await insertRefundRequest(tenantId, orderId, 60_01);
    expect(overNet.errorCode, `zwrot 60,01 ponad saldo netto przeszedł: ${overNet.errorMessage}`).toBe(
      PG_BALANCE_GATE,
    );

    const withinNet = await insertRefundRequest(tenantId, orderId, 60_00);
    expect(withinNet.errorMessage, `zwrot 60,00 w saldzie netto odrzucony: ${withinNet.errorMessage}`).toBeUndefined();
  });

  it("żądanie zwrotu bez ŻADNEGO pobrania płonie 23514", async () => {
    const tenantId = await createTenant("empty");
    const orderId = await seedOrderWithBalance(tenantId, []);

    const { errorCode, errorMessage } = await insertRefundRequest(tenantId, orderId, 1_00);
    expect(errorCode, `zwrot z pustego rejestru przeszedł: ${errorMessage}`).toBe(PG_BALANCE_GATE);
  });

  it("saldo sąsiedniego zamówienia nie kredytuje żądania zwrotu tego zamówienia", async () => {
    const tenantId = await createTenant("neighbour");
    // Zamówienie A ma saldo, B nie ma. Żądanie na B nie może czerpać z A.
    await seedOrderWithBalance(tenantId, [{ kind: "collected", amount_grosze: 100_00 }]);
    const orderB = await seedOrderWithBalance(tenantId, []);

    const { errorCode, errorMessage } = await insertRefundRequest(tenantId, orderB, 1_00);
    expect(errorCode, `zwrot na cudzym saldzie przeszedł: ${errorMessage}`).toBe(PG_BALANCE_GATE);
  });
});
