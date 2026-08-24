/**
 * Widok dnia pulpitu (migracja 0069, ADR-140) na ŻYWYM, lokalnym Supabase.
 *
 * PRZEDMIOTEM TESTU JEST BAZA: `app.dashboard_day` liczy DOKŁADNE zbiory
 * z seedu o znanych datach i kwotach — nie „coś się zwróciło". Wzorzec
 * z dashboard-aggregates.test.ts (funkcje-siostry 0054, ADR-109).
 *
 * Osie:
 *   1. DEFINICJE ZBIORÓW — każdy z pięciu rodzajów (pickup_today /
 *      return_today / overdue / prepare_tomorrow / money_alert) zawiera
 *      dokładnie te zamówienia, które nakazuje kontrakt z filtrem `dzien`
 *      listy zamówień; zamówienia spoza definicji (cancelled, zwrot jutro,
 *      kaucja rozliczona) NIE występują.
 *   2. SORTOWANIE — braki najpierw (płatność, potem egzemplarz), saldo
 *      kaucji malejąco, dni po terminie malejąco, nieudane płatności przed
 *      kaucjami; dalej numer rosnąco.
 *   3. LICZNIK vs LIMIT — kind_total liczy CAŁY zbiór, pozycje tnie p_limit;
 *      rozłączność gałęzi alarmów (payment_failed + kaucja = JEDEN wiersz).
 *   4. IZOLACJA I DOSTĘP — wynik A bez ani grosza B (sonda cross-tenant wg
 *      wzorca sióstr); anon 42501; service_role bez claimu tenanta pusto.
 *   5. ARCHIWUM (ADR-246) — zarchiwizowane zamówienia (archived_at is not
 *      null) NIE wchodzą do ŻADNEGO rodzaju; bliźniak zasiany w każdej
 *      gałęzi nie rusza kind_total (widok dnia jest lustrem aktywnej listy,
 *      która archiwum chowa — domknięcie follow-upu ADR-242).
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OrderStatus, PaymentStatus } from "@avably/core";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const anonClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

/**
 * „Dziś" testów — data przyszła i stała (inna niż w dashboard-aggregates,
 * żeby równoległe seedy na wspólnej bazie nie weszły sobie w okna).
 */
const TODAY = "2031-03-10";
const TOMORROW = "2031-03-11";

/** Statusy płatności legalne przy narodzinach wiersza (orders_write_gate). */
const BIRTH_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "unpaid",
  "pending",
  "paid",
  "manual",
  "completed",
];

/** Ścieżka osi zamówienia od pending do returned (order_transition_allowed). */
const ORDER_PATH: readonly OrderStatus[] = [
  "reserved",
  "ready_for_pickup",
  "picked_up",
  "returned",
];

interface OrderSpec {
  tenantId: string;
  customerId: string;
  start: string;
  end: string;
  rental: number;
  delivery?: number;
  deposit?: number;
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  provider?: "manual" | "stripe";
  productId?: string;
  /** Przypnij egzemplarz do pozycji (unit_id) — bez tego pozycja „bez egzemplarza". */
  unitId?: string;
}

