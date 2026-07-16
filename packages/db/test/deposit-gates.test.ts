/**
 * Bramki rejestru kaucji (packages/db/supabase/migrations/0011_deposit_settlement.sql)
 * — dowody dla ADR-026 (strukturalny powód potrącenia + niezmiennik salda
 * w bazie) oraz spłaty długu kodów z 0006.
 *
 * Zakres:
 *   1. kształt strukturalnego powodu: `deducted` wymaga kodu z listy,
 *      `other` wymaga doprecyzowania tekstem, nadmiarowy kod przy pobraniu
 *      i zwrocie jest ODRZUCANY (wzorzec 0006 — nie zerowany po cichu),
 *   2. niezmiennik salda: suma zwrotów i potrąceń nie może przekroczyć sumy
 *      pobrań — egzekwowane triggerem dla KAŻDEJ roli (testy idą kluczem
 *      service_role, który omija RLS: jeśli bramka trzyma jego, trzyma
 *      wszystkich), także dla wielu wierszy JEDNEGO polecenia (bulk),
 *   3. wyścig dwóch równoległych rozliczeń — dwie realne sesje członków,
 *      bezpośredni INSERT do deposit_events. Celowo BEZ app.create_order
 *      i bez dotykania orders/order_items: lekcja ADR-024 — cudze locki
 *      (numeracja 0007, bramka egzemplarza 0010) potrafią zserializować
 *      transakcje wcześniej i MASKOWAĆ dowód. Jedyna serializacja na tej
 *      ścieżce to advisory lock bramki kaucji,
 *   4. join_waitlist zgłasza odmowy standardowymi SQLSTATE (22023) —
 *      P0012/P0013 były dekoracją, bo PostgREST zjada kody P0xxx do gołego
 *      500 bez kodu (nagłówek 0010).
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*
 * (patrz docs/konwencje-migracji.md). Bez nich cały plik jest pomijany.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";
import { createAdminClient } from "./helpers/seed-tenants";

const hasEnv = integrationEnv([
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
]);

/** 23514 = check_violation: kształt powodu i niezmiennik salda (ADR-026). */
const PG_CHECK_VIOLATION = "23514";
/** 22023 = invalid_parameter_value: walidacje join_waitlist po spłacie długu. */
const PG_INVALID_PARAMETER = "22023";

interface EventInput {
  kind: "collected" | "refunded" | "deducted";
  amount_grosze: number;
  reason_code?: string;
  reason?: string;
}

