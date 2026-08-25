/**
 * KOLUMNY I PEŁNE RZĘDY SIATKI SPRZĘTU — PROGI I REGUŁY JAKO DANE
 * (E7, aneks ADR-094; pasma kolumn: decyzja właściciela K1, 2026-08-25).
 *
 * ==================== PO CO TEN PLIK ====================
 *
 * Liczbę kolumn i regułę „utnij ostatni, niepełny rząd" wykonuje ARKUSZ
 * (`site.css`), bo tylko on wie, ile miejsca ma siatka przy bieżącej
 * szerokości kontenera. Arkusz jest jednak artefaktem, którego nie da się
 * wywołać w teście — a reguła zapisana wyłącznie w nim jest regułą, której
 * nikt nie sprawdza. Lekcja PR #83 mówi dokładnie o tej klasie wady: bramka
 * licząca po deklaracji obok testu, a nie po tym, co NAPRAWDĘ stoi
 * w artefakcie, przechodzi na zielono po każdej zmianie artefaktu.
 *
 * Ten moduł jest jednym źródłem obu stron: tabela pasm (jedna dla kolumn
 * i dla reguły pełnych rzędów) plus GENERATORY tekstu bloków arkusza.
 * Kontrakt artefaktu (`product-grid.test.ts`) składa z nich oczekiwany zapis
 * i szuka go w `site.css` — więc skasowanie reguły dla trzech kolumn,
 * podmiana selektora albo cicha zmiana progu zapala test, zamiast zostawić
 * wiszący kafel (albo ukrytą pozycję) na opublikowanej stronie.
 *
 * ZERO KLAS MOTYWU: same nazwy klas siatki i teksty selektorów. Skan ról
 * (`structured-role-usage.test.tsx`) czyta ten plik razem z komponentami, więc
 * każda klasa `site-*` musiałaby mieć tu jawną decyzję — `site-product-grid`
 * i `site-product-columns` mają ją jako NEUTRALNE (geometria rzędu, ani
 * jednej zmiennej roli).
 */

/** Klasa siatki, do której reguła pełnych rzędów jest przyczepiona. */
export const PRODUCT_GRID_CLASS = "site-product-grid";

/**
 * KLASA NIOSĄCA LICZBĘ KOLUMN (K1, 2026-08-25). Do tej zmiany kolumny stały
 * jako utility w `productGrid` (template.ts), a ich lustro w tabeli niżej —
 * zmiana progu wymagała edycji dwóch plików naraz. Teraz kolumny realizuje
 * arkusz JEDNĄ klasą, tabela niżej jest jedynym źródłem pasm, a kontrakt
 * artefaktu składa z niej oczekiwany zapis i szuka go w `site.css`. Klasa
 * jest OSOBNA od `PRODUCT_GRID_CLASS`, bo kolumny dzielą też siatki BEZ
 * reguły pełnych rzędów (sekcja kategorii, katalog ze stronicowaniem — tam
 * ucięcie rzędu chowałoby pozycje, po które klient przyszedł).
 */
export const PRODUCT_COLUMNS_CLASS = "site-product-columns";

/**
 * PASMA SIATKI — jedyne źródło liczby kolumn per szerokość kontenera.
 *
 *   • do 28 rem — JEDNA kolumna (K1): dwie kolumny po ~145–165 px łamały
 *     tytuły na trzy linie, przycisk na dwie, a ceny w środku frazy (S-17);
 *     28 rem to ten sam próg, co jedna kolumna auto-układu wpisów (S-16) —
 *     jeden próg „telefonu" w całym arkuszu, dopisany do ADR-085;
 *   • 28–64 rem — dwie kolumny (dotychczasowa podstawa);
 *   • od 64 rem — trzy kolumny (bez zmian).
 *
 * `from: null` znaczy „od zera" — pasmo bez reguły w arkuszu, bo
 * `display: grid` bez szablonu kolumn DAJE jedną kolumnę; martwa reguła
 * `repeat(1, …)` tylko udawałaby decyzję, którą podjęła przeglądarka.
 */
export const PRODUCT_GRID_STEPS = [
  { columns: 1, from: null, until: "28rem" },
  { columns: 2, from: "28rem", until: "64rem" },
  { columns: 3, from: "64rem", until: null },
] as const;

export type ProductGridStep = (typeof PRODUCT_GRID_STEPS)[number];

