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
import type { ExportContext } from "../export/common";
import {
  parseCatalogCsv,
  type CatalogImportIssue,
  type CatalogImportProduct,
} from "./catalog-csv";

/** Strona odczytu przy sprawdzaniu identyfikatorów (limit PostgREST). */
const ID_CHECK_PAGE_SIZE = 500;

export interface CatalogImportPlan {
  products: CatalogImportProduct[];
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
  const parsed = parseCatalogCsv(text);
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
    issues,
    rowCount: parsed.rowCount,
    created,
    updated,
    tiers,
  };
}

/** Kształt wiersza p_rows funkcji app.import_catalog (migracja 0055). */
function toRpcRows(products: CatalogImportProduct[]): Record<string, unknown>[] {
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
    .rpc("import_catalog", { p_rows: toRpcRows(plan.products) });
  if (error) {
    throw new Error(`Import katalogu: zapis nie powiódł się (${error.code ?? "?"}).`);
  }
  return {
    issues: [],
    result: data as { created: number; updated: number; tiers: number },
  };
}
