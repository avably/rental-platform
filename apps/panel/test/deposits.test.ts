/**
 * Testy integracyjne rozliczeń kaucji (Zadanie 5) na żywym, lokalnym
 * Supabase — wzorzec orders.test.ts: realni użytkownicy, realne sesje,
 * zero mocków.
 *
 * Weryfikują ścieżkę PANELU (klient z sesją, zero service-role):
 *   1. członek rejestruje pobranie → zwrot częściowy → potrącenie z kodem
 *      dokładnie tak, jak robią to akcje deposit-actions.ts; wiersze niosą
 *      kwoty, kod powodu i created_by,
 *   2. nadmiarowy zwrot z sesji członka dostaje 23514 — kod, na który
 *      akcja mapuje komunikat dla operatora,
 *   3. pełne rozliczenie (także samym potrąceniem) spełnia warunek
 *      isDepositSettled i UPDATE payment_status='deposit_refunded'
 *      przechodzi z sesji członka (ADR-027); częściowe rozliczenie
 *      warunku NIE spełnia,
 *   4. izolacja: członek tenanta B nie wstawi zdarzenia do zamówienia A
 *      (WITH CHECK 42501 przy własnym claimie na cudzy tenant_id, 23503
 *      z klucza złożonego przy własnym tenant_id i cudzym order_id)
 *      i nie widzi rejestru A (SELECT pusty).
 *
 * Mechanikę bramek 0011 (kształt powodu, niezmiennik, bulk, wyścig dwóch
 * sesji) dowodzi packages/db/test/deposit-gates.test.ts — tu jej nie
 * powtarzamy.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import {
  depositTotals,
  isDepositSettled,
  type DepositEventRow,
} from "@/app/[locale]/zamowienia/[id]/deposit";

import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "DepositsTest!12345678";
const PG_DEPOSIT_GATE = "23514";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_RLS_WITH_CHECK = "42501";

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
): Promise<{ client: SupabaseClient; tenantId: string; userId: string }> {
  const email = `dep-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await bootstrap.schema("app").rpc("create_tenant", {
    p_slug: `dep-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja kaucji ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string, userId: data.user.id };
}

describe.skipIf(!hasEnv)("rozliczenia kaucji (0011, ścieżka panelu)", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string; userId: string };
  let tenantB: { client: SupabaseClient; tenantId: string; userId: string };

  beforeAll(async () => {
    admin = createAdminClient();
    tenantA = await createTenantMember(admin, "a");
    tenantB = await createTenantMember(admin, "b");
  }, 60_000);

  /** Zamówienie tenanta A z sesji członka — nośnik rejestru kaucji. */
  async function createOrderA(totalDepositGrosze: number): Promise<string> {
    const { data: customer, error: customerError } = await tenantA.client
      .from("customers")
      .insert({ tenant_id: tenantA.tenantId, email: `klient-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (customerError) throw new Error(`insert customers: ${customerError.message}`);

    const { data: order, error: orderError } = await tenantA.client
      .from("orders")
      .insert({
        tenant_id: tenantA.tenantId,
        customer_id: customer!.id,
        start_date: "2026-09-10",
        end_date: "2026-09-12",
        delivery_method: "courier",
        total_deposit_grosze: totalDepositGrosze,
      })
      .select("id")
      .single();
    if (orderError) throw new Error(`insert orders: ${orderError.message}`);
    return order!.id as string;
  }

  /** Dokładnie ten INSERT, który wykonują akcje deposit-actions.ts. */
  async function insertEventAsA(
    orderId: string,
    event: {
      kind: DepositEventRow["kind"];
      amount_grosze: number;
      reason_code?: string | null;
      reason?: string | null;
    },
  ) {
    return tenantA.client
      .from("deposit_events")
      .insert({
        tenant_id: tenantA.tenantId,
        order_id: orderId,
        kind: event.kind,
        amount_grosze: event.amount_grosze,
        reason_code: event.reason_code ?? null,
        reason: event.reason ?? null,
        created_by: tenantA.userId,
      })
      .select("id");
  }

  async function eventsOfA(orderId: string): Promise<DepositEventRow[]> {
    const { data, error } = await tenantA.client
      .from("deposit_events")
      .select("id, kind, amount_grosze, reason_code, reason, created_at")
      .eq("tenant_id", tenantA.tenantId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`select deposit_events: ${error.message}`);
    return (data ?? []) as unknown as DepositEventRow[];
  }

  it("pobranie → zwrot częściowy → potrącenie z kodem: rejestr niesie dane i autora", async () => {
    const orderId = await createOrderA(100_00);

    const collected = await insertEventAsA(orderId, { kind: "collected", amount_grosze: 100_00 });
    expect(collected.error?.message, `pobranie odrzucone: ${collected.error?.message}`).toBeUndefined();

    const refunded = await insertEventAsA(orderId, { kind: "refunded", amount_grosze: 60_00 });
    expect(refunded.error?.message, `zwrot odrzucony: ${refunded.error?.message}`).toBeUndefined();

    const deducted = await insertEventAsA(orderId, {
      kind: "deducted",
      amount_grosze: 30_00,
      reason_code: "damage",
      reason: "porysowana pokrywa",
    });
    expect(deducted.error?.message, `potrącenie odrzucone: ${deducted.error?.message}`).toBeUndefined();

    const events = await eventsOfA(orderId);
    expect(events.map((event) => [event.kind, event.amount_grosze])).toEqual([
      ["collected", 100_00],
      ["refunded", 60_00],
      ["deducted", 30_00],
    ]);
    expect(events[2]!.reason_code).toBe("damage");
    expect(events[2]!.reason).toBe("porysowana pokrywa");

    // Autor zdarzenia (created_by) — przez klienta admina, bo SELECT panelu
    // go nie potrzebuje, a kolumna ma nieść odpowiedzialność operatora.
    const { data: withAuthor } = await admin
      .from("deposit_events")
      .select("created_by")
      .eq("tenant_id", tenantA.tenantId)
      .eq("order_id", orderId);
    expect(new Set((withAuthor ?? []).map((row) => row.created_by))).toEqual(
      new Set([tenantA.userId]),
    );

    // Saldo 10 zł — rejestr NIE jest rozliczony.
    expect(isDepositSettled(depositTotals(events))).toBe(false);
  });

  it("nadmiarowy zwrot z sesji członka dostaje 23514 — kod mapowany przez akcję", async () => {
    const orderId = await createOrderA(50_00);

    const collected = await insertEventAsA(orderId, { kind: "collected", amount_grosze: 50_00 });
    expect(collected.error?.message).toBeUndefined();

    const over = await insertEventAsA(orderId, { kind: "refunded", amount_grosze: 50_01 });
    expect(over.error?.code, `nadmiarowy zwrot przeszedł: ${over.error?.message}`).toBe(
      PG_DEPOSIT_GATE,
    );
  });

  it("pełne rozliczenie spełnia warunek ADR-027 i UPDATE payment_status przechodzi z sesji członka", async () => {
    const orderId = await createOrderA(80_00);

    await insertEventAsA(orderId, { kind: "collected", amount_grosze: 80_00 });
    await insertEventAsA(orderId, { kind: "refunded", amount_grosze: 50_00 });
    await insertEventAsA(orderId, {
      kind: "deducted",
      amount_grosze: 30_00,
      reason_code: "late_return",
    });

    const events = await eventsOfA(orderId);
    expect(isDepositSettled(depositTotals(events)), "saldo 0 nie spełnia warunku").toBe(true);

    // Dokładnie ten UPDATE, który wykonuje akcja po spełnieniu warunku.
    const { data: updated, error } = await tenantA.client
      .from("orders")
      .update({ payment_status: "deposit_refunded" })
      .eq("tenant_id", tenantA.tenantId)
      .eq("id", orderId)
      .neq("payment_status", "deposit_refunded")
      .select("id");
    expect(error?.message, `UPDATE payment_status odrzucony: ${error?.message}`).toBeUndefined();
    expect(updated).toHaveLength(1);

    const { data: order } = await tenantA.client
      .from("orders")
      .select("payment_status")
      .eq("tenant_id", tenantA.tenantId)
      .eq("id", orderId)
      .single();
    expect(order!.payment_status).toBe("deposit_refunded");
  });

  it("rozliczenie samym potrąceniem też spełnia warunek ADR-027", async () => {
    const orderId = await createOrderA(40_00);

    await insertEventAsA(orderId, { kind: "collected", amount_grosze: 40_00 });
    await insertEventAsA(orderId, {
      kind: "deducted",
      amount_grosze: 40_00,
      reason_code: "missing_part",
    });

    const events = await eventsOfA(orderId);
    expect(isDepositSettled(depositTotals(events))).toBe(true);
  });

  it("izolacja: członek B nie wstawi zdarzenia do zamówienia A i nie widzi rejestru A", async () => {
    const orderId = await createOrderA(20_00);
    const collected = await insertEventAsA(orderId, { kind: "collected", amount_grosze: 20_00 });
    expect(collected.error?.message).toBeUndefined();

    // Własny claim, cudzy tenant_id → WITH CHECK polityki tenant_insert.
    const crossTenant = await tenantB.client
      .from("deposit_events")
      .insert({
        tenant_id: tenantA.tenantId,
        order_id: orderId,
        kind: "collected",
        amount_grosze: 1_00,
      })
      .select("id");
    expect(crossTenant.error?.code, `INSERT na cudzy tenant przeszedł: ${crossTenant.error?.message}`).toBe(
      PG_RLS_WITH_CHECK,
    );

    // Własny tenant_id, cudze order_id → klucz złożony (tenant_id, order_id).
    const crossOrder = await tenantB.client
      .from("deposit_events")
      .insert({
        tenant_id: tenantB.tenantId,
        order_id: orderId,
        kind: "collected",
        amount_grosze: 1_00,
      })
      .select("id");
    expect(crossOrder.error?.code, `INSERT na cudze zamówienie przeszedł: ${crossOrder.error?.message}`).toBe(
      PG_FOREIGN_KEY_VIOLATION,
    );

    // SELECT przez granicę tenanta: pusty wynik, nie odmowa.
    const { data: foreign, error: foreignError } = await tenantB.client
      .from("deposit_events")
      .select("id")
      .eq("order_id", orderId);
    expect(foreignError?.message).toBeUndefined();
    expect(foreign).toHaveLength(0);
  });
});
