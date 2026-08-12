import { Button } from "@avably/ui";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { productsFilterSchema } from "@/lib/catalog-validation";
import { CATALOG_PAGE_LIMIT, fetchCatalogList } from "@/lib/catalog/list-query";
import { filterProductsByStatus, filterProductsBySearch } from "@/lib/catalog/product-search";
import { resolveProductSort, sortProducts } from "@/lib/catalog/product-sort";
import { requireMemberPage } from "@/lib/member-page";
import { warsawToday } from "@/lib/orders/order-dates";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { CatalogEmptyState, CatalogNoResultsState } from "./catalog-empty-state";
import { CatalogToolbar } from "./catalog-toolbar";
import { ProductsTable } from "./products-table";

/**
 * Lista katalogu (U8a, ADR-145).
 *
 * Ekran jest server componentem: czyta bazę pod RLS tenanta
 * (`lib/catalog/list-query.ts` — jedyne miejsce z zapytaniami), a cała
 * interaktywność (fraza, filtr publikacji, sort) żyje w URL. Produktów nie da
 * się tu zaznaczać ani masowo przetwarzać, więc — jak lista klientów — ekran
 * nie potrzebuje warstwy klienta.
 *
 * „DZIŚ W TERENIE" liczymy z pozycji zamówień w statusie `picked_up`, których
 * zakres dat obejmuje dziś (definicja i uzasadnienie:
 * `lib/catalog/deployed-today.ts`). „Dziś" to Europe/Warsaw, nie UTC — to jest
 * pojęcie operatora stojącego za ladą, a północ UTC potrafi cofnąć dzień
 * względem tego, co on widzi na zegarze.
 */
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireMemberPage("/katalog");

  const params = await searchParams;
  const single = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : undefined;
  // Błędny filtr jest ignorowany (catch → undefined), nie błędem strony.
  const filter = productsFilterSchema.parse({
    q: single(params.q),
    status: single(params.status),
    sort: single(params.sort),
    dir: single(params.dir),
  });

  const { rows: allRows, capped, hasAnyProducts } = await fetchCatalogList(
    ctx.supabase,
    ctx.tenantId!,
    {
      today: warsawToday(),
      // Baza publicznych URL-i Storage. NEXT_PUBLIC_SUPABASE_URL jest
      // wstrzykiwane build-time — miniatura to goły URL publiczny, bez
      // transformacji zależnej od planu hostingu (ADR-145).
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    },
  );

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("catalog.list");
  const tImport = await getTranslations("catalogImport");
  const tCategories = await getTranslations("catalog.categories");

  const sort = resolveProductSort(filter.sort, filter.dir);
  const visibleRows = sortProducts(
    filterProductsBySearch(filterProductsByStatus(allRows, filter.status), filter.q ?? ""),
    sort,
    locale,
  );

  const baseParams: Record<string, string | undefined> = {
    q: filter.q,
    status: filter.status,
    sort: filter.sort,
    dir: filter.dir,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Punkty odbioru wyprowadzone do Dostaw (2026-08-04): katalog opisuje
          SPRZĘT, a punkt odbioru jest sposobem jego wydania — stoi więc obok
          kuriera i paczkomatu. Import CSV (C3, ADR-112) wraca tu jako druga
          akcja ŚWIADOMIE: to operacja NA katalogu (hurtowa edycja cennika),
          nie na jego otoczeniu — a wejście przyciskiem zamiast pozycją
          w nawigacji utrzymuje kontrakt struktury grup z artefaktu Fazy 2. */}
      <header className="mb-2 flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Kategorie stoją TU, a nie w menu: opisują katalog, więc mieszkają
              przy katalogu — jak import CSV (ADR-155). */}
          <Button asChild variant="secondary">
            <Link href="/katalog/kategorie">{tCategories("entry")}</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/katalog/import">{tImport("entry")}</Link>
          </Button>
          <Button asChild>
            <Link href="/katalog/nowy">{t("newProduct")}</Link>
          </Button>
        </div>
      </header>

      {hasAnyProducts ? (
        <>
          <CatalogToolbar filter={filter} resultCount={visibleRows.length} />
          {capped ? (
            <p className="text-muted-foreground text-sm" data-catalog-cap>
              {t("cap", { count: CATALOG_PAGE_LIMIT })}
            </p>
          ) : null}
          {visibleRows.length === 0 ? (
            <CatalogNoResultsState />
          ) : (
            <ProductsTable
              rows={visibleRows}
              currency={currency}
              locale={locale}
              sort={sort}
              baseParams={baseParams}
            />
          )}
        </>
      ) : (
        <CatalogEmptyState />
      )}
    </div>
  );
}
