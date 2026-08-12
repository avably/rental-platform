/**
 * Taksonomia katalogu w panelu (ADR-155) — trzy mechanizmy, każdy z dowodem
 * z OBU stron.
 *
 *  1. WALIDACJA SLUGA. Bramką jest baza (trigger 0072), ale formularz ma
 *     powiedzieć operatorowi, co jest nie tak, ZANIM tam trafi: slug
 *     zarezerwowany, slug o złym kształcie i slug WYPROWADZONY z nazwy.
 *     Kontrola pozytywna („zwykły przechodzi") stoi obok każdej odmowy —
 *     schemat, który odrzuca wszystko, wygląda jak schemat, który działa.
 *
 *  2. RÓŻNICA PRZYPISAŃ. `syncProductCategories` ma dokładać i zdejmować
 *     WYŁĄCZNIE to, co się zmieniło. Test sprawdza także przypadek, w którym
 *     nie zmieniło się nic — wtedy do bazy nie może pójść ANI JEDEN zapis
 *     (inaczej każdy zapis produktu przepisywałby przypisania, a strona
 *     kategorii widziałaby produkt na moment zniknięty z oferty).
 *
 *  3. KOLUMNA `categories` W CSV. Opcjonalna: plik bez niej nie mówi nic
 *     o kategoriach (klucz nie idzie do bazy → przypisania nietknięte), plik
 *     z pustą komórką mówi „bez kategorii" (klucz idzie jako pusta tablica).
 *     Rozróżnienia null vs [] pilnuje osobny przypadek, bo to jest różnica
 *     między „nie ruszaj" a „skasuj".
 */
import { describe, expect, it } from "vitest";

import { categorySchema, productCategoryIdsSchema } from "@/lib/catalog-validation";
import { syncProductCategories } from "@/lib/catalog/categories";
import { CATALOG_CSV_CATEGORIES_COLUMN, CATALOG_CSV_HEADER } from "@/lib/export/catalog";
import { CSV_BOM } from "@/lib/export/csv";
import { parseCatalogCsv } from "@/lib/import/catalog-csv";

// ---------------------------------------------------------------------
// 1. Walidacja formularza kategorii
// ---------------------------------------------------------------------

const form = (overrides: Record<string, string> = {}) => ({
  name: "Namioty",
  slug: "",
  description: "",
  ...overrides,
});

function slugErrorOf(input: Record<string, string>): string | undefined {
  const parsed = categorySchema.safeParse(input);
  if (parsed.success) return undefined;
  return parsed.error.issues.find((issue) => issue.path[0] === "slug")?.message;
}

describe("categorySchema (ADR-155)", () => {
  it("pusty adres jest WYPROWADZANY z nazwy, także z polskich znaków", () => {
    const parsed = categorySchema.safeParse(form({ name: "Łódki i kajaki" }));
    expect(parsed.success, "nazwa z diakrytykami odrzucona").toBe(true);
    expect(parsed.success && parsed.data.slug).toBe("lodki-i-kajaki");
  });

  it("adres wpisany ręcznie wygrywa z nazwą (operator ma ostatnie słowo)", () => {
    const parsed = categorySchema.safeParse(form({ name: "Namioty", slug: "namioty-2024" }));
    expect(parsed.success && parsed.data.slug).toBe("namioty-2024");
  });

  it.each(["checkout", "cart", "product", "store", "regulamin", "pl", "kategoria"])(
    "adres `%s` jest odrzucony jako zarezerwowany, z nazwą adresu w komunikacie",
    (slug) => {
      const message = slugErrorOf(form({ slug }));
      expect(message, `adres \`${slug}\` przeszedł walidację formularza`).toBeDefined();
      expect(message).toContain(slug);
    },
  );

  it("odrzuca kształt, którego adres nie uniesie — i podaje przykład poprawnego", () => {
    const message = slugErrorOf(form({ slug: "Namioty Duże" }));
    expect(message, "adres ze spacjami i wielkimi literami przeszedł").toBeDefined();
    expect(message).toContain("namioty-rodzinne");
  });

  it("nazwa, z której nie da się zbudować adresu, kończy się odmową PRZY ADRESIE", () => {
    // Bez tego operator dostałby komunikat „podaj nazwę" przy polu, które
    // wypełnił — a brakuje mu adresu, nie nazwy.
    const message = slugErrorOf(form({ name: "🏕️🏕️", slug: "" }));
    expect(message).toBeDefined();
  });

  it("KONTROLA POZYTYWNA: zwykła kategoria przechodzi w całości", () => {
    const parsed = categorySchema.safeParse(
      form({ name: "Namioty rodzinne", slug: "namioty-rodzinne", description: "Na wyjazd" }),
    );
    expect(parsed.success, "poprawna kategoria została odrzucona").toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      name: "Namioty rodzinne",
      slug: "namioty-rodzinne",
      // Puste pole opisu → NULL: baza rozróżnia „bez opisu" od pustego napisu.
      description: "Na wyjazd",
    });
  });

  it("pusty opis staje się NULL-em, nie pustym napisem", () => {
    const parsed = categorySchema.safeParse(form({ description: "   " }));
    expect(parsed.success && parsed.data.description).toBeNull();
  });

  it("productCategoryIdsSchema: puste zaznaczenie jest POPRAWNE, śmieć nie", () => {
    expect(productCategoryIdsSchema.safeParse([]).success).toBe(true);
    expect(productCategoryIdsSchema.safeParse(["nie-uuid"]).success).toBe(false);
  });
});

