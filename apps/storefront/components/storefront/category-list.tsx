/**
 * SIATKA I NAWIGACJA STRONY KATEGORII (faza C, ADR-247).
 *
 * ==================== KAFEL JEST TEN SAM, CO W KATALOGU ====================
 *
 * Pozycje rysuje `ProductTile` z pakietu UI — dokładnie ten kafel, który stoi
 * na `/katalog` i w sekcji sprzętu na stronie najemcy. Druga kopia kafla
 * rozjechałaby się przy pierwszej poprawce wyglądu (lekcja ADR-186), a badge
 * dostępności z Fazy B dołoży się do TEJ SAMEJ karty bez zmiany tutaj. Liczby
 * wolnych sztuk w wybranym terminie wstrzykuje kontekst dostępności powłoki
 * (`StoreCatalogAvailability`, ADR-180) — kafel czyta je sam, jak w katalogu.
 *
 * ==================== NAWIGACJA I SORT ZOSTAJĄ W ADRESIE (ODNOŚNIKI) ====================
 *
 * Każda strona wyników i każdy porządek mają własny adres
 * (`/kategoria/{slug}?sort=…&strona=N`), więc przejście między nimi jest
 * NAWIGACJĄ, nie akcją JS: robot dochodzi do każdej pozycji kategorii, klient
 * może wkleić link, a „wstecz" działa. Arytmetykę numerów stron liczy wspólny
 * `catalogPagerItems` (ADR-186) — kategoria różni się tylko CELEM adresu, więc
 * to on jest parametrem, a nie druga kopia rachunku.
 */
import { CATALOG_PATH_SEGMENT } from "@avably/core";
import { LISTING_GRID_CLASS, ProductTile } from "@avably/ui";
import type { ProductsStructuredContent } from "@avably/core/site";
import type { SiteRenderLabels, StorefrontProduct, TemplateStyles } from "@avably/ui";

import { catalogPagerItems } from "@/lib/catalog/catalog-pager";
import { categoryPagePath, type CategorySort } from "@/lib/catalog/category-path";
import { format, type StorefrontCopy } from "@/lib/storefront/copy";

export function CategoryList({
  products,
  content,
  styles,
  copy,
  slug,
  page,
  pageCount,
  sort,
  labels,
}: {
  products: StorefrontProduct[];
  /** Ustawienia KAFLA (podtytuł, cechy, przycisk) — z sekcji sprzętu najemcy. */
  content: ProductsStructuredContent;
  styles: TemplateStyles;
  copy: StorefrontCopy;
  slug: string;
  page: number;
  pageCount: number;
  sort: CategorySort;
  labels: SiteRenderLabels;
}) {
  /*
    KATEGORIA PUSTA MÓWI WŁASNYM ZDANIEM, nie „katalog w przygotowaniu". To NIE
    jest 404 (ADR-244): kategoria istnieje, po prostu nie ma w niej jeszcze
    pozycji — treść pod istniejącym adresem, do którego prowadzą linki najemcy.

    Od F9 stan pusty jest WYJŚCIEM, nie ślepym zaułkiem (spec: ikona + zdanie +
    CTA): jedno zdanie prawdy i przycisk do pełnego katalogu, bo klient, który
    tu trafił, szuka sprzętu — pusta półka bez drogi dalej gubi go w sklepie.
    Ikona jest dekoracją (aria-hidden), zdanie niesie treść.
  */
  if (products.length === 0) {
    return (
      <div data-category-empty className="mt-10 flex flex-col items-center gap-3 py-10 text-center">
        <span
          className="site-icon-tile site-text-accent flex size-11 items-center justify-center"
          aria-hidden="true"
        >
          {/* Pusta skrzynia — inline, bo storefront nie zależy od pakietu ikon. */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 8l-9-5-9 5 9 5 9-5z" />
            <path d="M3 8v8l9 5 9-5V8" />
            <path d="M12 13v8" />
          </svg>
        </span>
        <p className="site-title text-lg">{copy.category.empty}</p>
        <a
          data-category-empty-cta
          href={`/${CATALOG_PATH_SEGMENT}`}
          className="site-cta mt-1 inline-flex h-11 items-center text-sm font-semibold"
        >
          {copy.category.emptyCta}
        </a>
      </div>
    );
  }

  return (
    <>
      {/*
        `site-listing-cards`: karta pozioma w 1-kolumnie (F9) i — od F11 —
        kolumny liczone od PASA listingu, a nie od całej strony (patrz
        `LISTING_BAND_CLASS` w trasie i site.css).
      */}
      <ul data-catalog-grid className={`${styles.productGrid} ${LISTING_GRID_CLASS} list-none p-0`}>
        {products.map((product, index) => (
          <ProductTile
            key={product.id}
            content={content}
            product={product}
            labels={labels}
            // Pierwszy kafel ładuje się łapczywie — siatka stoi tuż pod
            // nagłówkiem, więc jej pierwsze zdjęcie jest elementem LCP.
            eager={index === 0}
            styles={styles}
          />
        ))}
      </ul>
      <CategoryPager copy={copy} slug={slug} page={page} pageCount={pageCount} sort={sort} />
    </>
  );
}

/**
 * NAWIGACJA STRON KATEGORII. Nie rysuje się, gdy kategoria mieści się na jednej
 * stronie — pasek z jedynym, nieaktywnym numerem jest szumem, nie informacją.
 * Każdy adres NIESIE bieżący sort, żeby zmiana strony nie gubiła porządku.
 */
export function CategoryPager({
  copy,
  slug,
  page,
  pageCount,
  sort,
}: {
  copy: StorefrontCopy;
  slug: string;
  page: number;
  pageCount: number;
  sort: CategorySort;
}) {
  if (pageCount <= 1) return null;

  const items = catalogPagerItems(page, pageCount);
  const linkClass = "site-link min-w-9 rounded px-3 py-2 text-center underline";

  return (
    <nav data-category-pager aria-label={copy.category.pagerLabel} className="mt-10">
      <ul className="flex list-none flex-wrap items-center justify-center gap-1 p-0">
        {page > 1 ? (
          <li>
            <a
              data-category-prev
              href={categoryPagePath(slug, page - 1, sort)}
              rel="prev"
              className={linkClass}
            >
              {copy.catalog.prev}
            </a>
          </li>
        ) : null}

        {items.map((item, index) =>
          item === "gap" ? (
            <li key={`gap-${index}`} aria-hidden="true" className="site-text-muted px-2">
              …
            </li>
          ) : (
            <li key={item}>
              {item === page ? (
                <span
                  data-category-page={item}
                  aria-current="page"
                  className="site-text-accent min-w-9 rounded px-3 py-2 text-center font-medium"
                >
                  {item}
                </span>
              ) : (
                <a
                  data-category-page={item}
                  href={categoryPagePath(slug, item, sort)}
                  className={linkClass}
                >
                  <span className="sr-only">{format(copy.catalog.goToPage, { page: item })}</span>
                  <span aria-hidden="true">{item}</span>
                </a>
              )}
            </li>
          ),
        )}

        {page < pageCount ? (
          <li>
            <a
              data-category-next
              href={categoryPagePath(slug, page + 1, sort)}
              rel="next"
              className={linkClass}
            >
              {copy.catalog.next}
            </a>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
