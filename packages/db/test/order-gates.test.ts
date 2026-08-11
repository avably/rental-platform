/**
 * Bramki zamówień w bazie (packages/db/supabase/migrations/0010_order_gates.sql)
 * — dowody dla ADR-024 (wyścig przy przypisaniu egzemplarza) i ADR-025
 * (maszyna stanów egzekwowana w bazie, nie w JS).
 *
 * Obie bramki DUPLIKUJĄ semantykę zdefiniowaną w @avably/core (mapę przejść
 * i dostępność z buforami), więc rdzeniem tego pliku są testy ZGODNOŚCI:
 *
 *   1. lustro CHECK↔TS: wartości statusów w bazie == stałe w @avably/core
 *      (introspekcja pg_constraint, nie przepisana lista),
 *   2. maszyna stanów: WSZYSTKIE 36 par from→to — werdykt bazy musi być
 *      równy canTransition() co do pary,
 *   3. dostępność: macierz scenariuszy (bufory, styki, okna serwisowe) —
 *      werdykt bazy musi być równy checkAvailability() scenariusz po
 *      scenariuszu, a wartości oczekiwane są DODATKOWO przypięte ręcznie
 *      (gdyby silnik i baza rozjechały się zgodnie, płonie pin),
 *   4. wyścig: dwóch operatorów (dwie realne sesje), ten sam egzemplarz
 *      i termin, równolegle — dokładnie jeden sukces, przegrany dostaje
 *      23P01, a jego zamówienie NIE istnieje (atomowość app.create_order).
 *
 * Sekcje 2-3 idą klientem service-role (wzorzec rental-core.test.ts): bramki
 * są zachowaniem SCHEMATU i obowiązują KAŻDĄ rolę — to jest częścią decyzji
 * ADR-025 (import danych też nie ma prawa tworzyć stanów niemożliwych).
 * Wyścig idzie realnymi sesjami członków tenanta, bo to jest ścieżka panelu.
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (docs/konwencje-
 * migracji.md). Bez nich strażnik integration-env failuje suitę.
 */
import { randomUUID } from "node:crypto";

import {
  AVAILABILITY_BLOCKING_ORDER_STATUSES,
  BLOCKING_PAYMENT_STATUSES,
  canPaymentTransition,
  canTransition,
  checkAvailability,
  ORDER_STATUSES,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentProvider,
  type PaymentStatus,
} from "@avably/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const hasEnv = integrationEnv([
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
]);

/** Kody błędów bramek 0010 — patrz nagłówek migracji. */
const PG_UNIT_CONFLICT = "23P01"; // exclusion_violation: egzemplarz zajęty
const PG_BAD_TRANSITION = "23514"; // check_violation: niedozwolone przejście maszyny stanów
const PG_CANCEL_BLOCKED = "23001"; // restrict_violation: anulowanie przy blokującym payment_status

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const TEST_PASSWORD = "OrderGates!12345678";

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

