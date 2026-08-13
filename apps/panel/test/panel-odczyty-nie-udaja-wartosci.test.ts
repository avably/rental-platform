/**
 * NIEUDANY ODCZYT NIE UDAJE WIARYGODNEJ WARTOŚCI (ADR-174, klasa błędu z ADR-165).
 *
 * Wspólne wszystkim trzem modułom: destrukturyzowały wyłącznie `data`, więc
 * awaria bazy była NIEODRÓŻNIALNA od poprawnej pustki — i obie ścieżki kończyły
 * się wartością, która wygląda na prawdziwą. To nie jest brakujący warunek,
 * tylko odczyt, który połyka własny błąd i odpowiada na pytanie, którego mu nie
 * zadano („nie masz sprzętu" zamiast „nie udało się przeczytać katalogu").
 *
 * Każdy moduł ma tu PARĘ zdań, i to jest cały sens tego pliku:
 *
 *   • odczyt, który PADŁ, kończy się wyjątkiem z nazwą tego, co czytał;
 *   • odczyt, który zastał PUSTO, dalej odpowiada po cichu i poprawnie.
 *
 * Bez drugiego zdania naprawa pierwszego byłaby nową wadą: świeży najemca bez
 * sprzętu, bez waluty i bez wyglądu jest stanem normalnym, a nie awarią.
 *
 * NAJGROŹNIEJSZY JEST WYGLĄD. Po ADR-161 `style_draft` opisuje wygląd CAŁEGO
 * sklepu, a płótno jest jedynym miejscem, w którym operator go widzi. Domyślny
 * motyw po nieudanym odczycie czyta się jako „straciłem wygląd sklepu",
 * a naprawą, którą operator ma pod ręką, jest ustawienie motywu od nowa —
 * czyli NADPISANIE wartości, która w bazie stoi nietknięta. Pozostałe pozycje
 * mylą; ta jedna kasuje pracę ręką samego operatora.
 */
import { DEFAULT_CURRENCY } from "@avably/core";
import { DEFAULT_SITE_STYLE } from "@avably/core/site";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AWARIA = { code: "42501", message: "permission denied for table" };

/* ============================ ATRAPA POSTGREST ============================
 *
 * Atrapa oddaje `{ data, error }` w kształcie klienta Supabase i pozwala
 * wstrzyknąć awarię PER TABELA — inaczej nie dałoby się odróżnić modułu, który
 * błąd obsłużył, od modułu, do którego zapytanie w ogóle nie doszło.
 */

interface Row {
  [column: string]: unknown;
}

const store = {
  tables: {} as Record<string, Row[]>,
  failing: null as string | null,
};

function queryFor(table: string) {
  const wynik = () =>
    store.failing === table
      ? { data: null, error: AWARIA }
      : { data: store.tables[table] ?? [], error: null };

  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => {
      const { data, error } = wynik();
      return error ? { data: null, error } : { data: (data as Row[])[0] ?? null, error: null };
    },
    then: (resolve: (value: { data: Row[] | null; error: unknown }) => unknown) =>
      Promise.resolve(wynik()).then(resolve),
  };
  return builder;
}

const supabase = { from: (table: string) => queryFor(table) } as unknown as SupabaseClient;

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "pl"),
  getTranslations: vi.fn(async () => (key: string, values?: Record<string, unknown>) =>
    `${key}:${JSON.stringify(values ?? {})}`,
  ),
}));

vi.mock("@/lib/custom-fields", () => ({ loadCustomFieldDefinitions: vi.fn(async () => []) }));

const { getTenantDraftStyle } = await import("@/lib/tenant-appearance");
const { getTenantCurrency } = await import("@/lib/tenant-currency");
const { previewProductsFor } = await import("@/lib/site-preview-data");

type Ctx = Parameters<typeof previewProductsFor>[0];
const ctx = { supabase, tenantId: TENANT_ID } as unknown as Ctx;

beforeEach(() => {
  store.failing = null;
  store.tables = {
    tenants: [{ id: TENANT_ID, template: null, style_draft: null, locale: "pl" }],
    tenant_settings: [],
    products: [],
    product_images: [],
  };
});

/* ============================ WYGLĄD SKLEPU ============================ */

