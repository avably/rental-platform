/**
 * Rdzeń importu katalogu (C3, ADR-112) — plan (podgląd) i wykonanie.
 *
 * Moduł bez Next — testowany na żywej bazie bez warstwy akcji
 * (wzorzec lib/export/*, test/import-csv.test.ts).
 *
 * DWUFAZOWOŚĆ: `planCatalogImport` parsuje plik i sprawdza identyfikatory,
 * NICZEGO nie zapisując — operator widzi podsumowanie (ile nowych, ile
 * aktualizacji, ile progów, błędy z numerami wierszy) ZANIM cokolwiek
 * zostanie nadpisane. `runCatalogImport` powtarza plan na tej samej treści
 * (parser jest deterministyczny, więc podgląd = zapis dla niezmienionego
 * pliku) i dopiero wtedy woła `app.import_catalog` — JEDNĄ funkcję SQL,
 * w której cała partia jest jedną transakcją (migracja 0055, ADR-028).
 *
 * IZOLACJA (dwie warstwy, wzorzec 0054): sprawdzenie istnienia product_id
 * idzie zapytaniem z JAWNYM filtrem `.eq("tenant_id", ctx.tenantId)` — obok
 * RLS sesji. Autorytatywną bramką pozostaje `app.import_catalog` (cudzy id
 * = wyjątek 22023 i rollback), plan daje operatorowi błąd z numerem wiersza
 * zamiast zbiorczej odmowy z bazy.
 */
import { CUSTOM_FIELD_LIMITS } from "@avably/core";

import type { ExportContext } from "../export/common";
import { CSV_CUSTOM_FIELD_PREFIX, loadExportCustomFields } from "../export/custom-fields";
import {
  catalogCsvHeaderColumns,
  parseCatalogCsv,
  type CatalogImportIssue,
  type CatalogImportProduct,
} from "./catalog-csv";

/** Strona odczytu przy sprawdzaniu identyfikatorów (limit PostgREST). */
const ID_CHECK_PAGE_SIZE = 500;

export interface CatalogImportPlan {
  products: CatalogImportProduct[];
  /** ID definicji objętych kolumnami pliku — patrz CatalogImportParseResult. */
  customFieldColumns: string[];
  issues: CatalogImportIssue[];
  /** Liczba wierszy danych w pliku (przed grupowaniem). */
  rowCount: number;
  created: number;
  updated: number;
  tiers: number;
}

export interface CatalogImportOutcome {
  issues: CatalogImportIssue[];
  /** Obecne wyłącznie przy udanym zapisie. */
  result?: { created: number; updated: number; tiers: number };
}

/**
 * Faza 1: parsowanie + walidacja + sprawdzenie identyfikatorów. ZERO zapisu.
 * Rzuca ImportLimitError przy przekroczeniu limitu wierszy.
 */
export async function planCatalogImport(
  ctx: ExportContext,
  text: string,
): Promise<CatalogImportPlan> {
  // Definicje czytamy TYLKO gdy plik w ogóle mówi coś o polach własnych.
  // Plik bez kolumn `cf_*` (np. eksport sprzed dodania pola albo arkusz
  // operatora sprzed C6) niczego o nich nie twierdzi — i ma zostawić
  // zapisane wartości nietknięte, a nie skasować je pustką.
  //
  // Definicje pochodzą z BAZY, nigdy z pliku: to one rozstrzygają, czy
  // kolumna `cf_<id>` jest kolumną tego najemcy. Żywe (bez zarchiwizowanych)
  // — dokładnie ten zbiór, który wystawił eksport katalogu.
  const carriesCustomFields = catalogCsvHeaderColumns(text).some((column) =>
    column.startsWith(CSV_CUSTOM_FIELD_PREFIX),
  );
  const definitions = carriesCustomFields
    ? await loadExportCustomFields(ctx.supabase, ctx.tenantId, "product", {
        includeArchived: false,
      })
    : [];
  const parsed = parseCatalogCsv(text, definitions);
  const issues = [...parsed.issues];
  let created = 0;
  let updated = 0;
  let tiers = 0;

  if (issues.length === 0) {
    const withId = parsed.products.filter((product) => product.productId !== null);
    const known = new Set<string>();
    for (let from = 0; from < withId.length; from += ID_CHECK_PAGE_SIZE) {
      const chunk = withId.slice(from, from + ID_CHECK_PAGE_SIZE);
      const { data, error } = await ctx.supabase
        .from("products")
        .select("id")
        // Jawny filtr tenanta OBOK RLS (tarcza M1) — klient o szerszych
        // uprawnieniach nie może „uznać" cudzego produktu za własny.
        .eq("tenant_id", ctx.tenantId)
        .in(
          "id",
          chunk.map((product) => product.productId!),
        );
      if (error) throw new Error(`Import katalogu: odczyt nie powiódł się (${error.code}).`);
      for (const row of (data ?? []) as { id: string }[]) known.add(row.id.toLowerCase());
    }
    for (const product of parsed.products) {
      if (product.productId !== null && !known.has(product.productId)) {
        issues.push({
          row: product.rows[0],
          code: "unknownProduct",
          column: "product_id",
          value: product.productId,
        });
      }
    }
    if (issues.length === 0) {
      created = parsed.products.filter((product) => product.productId === null).length;
      updated = parsed.products.length - created;
      tiers = parsed.products.reduce((sum, product) => sum + product.tiers.length, 0);
    }
  }

  return {
    products: issues.length === 0 ? parsed.products : [],
    customFieldColumns: issues.length === 0 ? parsed.customFieldColumns : [],
    issues,
    rowCount: parsed.rowCount,
    created,
    updated,
    tiers,
  };
}

