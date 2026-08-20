/**
 * Rekoncyliacja zwrotów kaucji utkniętych w `pending` (Faza B, siatka na
 * zgubiony webhook `charge.refund.updated`) — na ŻYWYM lokalnym Supabase.
 *
 * DLACZEGO NA ŻYWEJ BAZIE. Domknięcie idzie ISTNIEJĄCĄ ścieżką
 * (`closeDepositRefundFromRead`), a jej poprawność jest WŁASNOŚCIĄ BAZY:
 * bramka salda 0011, serializacja 0034, unikat odnośnika 0031, unikat jednego
 * żądania w locie 0032 i bramka spójności `deposit_refunded` 0030/0015. Atrapa
 * bazy dowodziłaby zgodności atrapy z atrapą.
 *
 * ================== ⚠ OŚ KRYTYCZNA: NIGDY DRUGI REFUND ==================
 *
 * `createDepositRefund` (POST /v1/refunds) jest tu ZASPIONOWANY i RZUCA. Każdy
 * przypadek udanego domknięcia dowodzi, że spy pozostał NIETKNIĘTY: kaucja
 * domyka się WYŁĄCZNIE z odczytu (`readRefund`), nigdy przez zainicjowanie
 * drugiego zwrotu. DOWÓD MUTACYJNY (uruchamiany ręcznie przy pracy nad jobem):
 * dopisanie do rdzenia `createDepositRefund(...)` albo `requestDepositRefund`
 * zapala `createDepositRefund` — i przypadki „domknięte" padają na czerwono.
 *
 * OSIE POZOSTAŁE: pending + succeeded u dostawcy → DOMKNIĘTE; pending u dostawcy
 * → NIE domyka; karencja (za świeży wiersz pominięty); idempotencja (dwa
 * przebiegi → jedno domknięcie); izolacja (konto A nie rusza B).
 */
import { randomUUID } from "node:crypto";

import type { RefundRead } from "@avably/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = ["SUPABASE_LOCAL_API_URL", "SUPABASE_LOCAL_SERVICE_ROLE_KEY"] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const RENTAL_GROSZE = 30_000;
const DEPOSIT_GROSZE = 20_000;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

/**
 * Port dostawcy pod kontrolą testu. `createDepositRefund` (POST /v1/refunds)
 * RZUCA — żadna ścieżka rekoncyliacji nie ma prawa go dotknąć. `createCalls`
 * jest twardym dowodem: pusty = ani jeden drugi refund nie wyszedł.
 */
const provider = vi.hoisted(() => ({
  createCalls: [] as unknown[],
}));

vi.mock("@avably/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // ⚠ Gdyby rekoncyliacja KIEDYKOLWIEK zainicjowała zwrot, wejdzie tędy —
    // i test to zobaczy dwoma drogami: rzutem (domknięcie pada) oraz niepustym
    // `createCalls` (asercja „NIGDY drugi refund"). Produkcyjny rdzeń joba nie
    // importuje tej funkcji w ogóle.
    createDepositRefund: async (params: unknown) => {
      provider.createCalls.push(params);
      throw new Error(
        "MUTANT: rekoncyliacja zainicjowała POST /v1/refunds — kaucja oddana dwa razy.",
      );
    },
  };
});

const { reconcileDepositRefunds } = await import("@/src/jobs/reconcile-deposit-refunds");

const adminClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

const createdTenantIds: string[] = [];

interface Fixture {
  tenantId: string;
  accountId: string;
  orderId: string;
  intentId: string;
  refundRequestId: string;
  refundId: string;
}

