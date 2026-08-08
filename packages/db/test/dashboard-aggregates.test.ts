/**
 * Agregaty dashboardu operatora (C1, migracja 0054; ADR-109) na ŻYWYM,
 * lokalnym Supabase.
 *
 * PRZEDMIOTEM TESTU JEST BAZA: cztery funkcje `app.dashboard_*` liczą
 * DOKŁADNE liczby z seedu o znanych kwotach — nie „coś się zwróciło”.
 * Każda asercja kwotowa porównuje pełny zbiór wierszy (toEqual), więc
 * jakikolwiek wyciek między tenantami, doliczenie kaucji albo zmieszanie
 * walut zmienia wynik i pali test (dowody mutacyjne M1–M3 briefu C1).
 *
 * Osie:
 *   1. PRZYCHÓD — definicja „zrealizowany” jako kontrakt: dokładne sumy
 *      rental+delivery per miesiąc × waluta; kaucja POZA sumą; statusy
 *      unpaid/pending/payment_failed/refunded oraz anulowane zamówienia
 *      poza sumą; stare zamówienie poza oknem 12 miesięcy.
 *   2. MULTIWALUTA (ADR-103) — EUR i PLN tego samego miesiąca to OSOBNE
 *      wiersze; żaden agregat nie dodaje groszy różnych walut.
 *   3. ZAJĘTOŚĆ — lustro silnika: dla KAŻDEGO statusu zamówienia dni liczą
 *      się wtedy i tylko wtedy, gdy status ∈ AVAILABILITY_BLOCKING_ORDER_
 *      STATUSES ∪ {returned} (stała importowana z @avably/core — zmiana
 *      w silniku bez zmiany SQL pali ten test). Dokładna arytmetyka
 *      nachodzenia okna i mianownik egzemplarze × dni.
 *   4. ZŁOCI KLIENCI — ranking per waluta, udział %, liczba zamówień,
 *      data ostatniego zamówienia, limit.
 *   5. WYMAGA UWAGI — po terminie bez zwrotu, payment_failed, nierozliczona
 *      kaucja po zakończonym najmie (saldo z rejestru, nie z deklaracji).
 *   6. IZOLACJA I DOSTĘP — liczby A nie zawierają ani grosza B; anon nie
 *      dosięga żadnej funkcji (42501); service_role bez kontekstu tenanta
 *      dostaje pusto (fail-closed), nie wszystko.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AVAILABILITY_BLOCKING_ORDER_STATUSES,
  ORDER_STATUSES,
  type OrderStatus,
  type PaymentStatus,
} from "@avably/core";

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
 * „Dziś” testów — data przyszła i stała, żeby okna były deterministyczne
 * i żeby seedy innych suit (biegnących równolegle na wspólnej bazie, ale
 * w INNYCH tenantach) nie miały jak wejść w te liczby.
 */
