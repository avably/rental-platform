/**
 * Wyszukiwarka listy klientów (R6a) — wzorzec lib/orders/order-search.ts.
 *
 * Haystack to POLA WŁASNE klienta: imię i nazwisko, e-mail, telefon (uwaga
 * właściciela: „wyszukiwarka po imieniu i nazwisku / mailu / telefonie").
 * Filtr działa nad już odczytaną STRONĄ wyników (pragmatyczny wariant spójny
 * z listą zamówień), a nie przez `.or()` PostgREST — strona jest ograniczona
 * limitem odczytu, więc dofiltrowanie w pamięci jest tanie i daje dokładny
 * licznik „N wyników". Gdy wolumen urośnie ponad stronę — zastąpić indeksem
 * tekstowym/RPC. Kontrakt broni test `customer-validation.test.ts`.
 */

export interface CustomerSearchable {
  id: string;
  fullName: string | null;
  email: string;
  phone: string | null;
}

/**
 * Czy wiersz pasuje do zapytania. Puste zapytanie pasuje do wszystkiego
 * (brak filtra). Dopasowanie jest CASE-insensitive i częściowe (`includes`)
 * po nazwie, e-mailu i telefonie.
 */
export function customerMatchesSearch(row: CustomerSearchable, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [row.fullName, row.email, row.phone].some((field) =>
    (field ?? "").toLowerCase().includes(needle),
  );
}

/** Zawęża listę do wierszy pasujących do `query` (kolejność zachowana). */
export function filterCustomersBySearch<T extends CustomerSearchable>(
  rows: T[],
  query: string,
): T[] {
  if (query.trim() === "") return rows;
  return rows.filter((row) => customerMatchesSearch(row, query));
}
