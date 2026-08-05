/**
 * ŹRÓDŁA WPISÓW DO SKOPIOWANIA W MINI-CMS (E5, ADR-096) — czysta warstwa
 * między wierszem bazy a wpisem sekcji strukturalnej.
 *
 * ==================== PO CO OSOBNY MODUŁ ====================
 *
 * Mapowanie mieszkało w trasie RSC (`.../kreator/page.tsx`) razem z odsiewem
 * punktów nieaktywnych — i to była LUKA, którą znalazła recenzja PM: wycięcie
 * `.eq("active", true)` z zapytania przechodziło CAŁĄ siatkę testów na zielono,
 * bo trasy serwerowej nie widzi żaden test jednostkowy. Reguła „strona ogłasza
 * wyłącznie punkty, które naprawdę przyjmują odbiory" jest za to regułą
 * PRODUKTOWĄ, a nie szczegółem zapytania, więc stoi tutaj, ma test i pali się,
 * gdy zniknie.
 *
 * Zapytanie w trasie NIE filtruje już samo — inaczej mielibyśmy dwa miejsca
 * decydujące o tym samym i mutacja jednego z nich znów byłaby niewidoczna.
 */

/**
 * Wiersz punktu odbioru w kształcie, w jakim czyta go trasa kreatora. Kolumny
 * adresu bywają puste (model ich nie wymaga), `active` przełącza operator
 * w module Dostaw.
 */
export interface PickupLocationRow {
  name: string;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  active: boolean;
}

/** Wpis sekcji dojazdu — dokładnie te pola, które przyjmuje schemat typu. */
export interface PickupLocationEntry {
  label: string;
  address: string;
}

/**
 * Adres punktu złożony z kolumn: „ulica, kod miasto". Puste człony wypadają,
 * więc punkt z samym miastem daje „Warszawa", a nie „, , Warszawa" — a punkt
 * bez ani jednego członu nie daje nic (patrz niżej).
 */
function addressOf(row: PickupLocationRow): string {
  const zipCity = [row.address_zip, row.address_city]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join(" ");
  return [row.address_street?.trim() ?? "", zipCity]
    .filter((part) => part.length > 0)
    .join(", ");
}

/**
 * WPISY DO SKOPIOWANIA z punktów odbioru — kopia danych, nie odnośnik do nich
 * (ADR-096, D5): wynik niesie NAPISY, więc zmiana punktu w Dostawach nie ma jak
 * przestawić opublikowanej strony.
 *
 * Dwa odsiewy, oba świadome:
 *   • PUNKT NIEAKTYWNY WYPADA. Punkt wyłączony w Dostawach nie przyjmuje
 *     odbiorów, a strona, która go ogłasza, wysyła klienta pod zamknięte drzwi.
 *     To jest cała treść tej funkcji i to ona ma własny test;
 *   • PUNKT BEZ ADRESU WYPADA. Adres jest jedynym polem WYMAGANYM przez schemat
 *     sekcji, więc taki wpis nie dałby się zapisać — a pozycja na liście do
 *     skopiowania, której wstawienie kończy się błędem, jest gorsza niż jej brak.
 *
 * Kolejność zostaje z wejścia (trasa sortuje po nazwie, czyli tak, jak operator
 * widzi punkty na ekranie Dostaw); po skopiowaniu i tak wolno ją przestawić,
 * bo treść należy już do sekcji.
 */
export function pickupLocationEntries(
  rows: readonly PickupLocationRow[],
): PickupLocationEntry[] {
  return rows
    .filter((row) => row.active)
    .map((row) => ({ label: row.name, address: addressOf(row) }))
    .filter((entry) => entry.address.length > 0);
}