async function createCustomer(
  admin: SupabaseClient,
  tenantId: string,
  fullName: string,
): Promise<string> {
  const { data, error } = await admin
    .from("customers")
    .insert({
      tenant_id: tenantId,
      email: `${randomUUID().slice(0, 8)}@day.test`,
      full_name: fullName,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Klient ${fullName}: ${error?.message}`);
  return data.id as string;
}

async function createProductWithUnits(
  admin: SupabaseClient,
  tenantId: string,
  name: string,
  unitCount: number,
): Promise<{ productId: string; unitIds: string[] }> {
  const { data, error } = await admin
    .from("products")
    .insert({ tenant_id: tenantId, name, base_price_day_grosze: 10_000, deposit_grosze: 0 })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Produkt ${name}: ${error?.message}`);
  const productId = data.id as string;
  const { data: units, error: unitError } = await admin
    .from("product_units")
    .insert(
      Array.from({ length: unitCount }, () => ({
        tenant_id: tenantId,
        product_id: productId,
        serial_number: `SN-${randomUUID().slice(0, 8)}`,
      })),
    )
    .select("id");
  if (unitError || !units) throw new Error(`Egzemplarze ${name}: ${unitError?.message}`);
  return { productId, unitIds: units.map((unit) => unit.id as string) };
}

/**
 * Zamówienie rodzi się w pending i idzie do celu legalnymi przejściami;
 * oś płatności analogicznie (payment_failed tylko w obiegu stripe przez
 * pending). Wzorzec z dashboard-aggregates.test.ts.
 */
async function createOrder(admin: SupabaseClient, spec: OrderSpec): Promise<string> {
  const provider = spec.provider ?? "manual";
  const targetPayment = spec.paymentStatus ?? "unpaid";
  const birthPayment: PaymentStatus =
    BIRTH_PAYMENT_STATUSES.includes(targetPayment) &&
    !(provider === "stripe" && targetPayment === "paid")
      ? targetPayment
      : "unpaid";

  const { data, error } = await admin
    .from("orders")
    .insert({
      tenant_id: spec.tenantId,
      customer_id: spec.customerId,
      start_date: spec.start,
      end_date: spec.end,
      order_status: "pending",
      payment_status: birthPayment,
      payment_provider: provider,
      delivery_method: "courier",
      total_rental_grosze: spec.rental,
      delivery_grosze: spec.delivery ?? 0,
      total_deposit_grosze: spec.deposit ?? 0,
      currency: "PLN",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Zamówienie: ${error?.message}`);
  const orderId = data.id as string;

  if (spec.productId) {
    const { error: itemsError } = await admin.from("order_items").insert({
      tenant_id: spec.tenantId,
      order_id: orderId,
      product_id: spec.productId,
      unit_id: spec.unitId ?? null,
      rental_grosze: spec.rental,
      deposit_grosze: spec.deposit ?? 0,
    });
    if (itemsError) throw new Error(`Pozycje zamówienia: ${itemsError.message}`);
  }

  const setOrderStatus = async (to: OrderStatus) => {
    const { error: stepError } = await admin
      .from("orders")
      .update({ order_status: to })
      .eq("tenant_id", spec.tenantId)
      .eq("id", orderId);
    if (stepError) throw new Error(`Przejście order_status → ${to}: ${stepError.message}`);
  };

  const targetOrder = spec.orderStatus ?? "pending";
  if (targetOrder === "cancelled") {
    await setOrderStatus("cancelled");
  } else if (targetOrder !== "pending") {
    for (const step of ORDER_PATH) {
      await setOrderStatus(step);
      if (step === targetOrder) break;
    }
  }

  const setPaymentStatus = async (to: PaymentStatus) => {
    const { error: stepError } = await admin
      .from("orders")
      .update({ payment_status: to })
      .eq("tenant_id", spec.tenantId)
      .eq("id", orderId);
    if (stepError) throw new Error(`Przejście payment_status → ${to}: ${stepError.message}`);
  };

  if (targetPayment !== birthPayment) {
    if (targetPayment === "payment_failed") {
      await setPaymentStatus("pending");
      await setPaymentStatus("payment_failed");
    } else {
      await setPaymentStatus(targetPayment);
    }
  }

  return orderId;
}

async function addDepositEvent(
  admin: SupabaseClient,
  tenantId: string,
  orderId: string,
  kind: "collected" | "refunded" | "deducted",
  amount: number,
): Promise<void> {
  const { error } = await admin.from("deposit_events").insert({
    tenant_id: tenantId,
    order_id: orderId,
    kind,
    amount_grosze: amount,
    ...(kind === "deducted" ? { reason_code: "damage" } : {}),
  });
  if (error) throw new Error(`Rejestr kaucji (${kind}): ${error.message}`);
}

/**
 * Archiwizuje zamówienie (trzecia oś widoczności, ADR-242): ustawia
 * archived_at znacznikiem czasu. UPDATE samego archived_at przechodzi bramkę
 * orders_write_gate (nie rusza osi status/płatność/waluta/daty).
 */
async function archiveOrder(
  admin: SupabaseClient,
  tenantId: string,
  orderId: string,
): Promise<void> {
  const { error } = await admin
    .from("orders")
    .update({ archived_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", orderId);
  if (error) throw new Error(`Archiwizacja zamówienia: ${error.message}`);
}

interface DayRow {
  kind: string;
  kind_total: number;
  item_position: number;
  order_id: string;
  order_number: string;
  customer_name: string;
  start_date: string;
  end_date: string;
  amount_grosze: number;
  currency_code: string;
  payment_status: string;
  unit_missing: boolean;
  item_kind: string | null;
}

async function day(ctx: TenantCtx, args: Record<string, unknown>): Promise<DayRow[]> {
  const { data, error } = await ctx.ownerClient.schema("app").rpc("dashboard_day", args);
  if (error) throw new Error(`dashboard_day: ${error.message}`);
  return (data ?? []) as DayRow[];
}

const byKind = (rows: DayRow[], kind: string): DayRow[] =>
  rows.filter((row) => row.kind === kind);

describe.skipIf(!hasEnv)("widok dnia pulpitu (0069, ADR-140)", () => {
  const admin = hasEnv ? createAdminClient() : (null as unknown as SupabaseClient);

  let a: TenantCtx;
  let b: TenantCtx;

  // Identyfikatory seedu tenanta A.
  let pickupClean1: string;
  let pickupUnpaid: string;
  let pickupNoUnit: string;
  let pickupClean2: string;
  let returnWithDeposit: string;
  let returnNoDeposit: string;
  let overdue3d: string;
  let overdue1d: string;
  let prepareTomorrowId: string;
  let failedUpcoming: string;
  let failedReturned: string;
  let depositOpen: string;
  // Zarchiwizowane bliźniaki (ADR-246) — po jednym pasującym do definicji
  // każdego rodzaju; archived_at is not null wyklucza je z widoku dnia.
  let archivedPickup: string;
  let archivedReturn: string;
  let archivedOverdue: string;
  let archivedPrepare: string;
  let archivedMoney: string;
  let bPickup: string;

  beforeAll(async () => {
    ({ a, b } = await seedTwoTenants());

    const anna = await createCustomer(admin, a.tenantId, "Anna Dnia");
    const bartek = await createCustomer(admin, a.tenantId, "Bartek Dnia");

    // ----- WYDANIA DZIŚ (4 zamówienia → testuje limit 3 i sortowanie) -----
    // Kolejność tworzenia = kolejność numerów (PREFIX-YYYY-NNN rosnąco).
    const prodA = await createProductWithUnits(admin, a.tenantId, "Rower dnia", 3);
    // #1: czyste (opłacone, egzemplarz przypięty).
    pickupClean1 = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: TODAY,
      end: TOMORROW,
      rental: 10_000,
      paymentStatus: "paid",
      orderStatus: "reserved",
      productId: prodA.productId,
      unitId: prodA.unitIds[0],
    });
    // #2: brak płatności (unpaid) — ma iść PRZED czystymi i przed brakiem
    // egzemplarza.
    pickupUnpaid = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: TODAY,
      end: TOMORROW,
      rental: 20_000,
      delivery: 1_500,
      paymentStatus: "unpaid",
      orderStatus: "reserved",
      productId: prodA.productId,
      unitId: prodA.unitIds[1],
    });
    // #3: opłacone, ale pozycja BEZ egzemplarza — drugi rodzaj braku.
    pickupNoUnit = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: bartek,
      start: TODAY,
      end: TOMORROW,
      rental: 30_000,
      paymentStatus: "paid",
      orderStatus: "ready_for_pickup",
      productId: prodA.productId,
    });
    // #4: czyste — przy limicie 3 wypada z pozycji, ale liczy się w kind_total.
    pickupClean2 = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: TODAY,
      end: TOMORROW,
      rental: 40_000,
      paymentStatus: "manual",
      orderStatus: "pending",
      productId: prodA.productId,
      unitId: prodA.unitIds[2],
    });
    // Spoza zbioru: anulowane ze startem dziś.
    await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: TODAY,
      end: TOMORROW,
      rental: 111_111,
      orderStatus: "cancelled",
    });

    // ----- ZWROTY DZIŚ (saldo kaucji malejąco) -----
    returnWithDeposit = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: bartek,
      start: "2031-03-05",
      end: TODAY,
      rental: 5_000,
      deposit: 5_000,
      paymentStatus: "paid",
      orderStatus: "picked_up",
    });
    await addDepositEvent(admin, a.tenantId, returnWithDeposit, "collected", 5_000);
    returnNoDeposit = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: "2031-03-06",
      end: TODAY,
      rental: 6_000,
      paymentStatus: "paid",
      orderStatus: "picked_up",
    });
    // Spoza zbioru: wydane ze zwrotem JUTRO (ani zwrot dziś, ani po terminie).
    await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: "2031-03-06",
      end: TOMORROW,
      rental: 222_222,
      paymentStatus: "paid",
      orderStatus: "picked_up",
    });

    // ----- PO TERMINIE (dni malejąco = end_date rosnąco) -----
    overdue1d = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: "2031-03-05",
      end: "2031-03-09",
      rental: 7_000,
      paymentStatus: "paid",
      orderStatus: "picked_up",
    });
    overdue3d = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: bartek,
      start: "2031-03-01",
      end: "2031-03-07",
      rental: 8_000,
      paymentStatus: "paid",
      orderStatus: "picked_up",
    });

    // ----- JUTRO DO PRZYGOTOWANIA -----
    prepareTomorrowId = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: TOMORROW,
      end: "2031-03-15",
      rental: 18_000,
      paymentStatus: "unpaid",
      orderStatus: "reserved",
      productId: prodA.productId,
    });

    // ----- ALARMY PIENIĘŻNE -----
    // Nieudana płatność (obieg stripe), start poza dniem — czysty alarm.
    failedUpcoming = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: bartek,
      start: "2031-03-20",
      end: "2031-03-22",
      rental: 77_700,
      provider: "stripe",
      paymentStatus: "payment_failed",
    });
    // Zwrócone + payment_failed + otwarta kaucja: JEDEN wiersz (gałąź
    // płatności), nie dwa — rozłączność gałęzi.
    failedReturned = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: "2031-02-01",
      end: "2031-02-03",
      rental: 9_000,
      deposit: 4_000,
      provider: "stripe",
      paymentStatus: "payment_failed",
      orderStatus: "returned",
    });
    await addDepositEvent(admin, a.tenantId, failedReturned, "collected", 4_000);
    // Nierozliczona kaucja po najmie: saldo 2 000 (3 000 − 1 000).
    depositOpen = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: bartek,
      start: "2031-02-10",
      end: "2031-02-12",
      rental: 11_000,
      deposit: 3_000,
      paymentStatus: "completed",
      orderStatus: "returned",
    });
    await addDepositEvent(admin, a.tenantId, depositOpen, "collected", 3_000);
    await addDepositEvent(admin, a.tenantId, depositOpen, "deducted", 1_000);
    // Spoza zbioru: kaucja W CAŁOŚCI rozliczona (saldo 0).
    const settled = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: "2031-02-20",
      end: "2031-02-22",
      rental: 333_333,
      deposit: 2_500,
      paymentStatus: "paid",
      orderStatus: "returned",
    });
    await addDepositEvent(admin, a.tenantId, settled, "collected", 2_500);
    await addDepositEvent(admin, a.tenantId, settled, "refunded", 2_500);

    // ----- Tenant B: kwota-sygnatura wycieku -----
    const zenon = await createCustomer(admin, b.tenantId, "Zenon Dnia");
    bPickup = await createOrder(admin, {
      tenantId: b.tenantId,
      customerId: zenon,
      start: TODAY,
      end: TOMORROW,
      rental: 999_999,
      paymentStatus: "paid",
      orderStatus: "reserved",
    });

    // ----- ZARCHIWIZOWANE BLIŹNIAKI TENANTA A (ADR-246) -----
    // Każdy pasuje do definicji swojego rodzaju (status + daty), ale po
    // archiwizacji archived_at is not null WYKLUCZA go z widoku dnia. Sam ich
    // byt jest dowodem regresji: gdyby dashboard_day nie znał archiwum,
    // liczniki kind_total rodzajów by wzrosły i istniejące asercje pękłyby.
    archivedPickup = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: TODAY,
      end: TOMORROW,
      rental: 50_000,
      paymentStatus: "paid",
      orderStatus: "reserved",
      productId: prodA.productId,
    });
    await archiveOrder(admin, a.tenantId, archivedPickup);

    archivedReturn = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: "2031-03-04",
      end: TODAY,
      rental: 51_000,
      paymentStatus: "paid",
      orderStatus: "picked_up",
    });
    await archiveOrder(admin, a.tenantId, archivedReturn);

    archivedOverdue = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: "2031-03-02",
      end: "2031-03-08",
      rental: 52_000,
      paymentStatus: "paid",
      orderStatus: "picked_up",
    });
    await archiveOrder(admin, a.tenantId, archivedOverdue);

    archivedPrepare = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: TOMORROW,
      end: "2031-03-16",
      rental: 53_000,
      paymentStatus: "unpaid",
      orderStatus: "reserved",
    });
    await archiveOrder(admin, a.tenantId, archivedPrepare);

    archivedMoney = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: anna,
      start: "2031-03-21",
      end: "2031-03-23",
      rental: 54_000,
      provider: "stripe",
      paymentStatus: "payment_failed",
    });
    await archiveOrder(admin, a.tenantId, archivedMoney);
  }, 120_000);

  afterAll(async () => {
    if (!hasEnv) return;
    await cleanupSeeded(admin);
  });

  it("pickup_today: definicja zbioru, braki najpierw (płatność, potem egzemplarz), numer rosnąco; kind_total liczy CAŁY zbiór przy limicie 3", async () => {
    const rows = byKind(await day(a, { p_today: TODAY, p_limit: 3 }), "pickup_today");

    expect(
      rows.map((row) => ({
        order_id: row.order_id,
        item_position: row.item_position,
        kind_total: row.kind_total,
        unit_missing: row.unit_missing,
        payment_status: row.payment_status,
      })),
    ).toEqual([
      // Brak płatności przed brakiem egzemplarza, czyste na końcu numerem.
      {
        order_id: pickupUnpaid,
        item_position: 1,
        kind_total: 4,
        unit_missing: false,
        payment_status: "unpaid",
      },
      {
        order_id: pickupNoUnit,
        item_position: 2,
        kind_total: 4,
        unit_missing: true,
        payment_status: "paid",
      },
      {
        order_id: pickupClean1,
        item_position: 3,
        kind_total: 4,
        unit_missing: false,
        payment_status: "paid",
      },
    ]);
    // Czwarte (czyste, późniejszy numer) wypadło z pozycji, nie z licznika.
    expect(rows.map((row) => row.order_id)).not.toContain(pickupClean2);
    // Kwota pozycji = najem + dostawa.
    expect(rows[0].amount_grosze).toBe(21_500);
  });

  it("return_today: wydane ze zwrotem dziś, saldo kaucji malejąco i jako kwota pozycji", async () => {
    const rows = byKind(await day(a, { p_today: TODAY, p_limit: 3 }), "return_today");

    expect(
      rows.map((row) => ({ order_id: row.order_id, amount_grosze: row.amount_grosze })),
    ).toEqual([
      { order_id: returnWithDeposit, amount_grosze: 5_000 },
      { order_id: returnNoDeposit, amount_grosze: 0 },
    ]);
    expect(rows[0].kind_total).toBe(2);
  });

  it("overdue: wydane po terminie, dni po terminie malejąco (end_date rosnąco)", async () => {
    const rows = byKind(await day(a, { p_today: TODAY, p_limit: 3 }), "overdue");

    expect(rows.map((row) => row.order_id)).toEqual([overdue3d, overdue1d]);
    expect(rows.map((row) => row.end_date)).toEqual(["2031-03-07", "2031-03-09"]);
    expect(rows[0].kind_total).toBe(2);
  });

  it("prepare_tomorrow: start jutro, jeszcze nie wydane, z brakami jak wydania", async () => {
    const rows = byKind(await day(a, { p_today: TODAY, p_limit: 3 }), "prepare_tomorrow");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      order_id: prepareTomorrowId,
      kind_total: 1,
      payment_status: "unpaid",
      unit_missing: true,
      amount_grosze: 18_000,
    });
  });

  it("money_alert: nieudane płatności przed kaucjami; zamówienie z OBOMA problemami liczy się RAZ (gałąź płatności); kaucja rozliczona poza zbiorem", async () => {
    const rows = byKind(await day(a, { p_today: TODAY, p_limit: 3 }), "money_alert");

    expect(
      rows.map((row) => ({
        order_id: row.order_id,
        item_kind: row.item_kind,
        amount_grosze: row.amount_grosze,
      })),
    ).toEqual([
      // payment_failed po end_date rosnąco: failedReturned (02-03) przed
      // failedUpcoming (03-22); potem kaucja depositOpen z saldem 2 000.
      { order_id: failedReturned, item_kind: "payment_failed", amount_grosze: 9_000 },
      { order_id: failedUpcoming, item_kind: "payment_failed", amount_grosze: 77_700 },
      { order_id: depositOpen, item_kind: "deposit_unsettled", amount_grosze: 2_000 },
    ]);
    // Trzy SPRAWY, nie cztery — failedReturned nie dubluje się w gałęzi kaucji.
    expect(rows[0].kind_total).toBe(3);
  });

  it("zarchiwizowane zamówienia (archived_at is not null) NIE wchodzą do ŻADNEGO rodzaju, a kind_total każdej gałęzi zostaje nietknięty (ADR-246, follow-up ADR-242)", async () => {
    const rows = await day(a, { p_today: TODAY, p_limit: 20 });
    const ids = new Set(rows.map((row) => row.order_id));

    // Żaden zarchiwizowany bliźniak nie pojawia się w wyniku — w każdej z
    // pięciu gałęzi (wydanie / zwrot / po terminie / jutro / alarm pieniężny).
    expect(ids.has(archivedPickup)).toBe(false);
    expect(ids.has(archivedReturn)).toBe(false);
    expect(ids.has(archivedOverdue)).toBe(false);
    expect(ids.has(archivedPrepare)).toBe(false);
    expect(ids.has(archivedMoney)).toBe(false);

    // Kwoty-sygnatury bliźniaków (50 000..54 000) nie wyciekają żadnym polem.
    const serialized = JSON.stringify(rows);
    for (const signature of ["50000", "51000", "52000", "53000", "54000"]) {
      expect(serialized).not.toContain(signature);
    }

    // Mimo bliźniaka pasującego do KAŻDEJ definicji liczniki kind_total są
    // takie same jak bez archiwum — dowód, że wykluczenie działa wszędzie,
    // nie tylko w jednej gałęzi.
    const total = (kind: string): number => {
      const kindRows = byKind(rows, kind);
      return kindRows.length > 0 ? kindRows[0].kind_total : 0;
    };
    expect(total("pickup_today")).toBe(4);
    expect(total("return_today")).toBe(2);
    expect(total("overdue")).toBe(2);
    expect(total("prepare_tomorrow")).toBe(1);
    expect(total("money_alert")).toBe(3);
  });

  it("rodzaje bez pozycji nie zwracają wierszy (stan zerowy renderuje panel), a pozycje spoza definicji nie istnieją w żadnym rodzaju", async () => {
    const rows = await day(a, { p_today: "2031-06-01", p_limit: 3 });
    // W dniu bez wydań/zwrotów zostają wyłącznie sprawy bez daty dnia:
    // po terminie (wszystkie picked_up z end < dziś) i alarmy pieniężne.
    expect(new Set(rows.map((row) => row.kind))).toEqual(
      new Set(["overdue", "money_alert"]),
    );
  });

  it("p_limit=1 tnie pozycje w KAŻDYM rodzaju z osobna, liczników nie zmienia", async () => {
    const rows = await day(a, { p_today: TODAY, p_limit: 1 });
    const kinds = rows.map((row) => row.kind);
    expect(kinds).toEqual([
      "pickup_today",
      "return_today",
      "overdue",
      "prepare_tomorrow",
      "money_alert",
    ]);
    expect(byKind(rows, "pickup_today")[0].kind_total).toBe(4);
    expect(byKind(rows, "money_alert")[0].kind_total).toBe(3);
  });

  it("wywołanie bez p_today działa (okno domyślne w Europe/Warsaw)", async () => {
    const { error } = await a.ownerClient.schema("app").rpc("dashboard_day", {});
    expect(error).toBeNull();
  });

  describe("izolacja i dostęp (sonda cross-tenant wg wzorca sióstr)", () => {
    it("wynik A nie zawiera ani grosza tenanta B; B widzi wyłącznie swoje wydanie", async () => {
      const rowsA = await day(a, { p_today: TODAY, p_limit: 20 });
      const serializedA = JSON.stringify(rowsA);
      expect(serializedA).not.toContain("999999");
      expect(serializedA).not.toContain(bPickup);
      expect(serializedA).not.toContain("Zenon");

      const rowsB = await day(b, { p_today: TODAY, p_limit: 20 });
      expect(
        rowsB.map((row) => ({
          kind: row.kind,
          order_id: row.order_id,
          amount_grosze: row.amount_grosze,
        })),
      ).toEqual([
        { kind: "pickup_today", order_id: bPickup, amount_grosze: 999_999 },
      ]);
    });

    it("anon nie dosięga funkcji (42501)", async () => {
      const { data, error } = await anonClient()
        .schema("app")
        .rpc("dashboard_day", { p_limit: 3 });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("service_role bez kontekstu tenanta dostaje PUSTO (fail-closed), nie wszystko", async () => {
      const { data, error } = await admin
        .schema("app")
        .rpc("dashboard_day", { p_today: TODAY, p_limit: 20 });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });
});
