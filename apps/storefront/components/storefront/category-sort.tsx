/**
 * PRZEŁĄCZNIK SORTOWANIA STRONY KATEGORII (faza C, ADR-247).
 *
 * ==================== ODNOŚNIKI, NIE SKRYPT ====================
 *
 * Każdy porządek ma własny adres (`?sort=…`), więc zmiana sortowania jest
 * NAWIGACJĄ: działa bez JavaScriptu, da się ją wkleić i zaindeksować, a robot
 * dochodzi do każdej pozycji także innym porządkiem. Przełącznik z `<select>`
 * na JS byłby jednym adresem na cztery widoki — i martwy przy wyłączonym JS,
 * czego reszta storefrontu (SSR, nie SPA) unika z zasady.
 *
 * ZMIANA SORTU WRACA NA STRONĘ PIERWSZĄ. Numer strony liczony jest w PORZĄDKU:
 * „strona 3 wg ceny" nie ma odpowiednika „strona 3 wg nazwy", a trzymanie
 * numeru przy zmianie porządku wrzucałoby klienta w losowe miejsce innej listy
 * (albo poza zakres → 404). Dlatego adresy sortu celują w stronę 1.
 *
 * PORZĄDEK DOMYŚLNY (nazwa) jest zaznaczony także pod adresem czystym: strona
 * bez `?sort=` to widok wg nazwy, więc `name` jest wtedy aktywny.
 */
import { categoryPagePath, CATEGORY_SORTS, type CategorySort } from "@/lib/catalog/category-path";
import type { StorefrontCopy } from "@/lib/storefront/copy";

function sortLabel(copy: StorefrontCopy, sort: CategorySort): string {
  switch (sort) {
    case "price_asc":
      return copy.category.sortPriceAsc;
    case "price_desc":
      return copy.category.sortPriceDesc;
    case "newest":
      return copy.category.sortNewest;
    case "name":
    default:
      return copy.category.sortName;
  }
}

export function CategorySort({
  copy,
  slug,
  active,
}: {
  copy: StorefrontCopy;
  slug: string;
  active: CategorySort;
}) {
  return (
    <nav
      data-category-sort
      aria-label={copy.category.sortLabel}
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
    >
      <span className="site-text-muted">{copy.category.sortLabel}:</span>
      <ul className="flex list-none flex-wrap items-center gap-x-3 gap-y-2 p-0">
        {CATEGORY_SORTS.map((sort) => (
          <li key={sort}>
            {sort === active ? (
              <span
                data-category-sort-option={sort}
                data-category-sort-active
                aria-current="true"
                className="site-text-accent font-medium"
              >
                {sortLabel(copy, sort)}
              </span>
            ) : (
              <a
                data-category-sort-option={sort}
                href={categoryPagePath(slug, 1, sort)}
                className="site-link underline"
              >
                {sortLabel(copy, sort)}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
