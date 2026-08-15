/**
 * DOSTĘPNOŚĆ NIE PRZECHODZI PRZEZ CACHE KATALOGU — BRAMKA (ADR-186, R4).
 *
 * ==================== CZEGO PILNUJE I DLACZEGO WŁAŚNIE TAK ====================
 *
 * ADR-185 postawił cache międzyżądaniowy na kopercie katalogu i zapisał obok
 * zakaz: dostępność (0081) przez ten cache NIE PRZECHODZI, bo liczy się per
 * termin i zmienia przy każdej rezerwacji — a zbuforowana dostępność to
 * PODWÓJNY WYNAJEM, czyli sprzęt obiecany dwóm klientom na te same dni.
 *
 * Do fazy 4b ten zakaz był WYŁĄCZNIE komentarzem w nagłówku
 * `lib/catalog/catalog-cache.ts`. Żaden test nie wiązał dostępności z cache,
 * więc regresja w tę stronę przechodziła niezauważona — a jej skutek widać
 * dopiero przy wydaniu sprzętu.
 *
 * ==================== BRAMKA MIERZY SKUTEK, NIE OBECNOŚĆ IMPORTU ====================
 *
 * Licznik stoi na KLIENCIE SUPABASE, czyli w miejscu, w którym pytanie
 * naprawdę wychodzi z procesu — nie na wywołaniu funkcji warstwy danych.
 * Różnica jest cała: bramka pytająca „czy `availability.ts` importuje
 * `catalog-cache`" przechodzi na zielono po mutacji, która przenosi
 * buforowanie o jedno piętro niżej (do `lib/checkout/catalog.ts`) albo pod inną
 * nazwą. Ta bramka pyta o rachunek: DWA pytania o dostępność w tym samym
 * terminie mają dać DWA wyjścia do bazy.
 *
 * ==================== KONTROLA POZYTYWNA JEST WARUNKIEM SENSU ====================
 *
 * Sam przypadek „poszło dwa razy" byłby zielony także wtedy, gdyby przyrząd
 * w ogóle nie umiał zobaczyć stłumienia zapytania — więc TYM SAMYM licznikiem
 * mierzymy katalog, który przez cache przechodzi: dwa odczyty katalogu dają
 * JEDNO wyjście do bazy. Dopiero na tym tle „dostępność poszła dwa razy" jest
 * zdaniem o dostępności, a nie o zepsutym liczniku.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const START = "2027-05-10";
const END = "2027-05-14";

/** Każde wywołanie RPC, które przekroczyło granicę warstwy danych. */
const wywolania: { fn: string; args: Record<string, unknown> }[] = [];

const headerValue = { current: TENANT_A as string | null };

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => (name === "x-tenant-id" ? headerValue.current : null),
  }),
}));

/**
 * ATRAPA KLIENTA, NIE ATRAPA WARSTWY DANYCH. Podmieniamy najgłębszy punkt
 * przed siecią, więc CAŁY łańcuch produkcyjny (akcja → `lib/checkout/catalog`
 * → klient) wykonuje się naprawdę. Buforowanie dołożone w dowolnym ogniwie
 * tego łańcucha zniknie z licznika i zapali test.
 */
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    schema: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        wywolania.push({ fn, args });
        if (fn === "get_public_catalog_availability") return { data: { products: [] }, error: null };
        if (fn === "get_public_availability") {
          return { data: { available_units: 1, total_units: 2 }, error: null };
        }
        if (fn === "get_public_availability_days") {
          return { data: { total_units: 2, days: {} }, error: null };
        }
        if (fn === "get_public_catalog") {
          return {
            data: {
              tenant: { name: "Wypożyczalnia", locale: "pl", currency: "PLN" },
              custom_fields: [],
              categories: [],
              products: [],
              pickup_locations: [],
              delivery_methods: [],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    }),
  }),
}));

const { checkAvailability, checkAvailabilityDays, checkCatalogAvailability } = await import(
  "@/lib/actions/availability"
);
const { getPublicCatalog } = await import("@/lib/checkout/catalog");
const {
  __resetCatalogCacheForTests,
  getCachedCatalog,
  resolvePublicCatalog,
  setCachedCatalog,
} = await import("@/lib/catalog/catalog-cache");

/** Ile razy dane pytanie NAPRAWDĘ wyszło do bazy w tym przebiegu. */
function ile(fn: string): number {
  return wywolania.filter((wpis) => wpis.fn === fn).length;
}