describe.skipIf(!hasEnv)("bramki kaucji — 0011_deposit_settlement.sql", () => {
  let admin: SupabaseClient;
  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(() => {
    admin = createAdminClient();
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  async function createTenant(label: string): Promise<string> {
    const { data, error } = await admin
      .from("tenants")
      .insert({
        slug: `dep-${label}-${randomUUID()}`.slice(0, 39),
        name: `Deposit gates test tenant ${label}`,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createTenant(${label}): ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  /** Zamówienie-nośnik rejestru: klient + orders w jednym kroku. */
  async function createOrder(tenantId: string): Promise<string> {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, email: `dep-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`createOrder/customer: ${customerError?.message}`);

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
    if (orderError || !order) throw new Error(`createOrder/order: ${orderError?.message}`);
    return order.id as string;
  }

  async function insertEvent(
    client: SupabaseClient,
    tenantId: string,
    orderId: string,
    event: EventInput,
  ): Promise<{ errorCode?: string; errorMessage?: string }> {
    const { error } = await client
      .from("deposit_events")
      .insert({ tenant_id: tenantId, order_id: orderId, ...event })
      .select("id");
    return { errorCode: error?.code, errorMessage: error?.message };
  }

  // -------------------------------------------------------------------
  // 1. Strukturalny powód potrącenia (reason_code)
  // -------------------------------------------------------------------

  describe("strukturalny powód potrącenia", () => {
    let tenantId: string;
    let orderId: string;

    beforeAll(async () => {
      tenantId = await createTenant("shape");
      orderId = await createOrder(tenantId);
      // Saldo na zapas: testy kształtu nie mają się potykać o niezmiennik sumy.
      const { errorMessage } = await insertEvent(admin, tenantId, orderId, {
        kind: "collected",
        amount_grosze: 1_000_00,
      });
      if (errorMessage) throw new Error(`seed collected: ${errorMessage}`);
    });

    it("potrącenie bez kodu powodu jest odrzucane — sam tekst już nie wystarcza", async () => {
      // Anty-wzorzec starkita: notatka tekstowa zamiast danych. Stary CHECK
      // z 0007 przyjąłby ten wiersz; strukturalny powód go odrzuca.
      const { errorCode, errorMessage } = await insertEvent(admin, tenantId, orderId, {
        kind: "deducted",
        amount_grosze: 5_00,
        reason: "uszkodzona obudowa",
      });
      expect(errorCode, `potrącenie bez kodu przeszło: ${errorMessage}`).toBe(PG_CHECK_VIOLATION);
    });

    it("kod spoza listy jest odrzucany", async () => {
      const { errorCode, errorMessage } = await insertEvent(admin, tenantId, orderId, {
        kind: "deducted",
        amount_grosze: 5_00,
        reason_code: "vandalism",
      });
      expect(errorCode, `kod spoza listy przeszedł: ${errorMessage}`).toBe(PG_CHECK_VIOLATION);
    });

    it("kod 'other' wymaga doprecyzowania tekstem (pusty i biały odrzucane)", async () => {
      const missing = await insertEvent(admin, tenantId, orderId, {
        kind: "deducted",
        amount_grosze: 5_00,
        reason_code: "other",
      });
      expect(missing.errorCode, `other bez doprecyzowania przeszło: ${missing.errorMessage}`).toBe(
        PG_CHECK_VIOLATION,
      );

      // Biały znak to to samo co brak — inaczej wymóg obchodzi się spacją.
      const blank = await insertEvent(admin, tenantId, orderId, {
        kind: "deducted",
        amount_grosze: 5_00,
        reason_code: "other",
        reason: "   ",
      });
      expect(blank.errorCode, `other z białym doprecyzowaniem przeszło: ${blank.errorMessage}`).toBe(
        PG_CHECK_VIOLATION,
      );
    });

    it("kod z listy bez doprecyzowania przechodzi — kod JEST powodem", async () => {
      const { errorMessage } = await insertEvent(admin, tenantId, orderId, {
        kind: "deducted",
        amount_grosze: 5_00,
        reason_code: "damage",
      });
      expect(errorMessage, `potrącenie 'damage' bez tekstu odrzucone: ${errorMessage}`).toBeUndefined();
    });

    it("kod 'other' z doprecyzowaniem przechodzi", async () => {
      const { errorMessage } = await insertEvent(admin, tenantId, orderId, {
        kind: "deducted",
        amount_grosze: 5_00,
        reason_code: "other",
        reason: "zgubiony klucz do skrzyni",
      });
      expect(errorMessage, `potrącenie 'other' z tekstem odrzucone: ${errorMessage}`).toBeUndefined();
    });

    it("kod powodu przy pobraniu i zwrocie jest odrzucany, nie zerowany po cichu", async () => {
      // Wzorzec 0006: nadmiarowe dane sterujące to błąd wywołującego —
      // cisza ukryłaby go.
      const collected = await insertEvent(admin, tenantId, orderId, {
        kind: "collected",
        amount_grosze: 10_00,
        reason_code: "damage",
      });
      expect(collected.errorCode, `pobranie z kodem przeszło: ${collected.errorMessage}`).toBe(
        PG_CHECK_VIOLATION,
      );

      const refunded = await insertEvent(admin, tenantId, orderId, {
        kind: "refunded",
        amount_grosze: 10_00,
        reason_code: "cleaning",
      });
      expect(refunded.errorCode, `zwrot z kodem przeszedł: ${refunded.errorMessage}`).toBe(
        PG_CHECK_VIOLATION,
      );
    });

    it("notatka tekstowa przy pobraniu pozostaje legalna (0007 ją dopuszczał)", async () => {
      const { errorMessage } = await insertEvent(admin, tenantId, orderId, {
        kind: "collected",
        amount_grosze: 10_00,
        reason: "gotówka przy odbiorze",
      });
      expect(errorMessage, `pobranie z notatką odrzucone: ${errorMessage}`).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // 2. Niezmiennik salda: zwroty + potrącenia <= pobrania
  // -------------------------------------------------------------------
  //
  // Wszystkie zapisy idą kluczem service_role (BYPASSRLS): jeśli bramka
  // trzyma rolę, która omija polityki, trzyma każdą — dokładnie ten sam
  // dowód, co przy bramkach 0010.

  describe("niezmiennik salda kaucji", () => {
    it("rozliczenie do zera przechodzi, a każdy grosz ponad pobrania płonie 23514", async () => {
      const tenantId = await createTenant("balance");
      const orderId = await createOrder(tenantId);

      const collected = await insertEvent(admin, tenantId, orderId, {
        kind: "collected",
        amount_grosze: 100_00,
      });
      expect(collected.errorMessage, `pobranie odrzucone: ${collected.errorMessage}`).toBeUndefined();

      const refund = await insertEvent(admin, tenantId, orderId, {
        kind: "refunded",
        amount_grosze: 60_00,
      });
      expect(refund.errorMessage, `zwrot częściowy odrzucony: ${refund.errorMessage}`).toBeUndefined();

      const deduction = await insertEvent(admin, tenantId, orderId, {
        kind: "deducted",
        amount_grosze: 40_00,
        reason_code: "damage",
      });
      expect(deduction.errorMessage, `potrącenie do zera odrzucone: ${deduction.errorMessage}`).toBeUndefined();

      // Saldo wynosi dokładnie 0 — kolejny grosz w dowolnym kierunku
      // rozliczenia musi płonąć.
      const overRefund = await insertEvent(admin, tenantId, orderId, {
        kind: "refunded",
        amount_grosze: 1,
      });
      expect(overRefund.errorCode, `nadmiarowy zwrot przeszedł: ${overRefund.errorMessage}`).toBe(
        PG_CHECK_VIOLATION,
      );

      const overDeduction = await insertEvent(admin, tenantId, orderId, {
        kind: "deducted",
        amount_grosze: 1,
        reason_code: "cleaning",
      });
      expect(overDeduction.errorCode, `nadmiarowe potrącenie przeszło: ${overDeduction.errorMessage}`).toBe(
        PG_CHECK_VIOLATION,
      );

      // Kolejne pobranie otwiera saldo na nowo — niezmiennik ogranicza
      // rozliczenia, nie pobrania.
      const reopened = await insertEvent(admin, tenantId, orderId, {
        kind: "collected",
        amount_grosze: 10_00,
      });
      expect(reopened.errorMessage, `ponowne pobranie odrzucone: ${reopened.errorMessage}`).toBeUndefined();

      const afterReopen = await insertEvent(admin, tenantId, orderId, {
        kind: "refunded",
        amount_grosze: 10_00,
      });
      expect(afterReopen.errorMessage, `zwrot po ponownym pobraniu odrzucony: ${afterReopen.errorMessage}`).toBeUndefined();
    });

    it("zwrot bez żadnego pobrania płonie 23514", async () => {
      const tenantId = await createTenant("no-collect");
      const orderId = await createOrder(tenantId);

      const { errorCode, errorMessage } = await insertEvent(admin, tenantId, orderId, {
        kind: "refunded",
        amount_grosze: 1_00,
      });
      expect(errorCode, `zwrot z pustego rejestru przeszedł: ${errorMessage}`).toBe(PG_CHECK_VIOLATION);
    });

    it("rejestry dwóch zamówień są niezależne — saldo sąsiada nie pokrywa rozliczenia", async () => {
      const tenantId = await createTenant("two-orders");
      const orderA = await createOrder(tenantId);
      const orderB = await createOrder(tenantId);

      const collected = await insertEvent(admin, tenantId, orderA, {
        kind: "collected",
        amount_grosze: 100_00,
      });
      expect(collected.errorMessage).toBeUndefined();

      // Zamówienie B nie ma pobrań — pobrania A nie mogą go kredytować.
      const { errorCode, errorMessage } = await insertEvent(admin, tenantId, orderB, {
        kind: "refunded",
        amount_grosze: 1_00,
      });
      expect(errorCode, `zwrot na cudzym saldzie przeszedł: ${errorMessage}`).toBe(PG_CHECK_VIOLATION);
    });

    it("bulk INSERT jednym poleceniem nie omija bramki (widoczność wierszy tego samego polecenia)", async () => {
      // PostgREST przyjmuje tablicę wierszy jako JEDNO polecenie INSERT.
      // Gdyby trigger BEFORE nie widział wierszy wstawionych wcześniej tym
      // samym poleceniem, dwa zwroty po 80 zł przy 100 zł pobrań przeszłyby
      // razem. Reguły widoczności Postgresa gwarantują, że widzi — a ten
      // test przypina tę gwarancję do naszej bramki.
      const tenantId = await createTenant("bulk");
      const orderId = await createOrder(tenantId);

      const collected = await insertEvent(admin, tenantId, orderId, {
        kind: "collected",
        amount_grosze: 100_00,
      });
      expect(collected.errorMessage).toBeUndefined();

      const { error } = await admin.from("deposit_events").insert([
        { tenant_id: tenantId, order_id: orderId, kind: "refunded", amount_grosze: 80_00 },
        { tenant_id: tenantId, order_id: orderId, kind: "refunded", amount_grosze: 80_00 },
      ]);
      expect(error?.code, `bulk z nadmiarem przeszedł: ${error?.message}`).toBe(PG_CHECK_VIOLATION);

      // Odmowa jest atomowa: nie wszedł ŻADEN wiersz z pary.
      const { data: events } = await admin
        .from("deposit_events")
        .select("id, kind")
        .eq("tenant_id", tenantId)
        .eq("order_id", orderId)
        .eq("kind", "refunded");
      expect(events, "część wierszy bulka weszła mimo odmowy").toHaveLength(0);
    });
  });
});
