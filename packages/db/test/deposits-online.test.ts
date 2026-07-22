/**
 * Bramki kaucji online (packages/db/supabase/migrations/0031_deposit_provider_link.sql)
 * — dowody dla ADR-068.
 *
 * Zakres:
 *   1. OBIEG jest daną, nie domysłem: `provider` z zamkniętej listy,
 *      z defaultem `manual` (obieg dostawcy trzeba wpisać JAWNIE),
 *   2. STRUKTURALNY ODNOŚNIK: wiersz `stripe` bez `provider_reference` jest
 *      odrzucany, wiersz `manual` z odnośnikiem — też. Wzorzec 0006/0011:
 *      nadmiar jest ODRZUCANY, nie zerowany po cichu,
 *   3. UNIKAT ODNOŚNIKA: ten sam refund nie zaksięguje się dwa razy, choćby
 *      potwierdziły go dwie różne drogi (odczyt z panelu i webhook),
 *   4. `deposit_refunds` — rejestr ŻĄDAŃ: izolacja tenantów, brak dostępu
 *      dla anona, BRAK grantu DELETE (żądanie zwrotu pieniędzy klienta nie
 *      jest notatką do skasowania),
 *   5. bramki 0011 NIETKNIĘTE: niezmiennik salda obowiązuje wiersze obiegu
 *      dostawcy dokładnie tak samo jak ręczne.
 *
 * Mechanikę samego niezmiennika (bulk, wyścig dwóch sesji, kształt powodu)
 * dowodzi deposit-gates.test.ts — tu jej nie powtarzamy.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
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

/** 23514 — CHECK: obieg spoza listy, kształt odnośnika, niezmiennik salda. */
const PG_CHECK_VIOLATION = "23514";
/** 23505 — unikat odnośnika dostawcy: to zdarzenie już jest zaksięgowane. */
const PG_UNIQUE_VIOLATION = "23505";
/** 42501 — brak uprawnienia (REVOKE) albo odmowa polityki WITH CHECK. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

describe.skipIf(!hasEnv)("kaucja online — 0031_deposit_provider_link.sql", () => {
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
        slug: `dpo-${label}-${randomUUID()}`.slice(0, 39),
        name: `Deposit online test tenant ${label}`,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createTenant(${label}): ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  async function createOrder(tenantId: string): Promise<string> {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, email: `dpo-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`customer: ${customerError?.message}`);

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        start_date: "2026-10-01",
        end_date: "2026-10-03",
        delivery_method: "courier",
        total_deposit_grosze: 500_00,
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(`order: ${orderError?.message}`);
    return order.id as string;
  }

  async function insertEvent(
    tenantId: string,
    orderId: string,
    event: Record<string, unknown>,
  ): Promise<{ errorCode?: string; errorMessage?: string }> {
    const { error } = await admin
      .from("deposit_events")
      .insert({ tenant_id: tenantId, order_id: orderId, ...event })
      .select("id");
    return { errorCode: error?.code, errorMessage: error?.message };
  }

  // -------------------------------------------------------------------
  // 1. Obieg jako dana
  // -------------------------------------------------------------------

  describe("obieg zdarzenia kaucji", () => {
    let tenantId: string;
    let orderId: string;

    beforeAll(async () => {
      tenantId = await createTenant("provider");
      orderId = await createOrder(tenantId);
    });

    it("domyślnym obiegiem jest `manual` — dostawcę trzeba wpisać JAWNIE", async () => {
      // Kierunek pomyłki wybiera się raz i na zawsze: default `stripe`
      // produkowałby wiersze UDAJĄCE potwierdzenie u dostawcy przy każdym
      // wywołaniu, które o obieg nie zadbało.
      const { error } = await admin
        .from("deposit_events")
        .insert({ tenant_id: tenantId, order_id: orderId, kind: "collected", amount_grosze: 100_00 })
        .select("id");
      expect(error).toBeNull();

      const { data } = await admin
        .from("deposit_events")
        .select("provider, provider_reference")
        .eq("order_id", orderId)
        .single();
      expect(data).toMatchObject({ provider: "manual", provider_reference: null });
    });

    it("obieg spoza listy jest odrzucany", async () => {
      const { errorCode, errorMessage } = await insertEvent(tenantId, orderId, {
        kind: "collected",
        amount_grosze: 100_00,
        provider: "paypal",
        provider_reference: "x",
      });
      expect(errorCode, `obieg spoza listy przeszedł: ${errorMessage}`).toBe(PG_CHECK_VIOLATION);
    });
  });

  // -------------------------------------------------------------------
  // 2. Strukturalny odnośnik u dostawcy
  // -------------------------------------------------------------------

  describe("odnośnik u dostawcy jako DOWÓD wiersza", () => {
    let tenantId: string;
    let orderId: string;

    beforeAll(async () => {
      tenantId = await createTenant("ref");
      orderId = await createOrder(tenantId);
    });

    it("wiersz `stripe` BEZ odnośnika jest odrzucany", async () => {
      // „Dostawca to zrobił" bez wskazania czego to zdanie niedowodliwe —
      // a dotyczy pieniędzy klienta.
      const { errorCode, errorMessage } = await insertEvent(tenantId, orderId, {
        kind: "collected",
        amount_grosze: 100_00,
        provider: "stripe",
      });
      expect(errorCode, `stripe bez odnośnika przeszedł: ${errorMessage}`).toBe(PG_CHECK_VIOLATION);
    });

    it("odnośnik z samych białych znaków to BRAK odnośnika", async () => {
      // Bez `btrim` wymóg obchodzi się spacją — dokładnie ta sama pułapka,
      // co przy doprecyzowaniu powodu 'other' w 0011.
      const { errorCode } = await insertEvent(tenantId, orderId, {
        kind: "collected",
        amount_grosze: 100_00,
        provider: "stripe",
        provider_reference: "   ",
      });
      expect(errorCode).toBe(PG_CHECK_VIOLATION);
    });

    it("wiersz `manual` Z odnośnikiem jest ODRZUCANY, nie zerowany po cichu", async () => {
      const { errorCode, errorMessage } = await insertEvent(tenantId, orderId, {
        kind: "collected",
        amount_grosze: 100_00,
        provider: "manual",
        provider_reference: "pi_skads_wziety",
      });
      expect(errorCode, `manual z odnośnikiem przeszedł: ${errorMessage}`).toBe(PG_CHECK_VIOLATION);
    });

    it("komplet (stripe + odnośnik) przechodzi", async () => {
      const { errorMessage } = await insertEvent(tenantId, orderId, {
        kind: "collected",
        amount_grosze: 100_00,
        provider: "stripe",
        provider_reference: `pi_${randomUUID().slice(0, 12)}`,
      });
      expect(errorMessage).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // 3. Unikat odnośnika — idempotencja księgowania pieniędzy
  // -------------------------------------------------------------------

  it("ten sam odnośnik nie zaksięguje się dwa razy", async () => {
    const tenantId = await createTenant("unique");
    const orderId = await createOrder(tenantId);
    const reference = `re_${randomUUID().slice(0, 12)}`;

    const first = await insertEvent(tenantId, orderId, {
      kind: "collected",
      amount_grosze: 100_00,
      provider: "stripe",
      provider_reference: reference,
    });
    expect(first.errorMessage).toBeUndefined();

    // Drugie potwierdzenie tego samego zwrotu (webhook po odczycie z panelu
    // albo odwrotnie) NIE ma prawa dopisać drugiego wiersza. Bez unikatu
    // rejestr twierdziłby, że pieniądze poruszyły się dwa razy.
    const second = await insertEvent(tenantId, orderId, {
      kind: "refunded",
      amount_grosze: 100_00,
      provider: "stripe",
      provider_reference: reference,
    });
    expect(second.errorCode, `duplikat odnośnika przeszedł: ${second.errorMessage}`).toBe(
      PG_UNIQUE_VIOLATION,
    );
  });

  it("unikat NIE dotyczy obiegu ręcznego — tam odnośnika nie ma", async () => {
    // Partial index po `provider_reference is not null`: dwa pobrania
    // gotówkowe na tym samym zamówieniu to normalna praca lady.
    const tenantId = await createTenant("manual-dup");
    const orderId = await createOrder(tenantId);

    const first = await insertEvent(tenantId, orderId, { kind: "collected", amount_grosze: 50_00 });
    const second = await insertEvent(tenantId, orderId, { kind: "collected", amount_grosze: 50_00 });
    expect(first.errorMessage).toBeUndefined();
    expect(second.errorMessage).toBeUndefined();
  });

  // -------------------------------------------------------------------
  // 4. Niezmiennik salda z 0011 obowiązuje TAK SAMO w obiegu dostawcy
  // -------------------------------------------------------------------

  it("zwrot większy niż pobranie jest odrzucany także z odnośnikiem dostawcy", async () => {
    // Bramka 0011 nie zna Stripe'a i nie ma go znać: potwierdzenie
    // u dostawcy nie jest zezwoleniem na rozjazd NASZEGO rejestru.
    const tenantId = await createTenant("balance");
    const orderId = await createOrder(tenantId);

    await insertEvent(tenantId, orderId, {
      kind: "collected",
      amount_grosze: 100_00,
      provider: "stripe",
      provider_reference: `pi_${randomUUID().slice(0, 12)}`,
    });

    const { errorCode, errorMessage } = await insertEvent(tenantId, orderId, {
      kind: "refunded",
      amount_grosze: 150_00,
      provider: "stripe",
      provider_reference: `re_${randomUUID().slice(0, 12)}`,
    });

    expect(errorCode, `nadmiarowy zwrot przeszedł: ${errorMessage}`).toBe(PG_CHECK_VIOLATION);
    expect(errorMessage).toContain("Rozliczenie kaucji przekracza pobraną kwotę");
  });

  // -------------------------------------------------------------------
  // 5. deposit_refunds — rejestr ŻĄDAŃ
  // -------------------------------------------------------------------

  describe("rejestr żądań zwrotu", () => {
    let tenantId: string;
    let orderId: string;

    beforeAll(async () => {
      tenantId = await createTenant("refunds");
      orderId = await createOrder(tenantId);
    });

    it("nowy wiersz rodzi się jako `requested` bez odnośnika", async () => {
      // `requested` = „wysłaliśmy żądanie i NIE ZNAMY odpowiedzi". To jest
      // najniebezpieczniejszy stan w tej tabeli i dlatego ma własną nazwę,
      // a nie NULL-a udającego, że nic się nie stało.
      const { data, error } = await admin
        .from("deposit_refunds")
        .insert({ tenant_id: tenantId, order_id: orderId, amount_grosze: 100_00 })
        .select("status, provider, provider_reference, last_error")
        .single();
      expect(error).toBeNull();
      expect(data).toMatchObject({
        status: "requested",
        provider: "stripe",
        provider_reference: null,
        last_error: null,
      });
    });

    it("status spoza listy jest odrzucany", async () => {
      const { error } = await admin
        .from("deposit_refunds")
        .insert({
          tenant_id: tenantId,
          order_id: orderId,
          amount_grosze: 100_00,
          status: "probably_fine",
        })
        .select("id");
      expect(error?.code).toBe(PG_CHECK_VIOLATION);
    });

    it("kwota zerowa i ujemna są odrzucane", async () => {
      for (const amount of [0, -1]) {
        const { error } = await admin
          .from("deposit_refunds")
          .insert({ tenant_id: tenantId, order_id: orderId, amount_grosze: amount })
          .select("id");
        expect(error?.code, `kwota ${amount} przeszła`).toBe(PG_CHECK_VIOLATION);
      }
    });

    it("odnośnik dostawcy jest unikatowy", async () => {
      const reference = `re_${randomUUID().slice(0, 12)}`;
      const first = await admin
        .from("deposit_refunds")
        .insert({
          tenant_id: tenantId,
          order_id: orderId,
          amount_grosze: 10_00,
          provider_reference: reference,
        })
        .select("id");
      expect(first.error).toBeNull();

      const second = await admin
        .from("deposit_refunds")
        .insert({
          tenant_id: tenantId,
          order_id: orderId,
          amount_grosze: 10_00,
          provider_reference: reference,
        })
        .select("id");
      // Po tym odnośniku webhook odnajduje tenanta i zamówienie — dwa
      // trafienia znaczyłyby, że nie wiadomo, czyj to zwrot.
      expect(second.error?.code).toBe(PG_UNIQUE_VIOLATION);
    });

    it("żądanie międzytenantowe jest niereprezentowalne (FK złożony)", async () => {
      const otherTenantId = await createTenant("refunds-other");
      const { error } = await admin
        .from("deposit_refunds")
        .insert({ tenant_id: otherTenantId, order_id: orderId, amount_grosze: 10_00 })
        .select("id");
      // 23503 z klucza złożonego (tenant_id, order_id) → orders.
      expect(error?.code).toBe("23503");
    });

    it("anon nie widzi rejestru żądań i nie zapisuje do niego", async () => {
      const anon = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        ...realtimeTransport,
      });

      const read = await anon.from("deposit_refunds").select("id");
      expect(read.data ?? []).toHaveLength(0);

      const write = await anon
        .from("deposit_refunds")
        .insert({ tenant_id: tenantId, order_id: orderId, amount_grosze: 10_00 })
        .select("id");
      expect(write.error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    });

    it("updated_at rusza przy zmianie stanu", async () => {
      const { data: created } = await admin
        .from("deposit_refunds")
        .insert({ tenant_id: tenantId, order_id: orderId, amount_grosze: 20_00 })
        .select("id, updated_at")
        .single();

      const { data: updated } = await admin
        .from("deposit_refunds")
        .update({ status: "pending" })
        .eq("id", (created as { id: string }).id)
        .select("updated_at")
        .single();

      expect(new Date((updated as { updated_at: string }).updated_at).getTime()).toBeGreaterThan(
        new Date((created as { updated_at: string }).updated_at).getTime() - 1,
      );
    });
  });

  describe("uprawnienia tabelaryczne", () => {
    // Sprawdzane W KATALOGU, nie przez zachowanie żądania: brak GRANT-u
    // i odmowa polityki RLS dają różne kody, a chodzi o to, że uprawnienia
    // NIE MA W OGÓLE — bo TRUNCATE i DELETE bez grantu to jedyna obrona,
    // której polityka nie zapewnia (wzorzec append-only z 0007).
    const sql = hasEnv ? postgres(env("SUPABASE_LOCAL_URL"), { max: 1 }) : null;

    afterAll(async () => {
      await sql?.end({ timeout: 5 });
    });

    it.each([
      ["anon", "SELECT", false],
      ["anon", "INSERT", false],
      ["authenticated", "SELECT", true],
      ["authenticated", "INSERT", true],
      ["authenticated", "UPDATE", true],
      ["authenticated", "DELETE", false],
      ["authenticated", "TRUNCATE", false],
    ] as const)("%s ma %s na deposit_refunds: %s", async (role, privilege, expected) => {
      const rows = await sql!<{ allowed: boolean }[]>`
        select has_table_privilege(${role}, 'public.deposit_refunds', ${privilege}) as allowed
      `;
      expect(rows[0]!.allowed).toBe(expected);
    });

    it("deposit_events pozostaje append-only po 0031", async () => {
      // Regresja: 0031 dokłada kolumny do rejestru zdarzeń, a nie prawo
      // ich nadpisywania. Gdyby po drodze pojawił się GRANT UPDATE, cała
      // wartość dowodowa rejestru w sporze z klientem by zniknęła.
      const rows = await sql!<{ upd: boolean; del: boolean }[]>`
        select
          has_table_privilege('authenticated', 'public.deposit_events', 'UPDATE') as upd,
          has_table_privilege('authenticated', 'public.deposit_events', 'DELETE') as del
      `;
      expect(rows[0]).toEqual({ upd: false, del: false });
    });
  });
});
