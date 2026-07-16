/**
 * Rdzeń wynajmu (packages/db/supabase/migrations/0007_rental_core.sql).
 *
 * Zakres — rzeczy, których macierz izolacji RLS (rls-isolation.test.ts) NIE
 * dowodzi, bo pilnuje innej osi (tenant A vs tenant B):
 *
 *   1. wszystkie dziewięć tabel rdzenia JEST objętych macierzą izolacji —
 *      introspekcja po kolumnie tenant_id ma je złapać automatycznie, ale
 *      „ma" to nie „łapie", więc lista jest tu sprawdzana jawnie,
 *   2. numeracja zamówień: format, prefiks z tenant_settings, fallback 'AV',
 *      głośna odmowa przy błędnym prefiksie i NIEZALEŻNOŚĆ sekwencji dwóch
 *      tenantów tworzących zamówienia RÓWNOLEGLE,
 *   3. CHECK-i warunkowe (zależności między kolumnami) — testowane
 *      NEGATYWNIE: wiersz naruszający zależność musi zostać odrzucony,
 *   4. spójność tenanta na kluczach złożonych — dziecko nie wskaże rodzica
 *      z innego tenanta, mimo poprawnego własnego tenant_id.
 *
 * Zapisy idą klientem service-role: te testy dowodzą zachowania SCHEMATU
 * (triggery, CHECK-i, klucze obce), które obowiązuje niezależnie od RLS.
 * Bramkę RLS dowodzi macierz izolacji — tu byłaby szumem.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*
 * (patrz docs/konwencje-migracji.md). Bez nich cały plik jest pomijany.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

import { createAdminClient, listTenantTables } from "./helpers/seed-tenants";
import { integrationEnv } from "./helpers/integration-env";

const hasEnv = integrationEnv([
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
]);

/** Kod Postgres 23514 = check_violation, 23503 = foreign_key_violation. */
const PG_CHECK_VIOLATION = "23514";
const PG_FOREIGN_KEY_VIOLATION = "23503";

// Dziewięć tabel wprowadzonych przez 0007. Lista jest JAWNA i wpisana wprost:
// gdyby powstawała z tej samej introspekcji, którą sprawdza, test dowodziłby
// wyłącznie tego, że introspekcja jest równa samej sobie.
const RENTAL_CORE_TABLES = [
  "products",
  "product_units",
  "pricing_tiers",
  "pickup_locations",
  "customers",
  "orders",
  "order_items",
  "deposit_events",
  "tenant_settings",
] as const;

