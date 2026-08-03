/**
 * KONTRAST — miara, nie opinia (K5, ADR-090).
 *
 * Panel „Styl strony" daje operatorowi wybór koloru akcentu. Wybór jest
 * ZAMKNIĘTY (nazwana paleta, nie dowolny hex) właśnie po to, żeby dało się
 * UDOWODNIĆ, że żadna dopuszczona kombinacja nie produkuje nieczytelnej strony.
 * Dowód jest testem, a test potrzebuje liczby — stąd ten moduł.
 *
 * Wzór jest z WCAG 2.1 (relatywna luminancja sRGB + iloraz (L1+0,05)/(L2+0,05)).
 * Świadomie NIE jest to APCA: próg 4,5:1 dla tekstu jest tym, do czego odnoszą
 * się wymagania dostępności, na które powołuje się reszta repo, a mieszanie
 * dwóch skal w jednym projekcie znaczy, że nikt nie wie, która obowiązuje.
 *
 * Wartości wchodzą jako HEX, bo w takiej postaci są AUTORSKIE: motyw zapisuje
 * kolory w `oklch()` z heksem w komentarzu obok (packages/ui/src/styles.css),
 * a paleta akcentów niżej powstaje tak samo. Konwersja oklch→sRGB w teście
 * dodałaby własny błąd numeryczny do liczby, która ma rozstrzygać spory.
 */

/** Próg WCAG AA dla tekstu podstawowego. */
export const CONTRAST_AA_TEXT = 4.5;

/**
 * Próg WCAG AA dla tekstu DUŻEGO (≥ 24 px albo ≥ 18,66 px pogrubiony) oraz dla
 * elementów nietekstowych (obrys, ikona niosąca znaczenie). Nagłówki płótna
 * zaczynają się od 1,875 rem = 30 px, więc mieszczą się w tej kategorii z
 * zapasem — ale skala jest zaciskiem i na wąskim płótnie schodzi niżej, dlatego
 * rejestr powierzchni niżej stosuje ten próg WYŁĄCZNIE tam, gdzie rozmiar jest
 * gwarantowany konstrukcyjnie, a nie tam, gdzie zwykle bywa duży.
 */
export const CONTRAST_AA_LARGE = 3;

/**
 * PRÓG WIDOCZNOŚCI KRESKI — i dlaczego NIE jest to 3:1 (K5, ADR-090).
 *
 * WCAG 1.4.11 żąda 3:1 od elementów nietekstowych, które NIOSĄ ZNACZENIE:
 * obrysu pola formularza, granicy komponentu interaktywnego, ikony
 * rozstrzygającej o stanie. Kreska między kartą a pasem strony marketingowej
 * do tej kategorii nie należy: kartę identyfikuje POWIERZCHNIA i układ, a
 * kreska ją najwyżej dopowiada. Wymuszenie 3:1 na włosowej linii zamieniłoby
 * każdy motyw w szkielet z kreślarki — dokładnie odwrotnie niż „gotowe do
 * produkcji od pierwszego wejścia".
 *
 * Zostaje więc próg WIDOCZNOŚCI: kreska ma być widoczna, a nie dostępnościowa.
 * 1,2:1 to najniższa różnica, przy której hairline daje się zauważyć na
 * typowym ekranie — i zarazem liczba, która wywala kartę o obrysie tego samego
 * koloru co jej tło (przypadek, w którym karta po prostu znika).
 *
 * GRANICA WYJĄTKU (decyzja PM, ADR-090): ten próg wolno przyłożyć WYŁĄCZNIE do
 * dekoracyjnej LINII ROZDZIELAJĄCEJ — obrysu karty, kreski pod pozycją FAQ,
 * separatora. Tekst (podstawowy, przygaszony, akcentowy) trzyma
 * {@link CONTRAST_AA_TEXT}; etykieta na wypełnieniu, wypełnienie przycisku jako
 * kształt i pierścień focusu trzymają {@link CONTRAST_AA_TEXT} albo
 * {@link CONTRAST_AA_LARGE} — bez wyjątku. Rozszerzenie tego wyjątku na
 * cokolwiek innego jest decyzją PM, nie autora zmiany.
 */
export const VISIBLE_EDGE = 1.2;

/** Kanały sRGB 0…255 z zapisu `#rrggbb` (skrót `#rgb` też). */
export function rgbFromHex(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Nie jest kolorem #rrggbb: ${hex}`);
  }
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** Relatywna luminancja sRGB (WCAG 2.1, 1.4.3). */
export function relativeLuminance(hex: string): number {
  const channels = rgbFromHex(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/**
 * Iloraz kontrastu dwóch kolorów NIEPRZEZROCZYSTYCH, od 1 (identyczne) do 21
 * (czerń–biel). Kolejność argumentów nie ma znaczenia.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Kolor półprzezroczysty ZŁOŻONY na nieprzezroczystym tle. Potrzebne, bo kafelek
 * ikony kładzie akcent z alfą 10 % na tle sekcji (`bg-primary/10`) i dopiero ta
 * MIESZANINA jest tłem dla napisu — liczenie kontrastu wprost do akcentu dałoby
 * wynik, którego na ekranie nie ma.
 */
export function flatten(foreground: string, background: string, alpha: number): string {
  const fg = rgbFromHex(foreground);
  const bg = rgbFromHex(background);
  const mixed = fg.map((value, index) => Math.round(value * alpha + bg[index]! * (1 - alpha)));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
