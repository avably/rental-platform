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
import { visibleCustomFields, type CustomFieldDefinition } from "@avably/core";

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

// -----------------------------------------------------------------------
// Pozycje katalogu do WSKAZANIA w sekcji sprzętu (E7, aneks ADR-094)
// -----------------------------------------------------------------------

/**
 * Wiersz katalogu w kształcie, w jakim czyta go trasa kreatora. Świadomie
 * WĄSKI: szuflada potrzebuje identyfikatora i nazwy, a cena, zdjęcia i bufory
 * serwisowe są sprawą renderu, który i tak czyta katalog własną drogą.
 */
export interface CatalogProductRow {
  id: string;
  name: string;
}

/**
 * POZYCJE KATALOGU DO WSKAZANIA — odnośnik do danych, NIE ich kopia.
 *
 * Odwrotnie niż przy punktach odbioru wyżej, i to jest różnica zamierzona.
 * Punkt odbioru kopiujemy, bo po skopiowaniu treść należy do sekcji i wolno ją
 * poprawić. Pozycję katalogu WSKAZUJEMY: w treści zostaje `value`
 * (identyfikator), a `label` żyje wyłącznie w szufladzie i znika razem z nią.
 * Kopia nazwy albo ceny byłaby drugim źródłem prawdy o ofercie — a cena
 * zmieniona w katalogu zostawiłaby na stronie głównej ofertę, której najemca
 * już nie składa.
 *
 * POZYCJA BEZ NAZWY WYPADA: schemat katalogu jej nie dopuszcza, ale gdyby
 * przeszła (import, migracja), operator dostałby na liście wyboru bezimienny
 * wiersz i nie miałby jak zgadnąć, co wskazuje.
 *
 * Kolejność zostaje z wejścia — trasa sortuje po nazwie, czyli tak, jak
 * operator widzi sprzęt na ekranie katalogu.
 */
export function catalogProductEntries(
  rows: readonly CatalogProductRow[],
): { value: string; label: string }[] {
  return rows
    .map((row) => ({ value: row.id, label: row.name.trim() }))
    .filter((entry) => entry.value.length > 0 && entry.label.length > 0);
}

// -----------------------------------------------------------------------
// Pola własne sprzętu do WSKAZANIA na kaflu (faza 1b, ADR-154)
// -----------------------------------------------------------------------

/**
 * POLA WŁASNE SPRZĘTU, KTÓRE WOLNO POKAZAĆ KLIENTOWI.
 *
 * ==================== TO JEST BRAMKA, A NIE PODPOWIEDŹ ====================
 *
 * Kafel sprzętu czyta podtytuł i cechy z pól własnych POZYCJI, a wartości tych
 * pól docierają do sklepu wyłącznie wtedy, gdy definicja jest oznaczona jako
 * widoczna w zamawianiu — zawęża je `app.get_public_catalog` (0058). Lista
 * wyboru w szufladzie MUSI więc być tym samym zbiorem, i to z dwóch powodów
 * naraz:
 *
 *   1. UCZCIWOŚĆ WOBEC OPERATORA. Wskazanie pola widocznego tylko w panelu
 *      dałoby kafel, na którym cecha po prostu się nie pojawia — bez błędu,
 *      bez komunikatu, bez śladu. Operator sprawdzałby wtedy zdjęcia, motyw
 *      i limit, zamiast dowiedzieć się, że wskazał pole spoza sklepu;
 *   2. ZERO ZACHĘTY DO WYNOSZENIA DANYCH. Lista pokazująca „Koszt zakupu"
 *      i „Numer w ewidencji" obok „Zasięgu" sugeruje, że wolno je wystawić.
 *      Baza i tak by ich nie wypuściła, ale interfejs nie ma prawa proponować
 *      operacji, która kończy się próbą pokazania klientowi danych lady.
 *
 * Filtr robi `visibleCustomFields` — DOKŁADNIE ta sama funkcja, którą panel
 * stosuje do formularzy i której lustrem jest warunek `show_in_checkout`
 * w bazie. Własny `if` po fladze byłby trzecią kopią tej samej reguły.
 *
 * POLE BEZ ETYKIETY WYPADA: schemat go nie dopuszcza, ale gdyby przeszło
 * (import, migracja), operator dostałby na liście bezimienny wiersz.
 */
export function productFieldEntries(
  definitions: readonly CustomFieldDefinition[],
): { value: string; label: string }[] {
  return visibleCustomFields(definitions, "checkout", "product")
    .map((definition) => ({ value: definition.id, label: definition.label.trim() }))
    .filter((entry) => entry.value.length > 0 && entry.label.length > 0);
}
