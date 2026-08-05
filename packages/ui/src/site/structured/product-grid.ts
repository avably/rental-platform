/**
 * PEŁNE RZĘDY SIATKI SPRZĘTU — PROGI I REGUŁA JAKO DANE (E7, aneks ADR-094).
 *
 * ==================== PO CO TEN PLIK ====================
 *
 * Regułę „utnij ostatni, niepełny rząd" wykonuje ARKUSZ (`site.css`), bo tylko
 * on wie, ile kolumn ma siatka przy bieżącej szerokości kontenera. Arkusz jest
 * jednak artefaktem, którego nie da się wywołać w teście — a reguła zapisana
 * wyłącznie w nim jest regułą, której nikt nie sprawdza. Lekcja PR #83 mówi
 * dokładnie o tej klasie wady: bramka licząca po deklaracji obok testu, a nie
 * po tym, co NAPRAWDĘ stoi w artefakcie, przechodzi na zielono po każdej
 * zmianie artefaktu.
 *
 * Ten moduł jest jednym źródłem obu stron: tabela progów (te same, co
 * `productGrid` w template.ts) plus GENERATOR tekstu reguły. Kontrakt artefaktu
 * składa z nich oczekiwany zapis i szuka go w `site.css` — więc skasowanie
 * reguły dla trzech kolumn albo podmiana selektora zapala test, zamiast
 * zostawić wiszący kafel na opublikowanej stronie.
 *
 * ZERO KLAS MOTYWU: sama nazwa klasy siatki i tekst selektora. Skan ról
 * (`structured-role-usage.test.tsx`) czyta ten plik razem z komponentami, więc
 * każda klasa `site-*` musiałaby mieć tu jawną decyzję — `site-product-grid`
 * ma ją jako NEUTRALNĄ (geometria rzędu, ani jednej zmiennej roli).
 */

/** Klasa siatki, do której reguła pełnych rzędów jest przyczepiona. */
export const PRODUCT_GRID_CLASS = "site-product-grid";

/**
 * PROGI SIATKI — lustro `productGrid` w template.ts (`grid-cols-2` do 64 rem,
 * `grid-cols-3` powyżej). Rozjazd tej tabeli z klasami siatki znaczyłby regułę
 * ucinającą do INNEJ liczby kolumn, niż ma siatka — czyli albo wiszący kafel
 * mimo reguły, albo ucięty rząd, który był pełny. Kontrakt zestawia oba zapisy.
 */
export const PRODUCT_GRID_STEPS = [
  { query: "(width < 64rem)", columns: 2 },
  { query: "(width >= 64rem)", columns: 3 },
] as const;

/**
 * TEKST REGUŁY dla zadanej liczby kolumn.
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
