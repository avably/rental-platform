import type { CSSProperties } from "react";

/**
 * AUTO-UKŁAD OD LICZBY WPISÓW (E6, aneks ADR-094).
 *
 * ==================== PROBLEM, KTÓRY TO ZAMYKA ====================
 *
 * Sekcja listowa o STAŁEJ liczbie kolumn wygląda na zepsutą przy większości
 * realnych liczb wpisów. Trzy kolumny: siedem opinii daje 3 + 3 + 1 i dwie
 * puste komórki w ostatnim rzędzie; jedna opinia daje kafel na jedną trzecią
 * szerokości i dwie trzecie pustki obok. Cztery pozycje cennika stają w 3 + 1
 * zamiast w równych 2 + 2. To nie jest kwestia gustu: pusta komórka czyta się
 * jako „czegoś tu brakuje”, a najemca nie ma jak jej naprawić inaczej niż
 * dopisując wpis, którego nie ma.
 *
 * ==================== ROZWIĄZANIE: DWIE CZĘŚCI ====================
 *
 *   1. ILE KOLUMN — {@link autoColumns}, czysta funkcja LICZBY WPISÓW. Nie ma
 *      tu ani jednego rozgałęzienia po konkretnej liczbie: rzędy wychodzą
 *      z sufitu kolumn, a kolumny rozkładają się RÓWNO na te rzędy.
 *   2. JAK WYPEŁNIĆ RZĄD — arkusz (`.site-auto-grid` w site.css). Wpisy są
 *      elementami zawijanego pasa o podstawie jednej kolumny i wolno im
 *      rosnąć, więc KAŻDY rząd jest wypełniony do końca — także ostatni,
 *      niepełny. Dziura jest więc niemożliwa z konstrukcji, a nie „przewidziana
 *      dla licznności, o których pomyśleliśmy”.
 *
 * Podział jest celowy: liczba kolumn zależy od DANYCH (ilu wpisów), a sposób
 * wypełnienia rzędu — od układu. Wciśnięcie obu do komponentu znaczyłoby
 * przeliczanie rozstawu w JSX, a wciśnięcie obu do arkusza — utratę reguły,
 * którą da się przetestować bez przeglądarki.
 *
 * ==================== CZEGO TU NIE MA ====================
 *
 * Nie ma przycinania treści. Auto-układ ustala SZEROKOŚĆ kolumny i nic poza
 * tym: wysokość wpisu bierze się z jego zawartości, a długie słowo łamie się
 * (`min-width: 0` w arkuszu). Sekcja, która przy siedmiu wpisach ucina siódmy
 * albo skraca cytat, jest tą samą wadą co dziura — tylko trudniejszą do
 * zauważenia, bo brakującej treści nie widać.
 */

/**
 * SUFIT KOLUMN NA SZEROKIM KONTENERZE. Trzy, bo czwarta kolumna robi z pozycji
 * cennika i z opinii pasek tekstu węższy niż zdanie — a sufit dla wąskiego
 * kontenera (dwie kolumny, decyzja właściciela 2026-08-01) niesie arkusz, więc
 * render nie ma go po co znać.
 */
export const AUTO_LAYOUT_MAX_COLUMNS = 3;

/**
 * ILE KOLUMN DLA TYLU WPISÓW.
 *
 * Rzędów bierzemy najmniej, ile się da przy suficie kolumn, a potem rozkładamy
 * wpisy RÓWNO na te rzędy. Stąd 4 → 2 + 2 (a nie 3 + 1) i 2 → 2 + nic (a nie
 * 2 z pustą trzecią). Wynik nigdy nie przekracza liczby wpisów, więc jeden wpis
 * dostaje jedną kolumnę na pełną szerokość, a nie jedną trzecią i dwie
 * niewidoczne obok.
 *
 * Zero (lista pusta) nie jest realnym wejściem — każdy typ strukturalny ma
 * `minItems ≥ 1` — ale podłoga `1` stoi tu mimo to: zero kolumn dałoby
 * dzielenie przez zero w arkuszu, czyli sekcję bez ani jednego widocznego
 * wpisu zamiast pustej listy.
 */
export function autoColumns(count: number, cap: number = AUTO_LAYOUT_MAX_COLUMNS): number {
  if (count <= 1) return 1;
  const rows = Math.ceil(count / cap);
  return Math.ceil(count / rows);
}

/** Rozstaw wpisów — NAZWY, nie piksele (ta sama zasada, co gęstość galerii). */
export type AutoLayoutGap = "regular" | "roomy";

const AUTO_LAYOUT_GAP_REM: Record<AutoLayoutGap, string> = {
  regular: "1rem",
  roomy: "1.5rem",
};

/**
 * Klasa kontenera auto-układu. Jedna dla wszystkich typów — reguła wypełniania
 * rzędu jest jedna, więc jej druga kopia mogłaby się rozjechać tylko w jedną
 * stronę: gorszą.
 */
export const AUTO_LAYOUT_CLASS = "site-auto-grid list-none p-0";

/**
 * WARTOŚCI DLA ARKUSZA: liczba kolumn (z danych) i rozstaw (z układu).
 *
 * Właściwości niestandardowe, a nie klasy, z tego samego powodu, co przy
 * kolumnach galerii: liczba pochodzi z treści, a skaner Tailwinda buduje klasy
 * statycznie i nigdy nie zobaczyłby napisu `grid-cols-${n}`.
 */
export function autoLayoutStyle(count: number, gap: AutoLayoutGap = "roomy"): CSSProperties {
  return {
    "--site-auto-cols": String(autoColumns(count)),
    "--site-auto-gap": AUTO_LAYOUT_GAP_REM[gap],
  } as CSSProperties;
}
