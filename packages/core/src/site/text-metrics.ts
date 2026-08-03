/**
 * MIARY TEKSTU I PUDEŁEK OBEJMUJĄCYCH TREŚĆ (K4, ADR-088).
 *
 * Do K3 estymator wysokości pudełka tekstowego mieszkał w konwersji presetów
 * i znał JEDNĄ szerokość płótna — projektową. To wystarczało, dopóki geometria
 * liczyła się tylko dla desktopu. Auto-układ mobilny pyta o to samo przy
 * płótnie 390 px, a tam odpowiedź jest INNA z dwóch niezależnych powodów:
 *
 *   1. JEDNOSTKA SIATKI JEST UŁAMKIEM SZEROKOŚCI PŁÓTNA (K2c, ADR-087), więc
 *      na 390 px ma ~2,7 px zamiast 8 px. Wiersz tekstu o stałej wysokości
 *      w pikselach zajmuje na telefonie prawie trzy razy więcej JEDNOSTEK.
 *   2. FONT NIE SKALUJE SIĘ W DÓŁ BEZ KOŃCA. Skale typografii są zaciśnięte
 *      (`clamp`) — poniżej pewnej szerokości tekst zostaje przy rozmiarze
 *      czytelnym zamiast maleć razem z płótnem. Ten sam akapit łamie się więc
 *      na telefonie na WIĘCEJ wierszy, niż wynikałoby z samej proporcji.
 *
 * Estymator jest tu zgrubny CELOWO: ma dać pudełko z zapasem, a nie zmierzyć
 * font, którego ten pakiet nie zna. Ma za to być DETERMINISTYCZNY — ta sama
 * treść przy tej samej szerokości projektowej daje bajtowo ten sam wynik, bo
 * inaczej auto-układu nie dałoby się ani porównać w teście, ani powtórzyć.
 *
 * Przy szerokości projektowej ({@link CANVAS_DESIGN_WIDTH_PX}) wszystkie wzory
 * niżej sprowadzają się do liczb sprzed K4 co do jednostki — konwersja sekcji
 * v1 daje więc dokładnie ten sam wynik, co przed tym etapem.
 */
import {
  CANVAS_COLUMNS,
  CANVAS_CONTENT_COLUMNS,
  CANVAS_DESIGN_WIDTH_PX,
  type CanvasElement,
} from "./elements";

/**
 * SKALE TEKSTU — cztery liczby na skalę.
 *
 * `charsPerLine` i `rowsPerLine` są ZMIERZONE na żywym renderze (szablon
 * `classic`, płótno przy szerokości projektowej) i opisują pas treści o pełnej
 * szerokości. `designPx` i `minPx` to końce zacisku `clamp()` z arkusza
 * `site.css` — dolny koniec jest tym, co dostaje telefon.
 *
 * Pierwsza wersja konwersji miała JEDNĄ gęstość dla wszystkich skal (~90 znaków
 * w wierszu) i dlatego nagłówek hero — 72 px, gdzie w wierszu mieszczą się ~22
 * znaki — wychodził poza swoje pudełko i NACHODZIŁ na tekst pod nim.
 */
export const TEXT_SCALES = {
  /** Nagłówek hero (`landing-display`). */
  display: { charsPerLine: 22, rowsPerLine: 10, designPx: 72, minPx: 42 },
  /** Nagłówek sekcji (`landing-heading`). */
  heading: { charsPerLine: 34, rowsPerLine: 7, designPx: 48, minPx: 30 },
  /** Tytuł bloku (poziom 3). */
  title: { charsPerLine: 44, rowsPerLine: 4, designPx: 20, minPx: 17 },
  /** Wprowadzenie (`lead`). */
  lead: { charsPerLine: 70, rowsPerLine: 4, designPx: 20, minPx: 16 },
  /** Akapit. */
  body: { charsPerLine: 90, rowsPerLine: 3, designPx: 16, minPx: 14 },
  /** Drobny tekst — także etykieta przycisku. */
  small: { charsPerLine: 100, rowsPerLine: 3, designPx: 14, minPx: 13 },
} as const;
export type TextScale = keyof typeof TEXT_SCALES;

/**
 * Rozmiar fontu danej skali przy zadanej szerokości płótna — dokładnie to, co
 * robi `clamp(minPx, …cqw, designPx)` w arkuszu. Ta funkcja i tamten zapis
 * MUSZĄ mówić to samo; pilnuje tego kontrakt typografii płótna.
 */