describe.skipIf(!hasEnv)("rdzeń wynajmu — 0007_rental_core.sql", () => {
  let admin: SupabaseClient;
  let sql: ReturnType<typeof postgres>;
  let dbYear: string;
  const createdTenantIds: string[] = [];

  /**
   * Świeży tenant na wyłączność testu. Numeracja zamówień jest sekwencją per
   * (tenant, rok), więc test oczekujący numeru 001 musi startować z tenantem,
   * który nie ma ani jednego zamówienia — współdzielenie tenanta między
   * testami czyniłoby oczekiwane numery zależnymi od kolejności wykonania.
   */
  async function createTenant(label: string): Promise<string> {
    const { data, error } = await admin
      .from("tenants")
      .insert({
        slug: `core-${label}-${randomUUID()}`.slice(0, 39),
        name: `Rental core test tenant ${label}`,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Nie udało się utworzyć tenanta testowego "${label}": ${error?.message}`);
    }
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  async function createCustomer(tenantId: string): Promise<string> {
    const { data, error } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, email: `customer-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Nie udało się utworzyć klienta: ${error?.message}`);
    return data.id as string;
  }

  async function setPrefix(tenantId: string, prefix: string): Promise<void> {
    // jsonb: skalar zapisywany jako skalar JSON — generator czyta go przez
    // `value #>> '{}'` (konwencja opisana w komentarzu tabeli tenant_settings).
    const { error } = await admin
      .from("tenant_settings")
      .insert({ tenant_id: tenantId, key: "order_number_prefix", value: prefix });
    if (error) throw new Error(`Nie udało się ustawić prefiksu: ${error.message}`);
  }

  /** Wstawia zamówienie BEZ order_number i zwraca numer nadany przez trigger. */
  async function insertOrder(
    tenantId: string,
    customerId: string,
  ): Promise<{ orderNumber?: string; errorCode?: string; errorMessage?: string }> {
    const { data, error } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        start_date: "2026-08-01",
        end_date: "2026-08-03",
        delivery_method: "courier",
      })
      .select("order_number")
      .single();
    if (error) return { errorCode: error.code, errorMessage: error.message };
    return { orderNumber: data?.order_number as string };
  }

  beforeAll(async () => {
    admin = createAdminClient();
    sql = postgres(process.env.SUPABASE_LOCAL_URL as string, { max: 5 });
    // Rok bierzemy Z BAZY, nie z hosta testowego: generator używa now() w
    // strefie sesji bazodanowej (Supabase: UTC), a runner CI może stać w innej.
    const [row] = await sql<{ year: string }[]>`select to_char(now(), 'YYYY') as year`;
    dbYear = row!.year;
  }, 60_000);

  afterAll(async () => {
    if (createdTenantIds.length > 0) {
      // Kaskada z public.tenants sprząta wszystkie tabele rdzenia naraz.
      const { error } = await admin.from("tenants").delete().in("id", createdTenantIds);
      if (error) throw new Error(`Teardown: nie udało się usunąć tenantów: ${error.message}`);
    }
    await sql.end({ timeout: 5 });
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Pokrycie macierzy izolacji
  // -------------------------------------------------------------------

  it("wszystkie tabele rdzenia wchodzą do macierzy izolacji RLS", async () => {
    // listTenantTables() to DOKŁADNIE to źródło, po którym iteruje macierz w
    // rls-isolation.test.ts. Gdyby któraś tabela rdzenia zgubiła kolumnę
    // tenant_id (albo powstała bez niej), wypadłaby z macierzy po cichu —
    // testy izolacji świeciłyby się na zielono, nie sprawdzając jej wcale.
    const tables = await listTenantTables({});
    expect(tables, "tabela rdzenia poza macierzą izolacji").toEqual(
      expect.arrayContaining([...RENTAL_CORE_TABLES]),
    );
  });

  it("każda tabela rdzenia ma włączone RLS", async () => {
    const rows = await sql<{ tablename: string }[]>`
      select tablename from pg_tables
      where schemaname = 'public'
        and tablename = any(${sql.array([...RENTAL_CORE_TABLES])})
        and rowsecurity = true
    `;
    expect(
      rows.map((r) => r.tablename).sort(),
      "tabela rdzenia bez włączonego RLS",
    ).toEqual([...RENTAL_CORE_TABLES].sort());
  });

  it("anon nie ma ŻADNYCH uprawnień na tabelach rdzenia", async () => {
    // Dopełnienie `revoke all ... from anon` w 0007. Bez tego testu regresja
    // (nowy grant dla anona, choćby SELECT) byłaby niewidoczna: macierz
    // izolacji sprawdza oś tenant-tenant, a nie oś publiczność-platforma.
    const rows = await sql<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'anon'
        and table_schema = 'public'
        and table_name = any(${sql.array([...RENTAL_CORE_TABLES])})
    `;
    expect(rows, "anon ma uprawnienia na tabeli rdzenia wynajmu").toEqual([]);
  });

  // -------------------------------------------------------------------
  // 2. Numeracja zamówień
  // -------------------------------------------------------------------

  describe("numeracja zamówień (app.generate_order_number)", () => {
    it("bez ustawienia prefiksu numeruje fallbackiem 'AV'", async () => {
      const tenantId = await createTenant("fallback");
      const customerId = await createCustomer(tenantId);

      const { orderNumber, errorMessage } = await insertOrder(tenantId, customerId);
      expect(errorMessage, `INSERT zamówienia nie powiódł się: ${errorMessage}`).toBeUndefined();
      expect(orderNumber, "fallback prefiksu nie zadziałał").toBe(`AV-${dbYear}-001`);
    });

    it("używa prefiksu z tenant_settings i normalizuje go do wielkich liter", async () => {
      const tenantId = await createTenant("prefix");
      const customerId = await createCustomer(tenantId);
      await setPrefix(tenantId, "sk");

      const { orderNumber, errorMessage } = await insertOrder(tenantId, customerId);
      expect(errorMessage, `INSERT zamówienia nie powiódł się: ${errorMessage}`).toBeUndefined();
      expect(orderNumber, "prefiks z tenant_settings nie został użyty").toBe(`SK-${dbYear}-001`);
    });

    it.each([
      { label: "znaki spoza [A-Z0-9]", value: "zły prefiks!" as unknown },
      { label: "za krótki", value: "X" as unknown },
      { label: "za długi", value: "PREFIKSZADLUGI" as unknown },
      { label: "pusty", value: "" as unknown },
      { label: "nie-string (liczba)", value: 42 as unknown },
      { label: "nie-string (obiekt)", value: { prefix: "SK" } as unknown },
    ])("odrzuca błędny prefiks przy ZAPISIE ustawienia ($label)", async ({ value }) => {
      // Bramka stoi u źródła, nie przy zamówieniu: pomyłka w konfiguracji ma
      // wybuchnąć tam, gdzie ją popełniono. Kształt (nie-string) jest tu tak
      // samo istotny jak treść — `value #>> '{}'` na obiekcie zwraca NULL, więc
      // bez sprawdzenia jsonb_typeof generator po cichu wróciłby do 'AV'.
      const tenantId = await createTenant("badprefix");
      const { error } = await admin
        .from("tenant_settings")
        .insert({ tenant_id: tenantId, key: "order_number_prefix", value });
      expect(error?.code, `błędny prefiks został zapisany: ${error?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );
    });

    it("CHECK prefiksu nie krępuje pozostałych ustawień", async () => {
      // Para do testów wyżej: warunek celuje WYŁĄCZNIE w klucz
      // order_number_prefix. Gdyby obejmował wszystkie klucze, tabela
      // ustawień przyjmowałaby tylko krótkie stringi — i test wyżej byłby
      // zielony z zupełnie złego powodu.
      const tenantId = await createTenant("othersetting");
      const { error } = await admin
        .from("tenant_settings")
        .insert({ tenant_id: tenantId, key: "zwroty_reguly", value: { dni: 14, opis: "dowolny obiekt" } });
      expect(error?.message, `zwykłe ustawienie zostało odrzucone: ${error?.message}`).toBeUndefined();
    });

    it("numeruje kolejno w obrębie tenanta", async () => {
      const tenantId = await createTenant("seq");
      const customerId = await createCustomer(tenantId);

      const first = await insertOrder(tenantId, customerId);
      const second = await insertOrder(tenantId, customerId);
      expect([first.orderNumber, second.orderNumber]).toEqual([
        `AV-${dbYear}-001`,
        `AV-${dbYear}-002`,
      ]);
    });

    it(
      "dwa tenanty tworzące zamówienia RÓWNOLEGLE numerują niezależnie",
      async () => {
        // To jest właściwy dowód mechanizmu: advisory lock jest zakluczony
        // parą (tenant, rok), więc sekwencje nie mogą ani na siebie czekać
        // (poprawność), ani się przeplatać (niezależność). Gdyby generator
        // liczył max(...) bez locka, równoległe wstawienia w obrębie jednego
        // tenanta odczytałyby ten sam max i dały duplikat — test padłby na
        // 23505 (unikalność orders_number_key jest siatką, nie mechanizmem).
        const ORDERS_PER_TENANT = 5;
        const [x, y] = await Promise.all([createTenant("par-x"), createTenant("par-y")]);
        const [cx, cy] = await Promise.all([createCustomer(x!), createCustomer(y!)]);
        await Promise.all([setPrefix(x!, "XX"), setPrefix(y!, "YY")]);

        // Przeplot X/Y w jednej paczce Promise.all — żądania idą równolegle,
        // każde własnym połączeniem z puli PostgREST.
        const inFlight: Promise<{ orderNumber?: string; errorMessage?: string }>[] = [];
        for (let i = 0; i < ORDERS_PER_TENANT; i += 1) {
          inFlight.push(insertOrder(x!, cx!));
          inFlight.push(insertOrder(y!, cy!));
        }
        const results = await Promise.all(inFlight);

        const failed = results.filter((r) => r.errorMessage);
        expect(
          failed.map((r) => r.errorMessage),
          "równoległe wstawienia zderzyły się — numeracja nie jest bezpieczna współbieżnie",
        ).toEqual([]);

        const expected = Array.from({ length: ORDERS_PER_TENANT }, (_, i) =>
          String(i + 1).padStart(3, "0"),
        );
        for (const [tenantId, prefix] of [
          [x!, "XX"],
          [y!, "YY"],
        ] as const) {
          const rows = await sql<{ order_number: string }[]>`
            select order_number from public.orders
            where tenant_id = ${tenantId} order by order_number
          `;
          expect(
            rows.map((r) => r.order_number),
            `tenant ${prefix}: numeracja z dziurą, duplikatem albo cudzym prefiksem`,
          ).toEqual(expected.map((n) => `${prefix}-${dbYear}-${n}`));
        }
      },
      60_000,
    );

    it("nie nadpisuje numeru podanego wprost (ścieżka importu)", async () => {
      const tenantId = await createTenant("import");
      const customerId = await createCustomer(tenantId);

      const { data, error } = await admin
        .from("orders")
        .insert({
          tenant_id: tenantId,
          customer_id: customerId,
          order_number: `IMP-${dbYear}-042`,
          start_date: "2026-08-01",
          end_date: "2026-08-03",
          delivery_method: "courier",
        })
        .select("order_number")
        .single();
      expect(error?.message, `INSERT z jawnym numerem nie powiódł się: ${error?.message}`).toBeUndefined();
      expect(data?.order_number, "trigger nadpisał numer podany wprost").toBe(`IMP-${dbYear}-042`);

      // Numer podany wprost wchodzi do sekwencji: kolejny liczy się z
      // istniejących zamówień, więc idzie po 042, a nie od 001.
      const next = await insertOrder(tenantId, customerId);
      expect(next.orderNumber, "numer podany wprost wypadł z sekwencji").toBe(`AV-${dbYear}-043`);
    });

    it("odrzuca numer o niepoprawnym kształcie", async () => {
      // CHECK formatu nie jest kosmetyką: generator rozbiera istniejące numery
      // przez split_part('-'), więc wiersz o innym kształcie zepsułby
      // numerację wszystkim kolejnym zamówieniom tenanta.
      const tenantId = await createTenant("shape");
      const customerId = await createCustomer(tenantId);

      const { error } = await admin.from("orders").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        order_number: "byle co",
        start_date: "2026-08-01",
        end_date: "2026-08-03",
        delivery_method: "courier",
      });
      expect(error?.code, `numer o złym kształcie przeszedł: ${error?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );
    });
  });

  // -------------------------------------------------------------------
  // 3. CHECK-i warunkowe — testy NEGATYWNE
  // -------------------------------------------------------------------

  describe("zależności między kolumnami (CHECK-i warunkowe)", () => {
    it("odbiór osobisty bez punktu odbioru jest odrzucany", async () => {
      const tenantId = await createTenant("pickup");
      const customerId = await createCustomer(tenantId);

      const { error } = await admin.from("orders").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        start_date: "2026-08-01",
        end_date: "2026-08-03",
        delivery_method: "pickup",
      });
      expect(
        error?.code,
        `zamówienie 'pickup' bez pickup_location_id przeszło: ${error?.message}`,
      ).toBe(PG_CHECK_VIOLATION);
    });

    it("odbiór osobisty ze wskazanym punktem przechodzi", async () => {
      // Para do testu wyżej: dowodzi, że CHECK odrzuca brakujący punkt, a nie
      // metodę 'pickup' w ogóle (odmowa zawsze byłaby też „zielona").
      const tenantId = await createTenant("pickup-ok");
      const customerId = await createCustomer(tenantId);
      const { data: location, error: locationError } = await admin
        .from("pickup_locations")
        .insert({ tenant_id: tenantId, name: "Magazyn główny" })
        .select("id")
        .single();
      expect(locationError?.message, `INSERT punktu odbioru: ${locationError?.message}`).toBeUndefined();

      const { error } = await admin.from("orders").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        start_date: "2026-08-01",
        end_date: "2026-08-03",
        delivery_method: "pickup",
        pickup_location_id: location!.id,
      });
      expect(error?.message, `poprawne zamówienie 'pickup' zostało odrzucone: ${error?.message}`).toBeUndefined();
    });

    it("potrącenie z kaucji bez strukturalnego powodu jest odrzucane (0011)", async () => {
      // 0007 wymagał przy 'deducted' niepustego reason; 0011 zastępuje ten
      // wymóg kodem powodu (reason_code). Pełną macierz kształtu i niezmiennik
      // salda dowodzi deposit-gates.test.ts — tu zostaje dowód zależności
      // warunkowej CHECK-a, spójny z resztą tej sekcji.
      const tenantId = await createTenant("deduct");
      const customerId = await createCustomer(tenantId);
      const { data: order } = await admin
        .from("orders")
        .insert({
          tenant_id: tenantId,
          customer_id: customerId,
          start_date: "2026-08-01",
          end_date: "2026-08-03",
          delivery_method: "courier",
        })
        .select("id")
        .single();

      // Saldo na zapas: potrącenie/zwrot niżej mają dowodzić CHECK-a powodu,
      // nie potykać się o niezmiennik sumy z triggera 0011.
      const { error: collectError } = await admin.from("deposit_events").insert({
        tenant_id: tenantId,
        order_id: order!.id,
        kind: "collected",
        amount_grosze: 20_000,
      });
      expect(collectError?.message, `pobranie kaucji odrzucone: ${collectError?.message}`).toBeUndefined();

      // Sam tekst już nie wystarcza — powód musi być daną (kodem z listy).
      const { error } = await admin.from("deposit_events").insert({
        tenant_id: tenantId,
        order_id: order!.id,
        kind: "deducted",
        amount_grosze: 5_000,
        reason: "uszkodzona obudowa",
      });
      expect(error?.code, `potrącenie bez kodu powodu przeszło: ${error?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );

      // 'other' wymaga doprecyzowania, a pusty/biały tekst to to samo co brak
      // — inaczej wymóg obchodzi się spacją i pole przestaje cokolwiek znaczyć.
      const { error: blankError } = await admin.from("deposit_events").insert({
        tenant_id: tenantId,
        order_id: order!.id,
        kind: "deducted",
        amount_grosze: 5_000,
        reason_code: "other",
        reason: "   ",
      });
      expect(blankError?.code, `potrącenie 'other' z pustym doprecyzowaniem przeszło: ${blankError?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );

      // Zwrot kodu nie wymaga — dowód, że CHECK celuje w 'deducted'.
      const { error: refundError } = await admin.from("deposit_events").insert({
        tenant_id: tenantId,
        order_id: order!.id,
        kind: "refunded",
        amount_grosze: 5_000,
      });
      expect(refundError?.message, `zwrot kaucji bez powodu został odrzucony: ${refundError?.message}`).toBeUndefined();
    });

    it("niepełne okno niedostępności egzemplarza jest odrzucane", async () => {
      const tenantId = await createTenant("unavail");
      const { data: product } = await admin
        .from("products")
        .insert({ tenant_id: tenantId, name: "Zagęszczarka", base_price_day_grosze: 15_000 })
        .select("id")
        .single();

      for (const [label, window] of [
        ["from bez to", { unavailable_from: "2026-08-01" }],
        ["to bez from", { unavailable_to: "2026-08-05" }],
      ] as const) {
        const { error } = await admin
          .from("product_units")
          .insert({ tenant_id: tenantId, product_id: product!.id, ...window });
        expect(error?.code, `niedostępność „${label}" przeszła: ${error?.message}`).toBe(
          PG_CHECK_VIOLATION,
        );
      }

      // Zakres odwrócony (koniec przed początkiem) też jest nie do obsłużenia
      // przez silnik dostępności.
      const { error: reversedError } = await admin.from("product_units").insert({
        tenant_id: tenantId,
        product_id: product!.id,
        unavailable_from: "2026-08-05",
        unavailable_to: "2026-08-01",
      });
      expect(reversedError?.code, `odwrócony zakres przeszedł: ${reversedError?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );

      // Okno jednodniowe (from = to) jest poprawne — zakres jest INCLUSIVE.
      const { error: sameDayError } = await admin.from("product_units").insert({
        tenant_id: tenantId,
        product_id: product!.id,
        unavailable_from: "2026-08-01",
        unavailable_to: "2026-08-01",
      });
      expect(
        sameDayError?.message,
        `jednodniowe okno niedostępności zostało odrzucone — zakres nie jest inclusive: ${sameDayError?.message}`,
      ).toBeUndefined();
    });

    it("zamówienie kończące się przed rozpoczęciem jest odrzucane, jednodniowe przechodzi", async () => {
      const tenantId = await createTenant("dates");
      const customerId = await createCustomer(tenantId);

      const { error } = await admin.from("orders").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        start_date: "2026-08-05",
        end_date: "2026-08-01",
        delivery_method: "courier",
      });
      expect(error?.code, `zamówienie z odwróconym zakresem przeszło: ${error?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );

      // start = end to najem JEDNODNIOWY, nie zerowy — zakres jest inclusive.
      const { error: sameDayError } = await admin.from("orders").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        start_date: "2026-08-01",
        end_date: "2026-08-01",
        delivery_method: "courier",
      });
      expect(
        sameDayError?.message,
        `najem jednodniowy odrzucony — zakres nie jest inclusive: ${sameDayError?.message}`,
      ).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // 4. Spójność tenanta na kluczach obcych
  // -------------------------------------------------------------------

  it("pozycja zamówienia nie wskaże zamówienia innego tenanta", async () => {
    // Bramka, której RLS NIE zapewnia: polityki sprawdzają tenant_id
    // WSTAWIANEGO wiersza, a ten jest tu poprawny — cudzy jest dopiero
    // rodzic. Odrzucenie musi więc przyjść z klucza złożonego
    // (tenant_id, order_id) → orders (tenant_id, id), a nie z polityki.
    const [victimId, attackerId] = await Promise.all([
      createTenant("fk-victim"),
      createTenant("fk-attacker"),
    ]);
    const victimCustomer = await createCustomer(victimId!);
    const { data: victimOrder } = await admin
      .from("orders")
      .insert({
        tenant_id: victimId!,
        customer_id: victimCustomer,
        start_date: "2026-08-01",
        end_date: "2026-08-03",
        delivery_method: "courier",
      })
      .select("id")
      .single();

    const { data: attackerProduct } = await admin
      .from("products")
      .insert({ tenant_id: attackerId!, name: "Wiertarka", base_price_day_grosze: 5_000 })
      .select("id")
      .single();

    const { error } = await admin.from("order_items").insert({
      tenant_id: attackerId!,
      order_id: victimOrder!.id,
      product_id: attackerProduct!.id,
      rental_grosze: 1,
    });
    expect(
      error?.code,
      `pozycja podpięła się pod zamówienie innego tenanta: ${error?.message}`,
    ).toBe(PG_FOREIGN_KEY_VIOLATION);
  });

  it("zamówienie nie wskaże klienta innego tenanta", async () => {
    const [victimId, attackerId] = await Promise.all([
      createTenant("fk-cust-victim"),
      createTenant("fk-cust-attacker"),
    ]);
    const victimCustomer = await createCustomer(victimId!);

    const { error } = await admin.from("orders").insert({
      tenant_id: attackerId!,
      customer_id: victimCustomer,
      start_date: "2026-08-01",
      end_date: "2026-08-03",
      delivery_method: "courier",
    });
    expect(error?.code, `zamówienie podpięło klienta innego tenanta: ${error?.message}`).toBe(
      PG_FOREIGN_KEY_VIOLATION,
    );
  });
});