describe("wygląd sklepu (getTenantDraftStyle) — jedyna pozycja z ryzykiem UTRATY danych", () => {
  it("nieudany odczyt RZUCA, zamiast oddać domyślny wygląd całego sklepu", async () => {
    store.failing = "tenants";

    await expect(
      getTenantDraftStyle(supabase, TENANT_ID),
      "awaria odczytu wróciła jako domyślny motyw — operator uzna, że stracił wygląd, i nadpisze prawdziwy",
    ).rejects.toThrow(/Odczyt wyglądu sklepu nie powiódł się/);
  });

  it("brak wiersza najemcy też RZUCA — po bramce członkostwa nie jest to legalna pustka", async () => {
    store.tables.tenants = [];

    await expect(getTenantDraftStyle(supabase, TENANT_ID)).rejects.toThrow(
      /Odczyt wyglądu sklepu nie powiódł się/,
    );
  });

  it("PUSTE kolumny wyglądu zostają stanem cichym — świeży najemca dostaje motyw domyślny", async () => {
    // Kontrola „nie zamień «nie ma» w «awaria»": wiersz JEST, kolumny puste.
    // To jest każdy najemca zaraz po rejestracji.
    await expect(getTenantDraftStyle(supabase, TENANT_ID)).resolves.toEqual(DEFAULT_SITE_STYLE);
  });
});

/* ============================== WALUTA ============================== */

describe("waluta najemcy (getTenantCurrency)", () => {
  it("nieudany odczyt RZUCA, zamiast podpisać cały cennik walutą domyślną", async () => {
    store.failing = "tenant_settings";

    await expect(
      getTenantCurrency(supabase, TENANT_ID),
      "awaria odczytu wróciła jako PLN — najemca rozliczający się w EUR dostaje cennik w cudzej walucie",
    ).rejects.toThrow(/Odczyt waluty najemcy nie powiódł się/);
  });

  it("BRAK ustawienia zostaje stanem cichym — nieustawiona waluta to poprawnie PLN", async () => {
    await expect(getTenantCurrency(supabase, TENANT_ID)).resolves.toBe(DEFAULT_CURRENCY);
  });

  it("ustawiona waluta wraca nietknięta — kontrola po niepustym zbiorze", async () => {
    store.tables.tenant_settings = [{ tenant_id: TENANT_ID, key: "currency", value: "EUR" }];

    await expect(getTenantCurrency(supabase, TENANT_ID)).resolves.toBe("EUR");
  });
});

/* ======================= KATALOG I ZDJĘCIA DO PODGLĄDU ======================= */

describe("katalog na płótno (previewProductsFor)", () => {
  it("nieudany odczyt KATALOGU RZUCA, zamiast pokazać „nie masz sprzętu”", async () => {
    store.failing = "products";

    await expect(
      previewProductsFor(ctx, TENANT_ID),
      "awaria odczytu wróciła jako pusty katalog — operator dostaje odpowiedź o swoim sprzęcie tam, gdzie padła odpowiedź o odczycie",
    ).rejects.toThrow(/Odczyt katalogu do podglądu nie powiódł się/);
  });

  it("nieudany odczyt ZDJĘĆ RZUCA — element związany ze zdjęciem rysuje się bez wartości jako WYCIĘTY", async () => {
    store.failing = "product_images";
    store.tables.products = [
      { id: "p1", name: "Rower", description: null, base_price_day_grosze: 5000, custom_fields: null },
    ];

    await expect(previewProductsFor(ctx, TENANT_ID)).rejects.toThrow(
      /Odczyt zdjęć sprzętu do podglądu nie powiódł się/,
    );
  });

  it("PUSTY katalog zostaje stanem cichym — najemca bez sprzętu dostaje pustą listę, nie wyjątek", async () => {
    await expect(previewProductsFor(ctx, TENANT_ID)).resolves.toEqual([]);
  });

  it("katalog BEZ zdjęć zostaje stanem cichym — kafel bez fotografii jest legalny", async () => {
    store.tables.products = [
      { id: "p1", name: "Rower", description: null, base_price_day_grosze: 5000, custom_fields: null },
    ];

    const products = await previewProductsFor(ctx, TENANT_ID);
    expect(products).toHaveLength(1);
    expect(products[0]!.imageUrl, "brak zdjęcia przestał być stanem cichym").toBeNull();
  });
});