describe.skipIf(!hasEnv)("bramki zamówień — 0010_order_gates.sql", () => {
  let admin: SupabaseClient;
  let sql: ReturnType<typeof postgres>;
  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];

  async function createTenant(label: string): Promise<string> {
    const { data, error } = await admin
      .from("tenants")
      .insert({
        slug: `gate-${label}-${randomUUID()}`.slice(0, 39),
        name: `Order gates test tenant ${label}`,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createTenant(${label}): ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  async function createCustomer(tenantId: string): Promise<string> {
    const { data, error } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, email: `gate-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createCustomer: ${error?.message}`);
    return data.id as string;
  }

  async function createProduct(
    tenantId: string,
    buffers: { before: number; after: number },
  ): Promise<string> {
    const { data, error } = await admin
      .from("products")
      .insert({
        tenant_id: tenantId,
        name: `Agregat ${randomUUID().slice(0, 8)}`,
        base_price_day_grosze: 10_000,
        buffer_before_days: buffers.before,
        buffer_after_days: buffers.after,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createProduct: ${error?.message}`);
    return data.id as string;
  }

  async function createUnit(
    tenantId: string,
    productId: string,
    service?: { from: string | null; to: string | null },
  ): Promise<string> {
    const { data, error } = await admin
      .from("product_units")
      .insert({
        tenant_id: tenantId,
        product_id: productId,
        unavailable_from: service?.from ?? null,
        unavailable_to: service?.to ?? null,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createUnit: ${error?.message}`);
    return data.id as string;
  }

  async function createOrder(
    tenantId: string,
    customerId: string,
    start: string,
    end: string,
    provider?: PaymentProvider,
  ): Promise<string> {
    const { data, error } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        start_date: start,
        end_date: end,
        delivery_method: "courier",
        // Bez argumentu NIE podajemy kolumny — ścieżka „jak przed 0027",
        // której default (manual) jest osobno dowodzony w sekcji 6.
        ...(provider ? { payment_provider: provider } : {}),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createOrder: ${error?.message}`);
    return data.id as string;
  }

  async function insertItem(
    tenantId: string,
    orderId: string,
    productId: string,
    unitId: string | null,
  ): Promise<{ errorCode?: string; errorMessage?: string }> {
    const { error } = await admin.from("order_items").insert({
      tenant_id: tenantId,
      order_id: orderId,
      product_id: productId,
      unit_id: unitId,
      rental_grosze: 10_000,
    });
    return error ? { errorCode: error.code, errorMessage: error.message } : {};
  }

  async function setStatus(
    orderId: string,
    to: OrderStatus,
  ): Promise<{ errorCode?: string; errorMessage?: string }> {
    const { data, error } = await admin
      .from("orders")
      .update({ order_status: to })
      .eq("id", orderId)
      .select("id");
    if (error) return { errorCode: error.code, errorMessage: error.message };
    if (!data || data.length === 0) return { errorMessage: "UPDATE dosięgnął zero wierszy" };
    return {};
  }

  /**
   * Doprowadza świeże zamówienie do stanu `target` WYŁĄCZNIE dozwolonymi
   * przejściami. To nie jest wygoda testowa, tylko część dowodu: bramka
   * obowiązuje też service-role, więc nie istnieje ścieżka „ustaw stan
   * bezpośrednio" — każdy stan osiąga się spacerem po mapie.
   */
  const WALKS: Record<OrderStatus, readonly OrderStatus[]> = {
    pending: [],
    reserved: ["reserved"],
    ready_for_pickup: ["reserved", "ready_for_pickup"],
    picked_up: ["reserved", "ready_for_pickup", "picked_up"],
    returned: ["reserved", "ready_for_pickup", "picked_up", "returned"],
    cancelled: ["cancelled"],
  };

  async function walkTo(orderId: string, target: OrderStatus): Promise<void> {
    for (const step of WALKS[target]) {
      const { errorMessage } = await setStatus(orderId, step);
      if (errorMessage) throw new Error(`walkTo(${target}) na kroku ${step}: ${errorMessage}`);
    }
  }

  beforeAll(async () => {
    admin = createAdminClient();
    sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 5 });
  }, 60_000);

  afterAll(async () => {
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    await sql.end({ timeout: 5 });
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Lustro CHECK↔TS — introspekcja, nie przepisana lista
  // -------------------------------------------------------------------

  describe("zbiory statusów w bazie == stałe w @avably/core", () => {
    async function constraintValues(conname: string): Promise<string[]> {
      const rows = await sql<{ def: string }[]>`
        select pg_get_constraintdef(oid) as def
        from pg_constraint
        where conrelid = 'public.orders'::regclass and conname = ${conname}
      `;
      if (rows.length !== 1) throw new Error(`Brak constraintu ${conname} na public.orders`);
      const matches = [...rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
      if (matches.length === 0) throw new Error(`Nie sparsowano wartości z: ${rows[0]!.def}`);
      return matches;
    }

    it("orders_order_status_check == ORDER_STATUSES", async () => {
      expect((await constraintValues("orders_order_status_check")).sort()).toEqual(
        [...ORDER_STATUSES].sort(),
      );
    });

    it("orders_payment_status_check == PAYMENT_STATUSES", async () => {
      expect((await constraintValues("orders_payment_status_check")).sort()).toEqual(
        [...PAYMENT_STATUSES].sort(),
      );
    });
  });

  // -------------------------------------------------------------------
  // 2. Maszyna stanów (ADR-025)
  // -------------------------------------------------------------------

  describe("maszyna stanów — trigger jest lustrem canTransition (36 par)", () => {
    let tenantId: string;
    let customerId: string;

    beforeAll(async () => {
      tenantId = await createTenant("machine");
      customerId = await createCustomer(tenantId);
    }, 30_000);

    it("INSERT z order_status innym niż 'pending' jest odrzucany (P0022)", async () => {
      const { error } = await admin.from("orders").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        start_date: "2026-08-01",
        end_date: "2026-08-03",
        delivery_method: "courier",
        order_status: "picked_up",
      });
      expect(error?.code, `zamówienie urodziło się jako picked_up: ${error?.message}`).toBe(
        PG_BAD_TRANSITION,
      );
    });

    it.each(
      ORDER_STATUSES.flatMap((from) =>
        ORDER_STATUSES.filter((to) => to !== from).map((to) => ({ from, to })),
      ),
    )(
      "$from → $to: baza zgodna z canTransition",
      async ({ from, to }) => {
        const orderId = await createOrder(tenantId, customerId, "2026-08-01", "2026-08-03");
        await walkTo(orderId, from);

        const { errorCode, errorMessage } = await setStatus(orderId, to);
        if (canTransition(from, to)) {
          expect(errorMessage, `dozwolone ${from}→${to} odrzucone: ${errorMessage}`).toBeUndefined();
        } else {
          expect(errorCode, `zabronione ${from}→${to} przeszło`).toBe(PG_BAD_TRANSITION);
        }
      },
      15_000,
    );

    it("UPDATE niezmieniający statusu nie pyta maszyny stanów", async () => {
      const orderId = await createOrder(tenantId, customerId, "2026-08-01", "2026-08-03");
      await walkTo(orderId, "returned"); // stan terminalny — każde PRZEJŚCIE jest zabronione
      // Pole obojętne dla maszyny stanów (0041 zdjął orders.notes — używamy
      // delivery_grosze, którego bramka 0010 nie dotyka: to nie status ani data).
      const { data, error } = await admin
        .from("orders")
        .update({ delivery_grosze: 1_234 })
        .eq("id", orderId)
        .select("id");
      expect(error?.message, `UPDATE pola obojętnego na terminalnym statusie: ${error?.message}`).toBeUndefined();
      expect(data).toHaveLength(1);
    });

    it("każdy UPDATE podbija updated_at", async () => {
      const orderId = await createOrder(tenantId, customerId, "2026-08-01", "2026-08-03");
      const { data: before } = await admin
        .from("orders")
        .select("updated_at")
        .eq("id", orderId)
        .single();
      const { data: after } = await admin
        .from("orders")
        .update({ delivery_grosze: 4_321 })
        .eq("id", orderId)
        .select("updated_at")
        .single();
      expect(new Date(after!.updated_at as string).getTime()).toBeGreaterThan(
        new Date(before!.updated_at as string).getTime(),
      );
    });

    describe("anulowanie a payment_status — lustro BLOCKING_PAYMENT_STATUSES", () => {
      it.each(PAYMENT_STATUSES.map((payment) => ({ payment })))(
        "payment_status=$payment: anulowanie zgodne ze stałą z @avably/core",
        async ({ payment }) => {
          // [0027] `payment_failed` istnieje WYŁĄCZNIE w obiegu online, więc
          // zamówienie musi być stripe'owe, a stan osiąga się spacerem
          // unpaid → pending → payment_failed (bramka obowiązuje też
          // service_role — nie ma ścieżki „ustaw wprost").
          const isFailed = payment === "payment_failed";
          const orderId = await createOrder(
            tenantId,
            customerId,
            "2026-08-01",
            "2026-08-03",
            isFailed ? "stripe" : undefined,
          );
          if (isFailed) {
            const step = await admin
              .from("orders")
              .update({ payment_status: "pending" })
              .eq("id", orderId)
              .select("id");
            expect(step.error?.message, `krok unpaid→pending: ${step.error?.message}`).toBeUndefined();
          }
          // Od 0015 (ADR-035) oś płatności MA bramkę: z 'unpaid' każdy status
          // jest osiągalny jednym legalnym przejściem, ale wejście w
          // deposit_refunded wymaga DODATKOWO pokrycia w rejestrze kaucji
          // (saldo 0 przy pobraniach > 0 — reguła B). Seedujemy je, żeby ten
          // test badał WYŁĄCZNIE blokadę anulowania (BLOCKING_PAYMENT_STATUSES),
          // nie bramkę spójności rejestru (ta ma własne testy w sekcji 5).
          if (payment === "deposit_refunded") {
            await admin
              .from("deposit_events")
              .insert({ tenant_id: tenantId, order_id: orderId, kind: "collected", amount_grosze: 100_00 });
            await admin
              .from("deposit_events")
              .insert({ tenant_id: tenantId, order_id: orderId, kind: "refunded", amount_grosze: 100_00 });
          }
          const { error: paymentError } = await admin
            .from("orders")
            .update({ payment_status: payment })
            .eq("id", orderId)
            .select("id");
          expect(paymentError?.message, `ustawienie payment_status=${payment}: ${paymentError?.message}`).toBeUndefined();

          const { errorCode, errorMessage } = await setStatus(orderId, "cancelled");
          if (BLOCKING_PAYMENT_STATUSES.includes(payment as PaymentStatus)) {
            expect(errorCode, `anulowanie przy payment_status=${payment} przeszło`).toBe(
              PG_CANCEL_BLOCKED,
            );
          } else {
            expect(
              errorMessage,
              `anulowanie przy payment_status=${payment} odrzucone: ${errorMessage}`,
            ).toBeUndefined();
          }
        },
      );
    });
  });

  // -------------------------------------------------------------------
  // 3. Dostępność egzemplarza (ADR-024) — zgodność SQL↔silnik
  // -------------------------------------------------------------------

  describe("bramka dostępności — werdykt bazy == checkAvailability, scenariusz po scenariuszu", () => {
    let tenantId: string;
    let customerId: string;

    beforeAll(async () => {
      tenantId = await createTenant("avail");
      customerId = await createCustomer(tenantId);
    }, 30_000);

    interface Scenario {
      label: string;
      buffers: { before: number; after: number };
      existing?: { start: string; end: string };
      service?: { from: string | null; to: string | null };
      requested: { start: string; end: string };
      /** Werdykt przypięty RĘCZNIE — gdyby silnik i baza rozjechały się zgodnie. */
      expectedAvailable: boolean;
    }

    const SCENARIOS: Scenario[] = [
      {
        label: "przerwa większa niż bufor: wolny",
        buffers: { before: 1, after: 1 },
        existing: { start: "2026-09-10", end: "2026-09-12" },
        requested: { start: "2026-09-14", end: "2026-09-15" },
        expectedAvailable: true,
      },
      {
        label: "przerwa równa buforowi (dzień po najmie w buforze): zajęty",
        buffers: { before: 1, after: 1 },
        existing: { start: "2026-09-10", end: "2026-09-12" },
        requested: { start: "2026-09-13", end: "2026-09-14" },
        expectedAvailable: false,
      },
      {
        label: "bez buforów, dzień po najmie: wolny",
        buffers: { before: 0, after: 0 },
        existing: { start: "2026-09-10", end: "2026-09-12" },
        requested: { start: "2026-09-13", end: "2026-09-14" },
        expectedAvailable: true,
      },
      {
        label: "bez buforów, styk w dzień końca: zajęty",
        buffers: { before: 0, after: 0 },
        existing: { start: "2026-09-10", end: "2026-09-12" },
        requested: { start: "2026-09-12", end: "2026-09-14" },
        expectedAvailable: false,
      },
      {
        label: "bufor PRZED najmem sięga istniejącego najmu: zajęty",
        buffers: { before: 2, after: 0 },
        existing: { start: "2026-09-10", end: "2026-09-12" },
        requested: { start: "2026-09-13", end: "2026-09-14" },
        expectedAvailable: false,
      },
      // Dwa scenariusze lustrzane: istniejący najem leży PO żądanym terminie.
      // Bez nich granica `o.start_date <= koniec+bufor` nie miała pokrycia —
      // mutacja `<=` → `<` przechodziła na zielono (wykryta dowodem
      // mutacyjnym przy 0010, stąd te przypadki).
      {
        label: "bez buforów, styk w dzień startu PÓŹNIEJSZEGO najmu: zajęty",
        buffers: { before: 0, after: 0 },
        existing: { start: "2026-09-13", end: "2026-09-15" },
        requested: { start: "2026-09-11", end: "2026-09-13" },
        expectedAvailable: false,
      },
      {
        label: "bufor PO najmie sięga dokładnie startu PÓŹNIEJSZEGO najmu: zajęty",
        buffers: { before: 0, after: 1 },
        existing: { start: "2026-09-16", end: "2026-09-18" },
        requested: { start: "2026-09-14", end: "2026-09-15" },
        expectedAvailable: false,
      },
      {
        label: "okno serwisowe nachodzi na termin: zajęty",
        buffers: { before: 1, after: 1 },
        service: { from: "2026-09-20", to: "2026-09-22" },
        requested: { start: "2026-09-21", end: "2026-09-23" },
        expectedAvailable: false,
      },
      {
        label: "okno serwisowe dotyka TYLKO bufora, nie najmu: wolny (bufor nie omija serwisu)",
        buffers: { before: 1, after: 1 },
        service: { from: "2026-09-20", to: "2026-09-22" },
        requested: { start: "2026-09-23", end: "2026-09-24" },
        expectedAvailable: true,
      },
      {
        label: "termin w całości wewnątrz istniejącego najmu: zajęty",
        buffers: { before: 0, after: 0 },
        existing: { start: "2026-09-10", end: "2026-09-15" },
        requested: { start: "2026-09-11", end: "2026-09-12" },
        expectedAvailable: false,
      },
    ];

    it.each(SCENARIOS)("$label", async (scenario) => {
      const productId = await createProduct(tenantId, scenario.buffers);
      const unitId = await createUnit(tenantId, productId, scenario.service);

      if (scenario.existing) {
        const existingOrder = await createOrder(
          tenantId,
          customerId,
          scenario.existing.start,
          scenario.existing.end,
        );
        const seeded = await insertItem(tenantId, existingOrder, productId, unitId);
        expect(seeded.errorMessage, `zasiew istniejącego najmu: ${seeded.errorMessage}`).toBeUndefined();
      }

      // Werdykt silnika na DOKŁADNIE tych samych danych.
      const engine = checkAvailability(
        [
          {
            unitId,
            unavailableFrom: scenario.service?.from ?? null,
            unavailableTo: scenario.service?.to ?? null,
          },
        ],
        scenario.existing
          ? [{ unitId, startDate: scenario.existing.start, endDate: scenario.existing.end }]
          : [],
        scenario.requested,
        {
          bufferBeforeDays: scenario.buffers.before,
          bufferAfterDays: scenario.buffers.after,
        },
      );
      expect(engine.available, "pin ręczny rozjechał się z silnikiem").toBe(
        scenario.expectedAvailable,
      );

      // Werdykt bazy: INSERT pozycji z przypisanym egzemplarzem.
      const newOrder = await createOrder(
        tenantId,
        customerId,
        scenario.requested.start,
        scenario.requested.end,
      );
      const { errorCode, errorMessage } = await insertItem(tenantId, newOrder, productId, unitId);
      if (scenario.expectedAvailable) {
        expect(errorMessage, `baza odrzuciła wolny termin: ${errorMessage}`).toBeUndefined();
      } else {
        expect(errorCode, "baza przyjęła zajęty termin").toBe(PG_UNIT_CONFLICT);
      }
    });

    it.each(ORDER_STATUSES.map((status) => ({ status })))(
      "istniejący najem w statusie $status blokuje zgodnie z AVAILABILITY_BLOCKING_ORDER_STATUSES",
      async ({ status }) => {
        const productId = await createProduct(tenantId, { before: 0, after: 0 });
        const unitId = await createUnit(tenantId, productId);
        const existingOrder = await createOrder(tenantId, customerId, "2026-09-10", "2026-09-12");
        const seeded = await insertItem(tenantId, existingOrder, productId, unitId);
        expect(seeded.errorMessage).toBeUndefined();
        await walkTo(existingOrder, status);

        const newOrder = await createOrder(tenantId, customerId, "2026-09-11", "2026-09-13");
        const { errorCode, errorMessage } = await insertItem(tenantId, newOrder, productId, unitId);
        if (AVAILABILITY_BLOCKING_ORDER_STATUSES.includes(status)) {
          expect(errorCode, `status ${status} nie zablokował egzemplarza`).toBe(PG_UNIT_CONFLICT);
        } else {
          expect(
            errorMessage,
            `status ${status} blokuje egzemplarz, choć nie powinien: ${errorMessage}`,
          ).toBeUndefined();
        }
      },
      15_000,
    );

    it("zmiana TERMINU zamówienia z przypisanym egzemplarzem przechodzi przez tę samą bramkę", async () => {
      const productId = await createProduct(tenantId, { before: 1, after: 1 });
      const unitId = await createUnit(tenantId, productId);

      const orderA = await createOrder(tenantId, customerId, "2026-10-10", "2026-10-12");
      expect((await insertItem(tenantId, orderA, productId, unitId)).errorMessage).toBeUndefined();

      // B mieści się z zapasem większym niż bufor…
      const orderB = await createOrder(tenantId, customerId, "2026-10-15", "2026-10-16");
      expect((await insertItem(tenantId, orderB, productId, unitId)).errorMessage).toBeUndefined();

      // …ale przesunięcie B tak, by bufor sięgnął A, musi zostać odrzucone.
      const { error: conflictError } = await admin
        .from("orders")
        .update({ start_date: "2026-10-13", end_date: "2026-10-14" })
        .eq("id", orderB)
        .select("id");
      expect(conflictError?.code, "zmiana terminu ominęła bramkę dostępności").toBe(
        PG_UNIT_CONFLICT,
      );

      // Przesunięcie w wolne miejsce przechodzi — bramka celuje w kolizję,
      // nie w edycję terminu w ogóle.
      const { data, error: okError } = await admin
        .from("orders")
        .update({ start_date: "2026-10-16", end_date: "2026-10-17" })
        .eq("id", orderB)
        .select("id");
      expect(okError?.message, `przesunięcie w wolny termin odrzucone: ${okError?.message}`).toBeUndefined();
      expect(data).toHaveLength(1);
    });

    it("ten sam egzemplarz dwa razy w JEDNYM zamówieniu jest odrzucany", async () => {
      const productId = await createProduct(tenantId, { before: 0, after: 0 });
      const unitId = await createUnit(tenantId, productId);
      const orderId = await createOrder(tenantId, customerId, "2026-11-01", "2026-11-03");

      expect((await insertItem(tenantId, orderId, productId, unitId)).errorMessage).toBeUndefined();
      const { errorCode } = await insertItem(tenantId, orderId, productId, unitId);
      expect(errorCode, "jeden egzemplarz wszedł dwa razy do zamówienia").toBe(PG_UNIT_CONFLICT);
    });

    it("pozycja BEZ egzemplarza (unit_id null) nie przechodzi przez bramkę", async () => {
      const productId = await createProduct(tenantId, { before: 0, after: 0 });
      const orderId = await createOrder(tenantId, customerId, "2026-11-01", "2026-11-03");
      const { errorMessage } = await insertItem(tenantId, orderId, productId, null);
      expect(errorMessage, `pozycja bez egzemplarza odrzucona: ${errorMessage}`).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // 4. Wyścig dwóch operatorów + atomowość app.create_order
  // -------------------------------------------------------------------

  describe("wyścig o egzemplarz — dwie realne sesje, jeden egzemplarz, jeden termin", () => {
    let memberA: SupabaseClient;
    let memberB: SupabaseClient;
    let memberAUserId: string; // autor zamówień z memberA — created_by w order_notes (0041)
    let tenantId: string;
    let customerId: string;
    let productId: string;
    let unitId: string;

    async function createUser(label: string): Promise<{ id: string; email: string }> {
      const email = `gate-${label}-${randomUUID()}@test.local`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email };
    }

    async function signIn(email: string): Promise<SupabaseClient> {
      const client = createAnonClient();
      const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
      if (error) throw new Error(`signIn(${email}): ${error.message}`);
      return client;
    }

    beforeAll(async () => {
      // Operator A zakłada organizację (realna ścieżka onboardingu)…
      const userA = await createUser("op-a");
      memberAUserId = userA.id;
      const bootstrap = await signIn(userA.email);
      const { data: newTenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
          p_slug: `gate-race-${randomUUID()}`.slice(0, 39),
          p_name: "Wypożyczalnia wyścigowa",
        });
      if (tenantError) throw new Error(`create_tenant: ${tenantError.message}`);
      tenantId = newTenantId as string;
      createdTenantIds.push(tenantId);
      memberA = await signIn(userA.email); // świeża sesja z claimem tenant_id

      // …operator B zostaje jej członkiem (staff — praca lady wystarcza).
      const userB = await createUser("op-b");
      const { error: memberError } = await admin
        .from("members")
        .insert({ tenant_id: tenantId, user_id: userB.id, role: "staff" });
      if (memberError) throw new Error(`insert members: ${memberError.message}`);
      memberB = await signIn(userB.email);

      customerId = await createCustomer(tenantId);
      productId = await createProduct(tenantId, { before: 1, after: 1 });
      unitId = await createUnit(tenantId, productId);
    }, 60_000);

    it("równoległe create_order: dokładnie jeden sukces, przegrany 23P01, zero sierot", async () => {
      const createOrderVia = (client: SupabaseClient) =>
        client.schema("app").rpc("create_order", {
          p_customer_id: customerId,
          p_start_date: "2026-12-01",
          p_end_date: "2026-12-05",
          p_delivery_method: "courier",
          p_pickup_location_id: null,
          p_notes: null,
          p_total_rental_grosze: 50_000,
          p_total_deposit_grosze: 0,
          p_items: [
            { product_id: productId, unit_id: unitId, rental_grosze: 50_000, deposit_grosze: 0 },
          ],
        });

      const [resultA, resultB] = await Promise.all([
        createOrderVia(memberA),
        createOrderVia(memberB),
      ]);

      const succeeded = [resultA, resultB].filter((r) => !r.error);
      const failed = [resultA, resultB].filter((r) => r.error);
      expect(succeeded, "wyścig: liczba sukcesów inna niż 1").toHaveLength(1);
      expect(failed, "wyścig: liczba odmów inna niż 1").toHaveLength(1);
      expect(failed[0]!.error!.code, "przegrany dostał inny kod niż 23P01").toBe(PG_UNIT_CONFLICT);

      // Egzemplarz jest na dokładnie JEDNEJ pozycji…
      const { data: items } = await admin
        .from("order_items")
        .select("id, order_id")
        .eq("unit_id", unitId);
      expect(items, "egzemplarz wynajęty dwa razy").toHaveLength(1);

      // …a przegrane zamówienie NIE istnieje (atomowość RPC — bez sieroty
      // z pustym koszykiem i zużytym numerem).
      const { data: orders } = await admin
        .from("orders")
        .select("id")
        .eq("tenant_id", tenantId);
      expect(orders, "przegrany zostawił zamówienie-sierotę").toHaveLength(1);
      expect(orders![0]!.id).toBe(succeeded[0]!.data as string);
    });

    it("zwycięskie zamówienie ma pozycje i sumy podane przy utworzeniu", async () => {
      const { data: order } = await admin
        .from("orders")
        .select("order_status, total_rental_grosze, total_deposit_grosze, order_number")
        .eq("tenant_id", tenantId)
        .single();
      expect(order).toMatchObject({
        order_status: "pending",
        total_rental_grosze: 50_000,
        total_deposit_grosze: 0,
      });
      expect(order!.order_number as string).toMatch(/^AV-\d{4}-\d{3,}$/);
    });

    it("wyścig na BEZPOŚREDNIM INSERT do order_items — to ta ścieżka przypina advisory lock z 0010", async () => {
      // Test wyżej (create_order) NIE dowodzi blokady z 0010: RPC zaczyna od
      // INSERT-u do orders, a trigger numeracji z 0007 bierze advisory lock
      // na (tenant, rok) — obie transakcje serializują się na NIM, zanim
      // dojdą do bramki egzemplarza, więc usunięcie locka z
      // app.assert_unit_available zostawiało tamten test zielony
      // (zweryfikowane mutacyjnie w review PR #44). Ta ścieżka — bezpośredni
      // INSERT pozycji do ISTNIEJĄCYCH zamówień — nie dotyka orders, więc
      // jedyną serializacją jest lock bramki: bez niego obie transakcje
      // przechodzą re-check równolegle i egzemplarz jest wynajęty dwa razy.
      //
      // Bufory 0/0: test mierzy wyłącznie kolizję terminów — arytmetykę
      // buforów pokrywa macierz zgodności wyżej.
      const raceProductId = await createProduct(tenantId, { before: 0, after: 0 });
      const raceUnitId = await createUnit(tenantId, raceProductId);

      // Dwa zamówienia pending na ten sam termin powstają PRZED wyścigiem —
      // numeracja się na nich serializuje i to nie szkodzi dowodowi.
      async function createOrderAs(client: SupabaseClient): Promise<string> {
        const { data, error } = await client
          .from("orders")
          .insert({
            tenant_id: tenantId,
            customer_id: customerId,
            start_date: "2026-12-20",
            end_date: "2026-12-22",
            delivery_method: "courier",
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`insert orders: ${error?.message}`);
        return data.id as string;
      }
      const orderA = await createOrderAs(memberA);
      const orderB = await createOrderAs(memberB);

      const insertItemAs = (client: SupabaseClient, orderId: string) =>
        client.from("order_items").insert({
          tenant_id: tenantId,
          order_id: orderId,
          product_id: raceProductId,
          unit_id: raceUnitId,
          rental_grosze: 30_000,
        });

      const [resultA, resultB] = await Promise.all([
        insertItemAs(memberA, orderA),
        insertItemAs(memberB, orderB),
      ]);

      const succeeded = [resultA, resultB].filter((r) => !r.error);
      const failed = [resultA, resultB].filter((r) => r.error);
      expect(succeeded, "wyścig na INSERT pozycji: liczba sukcesów inna niż 1").toHaveLength(1);
      expect(failed, "wyścig na INSERT pozycji: liczba odmów inna niż 1").toHaveLength(1);
      expect(failed[0]!.error!.code, "przegrany dostał inny kod niż 23P01").toBe(PG_UNIT_CONFLICT);

      const { data: items } = await admin
        .from("order_items")
        .select("id")
        .eq("unit_id", raceUnitId);
      expect(items, "egzemplarz wynajęty dwa razy — blokada bramki nie działa").toHaveLength(1);
    });

    it("create_order odrzuca puste pozycje (22023) — zamówienie bez koszyka nie powstaje", async () => {
      const { error } = await memberA.schema("app").rpc("create_order", {
        p_customer_id: customerId,
        p_start_date: "2026-12-10",
        p_end_date: "2026-12-11",
        p_delivery_method: "courier",
        p_pickup_location_id: null,
        p_notes: null,
        p_total_rental_grosze: 0,
        p_total_deposit_grosze: 0,
        p_items: [],
      });
      expect(error?.code, "create_order przyjął pusty koszyk").toBe("22023");
    });

    // 0016 (ADR-030, wpięcie): koszt dostawy wchodzi do zamówienia TĄ SAMĄ
    // atomową transakcją co pozycje. Nie jest bramką — to transport — więc
    // dowodem jest utrwalenie wartości, nie odmowa.
    it("create_order utrwala p_delivery_grosze (koszt dostawy w transporcie, 0016)", async () => {
      const deliveryProductId = await createProduct(tenantId, { before: 0, after: 0 });
      const deliveryUnitId = await createUnit(tenantId, deliveryProductId);

      const { data: orderId, error } = await memberA.schema("app").rpc("create_order", {
        p_customer_id: customerId,
        p_start_date: "2027-03-01",
        p_end_date: "2027-03-05",
        p_delivery_method: "courier",
        p_pickup_location_id: null,
        p_notes: null,
        p_total_rental_grosze: 40_000,
        p_total_deposit_grosze: 0,
        p_delivery_grosze: 1_500,
        p_items: [
          { product_id: deliveryProductId, unit_id: deliveryUnitId, rental_grosze: 40_000, deposit_grosze: 0 },
        ],
      });
      expect(error, `create_order z kosztem dostawy: ${error?.message}`).toBeNull();

      const { data: order } = await admin
        .from("orders")
        .select("delivery_grosze")
        .eq("id", orderId as string)
        .single();
      expect(order!.delivery_grosze, "koszt dostawy nie trafił do zamówienia").toBe(1_500);
    });

    // Zgodność wstecz: wołający sprzed 0016 (bez p_delivery_grosze) dostaje
    // default 0 — parametr z DEFAULT na końcu listy nie wywraca istniejącej
    // ścieżki.
    it("create_order bez p_delivery_grosze → delivery_grosze 0 (default zgodny z kolumną)", async () => {
      const legacyProductId = await createProduct(tenantId, { before: 0, after: 0 });
      const legacyUnitId = await createUnit(tenantId, legacyProductId);

      const { data: orderId, error } = await memberA.schema("app").rpc("create_order", {
        p_customer_id: customerId,
        p_start_date: "2027-04-01",
        p_end_date: "2027-04-05",
        p_delivery_method: "courier",
        p_pickup_location_id: null,
        p_notes: null,
        p_total_rental_grosze: 40_000,
        p_total_deposit_grosze: 0,
        p_items: [
          { product_id: legacyProductId, unit_id: legacyUnitId, rental_grosze: 40_000, deposit_grosze: 0 },
        ],
      });
      expect(error, `create_order bez kosztu dostawy: ${error?.message}`).toBeNull();

      const { data: order } = await admin
        .from("orders")
        .select("delivery_grosze")
        .eq("id", orderId as string)
        .single();
      expect(order!.delivery_grosze).toBe(0);
    });

    // 0041 (ADR-081): p_notes zostaje w sygnaturze (zgodność wsteczna), ale
    // niepusta treść zakłada WIERSZ w order_notes (0039), nie wpis do usuniętej
    // kolumny orders.notes. Autor = twórca zamówienia (auth.uid(); SECURITY
    // INVOKER → zalogowany członek). Dowód: notatka z kreatora trafia na LISTĘ
    // wpisów szczegółu, a nie w martwe pole.
    it("create_order z notatką → wpis w order_notes z autorem = twórca zamówienia (0041)", async () => {
      const noteProductId = await createProduct(tenantId, { before: 0, after: 0 });
      const noteUnitId = await createUnit(tenantId, noteProductId);

      const { data: orderId, error } = await memberA.schema("app").rpc("create_order", {
        p_customer_id: customerId,
        p_start_date: "2027-05-01",
        p_end_date: "2027-05-05",
        p_delivery_method: "courier",
        p_pickup_location_id: null,
        p_notes: "  Klient prosi o dodatkowy pas transportowy.  ",
        p_total_rental_grosze: 40_000,
        p_total_deposit_grosze: 0,
        p_items: [
          { product_id: noteProductId, unit_id: noteUnitId, rental_grosze: 40_000, deposit_grosze: 0 },
        ],
      });
      expect(error, `create_order z notatką: ${error?.message}`).toBeNull();

      const { data: notes, error: notesError } = await admin
        .from("order_notes")
        .select("body, created_by")
        .eq("order_id", orderId as string);
      expect(notesError?.message, `odczyt order_notes: ${notesError?.message}`).toBeUndefined();
      expect(notes, "notatka kreatora nie trafiła na listę wpisów").toHaveLength(1);
      // btrim jak w 0039 — bez wiodących/kończących spacji.
      expect(notes![0]!.body).toBe("Klient prosi o dodatkowy pas transportowy.");
      // Autor = zalogowany członek (nie NULL — to nie wpis historyczny).
      expect(notes![0]!.created_by, "autor wpisu != twórca zamówienia").toBe(memberAUserId);
    });

    it("create_order bez notatki (p_notes null) → zero wpisów w order_notes (0041)", async () => {
      const nilProductId = await createProduct(tenantId, { before: 0, after: 0 });
      const nilUnitId = await createUnit(tenantId, nilProductId);

      const { data: orderId, error } = await memberA.schema("app").rpc("create_order", {
        p_customer_id: customerId,
        p_start_date: "2027-06-01",
        p_end_date: "2027-06-05",
        p_delivery_method: "courier",
        p_pickup_location_id: null,
        p_notes: null,
        p_total_rental_grosze: 40_000,
        p_total_deposit_grosze: 0,
        p_items: [
          { product_id: nilProductId, unit_id: nilUnitId, rental_grosze: 40_000, deposit_grosze: 0 },
        ],
      });
      expect(error, `create_order bez notatki: ${error?.message}`).toBeNull();

      const { data: notes } = await admin
        .from("order_notes")
        .select("id")
        .eq("order_id", orderId as string);
      expect(notes, "brak notatki, a wpis powstał").toHaveLength(0);
    });

    it("create_order z notatką z samych spacji → zero wpisów (btrim, jak filtr 0039)", async () => {
      const blankProductId = await createProduct(tenantId, { before: 0, after: 0 });
      const blankUnitId = await createUnit(tenantId, blankProductId);

      const { data: orderId, error } = await memberA.schema("app").rpc("create_order", {
        p_customer_id: customerId,
        p_start_date: "2027-07-01",
        p_end_date: "2027-07-05",
        p_delivery_method: "courier",
        p_pickup_location_id: null,
        p_notes: "   ",
        p_total_rental_grosze: 40_000,
        p_total_deposit_grosze: 0,
        p_items: [
          { product_id: blankProductId, unit_id: blankUnitId, rental_grosze: 40_000, deposit_grosze: 0 },
        ],
      });
      expect(error, `create_order z pustą notatką: ${error?.message}`).toBeNull();

      const { data: notes } = await admin
        .from("order_notes")
        .select("id")
        .eq("order_id", orderId as string);
      expect(notes, "notatka z samych spacji założyła wpis").toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------
  // 5. Maszyna stanów payment_status (0015, ADR-035)
  // -------------------------------------------------------------------
  //
  // Dwie ortogonalne reguły bramki: (A) mapa przejść — lustro
  // canPaymentTransition z @avably/core, dowodzona zgodnością wszystkich 64
  // par plus zachowaniem (regres, terminal, INSERT); (B) spójność wejścia w
  // deposit_refunded z rejestrem kaucji (saldo 0 przy pobraniach > 0). Sekcja
  // idzie klientem service-role (bramka jest zachowaniem SCHEMATU i obowiązuje
  // KAŻDĄ rolę — jak sekcje 2-3 i ADR-025/ADR-035).
  describe("maszyna stanów payment_status (0015, ADR-035)", () => {
    async function setPayment(orderId: string, to: string) {
      return admin.from("orders").update({ payment_status: to }).eq("id", orderId).select("id");
    }
    async function collect(tenantId: string, orderId: string, amount: number) {
      const { error } = await admin
        .from("deposit_events")
        .insert({ tenant_id: tenantId, order_id: orderId, kind: "collected", amount_grosze: amount });
      if (error) throw new Error(`collect: ${error.message}`);
    }
    async function refund(tenantId: string, orderId: string, amount: number) {
      const { error } = await admin
        .from("deposit_events")
        .insert({ tenant_id: tenantId, order_id: orderId, kind: "refunded", amount_grosze: amount });
      if (error) throw new Error(`refund: ${error.message}`);
    }
    async function freshOrder(label: string): Promise<{ tenantId: string; orderId: string }> {
      const tenantId = await createTenant(label);
      const customerId = await createCustomer(tenantId);
      const orderId = await createOrder(tenantId, customerId, "2027-01-05", "2027-01-07");
      return { tenantId, orderId };
    }

    // [0027] Macierz zgodności ma DRUGI wymiar: reżim. 2 × 9 × 9 = 162 pary,
    // każda odpytana w bazie i porównana z werdyktem @avably/core.
    it.each(PAYMENT_PROVIDERS.map((provider) => ({ provider })))(
      "zgodność wszystkich 81 par w reżimie $provider: SQL == canPaymentTransition",
      async ({ provider }) => {
        let sprawdzone = 0;
        for (const from of PAYMENT_STATUSES) {
          for (const to of PAYMENT_STATUSES) {
            const [{ allowed }] = await sql<{ allowed: boolean }[]>`
              select app.payment_transition_allowed(${from}, ${to}, ${provider}) as allowed`;
            expect(allowed, `SQL ${provider}: ${from}->${to}`).toBe(
              canPaymentTransition(from, to, provider),
            );
            sprawdzone += 1;
          }
        }
        // Kontrola po pustym zbiorze: pętla po skurczonej stałej nie ma prawa
        // przejść na zielono bez sprawdzenia ani jednej pary.
        expect(sprawdzone, "macierz nie pokryła kompletu par").toBe(
          PAYMENT_STATUSES.length * PAYMENT_STATUSES.length,
        );
      },
      30_000,
    );

    it("mapa 2-argumentowa z 0015 już NIE istnieje (wywołanie bez reżimu nie ma jak zgadnąć)", async () => {
      await expect(
        sql`select app.payment_transition_allowed('paid', 'pending')`,
      ).rejects.toMatchObject({ code: "42883" });
    });

    it("regres deposit_refunded -> paid odrzucony 23514 (nic innego tego nie blokuje)", async () => {
      const { tenantId, orderId } = await freshOrder("pay-regres");
      await collect(tenantId, orderId, 100_00);
      await refund(tenantId, orderId, 100_00); // saldo 0, pobrania > 0
      const flip = await setPayment(orderId, "deposit_refunded");
      expect(flip.error?.message, `flip do deposit_refunded padł: ${flip.error?.message}`).toBeUndefined();
      const regres = await setPayment(orderId, "paid");
      expect(regres.error?.code, `regres przeszedł: ${regres.error?.message}`).toBe(PG_BAD_TRANSITION);
    });

    it("refunded jest terminalny (refunded -> paid odrzucony 23514)", async () => {
      const { orderId } = await freshOrder("pay-term");
      expect((await setPayment(orderId, "refunded")).error?.message).toBeUndefined();
      const back = await setPayment(orderId, "paid");
      expect(back.error?.code, `wyjście z refunded przeszło: ${back.error?.message}`).toBe(
        PG_BAD_TRANSITION,
      );
    });

    it("INSERT w stanie rozliczeniowym odrzucony 23514", async () => {
      const tenantId = await createTenant("pay-insert");
      const customerId = await createCustomer(tenantId);
      const { error } = await admin.from("orders").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        start_date: "2027-02-01",
        end_date: "2027-02-02",
        delivery_method: "courier",
        payment_status: "deposit_refunded",
      });
      expect(error?.code, `INSERT deposit_refunded przeszedł: ${error?.message}`).toBe(
        PG_BAD_TRANSITION,
      );
    });

    it("deposit_refunded bez pokrycia w rejestrze odrzucony 23514 (collected=0)", async () => {
      const { orderId } = await freshOrder("pay-ledger-0");
      const r = await setPayment(orderId, "deposit_refunded");
      expect(r.error?.code, `deposit_refunded bez pobrań przeszedł: ${r.error?.message}`).toBe(
        PG_BAD_TRANSITION,
      );
    });

    it("deposit_refunded przy saldzie != 0 odrzucony 23514", async () => {
      const { tenantId, orderId } = await freshOrder("pay-ledger-bal");
      await collect(tenantId, orderId, 100_00); // saldo 100, nie 0
      const r = await setPayment(orderId, "deposit_refunded");
      expect(r.error?.code, `deposit_refunded przy saldzie 100 przeszedł: ${r.error?.message}`).toBe(
        PG_BAD_TRANSITION,
      );
    });

    it("legalne przejścia otwarte przechodzą (unpaid -> paid -> manual)", async () => {
      const { orderId } = await freshOrder("pay-open");
      expect((await setPayment(orderId, "paid")).error?.message).toBeUndefined();
      expect((await setPayment(orderId, "manual")).error?.message).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // 6. Reżim płatności per zamówienie (0027, ADR-064)
  // -------------------------------------------------------------------
  //
  // Macierz zgodności wyżej dowodzi, że SQL i TS mówią to samo o MAPACH.
  // Ta sekcja dowodzi, że mapa reżimu ścisłego faktycznie stoi na drodze
  // UPDATE-owi — i że granica jest OBUSTRONNA: to samo przejście przechodzi
  // na zamówieniu operatorskim. Klient service-role, bo bramka jest
  // zachowaniem SCHEMATU (ADR-025/035/064).
  describe("dwa reżimy jednej osi (0027, ADR-064)", () => {
    async function setPayment(orderId: string, to: string) {
      return admin.from("orders").update({ payment_status: to }).eq("id", orderId).select("id");
    }
    async function orderRow(orderId: string) {
      const { data } = await admin
        .from("orders")
        .select("payment_provider, payment_status")
        .eq("id", orderId)
        .single();
      return data as { payment_provider: string; payment_status: string };
    }
    /** Zamówienie doprowadzone do `paid` spacerem właściwym dla reżimu. */
    async function paidOrder(label: string, provider: PaymentProvider): Promise<string> {
      const tenantId = await createTenant(label);
      const customerId = await createCustomer(tenantId);
      const orderId = await createOrder(tenantId, customerId, "2027-06-01", "2027-06-03", provider);
      if (provider === "stripe") {
        const step = await setPayment(orderId, "pending");
        expect(step.error?.message, `unpaid→pending (${provider}): ${step.error?.message}`).toBeUndefined();
      }
      const paid = await setPayment(orderId, "paid");
      expect(paid.error?.message, `→paid (${provider}): ${paid.error?.message}`).toBeUndefined();
      return orderId;
    }

    it("KRYTERIUM: stripe + paid → pending odrzucone 23514, stan zostaje paid", async () => {
      const orderId = await paidOrder("prov-stripe", "stripe");
      const regres = await setPayment(orderId, "pending");
      expect(regres.error?.code, `regres na stripe przeszedł: ${regres.error?.message}`).toBe(
        PG_BAD_TRANSITION,
      );
      expect((await orderRow(orderId)).payment_status, "opłacone zamówienie zmieniło stan").toBe(
        "paid",
      );
    });

    it("KRYTERIUM (druga strona): manual + paid → pending PRZECHODZI", async () => {
      // Bez tego przypadku „zero regresu" nie odróżnia bramki reżimowej od
      // zaostrzenia całej osi — a swoboda operatorska ADR-035 ma zostać.
      const orderId = await paidOrder("prov-manual", "manual");
      const regres = await setPayment(orderId, "pending");
      expect(regres.error?.message, `regres na manual odrzucony: ${regres.error?.message}`).toBeUndefined();
      expect((await orderRow(orderId)).payment_status).toBe("pending");
    });

    it("istniejące zamówienia zachowują obieg operatorski (default kolumny = manual)", async () => {
      // Migracja nie ma prawa po cichu zaostrzyć reżimu danym sprzed niej:
      // INSERT bez wskazania obiegu daje 'manual', a regres z paid przechodzi.
      const tenantId = await createTenant("prov-default");
      const customerId = await createCustomer(tenantId);
      const orderId = await createOrder(tenantId, customerId, "2027-06-10", "2027-06-12");
      expect((await orderRow(orderId)).payment_provider, "default kolumny nie jest manual").toBe(
        "manual",
      );
      expect((await setPayment(orderId, "paid")).error?.message).toBeUndefined();
      const regres = await setPayment(orderId, "pending");
      expect(regres.error?.message, `zamówienie bez obiegu straciło swobodę: ${regres.error?.message}`).toBeUndefined();
    });

    it("payment_provider nie wraca ze stripe na manual (23514) — reżimu nie da się zdjąć", async () => {
      // Inaczej ścisła bramka miałaby obejście w jednym UPDATE.
      const orderId = await paidOrder("prov-lock", "stripe");
      const { error } = await admin
        .from("orders")
        .update({ payment_provider: "manual" })
        .eq("id", orderId)
        .select("id");
      expect(error?.code, `zdjęcie reżimu przeszło: ${error?.message}`).toBe(PG_BAD_TRANSITION);
      expect((await orderRow(orderId)).payment_provider).toBe("stripe");
    });

    it("manual → stripe jest otwarte (tak zamówienie wchodzi w płatność online)", async () => {
      const tenantId = await createTenant("prov-enter");
      const customerId = await createCustomer(tenantId);
      const orderId = await createOrder(tenantId, customerId, "2027-06-20", "2027-06-22");
      const { error } = await admin
        .from("orders")
        .update({ payment_provider: "stripe" })
        .eq("id", orderId)
        .select("id");
      expect(error?.message, `wejście w obieg online odrzucone: ${error?.message}`).toBeUndefined();
      expect((await orderRow(orderId)).payment_provider).toBe("stripe");
    });

    it("payment_failed osiągalny tylko online: stripe pending → payment_failed → pending", async () => {
      const tenantId = await createTenant("prov-failed");
      const customerId = await createCustomer(tenantId);
      const orderId = await createOrder(tenantId, customerId, "2027-07-01", "2027-07-03", "stripe");
      expect((await setPayment(orderId, "pending")).error?.message).toBeUndefined();
      expect((await setPayment(orderId, "payment_failed")).error?.message).toBeUndefined();
      // Klient ponawia — zamówienie żyje.
      expect((await setPayment(orderId, "pending")).error?.message).toBeUndefined();
      expect((await setPayment(orderId, "paid")).error?.message).toBeUndefined();
    });

    it("payment_failed nieosiągalny w obiegu ręcznym (23514)", async () => {
      const tenantId = await createTenant("prov-failed-man");
      const customerId = await createCustomer(tenantId);
      const orderId = await createOrder(tenantId, customerId, "2027-07-05", "2027-07-07");
      const r = await setPayment(orderId, "payment_failed");
      expect(r.error?.code, `payment_failed offline przeszedł: ${r.error?.message}`).toBe(
        PG_BAD_TRANSITION,
      );
    });

    it("INSERT w payment_failed odrzucony 23514 (nieudana próba zakłada próbę)", async () => {
      const tenantId = await createTenant("prov-failed-ins");
      const customerId = await createCustomer(tenantId);
      const { error } = await admin.from("orders").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        start_date: "2027-07-10",
        end_date: "2027-07-11",
        delivery_method: "courier",
        payment_provider: "stripe",
        payment_status: "payment_failed",
      });
      expect(error?.code, `INSERT payment_failed przeszedł: ${error?.message}`).toBe(
        PG_BAD_TRANSITION,
      );
    });

    it("CHECK kolumny przyjmuje wyłącznie wartości z PAYMENT_PROVIDERS", async () => {
      const tenantId = await createTenant("prov-check");
      const customerId = await createCustomer(tenantId);
      const { error } = await admin.from("orders").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        start_date: "2027-07-15",
        end_date: "2027-07-16",
        delivery_method: "courier",
        payment_provider: "paypal",
      });
      expect(error?.code, "obcy obieg płatności przeszedł").toBe(PG_BAD_TRANSITION);

      const rows = await sql<{ def: string }[]>`
        select pg_get_constraintdef(oid) as def
        from pg_constraint
        where conrelid = 'public.orders'::regclass
          and conname = 'orders_payment_provider_check'
      `;
      expect(rows, "brak CHECK-u orders_payment_provider_check").toHaveLength(1);
      const values = [...rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
      expect(values.sort()).toEqual([...PAYMENT_PROVIDERS].sort());
    });
  });
});