/**
 * BLOK KOLUMN dla pasma — `@container` z regułą `grid-template-columns`.
 * `repeat(N, minmax(0, 1fr))` to dokładnie siatka, którą dawały klasy
 * `grid-cols-N` Tailwinda — zero zmiany wyglądu, zmienia się wyłącznie
 * miejsce, w którym stoi liczba.
 *
 * Zapytanie jest MOBILE-FIRST (`width >= from`), a nie domknięte z obu stron:
 * pasma wyższe stoją w arkuszu PÓŹNIEJ i wygrywają kaskadą tam, gdzie oba
 * zapytania są prawdziwe naraz. Dla pasma od zera bloku nie ma (patrz tabela).
 */
export function columnsBlockFor(step: ProductGridStep): string | null {
  if (step.from === null) return null;
  return `@container site (width >= ${step.from}) {\n  .${PRODUCT_COLUMNS_CLASS} {\n    grid-template-columns: repeat(${step.columns}, minmax(0, 1fr));\n  }\n}`;
}

/**
 * TEKST REGUŁY PEŁNYCH RZĘDÓW dla zadanej liczby kolumn.
 *
 * `:nth-child(Nn + 1)` wskazuje PIERWSZY kafel rzędu. Jeśli jest zarazem wśród
 * ostatnich N-1 kafli listy, to jego rząd się nie domknął — znika więc on
 * i wszystko po nim (`~ li`). `:not(:first-child)` jest podłogą: przy liczbie
 * kafli mniejszej od liczby kolumn jedyny rząd jest niepełny z konstrukcji,
 * a jego ukrycie dałoby sekcję bez ani jednej pozycji.
 *
 * Dla jednej kolumny reguła nie powstaje: każdy rząd jest wtedy pełny, a
 * `-n + 0` nie trafiłoby w nic i byłoby martwym zapisem w arkuszu.
 */
export function orphanRuleFor(columns: number): string {
  const selector = `.${PRODUCT_GRID_CLASS} > li:nth-child(${columns}n + 1):not(:first-child):nth-last-child(-n + ${columns - 1})`;
  return `${selector},\n  ${selector} ~ li {\n    display: none;\n  }`;
}

/**
 * BLOK PEŁNYCH RZĘDÓW dla pasma — reguła obowiązuje WYŁĄCZNIE w pasmie swojej
 * liczby kolumn, więc pasmo domknięte z obu stron dostaje ZAGNIEŻDŻONE
 * zapytanie (koniunkcja `width >= from` i `width < until` na tym samym
 * kontenerze `site`). Reguła `2n + 1` obowiązująca poniżej 28 rem ukrywałaby
 * przy jednej kolumnie ostatnią NIEPARZYSTĄ pozycję pełnego rzędu — dokładnie
 * ta wada, którą domknięcie pasma wyklucza. Pasmo jednej kolumny bloku nie ma
 * (`fullRowCount(n, 1) === n`, kontrakt w rdzeniu).
 */
export function orphanBlockFor(step: ProductGridStep): string | null {
  if (step.columns <= 1) return null;
  const rule = orphanRuleFor(step.columns);
  if (step.until === null) {
    return `@container site (width >= ${step.from}) {\n  ${rule}\n}`;
  }
  return `@container site (width >= ${step.from}) {\n  @container site (width < ${step.until}) {\n    ${rule}\n  }\n}`;
}

/**
 * CZY REGUŁA PEŁNYCH RZĘDÓW MOŻE UKRYĆ pozycje przy tej liczbie kafli —
 * w KTÓRYMKOLWIEK pasmie szerokości. Render nie zna bieżącej szerokości
 * kontenera (ta sama treść stoi na płótnie 390 px i w sklepie na pełnej),
 * więc pytanie jest o WSZYSTKIE pasma naraz: jeśli choć jedno ucina, część
 * oferty bywa niewidoczna i sekcja MUSI odesłać po resztę do katalogu
 * (decyzja właściciela K2, 2026-08-25; audyt S-21 — desktop widział trzy
 * z czterech pozycji bez śladu, że czwarta istnieje).
 *
 * Arytmetyka jest lustrem `fullRowCount` z rdzenia: pasmo ucina, gdy kafli
 * jest więcej niż kolumn i liczba nie dzieli się przez kolumny.
 */
export function productGridMayClip(shown: number): boolean {
  return PRODUCT_GRID_STEPS.some(
    ({ columns }) => shown > columns && shown % columns !== 0,
  );
}