/**
 * Kształt wiersza p_rows funkcji app.import_catalog (0055, rozszerzona w 0058).
 *
 * `custom_field_columns` powtarza się w każdym wierszu, choć jest wspólne dla
 * pliku — świadomie: sygnatura funkcji zostaje NIETKNIĘTA (jeden parametr
 * `p_rows jsonb`), więc nie ma drugiej, przeterminowanej wersji funkcji do
 * utrzymania ani grantów do odtwarzania. Koszt to kilkanaście bajtów na wiersz.
 */
function toRpcRows(
  products: CatalogImportProduct[],
  customFieldColumns: string[],
): Record<string, unknown>[] {
  return products.map((product) => ({
    product_id: product.productId,
    name: product.name,
    description: product.description,
    base_price_day_grosze: product.basePriceDayGrosze,
    deposit_grosze: product.depositGrosze,
    // Mnożniki jako STRINGI dziesiętne — rzut ::numeric dopiero w bazie.
    auto_increment_multiplier: product.autoIncrementMultiplier,
    buffer_before_days: product.bufferBeforeDays,
    buffer_after_days: product.bufferAfterDays,
    active: product.active,
    tiers: product.tiers.map((tier) => ({
      tier_days: tier.tierDays,
      multiplier: tier.multiplier,
      label: tier.label,
      sort_order: tier.sortOrder,
    })),
    custom_fields: product.customFields,
    custom_field_columns: customFieldColumns,
  }));
}

/**
 * Faza 2: plan raz jeszcze (ta sama treść → ten sam wynik), potem atomowy
 * zapis przez app.import_catalog. Błędy planu wracają bez dotykania zapisu.
 */
export async function runCatalogImport(
  ctx: ExportContext,
  text: string,
): Promise<CatalogImportOutcome> {
  const plan = await planCatalogImport(ctx, text);
  if (plan.issues.length > 0 || plan.products.length === 0) {
    return { issues: plan.issues };
  }

  const { data, error } = await ctx.supabase
    .schema("app")
    .rpc("import_catalog", {
      p_rows: toRpcRows(plan.products, plan.customFieldColumns),
    });
  if (error) {
    // 23514 = naruszenie CHECK-a rozmiaru `custom_fields` PO SCALENIU mapy pliku
    // z wartościami już zapisanymi (pod definicjami zarchiwizowanymi/spoza
    // kolumn pliku). Podgląd liczy rozmiar TYLKO na mapie z pliku (mode:"create"),
    // więc świeci zielono, a baza egzekwuje na całości i cofa import (atomowo —
    // bez utraty danych). Zamiast surowego błędu 500 oddajemy zdanie dla
    // operatora. BEZ `row`: partia jest jedną transakcją, więc numer wiersza
    // jest nieosiągalny — problem jest PLIKOWY, nie wierszowy (round-3, #B;
    // podanie zmyślonego `row: 1` sugerowałoby błąd w nagłówku, którego nie ma).
    if (error.code === "23514") {
      return {
        issues: [
          {
            code: "badCustomField",
            value: `>${CUSTOM_FIELD_LIMITS.valuesBytesMax}B po scaleniu z zapisanymi wartościami`,
          },
        ],
      };
    }
    throw new Error(`Import katalogu: zapis nie powiódł się (${error.code ?? "?"}).`);
  }
  return {
    issues: [],
    result: data as { created: number; updated: number; tiers: number },
  };
}
