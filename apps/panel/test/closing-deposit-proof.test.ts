/**
 * DOWÓD KAUCJI w oknie domykania (Zasada 8, ADR-138) — spec (e)5.
 *
 * `settleDepositAction` wywołana PRODUKCYJNĄ drogą (realna akcja, realny
 * rdzeń guardu z opt-in `{ closing: true }`, realny `requestDepositRefund`,
 * ŻYWY lokalny Supabase z bramkami 0011/0030/0032/0034) przez CZŁONKA
 * ZAWIESZONEGO tenanta w otwartym oknie:
 *
 *   1. wywołanie zwrotu FAKTYCZNIE idzie do dostawcy — spy na granicy HTTP
 *      (`createDepositRefund` z @avably/core, jedyne miejsce POST /refunds)
 *      dostaje kwotę i konto Connect najemcy; NIE jest to „tylko wpis
 *      w rejestrze",
 *   2. po potwierdzonym odczycie rejestr kaucji ma wiersz `refunded`
 *      z odnośnikiem dostawcy, a saldo wraca do zera PRZEZ bramkę 0011,
 *   3. `payment_status` przechodzi w `deposit_refunded` PRZEZ bramkę
 *      spójności 0030/0015 (saldo 0 przy pobraniach > 0) — na żywej bazie,
 *      nie w atrapie,
 *   4. KONTROLA ZBIORU: zamówienie utworzone PO zawieszeniu nie dostaje
 *      zwrotu — odmowa predykatu, dostawca NIETKNIĘTY.
 *
 * Wstrzyknięty jest WYŁĄCZNIE dostawca płatności (jak w deposit-online) —
 * bramki są własnością bazy i to one tu zeznają.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { requireMemberWithClient } from "@/lib/auth";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "ClosingDeposit!12345678";
const RENTAL_GROSZE = 30_000;
const DEPOSIT_GROSZE = 50_000;

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const adminClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

const anonClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

// --- Wstrzyknięty dostawca: spy na granicy HTTP @avably/core ---
const createRefundSpy = vi.hoisted(() => vi.fn());
const readRefundSpy = vi.hoisted(() => vi.fn());
vi.mock("@avably/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@avably/core")>();
  return {
    ...actual,
    createDepositRefund: (params: unknown) => createRefundSpy(params),
    readDepositRefund: (refundId: string, opts: unknown) => readRefundSpy(refundId, opts),
  };
});

// Guard produkcyjny na ŻYWEJ sesji członka — patrz wireGuard niżej.
const requireMemberMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-server", () => ({
  requireMember: (role?: string, options?: { closing?: boolean }) =>
    requireMemberMock(role, options),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { settleDepositAction } = await import(
  "@/app/[locale]/(panel)/zamowienia/[id]/deposit-actions"
);

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];
let orderNumberSeq = 0;

describe.skipIf(!hasEnv)("okno domykania — dowód kaucji (e)5", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  let member: { client: SupabaseClient; tenantId: string; userId: string };
  let connectedAccountId: string;

  beforeAll(async () => {
    if (!hasEnv) return;
    const email = `cw5-${randomUUID()}@test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    createdUserIds.push(data.user.id);

    const signIn = async (): Promise<SupabaseClient> => {
      const client = anonClient();
      const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password: TEST_PASSWORD,
      });
      if (signInError) throw new Error(`signIn: ${signInError.message}`);
      return client;
    };

    const bootstrap = await signIn();
    const { data: tenantId, error: tenantError } = await bootstrap
      .schema("app")
      .rpc("create_tenant", {
        p_slug: `cw5-${randomUUID()}`.slice(0, 39),
        p_name: "Domykanie kaucji",
      });
    if (tenantError) throw new Error(`create_tenant: ${tenantError.message}`);
    createdTenantIds.push(tenantId as string);

    connectedAccountId = `acct_${randomUUID().slice(0, 12)}`;
    const { error: accountError } = await admin.from("payment_accounts").insert({
      tenant_id: tenantId as string,
      provider_account_id: connectedAccountId,
    });
    if (accountError) throw new Error(`payment_accounts: ${accountError.message}`);

    member = { client: await signIn(), tenantId: tenantId as string, userId: data.user.id };
  }, 90_000);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  function wireGuard(): void {
    requireMemberMock.mockImplementation((role?: string, options?: { closing?: boolean }) =>
      requireMemberWithClient(member.client, role as never, options),
    );
  }

  /** Zamówienie online (`returned`, kaucja pobrana u dostawcy) — jak po 0029. */
  async function seedReturnedOrder(): Promise<{ orderId: string; intentId: string }> {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({
        tenant_id: member.tenantId,
        full_name: "Klient",
        email: `k-${randomUUID().slice(0, 8)}@test.local`,
      })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`customer: ${customerError?.message}`);

    const { data: pickup, error: pickupError } = await admin
      .from("pickup_locations")
      .insert({ tenant_id: member.tenantId, name: "Magazyn", address_city: "Warszawa" })
      .select("id")
      .single();
    if (pickupError || !pickup) throw new Error(`pickup: ${pickupError?.message}`);

    const intentId = `pi_${randomUUID().slice(0, 16)}`;
    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        tenant_id: member.tenantId,
        customer_id: customer.id as string,
        order_number: `CW5-2026-${String(9000 + (orderNumberSeq += 1))}`,
        start_date: "2026-12-01",
        end_date: "2026-12-03",
        delivery_method: "pickup",
        pickup_location_id: pickup.id as string,
        // Trigger 0010 dopuszcza powstanie WYŁĄCZNIE w pending — do
        // `returned` idziemy przejściami do przodu, jak żywe zamówienie.
        order_status: "pending",
        payment_status: "pending",
        payment_provider: "stripe",
        payment_method: "online",
        provider_payment_intent_id: intentId,
        total_rental_grosze: RENTAL_GROSZE,
        total_deposit_grosze: DEPOSIT_GROSZE,
        delivery_grosze: 0,
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(`order: ${orderError?.message}`);
    const orderId = order.id as string;

    // Oś płatności: pending → paid (reżim stripe); oś zamówienia: cztery
    // przejścia do przodu aż do `returned` — wszystkie przez bramki 0010/0015.
    const { error: paidError } = await admin
      .from("orders")
      .update({ payment_status: "paid" })
      .eq("id", orderId);
    if (paidError) throw new Error(`paid: ${paidError.message}`);
    for (const next of ["reserved", "ready_for_pickup", "picked_up", "returned"] as const) {
      const { error: stepError } = await admin
        .from("orders")
        .update({ order_status: next })
        .eq("id", orderId);
      if (stepError) throw new Error(`przejście ${next}: ${stepError.message}`);
    }

    // Kaucja POBRANA u dostawcy (jak księguje ją webhook z odnośnikiem PI).
    const { error: collectedError } = await admin.from("deposit_events").insert({
      tenant_id: member.tenantId,
      order_id: orderId,
      kind: "collected",
      amount_grosze: DEPOSIT_GROSZE,
      provider: "stripe",
      provider_reference: intentId,
    });
    if (collectedError) throw new Error(`collected: ${collectedError.message}`);

    return { orderId, intentId };
  }

  function settleForm(orderId: string): FormData {
    const fd = new FormData();
    fd.set("orderId", orderId);
    fd.set("balanceGrosze", String(DEPOSIT_GROSZE));
    // Kwoty w złotówkach (parseMajorToGrosze): 500 zł = 50 000 gr.
    fd.set("refundAmount", "500");
    fd.set("deductAmount", "");
    fd.set("deductReasonCode", "");
    fd.set("deductReason", "");
    fd.set("refundNote", "");
    return fd;
  }

  it("zwrot z okna domykania idzie DO DOSTAWCY i domyka rozliczenie przez bramki bazy", async () => {
    const { orderId } = await seedReturnedOrder();

    // ZAWIESZENIE PO utworzeniu zamówienia — świeży zegar, okno otwarte,
    // zamówienie w zamrożonym zbiorze (returned + saldo 50 000 ≠ 0).
    const { error: suspendError } = await admin
      .from("tenants")
      .update({ status: "suspended", suspended_at: new Date().toISOString() })
      .eq("id", member.tenantId);
    if (suspendError) throw new Error(`suspend: ${suspendError.message}`);

    const refundId = `re_${randomUUID().slice(0, 16)}`;
    createRefundSpy.mockResolvedValueOnce(refundId);
    readRefundSpy.mockResolvedValueOnce({
      refundId,
      status: "succeeded",
      amountGrosze: DEPOSIT_GROSZE,
      intentId: "pi_ignored",
      failureReason: null,
    });
    wireGuard();

    const state = await settleDepositAction({}, settleForm(orderId));

    // 1. Wywołanie zwrotu POSZŁO do dostawcy — kwota i konto Connect najemcy.
    expect(state.formError).toBeUndefined();
    expect(state.success).toBe("refunded");
    expect(createRefundSpy).toHaveBeenCalledTimes(1);
    expect(createRefundSpy.mock.calls[0]![0]).toMatchObject({
      amountGrosze: DEPOSIT_GROSZE,
      connectedAccountId,
      orderId,
    });

    // 2. Rejestr: wiersz `refunded` z odnośnikiem dostawcy — PRZEZ bramkę 0011.
    const { data: events } = await admin
      .from("deposit_events")
      .select("kind, amount_grosze, provider, provider_reference")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    expect(events).toMatchObject([
      { kind: "collected", amount_grosze: DEPOSIT_GROSZE },
      { kind: "refunded", amount_grosze: DEPOSIT_GROSZE, provider: "stripe", provider_reference: refundId },
    ]);

    // 3. Bramka spójności 0030/0015: saldo 0 przy pobraniach > 0 →
    //    payment_status = deposit_refunded, na żywej bazie.
    const { data: after } = await admin
      .from("orders")
      .select("payment_status")
      .eq("id", orderId)
      .single();
    expect(after).toEqual({ payment_status: "deposit_refunded" });
  }, 60_000);

  it("zamówienie utworzone PO zawieszeniu: odmowa zbioru, dostawca NIETKNIĘTY", async () => {
    // Tenant jest już suspended (poprzedni test) — nowe zamówienie ma
    // created_at > suspended_at, więc stoi POZA zamrożonym zbiorem.
    const { orderId } = await seedReturnedOrder();
    createRefundSpy.mockClear();
    wireGuard();

    const state = await settleDepositAction({}, settleForm(orderId));

    expect(state.formError).toMatch(/opłacone przed zawieszeniem/);
    expect(createRefundSpy).not.toHaveBeenCalled();

    const { data: events } = await admin
      .from("deposit_events")
      .select("kind")
      .eq("order_id", orderId);
    expect(events).toEqual([{ kind: "collected" }]);
  }, 60_000);
});