export function fontPxAt(scale: TextScale, canvasWidthPx: number): number {
  const { designPx, minPx } = TEXT_SCALES[scale];
  const width = canvasWidthPx > 0 ? canvasWidthPx : CANVAS_DESIGN_WIDTH_PX;
  return Math.min(designPx, Math.max(minPx, (designPx * width) / CANVAS_DESIGN_WIDTH_PX));
}

/** Bok jednostki siatki w pikselach przy zadanej szerokości płótna. */
export function unitPxAt(canvasWidthPx: number): number {
  const width = canvasWidthPx > 0 ? canvasWidthPx : CANVAS_DESIGN_WIDTH_PX;
  return width / CANVAS_COLUMNS;
}

/** Piksele → jednostki siatki, w GÓRĘ (pudełko ma mieścić, nie ciąć). */
export function unitsForPx(px: number, canvasWidthPx: number): number {
  return Math.max(1, Math.ceil(px / unitPxAt(canvasWidthPx)));
}

/**
 * Ile znaków mieści się w wierszu pudełka o `columns` kolumnach. Wąskie pudełko
 * mieści proporcjonalnie mniej; węższe płótno mieści mniej dwa razy — raz przez
 * mniejszą liczbę pikseli, drugi raz przez font, który przestał maleć.
 */
export function charsPerLineAt(
  scale: TextScale,
  columns: number,
  canvasWidthPx: number,
): number {
  const spec = TEXT_SCALES[scale];
  const widthRatio = columns / CANVAS_CONTENT_COLUMNS;
  const canvasRatio = (canvasWidthPx > 0 ? canvasWidthPx : CANVAS_DESIGN_WIDTH_PX) / CANVAS_DESIGN_WIDTH_PX;
  const fontRatio = spec.designPx / fontPxAt(scale, canvasWidthPx);
  return Math.max(8, Math.round(spec.charsPerLine * widthRatio * canvasRatio * fontRatio));
}

/** Wysokość JEDNEGO wiersza w jednostkach siatki przy zadanej szerokości płótna. */
export function rowsPerLineAt(scale: TextScale, canvasWidthPx: number): number {
  const spec = TEXT_SCALES[scale];
  const width = canvasWidthPx > 0 ? canvasWidthPx : CANVAS_DESIGN_WIDTH_PX;
  const fontRatio = fontPxAt(scale, canvasWidthPx) / spec.designPx;
  return Math.max(1, Math.ceil(spec.rowsPerLine * (CANVAS_DESIGN_WIDTH_PX / width) * fontRatio));
}

/**
 * Wysokość pudełka tekstowego w jednostkach siatki przy zadanej szerokości
 * płótna. Uogólnienie estymatora z K2 — patrz {@link textRows}.
 */
export function textRowsAt(
  text: string,
  scale: TextScale,
  columns: number,
  canvasWidthPx: number,
  minRows = 0,
): number {
  const perLine = charsPerLineAt(scale, columns, canvasWidthPx);
  const lines = Math.max(1, Math.ceil(text.trim().length / perLine));
  const rows = rowsPerLineAt(scale, canvasWidthPx);
  return Math.max(minRows, rows, lines * rows);
}

/**
 * Wysokość pudełka tekstowego przy szerokości PROJEKTOWEJ (desktop). Zostaje
 * pod dotychczasową nazwą i sygnaturą, bo tak woła ją konwersja dwunastu typów
 * sekcji — a jej wynik jest zapisaną geometrią tenanta, nie liczbą do
 * przestawiania mimochodem.
 */
export function textRows(
  text: string,
  scale: TextScale = "body",
  columns = CANVAS_CONTENT_COLUMNS,
  minRows = 0,
): number {
  return textRowsAt(text, scale, columns, CANVAS_DESIGN_WIDTH_PX, minRows);
}

// -----------------------------------------------------------------------
// Pudełko obejmujące treść (hug)
// -----------------------------------------------------------------------

/**
 * Wewnętrzny rozstaw przycisku w pikselach (poziomo i pionowo razem) — brany
 * z HOJNIEJSZEGO z dwóch szablonów (`bold`: `px-8 py-4`, tekst 16 px), żeby
 * szacunek był pudełkiem z zapasem, a nie pudełkiem, z którego napis wystaje.
 */
const BUTTON_PAD_X_PX = 64;
const BUTTON_HEIGHT_PX = 56;

