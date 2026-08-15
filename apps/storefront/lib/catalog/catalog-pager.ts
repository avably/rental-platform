/**
 * OKNO NUMERÓW W NAWIGACJI STRON KATALOGU (faza 4b, ADR-186).
 *
 * ==================== DLACZEGO NIE WSZYSTKIE NUMERY ====================
 *
 * Katalog 2 000 pozycji to 84 strony. Wypisanie wszystkich numerów daje pasek
 * dłuższy od treści, 84 odnośniki do przejścia klawiaturą i 84 linki wewnętrzne
 * na KAŻDEJ stronie katalogu — czyli dokładnie ten kształt, który wyszukiwarki
 * czytają jako nawigację niosącą mało informacji.
 *
 * ==================== CZEGO OKNO NIE MOŻE STRACIĆ ====================
 *
 * PIERWSZEJ I OSTATNIEJ STRONY. To są dwa jedyne punkty, do których klient
 * chce skoczyć wprost („wróć na początek", „zobacz koniec oferty"), i dwa
 * jedyne, których nie da się odtworzyć z sąsiedztwa. Reszta okna jest
 * sąsiedztwem bieżącej strony.
 *
 * PRZERWA (`gap`) NIE JEST LICZBĄ i dlatego ma własną reprezentację, a nie
 * `-1` albo `0` w tej samej tablicy: render rysuje ją jako tekst bez odnośnika,
 * a liczba-wartownik prędzej czy później trafi do `catalogPagePath` i wyprodukuje
 * adres `?strona=-1`.
 */

/** Ile stron pokazujemy po każdej stronie bieżącej (poza pierwszą i ostatnią). */
export const CATALOG_PAGER_RADIUS = 2;

export type CatalogPagerItem = number | "gap";

/**
 * Numery stron do wypisania w nawigacji — zawsze rosnąco, zawsze z pierwszą
 * i ostatnią stroną, z przerwami tam, gdzie ciąg się rwie.
 *
 * Wejście spoza zakresu (numer strony większy od liczby stron, liczba stron
 * mniejsza od jednej) nie jest tu błędem: funkcja jest CZYSTA i ma oddać
 * sensowną listę także dla stanu, którego trasa i tak nie dopuści (404).
 */
export function catalogPagerItems(
  page: number,
  pageCount: number,
  radius = CATALOG_PAGER_RADIUS,
): CatalogPagerItem[] {
  const stron = Math.max(1, Math.trunc(pageCount));
  const biezaca = Math.min(Math.max(1, Math.trunc(page)), stron);

  const numery = new Set<number>([1, stron]);
  for (let n = biezaca - radius; n <= biezaca + radius; n += 1) {
    if (n >= 1 && n <= stron) numery.add(n);
  }

  const posortowane = [...numery].sort((a, b) => a - b);
  const wynik: CatalogPagerItem[] = [];
  let poprzedni = 0;
  for (const numer of posortowane) {
    // Przerwa tylko wtedy, gdy naprawdę coś wypadło. Dziura o szerokości
    // JEDNEJ strony jest gorsza niż jej numer: „1 … 3" zajmuje tyle samo
    // miejsca co „1 2 3" i odbiera jedno kliknięcie.
    if (poprzedni && numer - poprzedni === 2) wynik.push(poprzedni + 1);
    else if (poprzedni && numer - poprzedni > 2) wynik.push("gap");
    wynik.push(numer);
    poprzedni = numer;
  }
  return wynik;
}
