/**
 * LISTA KATALOGU ZE STRONICOWANIEM (faza 4b, ADR-186).
 *
 * ==================== SIATKA JEST TA SAMA, REGUŁA RZĘDU — INNA ====================
 *
 * Kafel przyjeżdża z pakietu UI (`ProductTile`), więc katalog wygląda dokładnie
 * tak, jak sekcja sprzętu na stronie najemcy — druga kopia kafla rozjechałaby
 * się przy pierwszej poprawce wyglądu. Znika jedna rzecz: klasa
 * `site-product-grid`, która ucina ostatni, NIEPEŁNY rząd. W sekcji to jest
 * uczciwe, bo pod spodem stoi odnośnik „zobacz cały katalog"; NA katalogu
 * ucięłoby pozycje, po które klient właśnie przyszedł — a odesłać go już nie
 * ma dokąd.
 *
 * ==================== NAWIGACJA JEST Z ODNOŚNIKÓW, NIE Z PRZYCISKÓW ====================
 *
 * Każda strona wyników ma własny adres (`/katalog?strona=N`), więc przejście
 * między stronami jest NAWIGACJĄ, a nie akcją. Konsekwencje są trzy i wszystkie
 * potrzebne: robot indeksujący dochodzi do każdej pozycji katalogu, klient może
 * wkleić link do konkretnej strony, a wstecz w przeglądarce działa. Przełącznik
 * z JavaScriptu dawałby jeden adres na całą listę — czyli katalog niewidoczny
 * dla wyszukiwarki, którą ta strona ma obsłużyć na równi z klientem.
 */
import { catalogPagePath } from "@avably/core";
import { ProductTile, ProductsEmpty } from "@avably/ui";
import type { ProductsStructuredContent } from "@avably/core/site";
import type { SiteRenderLabels, StorefrontProduct, TemplateStyles } from "@avably/ui";

import { catalogPagerItems } from "@/lib/catalog/catalog-pager";
import { catalogSearchPath } from "@/lib/catalog/catalog-search";
import { format, type StorefrontCopy } from "@/lib/storefront/copy";

/**
 * ADRES STRONY WYNIKÓW. Bez aktywnego wyszukiwania to zwykły adres katalogu
 * (`/katalog?strona=N`, ADR-186); z aktywnym — adres niesie też `?q=`, żeby
 * przejście między stronami NIE gubiło zapytania (ADR-263). Jedno wyrażenie dla
 * całej nawigacji, więc „poprzednia", „następna" i numery idą tą samą regułą.
 */
function pageHref(page: number, searchQuery: string): string {
  return searchQuery.length > 0 ? catalogSearchPath(page, searchQuery) : catalogPagePath(page);
}

export function CatalogList({
  products,
  content,
  styles,
  labels,
  copy,
  page,
  pageCount,
  searchQuery = "",
}: {
  products: StorefrontProduct[];
  /** Ustawienia KAFLA (podtytuł, cechy, przycisk) — patrz lib/catalog/catalog-tiles.ts. */
  content: ProductsStructuredContent;
  styles: TemplateStyles;
  labels: SiteRenderLabels;
  copy: StorefrontCopy;
  page: number;
  pageCount: number;
  /**
   * Aktywne zapytanie wyszukiwania (`?q=`) albo pusty łańcuch (ADR-263). Gdy
   * niepuste, nawigacja stron zachowuje je w adresach; stan pusty listy przy
   * aktywnym wyszukiwaniu rozstrzyga TRASA (komunikat „brak wyników"), nie ten
   * komponent — tu pusta lista wraca do neutralnego `ProductsEmpty`.
   */
  searchQuery?: string;
}) {
  if (products.length === 0) return <ProductsEmpty labels={labels} />;

  return (
    <>
      <ul data-catalog-grid className={`${styles.productGrid} list-none p-0`}>
        {products.map((product, index) => (
          <ProductTile
            key={product.id}
            content={content}
            product={product}
            /*
              PIERWSZY KAFEL ŁADUJE SIĘ ŁAPCZYWIE — na katalogu tym bardziej niż
              w sekcji: siatka stoi tu tuż pod nagłówkiem, więc jej pierwsze
              zdjęcie jest elementem LCP na każdej stronie wyników.
            */
            eager={index === 0}
            styles={styles}
            labels={labels}
          />
        ))}
      </ul>
      <CatalogPager copy={copy} page={page} pageCount={pageCount} searchQuery={searchQuery} />
    </>
  );
}

/**
 * NAWIGACJA STRON. Nie rysuje się przy katalogu mieszczącym się na jednej
 * stronie — pasek z jedynym, nieaktywnym numerem jest szumem, a nie informacją.
 */
export function CatalogPager({
  copy,
  page,
  pageCount,
  searchQuery = "",
}: {
  copy: StorefrontCopy;
  page: number;
  pageCount: number;
  /** Aktywne `?q=` (ADR-263) — gdy niepuste, adresy stron je zachowują. */
  searchQuery?: string;
}) {
  if (pageCount <= 1) return null;

  const items = catalogPagerItems(page, pageCount);
  const linkClass = "site-link min-w-9 rounded px-3 py-2 text-center underline";

  return (
    <nav data-catalog-pager aria-label={copy.catalog.pagerLabel} className="mt-10">
      <ul className="flex list-none flex-wrap items-center justify-center gap-1 p-0">
        {page > 1 ? (
          <li>
            <a data-catalog-prev href={pageHref(page - 1, searchQuery)} rel="prev" className={linkClass}>
              {copy.catalog.prev}
            </a>
          </li>
        ) : null}

        {items.map((item, index) =>
          item === "gap" ? (
            // Przerwa jest tekstem, nie odnośnikiem, i jest ukryta przed
            // czytnikiem ekranu: „…" wyczytane na głos nie niesie informacji,
            // a między numerami stron brzmi jak błąd.
            <li key={`gap-${index}`} aria-hidden="true" className="site-text-muted px-2">
              …
            </li>
          ) : (
            <li key={item}>
              {item === page ? (
                /*
                  BIEŻĄCA STRONA NIE JEST ODNOŚNIKIEM DO SIEBIE. `aria-current`
                  mówi czytnikowi ekranu, gdzie stoimy; link prowadzący pod
                  własny adres jest dla klawiatury dodatkowym przystankiem,
                  który nic nie robi.
                */
                <span
                  data-catalog-page={item}
                  aria-current="page"
                  className="site-text-accent min-w-9 rounded px-3 py-2 text-center font-medium"
                >
                  {item}
                </span>
              ) : (
                <a data-catalog-page={item} href={pageHref(item, searchQuery)} className={linkClass}>
                  <span className="sr-only">{format(copy.catalog.goToPage, { page: item })}</span>
                  <span aria-hidden="true">{item}</span>
                </a>
              )}
            </li>
          ),
        )}

        {page < pageCount ? (
          <li>
            <a data-catalog-next href={pageHref(page + 1, searchQuery)} rel="next" className={linkClass}>
              {copy.catalog.next}
            </a>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
