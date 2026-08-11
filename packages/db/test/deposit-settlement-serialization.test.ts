/**
 * Serializacja rozliczenia kaucji NIEOBJĘTEGO unikatem 0032
 * (packages/db/supabase/migrations/0034_deposit_settlement_serialization.sql,
 * ADR-072).
 *
 * CO TU JEST DOWODZONE. Gwarancja „jeden zwrot w locie" z 0032 stoi na tabeli
 * `deposit_refunds`, a ta przyjmuje wyłącznie kwoty > 0 w obiegu dostawcy.
 * Rozliczenie samym POTRĄCENIEM (kwota zwrotu = 0) i całe rozliczenie w obiegu
 * RĘCZNYM idą wprost do `deposit_events`, więc unikatu nie dotykają: przed
 * 0034 dwa równoległe potrącenia po 300 zł z kaucji 1000 zł księgowały się
 * OBA (600 <= 1000, niezmiennik salda nietknięty), zatrzymując klientowi
 * dwa razy więcej, niż wynikało z decyzji.
 *
 * 0034 wymaga od wiersza-decyzji DEKLARACJI SALDA, wobec którego decyzję
 * podjęto (`expected_balance_grosze`), i odrzuca zapis, gdy rejestr pokazuje
 * już inne. Sprawdzenie stoi WEWNĄTRZ advisory locka bramki 0011, więc
 * przegrana transakcja czyta rejestr po commicie wygranej (READ COMMITTED:
 * nowe zapytanie = nowy snapshot) — to jest ta sama serializacja, którą 0011
 * postawiło pod niezmiennik sumy.
 *
 * Wyścig jest odtwarzany DWOMA REALNYMI SESJAMI CZŁONKÓW i bezpośrednimi
 * INSERT-ami do `deposit_events` — celowo bez `app.create_order` i bez
 * dotykania orders/order_items: lekcja ADR-024 mówi, że cudze locki
 * (numeracja z 0007, bramka egzemplarza z 0010) potrafią zserializować
 * transakcje wcześniej i ZAMASKOWAĆ dowód.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*
 * (patrz docs/konwencje-migracji.md). Bez nich cały plik jest pomijany.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";
import { createAdminClient } from "./helpers/seed-tenants";

const hasEnv = integrationEnv([
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
]);

/** 23P01 = exclusion_violation: decyzja podjęta wobec salda, którego już nie ma. */
const PG_STALE_BALANCE = "23P01";
/** 23514 = check_violation: kształt wiersza i niezmiennik salda (0011/ADR-026). */
const PG_CHECK_VIOLATION = "23514";

const TEST_PASSWORD = "Settle0034!12345678";
const COLLECTED = 1_000_00;