/**
 * KAFELEK IKONY — bok w pikselach przy szerokości projektowej i przy telefonie.
 *
 * Ikona ma ten sam problem, co typografia: rozmiar w `rem` NIE maleje razem
 * z płótnem, więc kafelek 48 px w miejscu wyliczonym na 6 jednostek (48 px przy
 * szerokości projektowej, 32 px przy 768 px) wchodził na tytuł pod sobą. Bok
 * jest więc zaciśnięty tak samo, jak font: skaluje się z płótnem, a w dół
 * zatrzymuje się na rozmiarze, który jeszcze da się kliknąć palcem.
 */
export const ICON_DESIGN_PX = 48;
export const ICON_MIN_PX = 32;

/** Bok kafelka ikony przy zadanej szerokości płótna — patrz {@link fontPxAt}. */
export function iconPxAt(canvasWidthPx = CANVAS_DESIGN_WIDTH_PX): number {
  const width = canvasWidthPx > 0 ? canvasWidthPx : CANVAS_DESIGN_WIDTH_PX;
  return Math.min(
    ICON_DESIGN_PX,
    Math.max(ICON_MIN_PX, (ICON_DESIGN_PX * width) / CANVAS_DESIGN_WIDTH_PX),
  );
}

/** Odstęp między adresem a linkiem w elemencie mapy (px) plus wiersz linku. */
const MAP_LINK_EXTRA_PX = 28;

/** Skala tekstu, którą element rysuje — jedno miejsce prawdy dla estymatorów. */
export function scaleOfElement(element: CanvasElement): TextScale {
  switch (element.kind) {
    case "heading":
      return element.level === 1 ? "display" : element.level === 2 ? "heading" : "title";
    case "text":
      return element.variant === "lead" ? "lead" : element.variant === "small" ? "small" : "body";
    case "button":
      return "small";
    case "mapLink":
      return "body";
    default:
      return "body";
  }
}

/** Ile kolumn zajmuje `length` znaków danej skali w JEDNYM wierszu. */
function columnsForChars(length: number, scale: TextScale, canvasWidthPx: number): number {
  const perLine = charsPerLineAt(scale, CANVAS_CONTENT_COLUMNS, canvasWidthPx);
  return Math.min(
    CANVAS_COLUMNS,
    Math.max(1, Math.ceil((length * CANVAS_CONTENT_COLUMNS) / perLine)),
  );
}

/**
 * SZACUNEK PUDEŁKA OBEJMUJĄCEGO TREŚĆ.
 *
 * To NIE jest pomiar — pomiaru dokonuje przeglądarka (render wystawia
 * `max-content`, a kreator czyta pudełko z DOM-u). To jest liczba, której
 * potrzebują trzy miejsca bez dostępu do przeglądarki: fabryka elementu (gdzie
 * go położyć), konwersja presetów (ile miejsca zająć w układzie) i auto-układ
 * mobilny (jak wysoki jest wiersz kolumny). Rozjazd szacunku z pomiarem jest
 * WPISANY W MODEL i nieszkodliwy: wpływa na odstępy, nie na to, co widać.
 *
 * `null` dla rodzajów bez własnego rozmiaru naturalnego (zdjęcie, kształt,
 * katalog) — patrz `HUG_KINDS`.
 */
export function hugBox(
  element: CanvasElement,
  canvasWidthPx = CANVAS_DESIGN_WIDTH_PX,
): { w: number; h: number } | null {
  switch (element.kind) {
    case "heading":
    case "text": {
      const scale = scaleOfElement(element);
      const w = columnsForChars(element.text.trim().length, scale, canvasWidthPx);
      return { w, h: textRowsAt(element.text, scale, w, canvasWidthPx) };
    }
    case "button": {
      const scale = scaleOfElement(element);
      const label = columnsForChars(element.label.trim().length, scale, canvasWidthPx);
      return {
        w: Math.min(CANVAS_COLUMNS, label + unitsForPx(BUTTON_PAD_X_PX, canvasWidthPx)),
        h: unitsForPx(BUTTON_HEIGHT_PX, canvasWidthPx),
      };
    }
    case "icon": {
      const side = unitsForPx(iconPxAt(canvasWidthPx), canvasWidthPx);
      return { w: side, h: side };
    }
    case "mapLink": {
      const scale = scaleOfElement(element);
      const w = columnsForChars(
        Math.max(element.address.trim().length, element.url.trim().length),
        scale,
        canvasWidthPx,
      );
      return {
        w,
        h:
          textRowsAt(element.address, scale, w, canvasWidthPx) +
          unitsForPx(MAP_LINK_EXTRA_PX, canvasWidthPx),
      };
    }
    default:
      return null;
  }
}
