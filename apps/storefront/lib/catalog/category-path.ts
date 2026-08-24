/**
 * STRONA KATEGORII `/kategoria/{slug}` — adres, sortowanie i mapowanie na
 * parametr bazy (faza C, ADR-247, odczyt z ADR-244/migracja 0101).
 *
 * ==================== JEDNO MIEJSCE, W KTÓRYM NUMER I SORT ZAMIENIAJĄ SIĘ W ADRES ====================
 *
 * Woła to trasa (kanon celuje w CZYSTĄ stronę kategorii), nawigacja stron
 * i przełącznik sortowania. Ścieżka pisana z ręki w każdym z tych miejsc
 * rozjechałaby się przy pierwszej zmianie kształtu adresu — ta sama lekcja, co
 * przy `catalogPagePath` (ADR-186) i `productPath` (ADR-182).
 *
 * ==================== NUMER STRONY TO TEN SAM PARAMETR, CO W KATALOGU ====================
 *
 * `?strona=` — reużywamy `CATALOG_PAGE_PARAM` i `parseCatalogPageParam`
 * z @avably/core, żeby konwencja numeru strony była JEDNA w całym sklepie
 * (katalog i kategoria), a nie dwie do zapamiętania. Strona pierwsza nie nosi
 * parametru: `/kategoria/{slug}?strona=1` i `/kategoria/{slug}` to ta sama
 * treść, więc jeden musi być formą krótszą.
 *
 * ==================== SORTOWANIE: DOMYŚLNE NIE NOSI PARAMETRU ====================
 *
 * Cztery porządki widoczne dla klienta: nazwa (A-Z, DOMYŚLNY), cena rosnąco,
 * cena malejąco, najnowsze. Domyślny — nazwa — to porządek `catalog` bazy
 * (`p.name, p.id`), więc nie nosi parametru w adresie: `?sort=name` i brak
 * parametru schodzą się w jednym adresie. Dzięki temu kanon czystej strony
 * kategorii pokrywa wariant domyślny bez dubla. Nieznana wartość `?sort=`
 * schodzi do domyślnej (fail-soft, jak baza) — kanon i tak celuje w czystą
 * stronę, więc żaden `?sort=cokolwiek` nie produkuje osobno indeksowanego
 * adresu (patrz `categoryPageMetadata`).
 */
import { CATALOG_PAGE_PARAM } from "@avably/core";

/** Pierwszy segment adresu strony kategorii — lustro RESERVED_CATEGORY_SLUGS. */
export const CATEGORY_PATH_SEGMENT = "kategoria";

/** Nazwa parametru sortowania. Polska, bo sklep najemcy jest JEDNOJĘZYCZNY. */
export const CATEGORY_SORT_PARAM = "sort";

/**
 * Porządki widoczne dla klienta. `name` jest DOMYŚLNY i mapuje na `catalog`
 * bazy (ta sama kolejność `p.name, p.id`). Wartości spójne z `p_sort`
 * funkcji `app.get_public_category_page` z dokładnością do tego jednego aliasu.
 */
export const CATEGORY_SORTS = ["name", "price_asc", "price_desc", "newest"] as const;
export type CategorySort = (typeof CATEGORY_SORTS)[number];

/** Porządek domyślny — nazwa A-Z; NIE nosi parametru w adresie. */
export const CATEGORY_SORT_DEFAULT: CategorySort = "name";

/**
 * Sort z parametru adresu. Nieznana wartość (w tym tablica z powtórzonego
 * parametru albo jawne `name`) schodzi do domyślnego: przełącznik sortowania
 * nie ma jak wywrócić strony za literówkę, a kanon i tak celuje w czystą stronę.
 */
export function parseCategorySortParam(raw: string | string[] | undefined): CategorySort {
  if (typeof raw !== "string") return CATEGORY_SORT_DEFAULT;
  const match = CATEGORY_SORTS.find((sort) => sort === raw);
  // `name` jako jawny parametr też schodzi do domyślnego (bezparametrowego),
  // żeby `?sort=name` i brak parametru dawały JEDEN adres.
  return match && match !== CATEGORY_SORT_DEFAULT ? match : CATEGORY_SORT_DEFAULT;
}

/**
 * `p_sort` dla `app.get_public_category_page`. Domyślny porządek nazwy to
 * `catalog` bazy; pozostałe idą 1:1. Nieznana wartość NIE dochodzi tu nigdy —
 * `parseCategorySortParam` już ją zdjął do domyślnej.
 */
export function categorySortToDb(sort: CategorySort): string {
  return sort === "name" ? "catalog" : sort;
}

/** Adres CZYSTEJ strony kategorii (kanon) — bez numeru strony i bez sortu. */
export function categoryBasePath(slug: string): string {
  return `/${CATEGORY_PATH_SEGMENT}/${slug}`;
}

/**
 * ADRES PUBLICZNY strony kategorii dla `page`/`sort`. Strona pierwsza i sort
 * domyślny nie noszą parametrów, więc adres domyślnego widoku jest adresem
 * czystym (kanonem). Kolejność parametrów jest STAŁA (`sort` przed `strona`),
 * żeby dwa wywołania o tym samym stanie dawały ten sam napis.
 */
export function categoryPagePath(
  slug: string,
  page = 1,
  sort: CategorySort = CATEGORY_SORT_DEFAULT,
): string {
  const params: string[] = [];
  if (sort !== CATEGORY_SORT_DEFAULT) params.push(`${CATEGORY_SORT_PARAM}=${sort}`);
  if (page > 1) params.push(`${CATALOG_PAGE_PARAM}=${page}`);
  const base = categoryBasePath(slug);
  return params.length > 0 ? `${base}?${params.join("&")}` : base;
}
