/**
 * WYSZUKIWARKA KATALOGU `/katalog?q=` — nazwa parametru, normalizacja zapytania
 * i adres wyników (domknięcie B1, ADR-263; buduje na ADR-186/migracji 0107).
 *
 * ==================== STAN WYSZUKIWANIA JEST W ADRESIE, NIE W KOSZYKU ====================
 *
 * Zapytanie żyje w `?q=`, tak jak numer strony w `?strona=` (ADR-186) i sort
 * kategorii w `?sort=` (ADR-247): adres wyników da się WKLEIĆ, wrócić do niego
 * przyciskiem wstecz i podać drugiej osobie. Formularz katalogu jest zwykłym
 * `GET` (SSR, nie SPA), więc wyszukiwanie działa bez JavaScriptu — spójnie z
 * resztą sklepu.
 *
 * ==================== `?q=` NIE JEST KANONICZNY (noindex) ====================
 *
 * Widok wyników wyszukiwania to widok FILTROWANY: nie ma go po co indeksować
 * (nieskończony zbiór zapytań daje nieskończony zbiór adresów cienkiej treści),
 * więc trasa oznacza stronę z `?q=` jako `noindex` — dlatego ten moduł NIE
 * dokłada `?q=` do żadnego kanonu ani mapy strony, a wyłącznie do adresów,
 * którymi klient nawiguje po WŁASNYCH wynikach (pole i nawigacja stron).
 *
 * ==================== ROZMIAR STRONY I NUMER STRONY BEZ ZMIAN ====================
 *
 * Filtr NIE wprowadza własnej arytmetyki stron — okno tnie baza (0107) tym samym
 * `p_offset`/`p_limit`, a `total` liczy po PRZEFILTROWANYM zbiorze, więc
 * `catalogPageCount`/`catalogPageOffset` z @avably/core działają bez zmian.
 */
import { CATALOG_PAGE_PARAM, CATALOG_PATH_SEGMENT } from "@avably/core";

/**
 * Nazwa parametru zapytania. `q` — krótka i uniwersalna konwencja wyszukiwania;
 * pozostałe parametry sklepu (`strona`, `sort`) są polskie, ale `q` jest tu
 * idiomem adresu wyszukiwania, nie treścią widoczną dla klienta.
 */
export const CATALOG_SEARCH_PARAM = "q";

/**
 * SUFIT długości zapytania. Nie broni bazy (ILIKE po długim wzorcu jest tani),
 * tylko ucina absurdalnie długie wejście z adresu, zanim trafi do zapytania i
 * do pola formularza. 120 znaków mieści każdą sensowną frazę sprzętu.
 */
export const CATALOG_SEARCH_MAX_LENGTH = 120;

/**
 * ZAPYTANIE Z PARAMETRU ADRESU — pusty łańcuch znaczy „brak wyszukiwania".
 *
 * Normalizacja jest JEDNA (tu), żeby pole formularza, licznik wyników i adres
 * stron niosły dokładnie ten sam napis: przycięcie brzegów, sklejenie białych
 * znaków do pojedynczej spacji, zacisk długości. Parametr powtórzony
 * (`?q=a&q=b`) albo pusty schodzi do braku filtra — wyszukiwanie nie jest
 * kanoniczne (noindex), więc nie produkuje duplikatów, których trzeba by bronić
 * 404 jak przy numerze strony.
 */
export function parseCatalogSearchQuery(raw: string | string[] | undefined): string {
  if (typeof raw !== "string") return "";
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return "";
  return normalized.slice(0, CATALOG_SEARCH_MAX_LENGTH);
}

/**
 * ADRES WYNIKÓW dla `page`/`query` — JEDYNE miejsce, w którym zapytanie i numer
 * strony zamieniają się we wspólny adres katalogu.
 *
 * Woła go nawigacja stron przy aktywnym wyszukiwaniu (żeby `?q=` przetrwał
 * przejście między stronami wyników). Kolejność parametrów jest STAŁA (`q` przed
 * `strona`), więc dwa wywołania o tym samym stanie dają ten sam napis. Strona
 * pierwsza nie nosi `strona`; puste zapytanie nie nosi `q` (wtedy adres jest
 * zwykłym adresem katalogu).
 */
export function catalogSearchPath(page: number, query: string): string {
  const base = `/${CATALOG_PATH_SEGMENT}`;
  const q = parseCatalogSearchQuery(query);
  const params: string[] = [];
  if (q.length > 0) params.push(`${CATALOG_SEARCH_PARAM}=${encodeURIComponent(q)}`);
  if (page > 1) params.push(`${CATALOG_PAGE_PARAM}=${page}`);
  return params.length > 0 ? `${base}?${params.join("&")}` : base;
}
