/**
 * Wyszukiwarka listy katalogu (U8a) — wzorzec `lib/customers/customer-search.ts`.
 *
 * Haystack to NAZWA produktu: to jedyne pole, po którym operator rozpoznaje
 * pozycję przy ladzie („nagrzewnica", „rower 26"). Opisu świadomie nie
 * przeszukujemy — kolumna `products.description` ma do 5000 znaków i nie jest
 * czytana przez listę, więc dołożenie jej byłoby odczytem setek kilobajtów po
 * to, żeby wyszukiwarka trafiała w zdania marketingowe.
 *
 * Filtr działa NAD ODCZYTANĄ STRONĄ (w pamięci), a nie przez `.or()`
 * PostgREST. Dwa powody, oba istotne:
 *   1. spójność z listą klientów i zamówień (jeden model: strona → filtr →
 *      sort → licznik „N wyników"),
 *   2. IZOLACJA: fraza operatora NIGDY nie wchodzi do budowy zapytania, więc
 *      nie ma czym wpłynąć na jego kształt ani na zawężenie po tenancie.
 *      Sonda `catalog-list-isolation.test.ts` pilnuje tego zachowaniem.
 *
 * Gdy wolumen urośnie ponad stronę — zastąpić indeksem tekstowym/RPC.
 */
import type { ProductStatusFilter } from "@/lib/catalog-validation";

export interface ProductSearchable {
  name: string;
}

/**
 * Czy wiersz pasuje do zapytania. Puste zapytanie pasuje do wszystkiego
 * (brak filtra). Dopasowanie jest CASE-insensitive i częściowe (`includes`).
 */
export function productMatchesSearch(row: ProductSearchable, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return row.name.toLowerCase().includes(needle);
}

/** Zawęża listę do wierszy pasujących do `query` (kolejność zachowana). */
export function filterProductsBySearch<T extends ProductSearchable>(
  rows: readonly T[],
  query: string,
): T[] {
  if (query.trim() === "") return [...rows];
  return rows.filter((row) => productMatchesSearch(row, query));
}

export interface ProductStatusFilterable {
  active: boolean;
}

/**
 * Filtr publikacji: `aktywne` / `nieaktywne` / brak parametru = wszystkie.
 * To jedyny filtr, który model danych dziś unosi — `products` nie ma
 * kategorii ani tagów (patrz ADR-145, sekcja „co odłożone").
 */
export function filterProductsByStatus<T extends ProductStatusFilterable>(
  rows: readonly T[],
  status: ProductStatusFilter | undefined,
): T[] {
  if (status === undefined) return [...rows];
  const wanted = status === "aktywne";
  return rows.filter((row) => row.active === wanted);
}