describe.skipIf(!hasEnv)("serializacja rozliczenia kaucji — 0034", () => {
  let admin: SupabaseClient;
  let memberA: SupabaseClient;
  let memberB: SupabaseClient;
  let tenantId: string;
  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];

  function anonClient(): SupabaseClient {
    const env = (name: string): string => {
      const value = process.env[name];
      if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
      return value;
    };
    return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    });
  }

  async function createUser(label: string): Promise<{ id: string; email: string }> {
    const email = `s34-${label}-${randomUUID()}@test.local`;
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
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (error) throw new Error(`signIn(${email}): ${error.message}`);
    return client;
  }

  /** Zamówienie z pobraną kaucją — nośnik rejestru dla jednego przypadku. */
  async function orderWithDeposit(): Promise<string> {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, email: `s34-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`customer: ${customerError?.message}`);

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        start_date: "2026-09-01",
        end_date: "2026-09-03",
        delivery_method: "courier",
        total_deposit_grosze: COLLECTED,
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(`order: ${orderError?.message}`);

    const { error: collectError } = await admin.from("deposit_events").insert({
      tenant_id: tenantId,
      order_id: order.id,
      kind: "collected",
      amount_grosze: COLLECTED,
    });
    if (collectError) throw new Error(`collected: ${collectError.message}`);
    return order.id as string;
  }

  async function ledger(orderId: string): Promise<{ kind: string; amount_grosze: number }[]> {
    const { data, error } = await admin
      .from("deposit_events")
      .select("kind, amount_grosze, created_at")
      .eq("tenant_id", tenantId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`ledger: ${error.message}`);
    return (data ?? []) as { kind: string; amount_grosze: number }[];
  }

  function balanceOf(events: { kind: string; amount_grosze: number }[]): number {
    return events.reduce(
      (sum, event) => sum + (event.kind === "collected" ? event.amount_grosze : -event.amount_grosze),
      0,
    );
  }

  beforeAll(async () => {
    admin = createAdminClient();

    // Operator A zakłada organizację realną ścieżką onboardingu…
    const userA = await createUser("op-a");
    const bootstrap = await signIn(userA.email);
    const { data: newTenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
        p_slug: `s34-${randomUUID()}`.slice(0, 39),
        p_name: "Wypożyczalnia rozliczeniowa 0034",
      });
    if (tenantError) throw new Error(`create_tenant: ${tenantError.message}`);
    tenantId = newTenantId as string;
    createdTenantIds.push(tenantId);
    memberA = await signIn(userA.email); // świeża sesja z claimem tenant_id

    // …operator B zostaje jej członkiem (rozliczenie kaucji to praca lady).
    const userB = await createUser("op-b");
    const { error: memberError } = await admin
      .from("members")
      .insert({ tenant_id: tenantId, user_id: userB.id, role: "staff" });
    if (memberError) throw new Error(`insert members: ${memberError.message}`);
    memberB = await signIn(userB.email);
  }, 60_000);

  afterAll(async () => {
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  // -------------------------------------------------------------------
  // 1. Kształt deklaracji (CHECK deposit_events_expected_balance_shape)
  // -------------------------------------------------------------------

  describe("kształt deklaracji salda", () => {
    it("deklaracja przy POBRANIU jest odrzucana, nie zerowana po cichu", async () => {
      // Pobranie wychodzi z bramki przed sprawdzeniem salda (0011: może je
      // wyłącznie zwiększyć), więc deklaracja przy nim byłaby liczbą, której
      // NIKT nigdy nie sprawdzi — czyli zabezpieczeniem tylko z wyglądu.
      const orderId = await orderWithDeposit();
      const { error } = await admin.from("deposit_events").insert({
        tenant_id: tenantId,
        order_id: orderId,
        kind: "collected",
        amount_grosze: 100_00,
        expected_balance_grosze: COLLECTED,
      });
      expect(error?.code).toBe(PG_CHECK_VIOLATION);
    });

    it("deklaracja ujemna jest odrzucana — bramką, bo BEFORE wyprzedza CHECK", async () => {
      // CHECK `deposit_events_expected_balance_shape` zabrania wartości
      // ujemnych, ale przy rodzajach innych niż `collected` NIGDY nie zdąży
      // się o to upomnieć: ograniczenia tabeli sprawdzają się PO triggerach
      // BEFORE, a bramka odrzuca każdą deklarację różną od salda — saldo zaś
      // nie bywa ujemne (niezmiennik 0011). Ta sama kolejność, przez którą
      // gałąź 23505 w bookDepositEvent okazała się nieosiągalna (0031).
      // Test asertuje kod, który wraca NAPRAWDĘ, a nie ten, którego się
      // spodziewaliśmy przy pisaniu CHECK-a.
      const orderId = await orderWithDeposit();
      const { error } = await admin.from("deposit_events").insert({
        tenant_id: tenantId,
        order_id: orderId,
        kind: "refunded",
        amount_grosze: 100_00,
        expected_balance_grosze: -1,
      });
      expect(error?.code).toBe(PG_STALE_BALANCE);
    });

    it("wiersz BEZ deklaracji wchodzi — zwrot księgowany po potwierdzeniu przelewu", async () => {
      // Granica z ADR-072: odmawiać wolno wyłącznie temu, co jeszcze nie
      // nastąpiło. Wiersz `refunded` powstający PO potwierdzonym przelewie
      // (nasz odczyt albo webhook) deklaracji nie niesie i nieść nie może.
      const orderId = await orderWithDeposit();
      const { error } = await admin.from("deposit_events").insert({
        tenant_id: tenantId,
        order_id: orderId,
        kind: "refunded",
        amount_grosze: COLLECTED,
      });
      expect(error).toBeNull();
      expect(balanceOf(await ledger(orderId))).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // 2. Wyścig: rozliczenie SAMYM POTRĄCENIEM
  // -------------------------------------------------------------------

  describe("dwa równoległe rozliczenia samym potrąceniem", () => {
    it("księguje się DOKŁADNIE JEDNO, przegrany dostaje 23P01", async () => {
      const orderId = await orderWithDeposit();

      // Każde potrącenie Z OSOBNA jest legalne i RAZEM też mieszczą się
      // w pobraniu (600 <= 1000) — dlatego bramka salda z 0011 nie ma tu
      // czego odrzucić i przed 0034 księgowały się OBA.
      const settle = (client: SupabaseClient) =>
        client
          .from("deposit_events")
          .insert({
            tenant_id: tenantId,
            order_id: orderId,
            kind: "deducted",
            amount_grosze: 300_00,
            reason_code: "damage",
            reason: "rysa na obudowie",
            expected_balance_grosze: COLLECTED,
          })
          .select("id");

      const [resultA, resultB] = await Promise.all([settle(memberA), settle(memberB)]);

      const succeeded = [resultA, resultB].filter((r) => !r.error);
      const failed = [resultA, resultB].filter((r) => r.error);
      expect(succeeded, "wyścig potrąceń: liczba sukcesów inna niż 1").toHaveLength(1);
      expect(failed, "wyścig potrąceń: liczba odmów inna niż 1").toHaveLength(1);
      expect(failed[0]!.error!.code, "przegrany dostał inny kod niż 23P01").toBe(PG_STALE_BALANCE);
      // Komunikat ma nieść OBIE liczby — bez nich operator nie wie, czy
      // rejestr ruszył się o jego własny drugi klik, czy o cudze rozliczenie.
      expect(failed[0]!.error!.message).toContain("Saldo kaucji zmieniło się");

      const events = await ledger(orderId);
      expect(
        events.filter((event) => event.kind === "deducted"),
        "w rejestrze inna liczba potrąceń niż 1",
      ).toHaveLength(1);
      expect(balanceOf(events), "saldo po wyścigu inne niż 700 zł").toBe(COLLECTED - 300_00);
    }, 30_000);

    it("kolejne rozliczenie wobec ŚWIEŻEGO salda przechodzi — raty zostają legalne", async () => {
      // Odpowiednik reguły z 0032: blokujemy DRUGIE żądanie tej samej decyzji,
      // nie zdolność do rozliczania kaucji w kilku krokach.
      const orderId = await orderWithDeposit();

      const first = await memberA.from("deposit_events").insert({
        tenant_id: tenantId,
        order_id: orderId,
        kind: "deducted",
        amount_grosze: 300_00,
        reason_code: "cleaning",
        expected_balance_grosze: COLLECTED,
      });
      expect(first.error).toBeNull();

      // Ekran odświeżony: operator widzi 700 zł i decyduje wobec tej liczby.
      const second = await memberA.from("deposit_events").insert({
        tenant_id: tenantId,
        order_id: orderId,
        kind: "deducted",
        amount_grosze: 200_00,
        reason_code: "damage",
        expected_balance_grosze: COLLECTED - 300_00,
      });
      expect(second.error).toBeNull();

      // …a powtórka ze STAREGO ekranu (dwuklik sekwencyjny, cofnięcie
      // przeglądarki, druga karta) odpada — czego unikat 0032 nie łapie
      // w ogóle, bo jego gwarancja wygasa z domknięciem żądania.
      const stale = await memberB.from("deposit_events").insert({
        tenant_id: tenantId,
        order_id: orderId,
        kind: "deducted",
        amount_grosze: 300_00,
        reason_code: "cleaning",
        expected_balance_grosze: COLLECTED,
      });
      expect(stale.error?.code).toBe(PG_STALE_BALANCE);

      expect(balanceOf(await ledger(orderId))).toBe(COLLECTED - 500_00);
    }, 30_000);
  });

  // -------------------------------------------------------------------
  // 3. Potrącenie i zwrot JEDNYM poleceniem (modal rozliczenia, obieg ręczny)
  // -------------------------------------------------------------------

  describe("para potrącenie + zwrot jednym poleceniem", () => {
    it("deklaracja NARASTAJĄCA przechodzi, a równoległa kopia pary odpada", async () => {
      const orderId = await orderWithDeposit();

      // Bramka widzi wiersze wstawione wcześniej TYM SAMYM poleceniem, więc
      // zwrot zastaje saldo pomniejszone o potrącenie — i deklaruje właśnie je.
      const pair = (client: SupabaseClient) =>
        client
          .from("deposit_events")
          .insert([
            {
              tenant_id: tenantId,
              order_id: orderId,
              kind: "deducted",
              amount_grosze: 250_00,
              reason_code: "damage",
              expected_balance_grosze: COLLECTED,
            },
            {
              tenant_id: tenantId,
              order_id: orderId,
              kind: "refunded",
              amount_grosze: COLLECTED - 250_00,
              expected_balance_grosze: COLLECTED - 250_00,
            },
          ])
          .select("id");

      const [resultA, resultB] = await Promise.all([pair(memberA), pair(memberB)]);

      const succeeded = [resultA, resultB].filter((r) => !r.error);
      const failed = [resultA, resultB].filter((r) => r.error);
      expect(succeeded, "wyścig pary: liczba sukcesów inna niż 1").toHaveLength(1);
      expect(failed[0]!.error!.code).toBe(PG_STALE_BALANCE);

      const events = await ledger(orderId);
      // ANI JEDNEGO wiersza z przegranej pary — atomowość polecenia trzyma.
      expect(events.map((event) => [event.kind, event.amount_grosze])).toEqual([
        ["collected", COLLECTED],
        ["deducted", 250_00],
        ["refunded", COLLECTED - 250_00],
      ]);
      expect(balanceOf(events)).toBe(0);
    }, 30_000);
  });

  // -------------------------------------------------------------------
  // 4. Kolejność sprawdzeń w bramce
  // -------------------------------------------------------------------

  it("poprawna deklaracja NIE przykrywa niezmiennika salda — nadmiar to nadal 23514", async () => {
    // Deklaracja jest dodatkową warstwą, nie zamiennikiem. Wołający, który
    // uczciwie odczytał saldo i mimo to prosi o więcej, ma dostać odmowę
    // z 0011 — z komunikatem o KWOCIE, bo to kwotę ma poprawić.
    const orderId = await orderWithDeposit();
    const { error } = await memberA.from("deposit_events").insert({
      tenant_id: tenantId,
      order_id: orderId,
      kind: "deducted",
      amount_grosze: COLLECTED + 1,
      reason_code: "damage",
      expected_balance_grosze: COLLECTED,
    });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
    expect(error?.message).toContain("przekracza pobraną kwotę");
    expect((await ledger(orderId)).filter((event) => event.kind === "deducted")).toHaveLength(0);
  }, 30_000);
});