const TODAY = "2030-06-15";

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
  currency?: "PLN" | "EUR" | "USD";
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  provider?: "manual" | "stripe";
  /** Ile pozycji (egzemplarzy) tego produktu zajmuje zamówienie. */
  productId?: string;
  items?: number;
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
      email: `${randomUUID().slice(0, 8)}@dashboard.test`,
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
): Promise<string> {
  const { data, error } = await admin
    .from("products")
    .insert({ tenant_id: tenantId, name, base_price_day_grosze: 10_000, deposit_grosze: 0 })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Produkt ${name}: ${error?.message}`);
  const productId = data.id as string;
  if (unitCount > 0) {
    const { error: unitsError } = await admin.from("product_units").insert(
      Array.from({ length: unitCount }, () => ({
        tenant_id: tenantId,
        product_id: productId,
        serial_number: `SN-${randomUUID().slice(0, 8)}`,
      })),
    );
    if (unitsError) throw new Error(`Egzemplarze ${name}: ${unitsError.message}`);
  }
  return productId;
}

/**
 * Zamówienie rodzi się w pending (bramka 0015) i idzie do celu wyłącznie
 * legalnymi przejściami; oś płatności analogicznie (payment_failed tylko
 * w obiegu stripe, przez pending — pisze service_role jak webhook).
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
      currency: spec.currency ?? "PLN",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Zamówienie: ${error?.message}`);
  const orderId = data.id as string;

  if (spec.productId && (spec.items ?? 1) > 0) {
    const { error: itemsError } = await admin.from("order_items").insert(
      Array.from({ length: spec.items ?? 1 }, () => ({
        tenant_id: spec.tenantId,
        order_id: orderId,
        product_id: spec.productId,
        rental_grosze: spec.rental,
        deposit_grosze: spec.deposit ?? 0,
      })),
    );
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

/** Wywołanie RPC funkcji dashboardu jako zalogowany członek tenanta. */
async function rpc<T>(
  ctx: TenantCtx,
  fn: string,
  args: Record<string, unknown>,
): Promise<T[]> {
  const { data, error } = await ctx.ownerClient.schema("app").rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (data ?? []) as T[];
}

interface RevenueRow {
  month_start: string;
  currency_code: string;
  rental_grosze: number;
  delivery_grosze: number;
  orders_count: number;
}

interface UtilizationRow {
  product_id: string;
  product_name: string;
  product_active: boolean;
  unit_count: number;
  busy_days: number;
  window_days: number;
  utilization_pct: number | string | null;
}

interface TopCustomerRow {
  customer_id: string;
  customer_name: string;
  currency_code: string;
  revenue_grosze: number;
  orders_count: number;
  last_order_date: string;
  share_pct: number | string | null;
}

interface AttentionRow {
  kind: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  end_date: string;
  amount_grosze: number;
  currency_code: string;
}

const pct = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

describe.skipIf(!hasEnv)("agregaty dashboardu operatora (0054, ADR-109)", () => {
  const admin = hasEnv ? createAdminClient() : (null as unknown as SupabaseClient);

  let a: TenantCtx;
  let b: TenantCtx;

  // Identyfikatory seedu tenanta A.
  let customerAnna: string;
  let customerBartek: string;
  let customerCelina: string;
  let productKoparka: string;
  let productZageszczarka: string;
  let productMlot: string;
  let overdueOrderId: string;
  let failedOrderId: string;
  let depositOrderId: string;

  beforeAll(async () => {
    ({ a, b } = await seedTwoTenants());

    // ----- Tenant A: klienci -----
    customerAnna = await createCustomer(admin, a.tenantId, "Anna Alfa");
    customerBartek = await createCustomer(admin, a.tenantId, "Bartek Beta");
    customerCelina = await createCustomer(admin, a.tenantId, "Celina Gamma");

    // ----- Tenant A: przychód (zamówienia bez pozycji — nie wchodzą
    // w zajętość; kwoty rozmyślnie „podpisane”, żeby pomyłka była widoczna) --
    // r1: paid, czerwiec, PLN — W SUMIE (11 500 z dostawą; kaucja 5 000 NIE).
    await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerAnna,
      start: "2030-06-03",
      end: "2030-06-05",
      rental: 10_000,
      delivery: 1_500,
      deposit: 5_000,
      paymentStatus: "paid",
    });
    // r2: manual, czerwiec, PLN — W SUMIE; jednocześnie PO TERMINIE zwrotu
    // (picked_up, end 2030-06-12 < TODAY) → pozycja overdue_return.
    overdueOrderId = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerAnna,
      start: "2030-06-10",
      end: "2030-06-12",
      rental: 20_000,
      paymentStatus: "manual",
      orderStatus: "picked_up",
    });
    // r3: completed, maj, PLN — W SUMIE; najem zakończony (returned)
    // z pobraną kaucją 6 000 bez zwrotu → pozycja deposit_unsettled.
    depositOrderId = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerBartek,
      start: "2030-05-05",
      end: "2030-05-08",
      rental: 30_000,
      delivery: 2_000,
      deposit: 6_000,
      paymentStatus: "completed",
      orderStatus: "returned",
    });
    const { error: depositError } = await admin.from("deposit_events").insert({
      tenant_id: a.tenantId,
      order_id: depositOrderId,
      kind: "collected",
      amount_grosze: 6_000,
    });
    if (depositError) throw new Error(`Kaucja r3: ${depositError.message}`);
    // r4: deposit_refunded, maj, PLN — W SUMIE (przychód z najmu został).
    // Przejście na deposit_refunded bramkuje rejestr kaucji (0011): zwrot
    // musi być POKRYTY wierszami collected/refunded, więc seedujemy pełny
    // obieg pieniędzy kaucji, zanim oś płatności ogłosi rozliczenie.
    const refundedOrderId = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerBartek,
      start: "2030-05-20",
      end: "2030-05-22",
      rental: 40_000,
      deposit: 7_000,
      paymentStatus: "paid",
    });
    for (const kind of ["collected", "refunded"] as const) {
      const { error: ledgerError } = await admin.from("deposit_events").insert({
        tenant_id: a.tenantId,
        order_id: refundedOrderId,
        kind,
        amount_grosze: 7_000,
      });
      if (ledgerError) throw new Error(`Rejestr kaucji r4 (${kind}): ${ledgerError.message}`);
    }
    const { error: r4Error } = await admin
      .from("orders")
      .update({ payment_status: "deposit_refunded" })
      .eq("tenant_id", a.tenantId)
      .eq("id", refundedOrderId);
    if (r4Error) throw new Error(`r4 → deposit_refunded: ${r4Error.message}`);
    // r5–r8: POZA SUMĄ (unpaid / pending / payment_failed / refunded).
    await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerAnna,
      start: "2030-06-04",
      end: "2030-06-06",
      rental: 555_555,
      paymentStatus: "unpaid",
    });
    await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerAnna,
      start: "2030-06-05",
      end: "2030-06-07",
      rental: 111_111,
      paymentStatus: "pending",
    });
    failedOrderId = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerBartek,
      start: "2030-06-18",
      end: "2030-06-20",
      rental: 77_700,
      provider: "stripe",
      paymentStatus: "payment_failed",
    });
    await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerBartek,
      start: "2030-06-08",
      end: "2030-06-09",
      rental: 88_800,
      paymentStatus: "refunded",
    });
    // r9: opłacone → zwrócone → ANULOWANE zamówienie — POZA SUMĄ.
    // Bramka 0027 nie pozwala anulować z pobranymi środkami (paid), więc
    // jedyna legalna droga to zwrot przed anulowaniem; niezmiennik bazy
    // gwarantuje, że anulowane zamówienie nigdy nie nosi zrealizowanej
    // płatności — filtr order_status <> 'cancelled' w 0054 to obrona w głąb.
    const cancelledOrderId = await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerAnna,
      start: "2030-06-11",
      end: "2030-06-13",
      rental: 99_900,
      paymentStatus: "paid",
    });
    const { error: r9Error } = await admin
      .from("orders")
      .update({ payment_status: "refunded", order_status: "cancelled" })
      .eq("tenant_id", a.tenantId)
      .eq("id", cancelledOrderId);
    if (r9Error) throw new Error(`r9 → refunded+cancelled: ${r9Error.message}`);
    // r10: EUR, czerwiec — OSOBNY wiersz waluty (ADR-103).
    await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerCelina,
      start: "2030-06-07",
      end: "2030-06-09",
      rental: 12_345,
      delivery: 655,
      currency: "EUR",
      paymentStatus: "paid",
    });
    // r11: opłacone, ale POZA oknem 12 miesięcy (start 2029-05-10).
    await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerAnna,
      start: "2029-05-10",
      end: "2029-05-12",
      rental: 44_400,
      paymentStatus: "paid",
    });

    // ----- Tenant A: zajętość (produkty z pozycjami zamówień) -----
    productKoparka = await createProductWithUnits(admin, a.tenantId, "Koparka", 2);
    productZageszczarka = await createProductWithUnits(admin, a.tenantId, "Zagęszczarka", 1);
    productMlot = await createProductWithUnits(admin, a.tenantId, "Młot", 0);
    // u1: returned 06-01..06-10 → 10 dni w oknie [05-17, 06-15].
    await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerAnna,
      start: "2030-06-01",
      end: "2030-06-10",
      rental: 1_000,
      orderStatus: "returned",
      productId: productKoparka,
    });
    // u2: picked_up 06-12..06-20 → 4 dni (nachodzenie do 06-15).
    await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerAnna,
      start: "2030-06-12",
      end: "2030-06-20",
      rental: 1_000,
      orderStatus: "picked_up",
      productId: productKoparka,
    });
    // u3: cancelled 05-20..06-05 → 0 dni (nigdy nie trzymał sprzętu).
    await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerAnna,
      start: "2030-05-20",
      end: "2030-06-05",
      rental: 1_000,
      orderStatus: "cancelled",
      productId: productKoparka,
    });
    // u4: reserved 05-10..05-18 → 2 dni (nachodzenie od 05-17).
    await createOrder(admin, {
      tenantId: a.tenantId,
      customerId: customerAnna,
      start: "2030-05-10",
      end: "2030-05-18",
      rental: 1_000,
      orderStatus: "reserved",
      productId: productKoparka,
    });

    // ----- Tenant B: kwota-sygnatura wycieku + lustro statusów zajętości --
    const customerZenon = await createCustomer(admin, b.tenantId, "Zenon Zeta");
    await createOrder(admin, {
      tenantId: b.tenantId,
      customerId: customerZenon,
      start: "2030-06-06",
      end: "2030-06-08",
      rental: 999_999,
      paymentStatus: "paid",
    });
    for (const status of ORDER_STATUSES) {
      const productId = await createProductWithUnits(
        admin,
        b.tenantId,
        `status-${status}`,
        1,
      );
      await createOrder(admin, {
        tenantId: b.tenantId,
        customerId: customerZenon,
        start: "2030-06-01",
        end: "2030-06-05",
        rental: 1_000,
        orderStatus: status,
        productId,
      });
    }
  }, 120_000);

  afterAll(async () => {
    if (!hasEnv) return;
    await cleanupSeeded(admin);
  });

  describe("app.dashboard_revenue", () => {
    it("liczy DOKŁADNE sumy per miesiąc × waluta: kaucja poza przychodem, statusy niezrealizowane i anulowane poza sumą, stare zamówienie poza oknem", async () => {
      const rows = await rpc<RevenueRow>(a, "dashboard_revenue", {
        p_months: 12,
        p_today: TODAY,
      });

      expect(rows).toEqual([
        {
          month_start: "2030-05-01",
          currency_code: "PLN",
          rental_grosze: 70_000,
          delivery_grosze: 2_000,
          orders_count: 2,
        },
        {
          month_start: "2030-06-01",
          currency_code: "EUR",
          rental_grosze: 12_345,
          delivery_grosze: 655,
          orders_count: 1,
        },
        {
          month_start: "2030-06-01",
          currency_code: "PLN",
          rental_grosze: 30_000,
          delivery_grosze: 1_500,
          orders_count: 2,
        },
      ]);
    });

    it("liczby A nie zawierają ani grosza tenanta B", async () => {
      const rows = await rpc<RevenueRow>(a, "dashboard_revenue", {
        p_months: 12,
        p_today: TODAY,
      });
      expect(JSON.stringify(rows)).not.toContain("999999");

      const rowsB = await rpc<RevenueRow>(b, "dashboard_revenue", {
        p_months: 12,
        p_today: TODAY,
      });
      expect(rowsB).toEqual([
        {
          month_start: "2030-06-01",
          currency_code: "PLN",
          rental_grosze: 999_999,
          delivery_grosze: 0,
          orders_count: 1,
        },
      ]);
    });

    it("wywołanie bez p_today działa (okno domyślne w Europe/Warsaw)", async () => {
      const { error } = await a.ownerClient.schema("app").rpc("dashboard_revenue", {});
      expect(error).toBeNull();
    });
  });

  describe("app.dashboard_utilization", () => {
    it("liczy dokładne dni zajętości i procent per produkt (mianownik: egzemplarze × dni okna)", async () => {
      const rows = await rpc<UtilizationRow>(a, "dashboard_utilization", {
        p_days: 30,
        p_today: TODAY,
      });

      expect(rows).toHaveLength(3);
      const byId = new Map(rows.map((row) => [row.product_id, row]));

      const koparka = byId.get(productKoparka);
      // u1 (returned) 10 + u2 (picked_up) 4 + u4 (reserved) 2 = 16 dni;
      // u3 (cancelled) nie liczy się. 100 × 16 / (2 egz. × 30 dni) = 26.7.
      expect(koparka).toMatchObject({
        product_name: "Koparka",
        unit_count: 2,
        busy_days: 16,
        window_days: 30,
      });
      expect(pct(koparka!.utilization_pct)).toBeCloseTo(26.7, 5);

      const zageszczarka = byId.get(productZageszczarka);
      expect(zageszczarka).toMatchObject({ unit_count: 1, busy_days: 0 });
      expect(pct(zageszczarka!.utilization_pct)).toBe(0);

      // Produkt bez egzemplarzy: procent nieokreślony (null), nie zero.
      const mlot = byId.get(productMlot);
      expect(mlot).toMatchObject({ unit_count: 0, busy_days: 0 });
      expect(mlot!.utilization_pct).toBeNull();
    });

    it("zajętość = statusy blokujące dostępność z SILNIKA + returned; cancelled nigdy (lustro AVAILABILITY_BLOCKING_ORDER_STATUSES)", async () => {
      const rows = await rpc<UtilizationRow>(b, "dashboard_utilization", {
        p_days: 30,
        p_today: TODAY,
      });
      const busySet = new Set<OrderStatus>([
        ...AVAILABILITY_BLOCKING_ORDER_STATUSES,
        "returned",
      ]);

      for (const status of ORDER_STATUSES) {
        const row = rows.find((r) => r.product_name === `status-${status}`);
        expect(row, `brak wiersza produktu status-${status}`).toBeDefined();
        expect(
          row!.busy_days,
          `status ${status}: dni zajętości nie zgadzają się z lustrem silnika`,
        ).toBe(busySet.has(status) ? 5 : 0);
      }
    });

    it("produkty tenanta B nie przeciekają do wyniku A", async () => {
      const rows = await rpc<UtilizationRow>(a, "dashboard_utilization", {
        p_days: 30,
        p_today: TODAY,
      });
      expect(rows.some((row) => row.product_name.startsWith("status-"))).toBe(false);
    });
  });

  describe("app.dashboard_top_customers", () => {
    it("ranking po przychodzie zrealizowanym per waluta z udziałem %, liczbą zamówień i datą ostatniego zamówienia", async () => {
      const rows = await rpc<TopCustomerRow>(a, "dashboard_top_customers", {
        p_months: 12,
        p_limit: 10,
        p_today: TODAY,
      });

      const eur = rows.filter((row) => row.currency_code === "EUR");
      const pln = rows.filter((row) => row.currency_code === "PLN");

      expect(eur).toHaveLength(1);
      expect(eur[0]).toMatchObject({
        customer_name: "Celina Gamma",
        revenue_grosze: 13_000,
        orders_count: 1,
        last_order_date: "2030-06-07",
      });
      expect(pct(eur[0].share_pct)).toBeCloseTo(100, 5);

      // PLN: Bartek 72 000 (r3 32 000 + r4 40 000), Anna 31 500
      // (r1 11 500 + r2 20 000); razem 103 500.
      expect(pln.map((row) => row.customer_name)).toEqual(["Bartek Beta", "Anna Alfa"]);
      expect(pln[0]).toMatchObject({
        revenue_grosze: 72_000,
        orders_count: 2,
        last_order_date: "2030-05-20",
      });
      expect(pct(pln[0].share_pct)).toBeCloseTo(69.6, 5);
      expect(pln[1]).toMatchObject({
        revenue_grosze: 31_500,
        orders_count: 2,
        last_order_date: "2030-06-10",
      });
      expect(pct(pln[1].share_pct)).toBeCloseTo(30.4, 5);
    });

    it("p_limit ogranicza ranking W KAŻDEJ walucie z osobna", async () => {
      const rows = await rpc<TopCustomerRow>(a, "dashboard_top_customers", {
        p_months: 12,
        p_limit: 1,
        p_today: TODAY,
      });
      expect(rows.map((row) => [row.currency_code, row.customer_name])).toEqual([
        ["EUR", "Celina Gamma"],
        ["PLN", "Bartek Beta"],
      ]);
    });

    it("klienci tenanta B nie występują w rankingu A", async () => {
      const rows = await rpc<TopCustomerRow>(a, "dashboard_top_customers", {
        p_months: 12,
        p_limit: 50,
        p_today: TODAY,
      });
      expect(rows.some((row) => row.customer_name === "Zenon Zeta")).toBe(false);
      expect(JSON.stringify(rows)).not.toContain("999999");
    });
  });

  describe("app.dashboard_attention", () => {
    it("wskazuje dokładnie: po terminie bez zwrotu, payment_failed i nierozliczoną kaucję po zakończonym najmie", async () => {
      const rows = await rpc<AttentionRow>(a, "dashboard_attention", {
        p_today: TODAY,
        p_limit: 20,
      });

      expect(
        rows.map((row) => ({
          kind: row.kind,
          order_id: row.order_id,
          customer_name: row.customer_name,
          amount_grosze: row.amount_grosze,
          currency_code: row.currency_code,
        })),
      ).toEqual([
        {
          kind: "overdue_return",
          order_id: overdueOrderId,
          customer_name: "Anna Alfa",
          amount_grosze: 20_000,
          currency_code: "PLN",
        },
        {
          kind: "payment_failed",
          order_id: failedOrderId,
          customer_name: "Bartek Beta",
          amount_grosze: 77_700,
          currency_code: "PLN",
        },
        {
          // Kwota pozycji = OTWARTE SALDO rejestru kaucji (6 000), nie
          // deklaracja z zamówienia.
          kind: "deposit_unsettled",
          order_id: depositOrderId,
          customer_name: "Bartek Beta",
          amount_grosze: 6_000,
          currency_code: "PLN",
        },
      ]);
    });

    it("tenant B widzi WYŁĄCZNIE swoją pozycję (zamówienie picked_up z lustra statusów), nic z A", async () => {
      const rows = await rpc<AttentionRow>(b, "dashboard_attention", {
        p_today: TODAY,
        p_limit: 20,
      });
      // Seed lustra statusów zostawia w B jedno zamówienie picked_up
      // z terminem 2030-06-05 < TODAY — to legalna pozycja overdue_return.
      expect(
        rows.map((row) => ({
          kind: row.kind,
          customer_name: row.customer_name,
          amount_grosze: row.amount_grosze,
        })),
      ).toEqual([
        { kind: "overdue_return", customer_name: "Zenon Zeta", amount_grosze: 1_000 },
      ]);
      const serialized = JSON.stringify(rows);
      for (const orderId of [overdueOrderId, failedOrderId, depositOrderId]) {
        expect(serialized).not.toContain(orderId);
      }
    });
  });

  describe("dostęp do funkcji dashboardu", () => {
    it.each([
      ["dashboard_revenue", { p_months: 12 }],
      ["dashboard_utilization", { p_days: 30 }],
      ["dashboard_top_customers", { p_months: 12, p_limit: 10 }],
      ["dashboard_attention", { p_limit: 20 }],
    ])("anon nie dosięga %s (42501)", async (fn, args) => {
      const { data, error } = await anonClient().schema("app").rpc(fn, args);
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("service_role bez kontekstu tenanta dostaje PUSTO (fail-closed), nie wszystko", async () => {
      const { data, error } = await admin
        .schema("app")
        .rpc("dashboard_revenue", { p_months: 12, p_today: TODAY });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  describe("kontrakt źródła funkcji (recenzja PM #209)", () => {
    /**
     * Wszystkie testy okien podają `p_today` JAWNIE — więc gałąź DOMYŚLNEGO
     * „dziś” (coalesce z now()) nie jest przypięta zachowaniem: regres
     * Europe/Warsaw → UTC przechodzi zielono, a przesuwa granice miesięcy
     * operatora o 1–2 h. Pin na ŹRÓDLE funkcji (pg_get_functiondef z żywej
     * bazy, wzorzec pinu predykatu z M1/#208): każda funkcja 0054 musi
     * liczyć domyślne „dziś” w Europe/Warsaw.
     */
    it("każda funkcja app.dashboard_* liczy domyślne „dziś” w Europe/Warsaw (pin pg_get_functiondef)", async () => {
      const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
      try {
        const rows = await sql<{ proname: string; def: string }[]>`
          select p.proname, pg_get_functiondef(p.oid) as def
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname like 'dashboard%'
        `;
        expect(rows.map((row) => row.proname).sort()).toEqual([
          "dashboard_attention",
          "dashboard_revenue",
          "dashboard_top_customers",
          "dashboard_utilization",
        ]);
        for (const row of rows) {
          expect(
            row.def,
            `${row.proname}: domyślna gałąź „dziś” musi liczyć w Europe/Warsaw — ` +
              `okna miesięczne mają biec tak, jak widzi je operator, nie UTC (ADR-109)`,
          ).toContain("Europe/Warsaw");
          // Strefa ma siedzieć w gałęzi domyślnej (coalesce z now()), nie być
          // martwym literałem: pilnujemy współobecności wzorca w tym samym źródle.
          expect(row.def).toMatch(/coalesce\(p_today/i);
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  });
});