describe("dostępność nie przechodzi przez cache katalogu (ADR-185, bramka ADR-186)", () => {
  beforeEach(() => {
    wywolania.length = 0;
    headerValue.current = TENANT_A;
    __resetCatalogCacheForTests();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  // -------------------------------------------------------------------
  // 1. KONTROLA POZYTYWNA — przyrząd UMIE zobaczyć stłumione zapytanie
  // -------------------------------------------------------------------
  it("KONTROLA POZYTYWNA: dwa odczyty KATALOGU dają JEDNO wyjście do bazy", async () => {
    const deps = {
      getCache: getCachedCatalog,
      setCache: setCachedCatalog,
      lookup: (id: string) => getPublicCatalog(id),
    };

    await resolvePublicCatalog(TENANT_A, deps);
    await resolvePublicCatalog(TENANT_A, deps);

    expect(
      ile("get_public_catalog"),
      "cache katalogu NIE DZIAŁA — licznik nie potrafi odróżnić buforowania od jego braku, " +
        "więc asercje o dostępności niżej nie mają czego dowodzić",
    ).toBe(1);
  });

  // -------------------------------------------------------------------
  // 2. DOSTĘPNOŚĆ — każde pytanie idzie do bazy
  // -------------------------------------------------------------------
  it("dostępność CAŁEGO katalogu: dwa pytania o TEN SAM termin = dwa wyjścia do bazy", async () => {
    await checkCatalogAvailability(START, END);
    await checkCatalogAvailability(START, END);

    expect(
      ile("get_public_catalog_availability"),
      "dostępność katalogu przeszła przez cache — drugi klient dostaje liczbę wolnych sztuk " +
        "sprzed cudzej rezerwacji, czyli PODWÓJNY WYNAJEM",
    ).toBe(2);
  });

  it("dostępność JEDNEJ pozycji i dostępność DZIENNA też nie są buforowane", async () => {
    const produkt = "33333333-3333-4333-8333-333333333333";

    await checkAvailability(produkt, START, END);
    await checkAvailability(produkt, START, END);
    await checkAvailabilityDays(produkt, START, END);
    await checkAvailabilityDays(produkt, START, END);

    expect(ile("get_public_availability"), "dostępność pozycji przeszła przez cache").toBe(2);
    expect(ile("get_public_availability_days"), "dostępność dzienna przeszła przez cache").toBe(2);
  });

  // -------------------------------------------------------------------
  // 3. ROZGRZANY CACHE KATALOGU NIE ODPOWIADA ZA DOSTĘPNOŚĆ
  // -------------------------------------------------------------------
  it("ciepły cache katalogu nie tłumi ani jednego pytania o dostępność", async () => {
    // Kolejność jest tu istotna: najpierw rozgrzewamy cache katalogu TEGO
    // najemcy, a dopiero potem pytamy o dostępność. Mutant, który dokłada
    // dostępność do koperty trzymanej w cache'u, przechodziłby test, w którym
    // cache jest zimny.
    const deps = {
      getCache: getCachedCatalog,
      setCache: setCachedCatalog,
      lookup: (id: string) => getPublicCatalog(id),
    };
    await resolvePublicCatalog(TENANT_A, deps);
    await resolvePublicCatalog(TENANT_A, deps);
    expect(ile("get_public_catalog"), "rozgrzewka nie doszła do bazy").toBe(1);

    await checkCatalogAvailability(START, END);
    await checkCatalogAvailability(START, END);

    expect(ile("get_public_catalog_availability")).toBe(2);
  });

  // -------------------------------------------------------------------
  // 4. NAJEMCA JEDZIE Z NAGŁÓWKA DO KAŻDEGO PYTANIA O DOSTĘPNOŚĆ
  // -------------------------------------------------------------------
  it("pytanie o dostępność niesie najemcę z nagłówka, a nie z jakiegokolwiek klucza cache", async () => {
    await checkCatalogAvailability(START, END);
    headerValue.current = TENANT_B;
    await checkCatalogAvailability(START, END);

    const najemcy = wywolania
      .filter((w) => w.fn === "get_public_catalog_availability")
      .map((w) => w.args.p_tenant_id);
    expect(najemcy, "dostępność drugiego najemcy przyszła z pytania o pierwszego").toEqual([
      TENANT_A,
      TENANT_B,
    ]);
  });
});