describe.skipIf(!hasEnv)("rekoncyliacja zwrotów kaucji — Faza B", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const NOW = new Date();
  let orderSeq = 0;

  /** Odczyt zwrotu u dostawcy pod kontrolą testu; nieznany refund RZUCA. */
  const reads = new Map<string, RefundRead>();
  const readCalls: { refundId: string; accountId: string }[] = [];
  function fakeReadRefund(refundId: string, accountId: string): Promise<RefundRead> {
    readCalls.push({ refundId, accountId });
    const hit = reads.get(refundId);
    // Baza bywa współdzielona — cudzy zwrot w partii ma POLEC (nie zostać
    // domknięty naszym scenariuszem), a nie dostać wymyśloną odpowiedź.
    if (!hit) return Promise.reject(new Error(`Odczyt spoza fixtures tego testu: ${refundId}`));
    return Promise.resolve(hit);
  }

  beforeEach(() => {
    provider.createCalls.length = 0;
    reads.clear();
    readCalls.length = 0;
  });

  afterAll(async () => {
    if (!hasEnv) return;
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
  });

  /**
   * Najemca z kontem u dostawcy, zamówieniem OPŁACONYM z pobraną kaucją i
   * żądaniem zwrotu utkniętym w `pending` (odnośnik `re_...` już zapisany).
   *
   * `agedMinutes` postarza wiersz `deposit_refunds` (updated_at wpisany WPROST
   * przy INSERT — trigger `deposit_refunds_touch` rusza go tylko na UPDATE),
   * żeby przeszedł przez karencję.
   */
  async function seedPendingRefund(
    label: string,
    options: { agedMinutes?: number; depositGrosze?: number } = {},
  ): Promise<Fixture> {
    const deposit = options.depositGrosze ?? DEPOSIT_GROSZE;
    const agedMinutes = options.agedMinutes ?? 60;

    const slug = `drrec-${label}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .insert({ slug, name: `Deposit recon ${label}` })
      .select("id")
      .single();
    if (tErr) throw new Error(tErr.message);
    const tenantId = (tenant as { id: string }).id;
    createdTenantIds.push(tenantId);

    const accountId = `acct_${label}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const { error: aErr } = await admin
      .from("payment_accounts")
      .insert({ tenant_id: tenantId, provider_account_id: accountId });
    if (aErr) throw new Error(`payment_accounts: ${aErr.message}`);

    const { data: customer, error: cErr } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, full_name: "Klient kaucja", email: `k-${randomUUID().slice(0, 8)}@test.local` })
      .select("id")
      .single();
    if (cErr) throw new Error(`customer: ${cErr.message}`);

    const { data: pickup, error: pErr } = await admin
      .from("pickup_locations")
      .insert({ tenant_id: tenantId, name: "Magazyn", address_city: "Warszawa" })
      .select("id")
      .single();
    if (pErr) throw new Error(`pickup: ${pErr.message}`);

    const intentId = `pi_${randomUUID().replace(/-/g, "")}`;
    const { data: order, error: oErr } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: (customer as { id: string }).id,
        order_number: `DRR-2026-${String(1000 + (orderSeq += 1))}`,
        start_date: "2027-03-01",
        end_date: "2027-03-03",
        delivery_method: "pickup",
        pickup_location_id: (pickup as { id: string }).id,
        order_status: "pending",
        payment_status: "paid",
        payment_provider: "stripe",
        payment_method: "online",
        provider_payment_intent_id: intentId,
        total_rental_grosze: RENTAL_GROSZE,
        total_deposit_grosze: deposit,
        delivery_grosze: 0,
      })
      .select("id")
      .single();
    if (oErr) throw new Error(`order: ${oErr.message}`);
    const orderId = (order as { id: string }).id;

    // Kaucja POBRANA (obieg stripe) — bez tego wiersza zwrot nie miałby czego
    // domknąć do zera, a `settleDepositIfComplete` nie przeszłoby w deposit_refunded.
    const { error: colErr } = await admin.from("deposit_events").insert({
      tenant_id: tenantId,
      order_id: orderId,
      kind: "collected",
      amount_grosze: deposit,
      provider: "stripe",
      provider_reference: intentId,
    });
    if (colErr) throw new Error(`collected: ${colErr.message}`);

    // Żądanie zwrotu utknięte w `pending`: POST się wydarzył (mamy re_...),
    // ale webhook charge.refund.updated się zgubił.
    const refundId = `re_${randomUUID().replace(/-/g, "")}`;
    const agedAt = new Date(NOW.getTime() - agedMinutes * 60_000).toISOString();
    const { data: refund, error: rErr } = await admin
      .from("deposit_refunds")
      .insert({
        tenant_id: tenantId,
        order_id: orderId,
        amount_grosze: deposit,
        provider: "stripe",
        provider_reference: refundId,
        status: "pending",
        updated_at: agedAt,
      })
      .select("id")
      .single();
    if (rErr) throw new Error(`deposit_refunds: ${rErr.message}`);

    return { tenantId, accountId, orderId, intentId, refundRequestId: (refund as { id: string }).id, refundId };
  }

  const refund = (overrides: Partial<RefundRead> & { refundId: string }): RefundRead => ({
    status: "succeeded",
    amountGrosze: DEPOSIT_GROSZE,
    intentId: null,
    failureReason: null,
    ...overrides,
  });

  async function paymentStatusOf(orderId: string): Promise<string> {
    const { data, error } = await admin.from("orders").select("payment_status").eq("id", orderId).single();
    if (error) throw new Error(error.message);
    return (data as { payment_status: string }).payment_status;
  }

  async function refundStatusOf(id: string): Promise<string> {
    const { data, error } = await admin.from("deposit_refunds").select("status").eq("id", id).single();
    if (error) throw new Error(error.message);
    return (data as { status: string }).status;
  }

  async function refundedEventsOf(orderId: string) {
    const { data, error } = await admin
      .from("deposit_events")
      .select("kind, amount_grosze, provider_reference")
      .eq("order_id", orderId)
      .eq("kind", "refunded");
    if (error) throw new Error(error.message);
    return (data ?? []) as { kind: string; amount_grosze: number; provider_reference: string }[];
  }

  const entryFor = (
    result: Awaited<ReturnType<typeof reconcileDepositRefunds>>,
    id: string,
  ) => result.entries.find((e) => e.refundRequestId === id) ?? null;

  // -------------------------------------------------------------------
  // 1. Pending + succeeded u dostawcy → DOMKNIĘTE (i NIGDY drugi refund)
  // -------------------------------------------------------------------

  it("pending + succeeded u dostawcy → wiersz DOMKNIĘTY (deposit_refunded), NIGDY drugi refund", async () => {
    const fx = await seedPendingRefund("settle");
    reads.set(fx.refundId, refund({ refundId: fx.refundId, intentId: fx.intentId }));

    const result = await reconcileDepositRefunds({ db: admin, readRefund: fakeReadRefund, now: NOW });

    expect(entryFor(result, fx.refundRequestId)?.outcome).toBe("settled");

    // Domknięcie: żądanie succeeded, wiersz refunded w rejestrze, oś płatności.
    expect(await refundStatusOf(fx.refundRequestId)).toBe("succeeded");
    expect(await paymentStatusOf(fx.orderId)).toBe("deposit_refunded");
    const events = await refundedEventsOf(fx.orderId);
    expect(events).toEqual([
      { kind: "refunded", amount_grosze: DEPOSIT_GROSZE, provider_reference: fx.refundId },
    ]);

    // ⚠ OŚ KRYTYCZNA: ani jeden POST /v1/refunds. Odczyt kontem WŁASNYM.
    expect(provider.createCalls).toHaveLength(0);
    expect(readCalls).toEqual([{ refundId: fx.refundId, accountId: fx.accountId }]);
  });

  // -------------------------------------------------------------------
  // 2. Pending u dostawcy → NIE domyka
  // -------------------------------------------------------------------

  it("refund nadal pending u dostawcy → NIE domyka, rejestr kaucji PUSTY", async () => {
    const fx = await seedPendingRefund("stillpending");
    reads.set(fx.refundId, refund({ refundId: fx.refundId, status: "pending" }));

    const result = await reconcileDepositRefunds({ db: admin, readRefund: fakeReadRefund, now: NOW });

    expect(entryFor(result, fx.refundRequestId)?.outcome).toBe("still-pending");
    // Pieniędzy u klienta jeszcze nie ma — zero wiersza refunded, płatność bez zmian.
    expect(await refundedEventsOf(fx.orderId)).toHaveLength(0);
    expect(await paymentStatusOf(fx.orderId)).toBe("paid");
    expect(await refundStatusOf(fx.refundRequestId)).toBe("pending");
    expect(provider.createCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // 3. Karencja — nie ścigaj się z webhookiem
  // -------------------------------------------------------------------

  it("wiersz ŚWIEŻSZY niż karencja jest pominięty — nawet nie odpytany", async () => {
    // Zwrot zmieniony przed chwilą: webhook charge.refund.updated ma jeszcze
    // dostać swoją szansę. Pętla nie ma prawa go wyprzedzić.
    const fx = await seedPendingRefund("karencja", { agedMinutes: 1 });
    reads.set(fx.refundId, refund({ refundId: fx.refundId }));

    const result = await reconcileDepositRefunds({ db: admin, readRefund: fakeReadRefund, now: NOW });

    expect(entryFor(result, fx.refundRequestId)).toBeNull();
    // Trzy niezależne dowody: brak wpisu, brak odczytu, brak zmiany.
    expect(readCalls.some((c) => c.refundId === fx.refundId)).toBe(false);
    expect(await refundStatusOf(fx.refundRequestId)).toBe("pending");
    expect(await paymentStatusOf(fx.orderId)).toBe("paid");
  });

  // -------------------------------------------------------------------
  // 4. Idempotencja — dwa przebiegi, jedno domknięcie
  // -------------------------------------------------------------------

  it("dwa przebiegi → DOKŁADNIE JEDNO domknięcie (idempotencja)", async () => {
    const fx = await seedPendingRefund("idem");
    reads.set(fx.refundId, refund({ refundId: fx.refundId, intentId: fx.intentId }));

    const first = await reconcileDepositRefunds({ db: admin, readRefund: fakeReadRefund, now: NOW });
    expect(entryFor(first, fx.refundRequestId)?.outcome).toBe("settled");

    // Drugi przebieg: wiersz jest już `succeeded`, więc filtr status='pending'
    // go nie wybiera — zero ponownego odczytu, zero drugiego wiersza refunded.
    readCalls.length = 0;
    const second = await reconcileDepositRefunds({ db: admin, readRefund: fakeReadRefund, now: NOW });

    expect(entryFor(second, fx.refundRequestId)).toBeNull();
    expect(readCalls.some((c) => c.refundId === fx.refundId)).toBe(false);
    expect(await refundedEventsOf(fx.orderId)).toHaveLength(1);
    expect(await paymentStatusOf(fx.orderId)).toBe("deposit_refunded");
    expect(provider.createCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // 5. Izolacja — odczyt kontem WŁAŚCICIELA zamówienia
  // -------------------------------------------------------------------

  it("każdy zwrot odczytany kontem SWOJEGO najemcy — bez przecieku między najemcami", async () => {
    const alfa = await seedPendingRefund("iso-alfa");
    const beta = await seedPendingRefund("iso-beta");
    reads.set(alfa.refundId, refund({ refundId: alfa.refundId, intentId: alfa.intentId }));
    reads.set(beta.refundId, refund({ refundId: beta.refundId, intentId: beta.intentId }));

    await reconcileDepositRefunds({ db: admin, readRefund: fakeReadRefund, now: NOW });

    // Dowód jest w PARZE (refund, konto): job czytający wszystko jednym kontem
    // też „coś odczytał".
    const alfaCall = readCalls.find((c) => c.refundId === alfa.refundId);
    const betaCall = readCalls.find((c) => c.refundId === beta.refundId);
    expect(alfaCall?.accountId).toBe(alfa.accountId);
    expect(betaCall?.accountId).toBe(beta.accountId);
    // Kontrola negatywna: konto najemcy NIE pojawia się przy cudzym zwrocie.
    expect(readCalls.some((c) => c.refundId === alfa.refundId && c.accountId === beta.accountId)).toBe(false);

    expect(await paymentStatusOf(alfa.orderId)).toBe("deposit_refunded");
    expect(await paymentStatusOf(beta.orderId)).toBe("deposit_refunded");
    expect(provider.createCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // 6. Brak konta u dostawcy → pominięcie z powodem, zero odczytów
  // -------------------------------------------------------------------

  it("najemca BEZ konta u dostawcy → skipped z powodem, zero odczytów", async () => {
    const fx = await seedPendingRefund("bez-konta");
    await admin.from("payment_accounts").delete().eq("tenant_id", fx.tenantId);
    reads.set(fx.refundId, refund({ refundId: fx.refundId }));

    const result = await reconcileDepositRefunds({ db: admin, readRefund: fakeReadRefund, now: NOW });

    expect(entryFor(result, fx.refundRequestId)?.outcome).toBe("skipped");
    expect(readCalls.some((c) => c.refundId === fx.refundId)).toBe(false);
    expect(await refundStatusOf(fx.refundRequestId)).toBe("pending");
  });

  // -------------------------------------------------------------------
  // 7. Ślad przebiegu — bez odnośnika u dostawcy ani konta
  // -------------------------------------------------------------------

  it("ślad przebiegu nie niesie re_... ani acct_...", async () => {
    const fx = await seedPendingRefund("slad");
    reads.set(fx.refundId, refund({ refundId: fx.refundId, intentId: fx.intentId }));

    const result = await reconcileDepositRefunds({ db: admin, readRefund: fakeReadRefund, now: NOW });
    const entry = entryFor(result, fx.refundRequestId);

    expect(entry).not.toBeNull();
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(fx.refundId);
    expect(serialized).not.toContain(fx.accountId);
    expect(serialized).not.toContain("re_");
    expect(serialized).not.toContain("acct_");
    expect(entry!.tenantId).toBe(fx.tenantId);
    expect(entry!.orderId).toBe(fx.orderId);
  });
});
