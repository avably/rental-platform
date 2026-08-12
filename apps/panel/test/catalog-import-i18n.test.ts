/**
 * i18n importu katalogu: `codes.badCustomField` / `codes.unknownCustomField`
 * renderują się jako ZDANIE, nie surowa ścieżka klucza (round-3, #B).
 *
 * ==================== CO ZŁAPAŁA RECENZJA PM ====================
 *
 * `apps/panel/lib/import/import-catalog.ts` (catch 23514) i `catalog-csv.ts`
 * (kolumna `cf_*` bez żywej definicji / wartość niezgodna z definicją) emitują
 * kody `badCustomField`/`unknownCustomField`, ale namespace `catalogImport.codes`
 * w `messages/pl.json`/`en.json` kończył się na `unknownProduct` — next-intl BEZ
 * niestandardowego `onError` nie rzuca w runtime, tylko cicho oddaje ŚCIEŻKĘ
 * KLUCZA jako tekst zastępczy (`getMessageFallback`), więc operator widział
 * dosłownie "catalogImport.codes.badCustomField" zamiast zdania.
 *
 * Test woła `issueMessage` — DOKŁADNIE tę funkcję, której używa
 * `import-wizard.tsx` do renderowania listy błędów (wyeksportowana z komponentu
 * wyłącznie na potrzeby tego testu) — z PRAWDZIWYM `createTranslator` (next-intl,
 * ten sam silnik co `useTranslations`/`getTranslations` w produkcji) na
 * PRAWDZIWYCH plikach wiadomości. Nie zgaduje po samym istnieniu klucza w JSON-ie
 * i nie powiela logiki wywołania — używa produkcyjnego kodu 1:1.
 */
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import type { CatalogImportIssue } from "@/lib/import/catalog-csv";

import { issueMessage } from "../app/[locale]/(panel)/katalog/import/import-wizard";
import en from "../messages/en.json";
import pl from "../messages/pl.json";

const CATALOGS = { pl, en } as const;
const RAW_PATH_PREFIX = "catalogImport.codes.";

/**
 * Translator jak w produkcji, ale `onError` PALI test zamiast cicho oddać
 * ścieżkę klucza. `createTranslator` (użyty tu, bo działa bez kontekstu
 * Reacta) i `useTranslations` (użyty przez `issueMessage` w produkcji) mają
 * strukturalnie inne typy — next-intl generuje dla `useTranslations` typ
 * "Messages" z `.next/types` przez parsowanie ICU wiadomości NA POZIOMIE
 * TYPÓW. Za runtime odpowiada dokładnie ten sam silnik (`use-intl/core`) na
 * tych samych plikach JSON, więc rzutowanie tu jest bezpieczne — sprawdzone
 * dowodem mutacyjnym w tym pliku.
 */
function strictTranslator(locale: keyof typeof CATALOGS): Parameters<typeof issueMessage>[0] {
  return createTranslator({
    locale,
    messages: CATALOGS[locale],
    namespace: "catalogImport",
    onError: (error) => {
      throw new Error(`i18n "${locale}": ${error.message}`);
    },
  }) as unknown as Parameters<typeof issueMessage>[0];
}

describe("catalogImport.codes — badCustomField/unknownCustomField renderują się jako zdanie", () => {
  it.each(Object.keys(CATALOGS) as (keyof typeof CATALOGS)[])(
    "%s: 23514 po scaleniu (badCustomField, bez row/column — problem plikowy) renderuje zdanie",
    (locale) => {
      const t = strictTranslator(locale);
      // Kształt DOKŁADNIE taki, jaki emituje `import-catalog.ts` po 23514: bez
      // `row` (round-3, #B) i bez `column` (błąd dotyczy całej mapy po scaleniu).
      const issue: CatalogImportIssue = {
        code: "badCustomField",
        value: ">8192B po scaleniu z zapisanymi wartościami",
      };

      const rendered = issueMessage(t, issue);

      expect(rendered.startsWith(RAW_PATH_PREFIX)).toBe(false);
      expect(rendered.trim().length).toBeGreaterThan(0);
    },
  );

  it.each(Object.keys(CATALOGS) as (keyof typeof CATALOGS)[])(
    "%s: badCustomField z wiersza parsera (z column/value) renderuje zdanie",
    (locale) => {
      const t = strictTranslator(locale);
      const issue: CatalogImportIssue = {
        row: 5,
        code: "badCustomField",
        column: "cf_11111111-1111-4111-8111-111111111111",
        value: "banan",
      };

      const rendered = issueMessage(t, issue);

      expect(rendered.startsWith(RAW_PATH_PREFIX)).toBe(false);
      expect(rendered.trim().length).toBeGreaterThan(0);
    },
  );

  it.each(Object.keys(CATALOGS) as (keyof typeof CATALOGS)[])(
    "%s: unknownCustomField (ścieżka podglądu, dług preegzystujący) renderuje zdanie",
    (locale) => {
      const t = strictTranslator(locale);
      const issue: CatalogImportIssue = {
        row: 1,
        code: "unknownCustomField",
        column: "cf_deadbeef",
      };

      const rendered = issueMessage(t, issue);

      expect(rendered.startsWith(RAW_PATH_PREFIX)).toBe(false);
      expect(rendered.trim().length).toBeGreaterThan(0);
    },
  );

  // KATEGORIE (ADR-155) — dwa kody dołożone razem z kolumną `categories`.
  // Ta sama pułapka co wyżej: brak klucza w messages nie rzuca w runtime,
  // tylko wypisuje operatorowi ścieżkę „catalogImport.codes.unknownCategory".
  it.each(Object.keys(CATALOGS) as (keyof typeof CATALOGS)[])(
    "%s: badCategorySlug (kształt slugu z pliku) renderuje zdanie z adresem",
    (locale) => {
      const t = strictTranslator(locale);
      const issue: CatalogImportIssue = {
        row: 3,
        code: "badCategorySlug",
        column: "categories",
        value: "Namioty Duże",
      };

      const rendered = issueMessage(t, issue);

      expect(rendered.startsWith(RAW_PATH_PREFIX)).toBe(false);
      // Wartość MUSI dojść do zdania: bez niej operator z arkuszem na 300
      // pozycji nie wie, którą komórkę poprawić.
      expect(rendered).toContain("Namioty Duże");
    },
  );

  it.each(Object.keys(CATALOGS) as (keyof typeof CATALOGS)[])(
    "%s: unknownCategory (slug spoza katalogu najemcy) renderuje zdanie z adresem",
    (locale) => {
      const t = strictTranslator(locale);
      const issue: CatalogImportIssue = {
        row: 7,
        code: "unknownCategory",
        column: "categories",
        value: "namioty-rodzinne",
      };

      const rendered = issueMessage(t, issue);

      expect(rendered.startsWith(RAW_PATH_PREFIX)).toBe(false);
      expect(rendered).toContain("namioty-rodzinne");
    },
  );

  it.each(Object.keys(CATALOGS) as (keyof typeof CATALOGS)[])(
    "%s: issueFile (etykieta problemu plikowego, zastępuje mylący 'Wiersz 1') istnieje i jest niepusta",
    (locale) => {
      const t = strictTranslator(locale);

      expect(t("issueFile").trim().length).toBeGreaterThan(0);
    },
  );
});
