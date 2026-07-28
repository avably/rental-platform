/**
 * Sortowanie listy klientów (R6a) — wzorzec lib/orders/order-sort.ts, ale
 * SORT JEST W PAMIĘCI.
 *
 * Powód: dwie z trzech kolumn sortowalnych („liczba zamówień", „ostatnie
 * zamówienie") są WYLICZANE z agregatu zamówień per klient, a nie kolumnami
 * tabeli `customers` — nie da się ich wyrazić w `order by` PostgREST. Żeby nie
 * mieszać dwóch mechanizmów (część kolumn bazą, część w pamięci), sortujemy
 * jednolicie stronę w pamięci, spójnie z wyborem wyszukiwarki (ta też działa
 * nad stroną). Strona jest ograniczona limitem odczytu, więc koszt jest mały.
 */
import {
  CUSTOMER_SORT_KEYS,
  type CustomerSortDirection,
  type CustomerSortKey,
} from "@/lib/customer-validation";

export interface CustomerSortColumn {
  /** Kierunek przy PIERWSZYM kliknięciu w nagłówek (naturalny dla kolumny). */
  defaultDir: CustomerSortDirection;
}

export const CUSTOMER_SORT_COLUMNS: Record<CustomerSortKey, CustomerSortColumn> = {
  // Alfabetycznie od A — jak „Klient" na liście zamówień.
  klient: { defaultDir: "asc" },
  // Liczby: najpierw najwięksi (najczęściej wracający klienci).
  zamowienia: { defaultDir: "desc" },
  // Daty: najpierw najświeższe (kto był ostatnio).
  ostatnie: { defaultDir: "desc" },
};

/** Sort domyślny bez parametru: alfabetycznie po kliencie. */
export const DEFAULT_CUSTOMER_SORT_KEY: CustomerSortKey = "klient";

export interface ResolvedCustomerSort {
  key: CustomerSortKey;
  dir: CustomerSortDirection;
}

/** Efektywny sort: brak `dir` → naturalny kierunek kolumny; brak `sort` → klient. */
export function resolveCustomerSort(
  sort: CustomerSortKey | undefined,
  dir: CustomerSortDirection | undefined,
): ResolvedCustomerSort {
  const key = sort ?? DEFAULT_CUSTOMER_SORT_KEY;
  return { key, dir: dir ?? CUSTOMER_SORT_COLUMNS[key].defaultDir };
}

/**
 * Sort po kliknięciu w nagłówek `key`: ta sama kolumna odwraca kierunek, inna
 * wchodzi ze swoim naturalnym kierunkiem (jak w liście zamówień).
 */
export function nextCustomerSortForKey(
  key: CustomerSortKey,
  current: ResolvedCustomerSort,
): ResolvedCustomerSort {
  if (key === current.key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: CUSTOMER_SORT_COLUMNS[key].defaultDir };
}

/** Stan `aria-sort` nagłówka względem aktywnego sortu (dostępność). */
export function ariaSortForCustomer(
  key: CustomerSortKey,
  current: ResolvedCustomerSort,
): "ascending" | "descending" | "none" {
  if (key !== current.key) return "none";
  return current.dir === "asc" ? "ascending" : "descending";
}

/**
 * Href nagłówka: zachowuje pozostałe parametry (q), podmienia sort/dir na
 * wynik `nextCustomerSortForKey`. Pusty/nullowy parametr pomijamy, żeby link
 * nie puchł od `x=`.
 */
export function customerSortHref(
  baseParams: Record<string, string | undefined>,
  key: CustomerSortKey,
  current: ResolvedCustomerSort,
): string {
  const next = nextCustomerSortForKey(key, current);
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(baseParams)) {
    if (name === "sort" || name === "dir") continue;
    if (value != null && value !== "") params.set(name, value);
  }
  params.set("sort", next.key);
  params.set("dir", next.dir);
  return `?${params.toString()}`;
}

/** Pola wiersza potrzebne do sortowania (label + agregaty zamówień). */
export interface CustomerSortable {
  /** Gotowa etykieta klienta: nazwa albo e-mail — po niej idzie sort „klient". */
  customerLabel: string;
  orderCount: number;
  /** ISO daty ostatniego zamówienia albo null (klient bez zamówień idzie na koniec). */
  lastOrderAt: string | null;
}

/**
 * Zwraca NOWĄ, posortowaną tablicę wg efektywnego sortu. Sort jest STABILNY
 * względem etykiety: przy równych wartościach (np. zero zamówień) rozstrzyga
 * alfabet, żeby kolejność nie skakała między odświeżeniami.
 */
export function sortCustomers<T extends CustomerSortable>(
  rows: readonly T[],
  sort: ResolvedCustomerSort,
  locale: string,
): T[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const byLabel = (a: T, b: T) => a.customerLabel.localeCompare(b.customerLabel, locale);

  return [...rows].sort((a, b) => {
    if (sort.key === "klient") {
      return byLabel(a, b) * dir;
    }
    if (sort.key === "zamowienia") {
      const delta = a.orderCount - b.orderCount;
      return delta !== 0 ? delta * dir : byLabel(a, b);
    }
    // ostatnie: klient bez zamówień (null) trafia zawsze na KONIEC, niezależnie
    // od kierunku — „brak daty" nie jest ani najwcześniejszą, ani najpóźniejszą.
    if (a.lastOrderAt === null && b.lastOrderAt === null) return byLabel(a, b);
    if (a.lastOrderAt === null) return 1;
    if (b.lastOrderAt === null) return -1;
    const delta = a.lastOrderAt < b.lastOrderAt ? -1 : a.lastOrderAt > b.lastOrderAt ? 1 : 0;
    return delta !== 0 ? delta * dir : byLabel(a, b);
  });
}

export { CUSTOMER_SORT_KEYS };
