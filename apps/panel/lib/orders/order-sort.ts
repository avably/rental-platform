/**
 * Odwzorowanie klucza sortu (URL) na kolumnę bazy oraz budowa linków nagłówków
 * (uwaga przeglądu U2) — ADR-057.
 *
 * SORT PO „#" JEST CHRONOLOGICZNY, nie leksykalny. Numer ma kształt
 * `SK-2026-068`; sortowanie tekstu stawia `SK-2026-9` PO `SK-2026-100` (różna
 * długość ostatniego segmentu), więc „najnowsze" po tekście kłamie. Numer
 * rośnie w czasie, dlatego klucz `numer` mapujemy na `created_at` — kolejność
 * wychodzi poprawna bez parsowania segmentów. Domyślny sort bez parametru to
 * `created_at` malejąco, czyli dokładnie „najnowsze pierwsze" jak dotąd.
 */
import { type OrderSortDirection, type OrderSortKey } from "@/lib/order-validation";

export interface OrderSortColumn {
  /** Kolumna do `.order()` — na `orders` albo na dołączonym zasobie. */
  column: string;
  /** Dołączony zasób (klient), gdy sortujemy po jego polu. */
  foreignTable?: string;
  /** Kierunek przy PIERWSZYM kliknięciu w nagłówek (naturalny dla kolumny). */
  defaultDir: OrderSortDirection;
}

export const ORDER_SORT_COLUMNS: Record<OrderSortKey, OrderSortColumn> = {
  // „#" → created_at: chronologia, nie tekst numeru (patrz nagłówek pliku).
  numer: { column: "created_at", defaultDir: "desc" },
  klient: { column: "full_name", foreignTable: "customers", defaultDir: "asc" },
  termin: { column: "start_date", defaultDir: "desc" },
  kwota: { column: "total_rental_grosze", defaultDir: "desc" },
  status: { column: "order_status", defaultDir: "asc" },
  platnosc: { column: "payment_status", defaultDir: "asc" },
};

/** Sort domyślny bez parametru: najnowsze po „#", czyli created_at malejąco. */
export const DEFAULT_SORT_KEY: OrderSortKey = "numer";

export interface ResolvedSort {
  key: OrderSortKey;
  dir: OrderSortDirection;
}

/** Efektywny sort: brak `dir` → naturalny kierunek kolumny; brak `sort` → #. */
export function resolveOrderSort(
  sort: OrderSortKey | undefined,
  dir: OrderSortDirection | undefined,
): ResolvedSort {
  const key = sort ?? DEFAULT_SORT_KEY;
  return { key, dir: dir ?? ORDER_SORT_COLUMNS[key].defaultDir };
}

/**
 * Sort po kliknięciu w nagłówek `key`: ta sama kolumna odwraca kierunek, inna
 * wchodzi ze swoim naturalnym kierunkiem. Dzięki temu pierwsze kliknięcie w
 * „Kwota" pokazuje od największej, a w „Klient" — alfabetycznie od A.
 */
export function nextSortForKey(key: OrderSortKey, current: ResolvedSort): ResolvedSort {
  if (key === current.key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: ORDER_SORT_COLUMNS[key].defaultDir };
}

/** Stan `aria-sort` nagłówka względem aktywnego sortu (dostępność U2). */
export function ariaSortFor(
  key: OrderSortKey,
  current: ResolvedSort,
): "ascending" | "descending" | "none" {
  if (key !== current.key) return "none";
  return current.dir === "asc" ? "ascending" : "descending";
}

/**
 * Href nagłówka: zachowuje pozostałe parametry (q, status, od, do, klient,
 * preset), podmienia sort/dir na wynik `nextSortForKey`. Pusty/nullowy
 * parametr pomijamy, żeby link nie puchł od `x=`.
 */
export function orderSortHref(
  baseParams: Record<string, string | undefined>,
  key: OrderSortKey,
  current: ResolvedSort,
): string {
  const next = nextSortForKey(key, current);
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(baseParams)) {
    if (name === "sort" || name === "dir") continue;
    if (value != null && value !== "") params.set(name, value);
  }
  params.set("sort", next.key);
  params.set("dir", next.dir);
  return `?${params.toString()}`;
}