// ---------------------------------------------------------------------
// 2. Różnica przypisań
// ---------------------------------------------------------------------

interface RecordedCall {
  op: "delete" | "insert";
  ids: string[];
}

/**
 * Minimalna atrapa klienta Supabase pokrywająca DOKŁADNIE te wywołania,
 * których używa `syncProductCategories`. Atrapa zamiast żywej bazy, bo
 * przedmiotem testu jest RÓŻNICA, a nie RLS (ten ma własną macierz).
 */
function fakeSupabase(current: string[], calls: RecordedCall[]) {
  const deleteBuilder = () => {
    const chain = {
      eq: () => chain,
      in: (_column: string, ids: string[]) => {
        calls.push({ op: "delete", ids: [...ids].sort() });
        return Promise.resolve({ error: null });
      },
    };
    return chain;
  };

  const selectBuilder = () => {
    const chain = {
      eq: () => chain,
      then: (resolve: (value: { data: { category_id: string }[]; error: null }) => unknown) =>
        resolve({ data: current.map((id) => ({ category_id: id })), error: null }),
    };
    return chain;
  };

  return {
    from: () => ({
      select: selectBuilder,
      delete: deleteBuilder,
      insert: (rows: { category_id: string }[]) => {
        calls.push({ op: "insert", ids: rows.map((row) => row.category_id).sort() });
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as Parameters<typeof syncProductCategories>[0];
}

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("syncProductCategories — różnica, nie pełna wymiana", () => {
  it("dokłada brakujące i zdejmuje zdjęte, jednym zapisem na kierunek", async () => {
    const calls: RecordedCall[] = [];
    const error = await syncProductCategories(fakeSupabase([A, B], calls), "t", "p", [B, C]);

    expect(error).toBeNull();
    expect(calls).toEqual([
      { op: "delete", ids: [A] },
      { op: "insert", ids: [C] },
    ]);
  });

  it("gdy nic się nie zmieniło, do bazy NIE IDZIE ani jeden zapis", async () => {
    const calls: RecordedCall[] = [];
    const error = await syncProductCategories(fakeSupabase([A, B], calls), "t", "p", [B, A]);

    expect(error).toBeNull();
    expect(calls, "zapis produktu przepisał niezmienione przypisania").toEqual([]);
  });

  it("puste zaznaczenie zdejmuje WSZYSTKIE przypisania (i nic nie wstawia)", async () => {
    const calls: RecordedCall[] = [];
    const error = await syncProductCategories(fakeSupabase([A, B], calls), "t", "p", []);

    expect(error).toBeNull();
    expect(calls).toEqual([{ op: "delete", ids: [A, B].sort() }]);
  });
});

// ---------------------------------------------------------------------
// 3. Kolumna `categories` w formacie wymiany
// ---------------------------------------------------------------------

const BASE_FIELDS: Record<string, string> = {
  name: "Agregat",
  base_price_day_grosze: "10000",
  deposit_grosze: "5000",
  auto_increment_multiplier: "1.0",
  buffer_before_days: "1",
  buffer_after_days: "1",
  active: "true",
};

/** Plik w formacie eksportu, opcjonalnie z kolumną kategorii. */
function csv(options: { categories?: string; withColumn: boolean }): string {
  const columns = options.withColumn
    ? [...CATALOG_CSV_HEADER, CATALOG_CSV_CATEGORIES_COLUMN]
    : [...CATALOG_CSV_HEADER];
  const values = columns.map((column) =>
    column === CATALOG_CSV_CATEGORIES_COLUMN ? (options.categories ?? "") : (BASE_FIELDS[column] ?? ""),
  );
  return `${CSV_BOM}${[columns.join(";"), values.join(";")].join("\r\n")}\r\n`;
}

describe("kolumna `categories` w imporcie CSV (ADR-155)", () => {
  it("plik BEZ kolumny nie mówi nic o kategoriach (null, nie pusta tablica)", () => {
    const result = parseCatalogCsv(csv({ withColumn: false }), []);
    expect(result.issues, "plik sprzed 0072 przestał się wczytywać").toEqual([]);
    expect(
      result.products[0]!.categories,
      "brak kolumny został odczytany jako „produkt bez kategorii”",
    ).toBeNull();
  });

  it("pusta komórka znaczy „bez kategorii” — pusta tablica, nie null", () => {
    const result = parseCatalogCsv(csv({ withColumn: true, categories: "" }), []);
    expect(result.issues).toEqual([]);
    expect(result.products[0]!.categories).toEqual([]);
  });

  it("czyta slugi rozdzielone kreską, normalizuje wielkość liter i usuwa powtórki", () => {
    const result = parseCatalogCsv(
      csv({ withColumn: true, categories: " Namioty | namioty |kajaki| " }),
      [],
    );
    expect(result.issues).toEqual([]);
    expect(result.products[0]!.categories).toEqual(["namioty", "kajaki"]);
  });

  it("slug o kształcie, którego adres nie uniesie, jest błędem WIERSZA z numerem", () => {
    const result = parseCatalogCsv(csv({ withColumn: true, categories: "Namioty Duże" }), []);
    expect(result.issues).toEqual([
      {
        row: 2,
        code: "badCategorySlug",
        column: CATALOG_CSV_CATEGORIES_COLUMN,
        value: "Namioty Duże",
      },
    ]);
    expect(result.products, "wiersz z błędem mimo to trafił do zapisu").toEqual([]);
  });
});
