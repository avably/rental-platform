/**
 * Sortowanie listy katalogu (U8a) — wzorzec `lib/customers/customer-sort.ts`,
 * SORT JEST W PAMIĘCI.
 *
 * Powód ten sam co przy klientach: dwie z czterech kolumn („Egzemplarze",
 * „Dziś w terenie") są WYLICZANE — pierwsza z agregatu `product_units(count)`,
 * druga z pozycji zamówień (`lib/catalog/deployed-today.ts`) — i nie da się
 * ich wyrazić w `order by` PostgREST. Mieszanie dwóch mechanizmów (część
 * kolumn bazą, część w pamięci) dawałoby kolumny sortujące się „inaczej", więc
 * cała strona sortuje się jednolicie w pamięci. Strona jest ograniczona
 * limitem odczytu (`CATALOG_PAGE_LIMIT`), więc koszt jest mały.
 */
import {
  PRODUCT_SORT_KEYS,
  type ProductSortDirection,
  type ProductSortKey,
} from "@/lib/catalog-validation";

export interface ProductSortColumn {
  /** Kierunek przy PIERWSZYM kliknięciu w nagłówek (naturalny dla kolumny). */
  defaultDir: ProductSortDirection;
}

export const PRODUCT_SORT_COLUMNS: Record<ProductSortKey, ProductSortColumn> = {
  // Alfabetycznie od A — tak katalog czyta się przy ladzie.
  nazwa: { defaultDir: "asc" },
  // Cena: od najtańszej, bo pierwszym pytaniem jest „co mam do 100 zł".
  cena: { defaultDir: "asc" },
  // Liczby sztuk: najpierw najliczniejsze pozycje magazynu.
  egzemplarze: { defaultDir: "desc" },
  // „Dziś w terenie": najpierw to, czego NIE MA na półce — to jest powód,
  // dla którego ta kolumna w ogóle powstała.
  teren: { defaultDir: "desc" },
};

/** Sort domyślny bez parametru: alfabetycznie po nazwie (stan sprzed U8a). */
export const DEFAULT_PRODUCT_SORT_KEY: ProductSortKey = "nazwa";

export interface ResolvedProductSort {
  key: ProductSortKey;
  dir: ProductSortDirection;
}

/** Efektywny sort: brak `dir` → naturalny kierunek kolumny; brak `sort` → nazwa. */
export function resolveProductSort(
  sort: ProductSortKey | undefined,
  dir: ProductSortDirection | undefined,
): ResolvedProductSort {
  const key = sort ?? DEFAULT_PRODUCT_SORT_KEY;
  return { key, dir: dir ?? PRODUCT_SORT_COLUMNS[key].defaultDir };
}

/**
 * Sort po kliknięciu w nagłówek `key`: ta sama kolumna odwraca kierunek, inna
 * wchodzi ze swoim naturalnym kierunkiem (jak na listach zamówień i klientów).
 */
export function nextProductSortForKey(
  key: ProductSortKey,
  current: ResolvedProductSort,
): ResolvedProductSort {
  if (key === current.key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: PRODUCT_SORT_COLUMNS[key].defaultDir };
}

/** Stan `aria-sort` nagłówka względem aktywnego sortu (dostępność). */
export function ariaSortForProduct(
  key: ProductSortKey,
  current: ResolvedProductSort,
): "ascending" | "descending" | "none" {
  if (key !== current.key) return "none";
  return current.dir === "asc" ? "ascending" : "descending";
}

/**
 * Href nagłówka: zachowuje pozostałe parametry (`q`, `status`), podmienia
 * sort/dir na wynik `nextProductSortForKey`. Pusty/nullowy parametr pomijamy,
 * żeby link nie puchł od `x=`.
 */
export function productSortHref(
  baseParams: Record<string, string | undefined>,
  key: ProductSortKey,
  current: ResolvedProductSort,
): string {
  const next = nextProductSortForKey(key, current);
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(baseParams)) {
    if (name === "sort" || name === "dir") continue;
    if (value != null && value !== "") params.set(name, value);
  }
  params.set("sort", next.key);
  params.set("dir", next.dir);
  return `?${params.toString()}`;
}

/** Pola wiersza potrzebne do sortowania. */
export interface ProductSortable {
  name: string;
  basePriceDayGrosze: number;
  unitCount: number;
  /** „Dziś w terenie" — liczba z `lib/catalog/deployed-today.ts`. */
  deployedToday: number;
}

/**
 * Zwraca NOWĄ, posortowaną tablicę wg efektywnego sortu. Sort jest STABILNY
 * względem nazwy: przy równych wartościach (np. zero w terenie) rozstrzyga
 * alfabet, żeby kolejność nie skakała między odświeżeniami.
 */
export function sortProducts<T extends ProductSortable>(
  rows: readonly T[],
  sort: ResolvedProductSort,
  locale: string,
): T[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, locale);

  const value = (row: T): number => {
    switch (sort.key) {
      case "cena":
        return row.basePriceDayGrosze;
      case "egzemplarze":
        return row.unitCount;
      default:
        return row.deployedToday;
    }
  };

  return [...rows].sort((a, b) => {
    if (sort.key === "nazwa") return byName(a, b) * dir;
    const delta = value(a) - value(b);
    return delta !== 0 ? delta * dir : byName(a, b);
  });
}

export { PRODUCT_SORT_KEYS };
