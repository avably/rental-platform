/**
 * Wyszukiwarka listy zamówień (uwaga przeglądu U1) — ADR-057.
 *
 * WYBÓR REALIZACJI: filtr tekstowy działa po stronie serwera, ale nad już
 * odczytaną STRONĄ wyników (pragmatyczny wariant dopuszczony w briefie), nie
 * przez `.or()` PostgREST. Powód: haystack obejmuje pola z DOŁĄCZONEGO klienta
 * (nazwa, e-mail) oraz ETYKIETY statusów, które istnieją tylko po stronie i18n
 * — `.or()` po polu zagnieżdżonego zasobu jest w PostgREST niewygodny, a po
 * etykiecie statusu wręcz niemożliwy (baza zna kod, nie tłumaczenie). Strona
 * jest ograniczona (limit odczytu), więc dofiltrowanie w pamięci jest tanie i
 * daje dokładny licznik „N wyników". Gdy wolumen urośnie ponad stronę —
 * zastąpić indeksem/RPC. Kontrakt broni test `order-search.test.ts`.
 */

export interface OrderSearchable {
  id: string;
  orderNumber: string;
  customerName: string | null;
  customerEmail: string | null;
  orderStatusLabel: string;
  paymentStatusLabel: string;
}

/**
 * Czy wiersz pasuje do zapytania. Puste zapytanie pasuje do wszystkiego
 * (brak filtra). Dopasowanie jest CASE-insensitive i częściowe (`includes`) po
 * numerze, kliencie (nazwa + e-mail) i etykietach obu osi statusu.
 */
export function orderMatchesSearch(row: OrderSearchable, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [
    row.orderNumber,
    row.customerName,
    row.customerEmail,
    row.orderStatusLabel,
    row.paymentStatusLabel,
  ].some((field) => (field ?? "").toLowerCase().includes(needle));
}

/** Zawęża listę do wierszy pasujących do `query` (kolejność zachowana). */
export function filterBySearch<T extends OrderSearchable>(rows: T[], query: string): T[] {
  if (query.trim() === "") return rows;
  return rows.filter((row) => orderMatchesSearch(row, query));
}
