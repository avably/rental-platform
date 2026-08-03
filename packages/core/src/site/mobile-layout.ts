/**
 * AUTO-UKŁAD MOBILNY (K4, ADR-088) — jedna kolumna wyprowadzona z desktopu.
 *
 * Cena geometrii absolutnej jest znana od K2 i przyjęta świadomie (plan Kreatora
 * 2.0, decyzja 3): układ złożony na desktopie zwężony do telefonu robi się
 * ciasny. Odpowiedzią NIE jest drugi, ręcznie budowany układ — operator
 * wypożyczalni nie zbuduje strony dwa razy. Odpowiedzią jest układ WYPROWADZONY
 * z desktopu, deterministycznie, z możliwością ręcznej poprawki tam, gdzie
 * automat się nie domyślił.
 *
 * ================== TRZY ZASADY ==================
 *
 * 1. FUNKCJA CZYSTA. Żadnego DOM-u, żadnego pomiaru, żadnego stanu. Ta sama
 *    treść daje bajtowo ten sam układ w panelu i w sklepie — a musi, bo płótno
 *    kreatora ma być DOWODEM na to, co zobaczy klient, a nie przybliżeniem.
 *    Wynik NIE jest zapisywany do treści: liczy się na bieżąco przy każdym
 *    renderze, więc element dodany na desktopie pojawia się na telefonie bez
 *    niczyjej ręki, a zmiana heurystyki działa wstecz na całą zapisaną treść.
 *
 * 2. KOLEJNOŚĆ CZYTANIA JEST ŚWIĘTA — i NIE wynika z sortowania po (y, x).
 *    Sortowanie po współrzędnych wygląda na oczywiste i jest błędne dokładnie
 *    tam, gdzie boli najbardziej: w układzie wielokolumnowym (atuty, galeria)
 *    daje kolejność wierszami, czyli WSZYSTKIE ikony, potem WSZYSTKIE tytuły,
 *    potem WSZYSTKIE opisy — trzy kafle rozprute na dziewięć osobnych pasków.
 *    Kolejność bierze się więc z REKURENCYJNEGO CIĘCIA płótna: najpierw cięcie
 *    poziome (nad/pod), potem pionowe (obok siebie), i tak w dół. Kolumna
 *    czyta się w całości, zanim zacznie się następna — dokładnie tak, jak
 *    patrzy na nią człowiek.
 *
 * 3. GRUPY PRZEŻYWAJĄ ZWIJANIE. Zbiór, którego nie da się przeciąć ANI poziomo,
 *    ANI pionowo, jest jedną całością — bo elementy w nim NACHODZĄ na siebie.
 *    To jest właśnie baner sekcji CTA i kafel opinii: kształt-tło plus treść na
 *    nim. Treść grupy układa się w kolumnę WEWNĄTRZ niej, a kształt-podkład
 *    obejmuje wynik, zamiast wylądować jako osobny prostokąt nad tekstem, do
 *    którego należy.
 *
 * ================== RĘCZNA POPRAWKA ==================
 *
 * `layout.mobile` obecne = operator poprawił ten element ręcznie; jego pudełko
 * WYGRYWA z automatem, a reszta układa się tak, jakby poprawki nie było —
 * dzięki temu „wróć do auto" (skasowanie pola) przywraca dokładnie to miejsce,
 * z którego element wyszedł.
 */
import {
  CANVAS_CONTENT_COLUMNS,
  CANVAS_PAD_COLUMNS,
  GRID_UNIT_PX,
  MOBILE_DESIGN_WIDTH_PX,
  SECTION_MAX_ROWS_MOBILE,
  SECTION_MIN_ROWS,
  sizeOf,
  type CanvasElement,
  type Geometry,
  type SectionCanvas,
} from "./elements";
import { hugBox, scaleOfElement, textRowsAt, unitsForPx } from "./text-metrics";

/** Odstęp od górnej i dolnej krawędzi sekcji (px → jednostki płótna mobilnego). */
const EDGE_PAD_PX = 32;
/** Odstęp MIĘDZY grupami w kolumnie. */
const GROUP_GAP_PX = 24;
/** Odstęp między elementami WEWNĄTRZ grupy — ciaśniejszy, bo to jedna całość. */
const INNER_GAP_PX = 12;
/** Wewnętrzny rozstaw karty (kształt-podkład wokół swojej treści). */
const CARD_PAD_PX = 24;

const EDGE_PAD = unitsForPx(EDGE_PAD_PX, MOBILE_DESIGN_WIDTH_PX);
const GROUP_GAP = unitsForPx(GROUP_GAP_PX, MOBILE_DESIGN_WIDTH_PX);
const INNER_GAP = unitsForPx(INNER_GAP_PX, MOBILE_DESIGN_WIDTH_PX);
const CARD_PAD = unitsForPx(CARD_PAD_PX, MOBILE_DESIGN_WIDTH_PX);

/**
 * Rodzaje, które na telefonie BIORĄ CAŁĄ SZEROKOŚĆ pasa treści, gdy ich wymiar
 * jest jawny. Przycisku i ikony NIE MA na tej liście świadomie: przycisk
 * rozciągnięty na 325 px wygląda jak pasek nawigacji, a ikona jak baner. Oba
 * rodzaje zachowują swój rozmiar FIZYCZNY — to samo, co widać na desktopie.
 */
const STRETCHY_KINDS = new Set<CanvasElement["kind"]>([
  "heading",
  "text",
  "image",
  "catalog",
  "mapLink",
  "shape",
]);

export interface MobileLayout {
  /** Wysokość płótna mobilnego w jednostkach — wynika z układu, nie z treści. */
  rows: number;
  /** Geometria mobilna każdego elementu (automat albo ręczna poprawka). */
  boxes: Record<string, Geometry>;
  /** Identyfikatory elementów ODPIĘTYCH od automatu (mają własną poprawkę). */
  detached: ReadonlySet<string>;
}

/** Czy element ma RĘCZNĄ poprawkę mobilną — jedno pytanie na cały system. */
export function isDetachedOnMobile(element: CanvasElement): boolean {
  return element.layout.mobile !== undefined;
}

/** Czy dwa pudełka nachodzą na siebie (styk krawędziami NIE jest nachodzeniem). */
function intersects(a: Geometry, b: Geometry): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Element z pozycją w tablicy — indeks rozstrzyga remisy, więc cięcie jest stabilne. */
interface Placed {
  element: CanvasElement;
  index: number;
}

const startOn = (placed: Placed, axis: "x" | "y") =>
  axis === "x" ? placed.element.layout.desktop.x : placed.element.layout.desktop.y;
const endOn = (placed: Placed, axis: "x" | "y") =>
  axis === "x"
    ? placed.element.layout.desktop.x + placed.element.layout.desktop.w
    : placed.element.layout.desktop.y + placed.element.layout.desktop.h;

interface Cut {
  /** Szerokość przerwy w jednostkach — to ona rozstrzyga, którą osią ciąć. */
  gap: number;
  before: Placed[];
  after: Placed[];
}

/**
 * NAJSZERSZE CIĘCIE wzdłuż osi: linia, której nie przecina żadne pudełko, a po
 * obu jej stronach zostaje jak najwięcej pustego miejsca. `null`, gdy takiej
 * linii nie ma (pudełka zachodzą na siebie w rzucie na tę oś).
 *
 * Zamiatamy od początku osi i pilnujemy najdalszej krawędzi końca; gdy kolejne
 * pudełko zaczyna się ZA nią, mamy kandydata. Wybieramy NAJSZERSZĄ przerwę,
 * a nie pierwszą z brzegu, i to jest sedno całej heurystyki: w rzędzie kafli
 * „ikona / tytuł / opis" przerwy pionowe MIĘDZY kaflami są szersze niż poziome
 * WEWNĄTRZ kafla, więc najpierw odcinają się całe kafle, a dopiero potem ich
 * zawartość. Cięcie „pierwsze z brzegu" zdejmowałoby najpierw pas ikon i
 * rozpruwało trzy kafle na dziewięć luźnych pasków.
 */
function widestCut(placed: readonly Placed[], axis: "x" | "y"): Cut | null {
  const sorted = [...placed].sort(
    (a, b) => startOn(a, axis) - startOn(b, axis) || endOn(a, axis) - endOn(b, axis) || a.index - b.index,
  );
  let reach = endOn(sorted[0]!, axis);
  let best: { gap: number; at: number } | null = null;
  for (let at = 1; at < sorted.length; at += 1) {
    const gap = startOn(sorted[at]!, axis) - reach;
    // Remis rozstrzyga PIERWSZE wystąpienie (ostry warunek) — bez tego ta sama
    // treść mogłaby dać dwa różne układy zależnie od kolejności w tablicy.
    if (gap >= 0 && (!best || gap > best.gap)) best = { gap, at };
    reach = Math.max(reach, endOn(sorted[at]!, axis));
  }
  return best
    ? { gap: best.gap, before: sorted.slice(0, best.at), after: sorted.slice(best.at) }
    : null;
}

/**
 * Kolejność czytania jako lista GRUP — patrz zasada 2 i 3 w nagłówku pliku.
 * Przy równych przerwach wygrywa cięcie POZIOME, bo dominującym kierunkiem
 * czytania strony jest „w dół": inaczej dwie sekcje jedna nad drugą, w których
 * przypadkiem da się poprowadzić linię pionową, rozjechałyby się na kolumny.
 */
function readingGroups(elements: readonly CanvasElement[]): CanvasElement[][] {
  function slice(placed: Placed[]): CanvasElement[][] {
    if (placed.length <= 1) {
      return placed.length === 0 ? [] : [[placed[0]!.element]];
    }
    const horizontal = widestCut(placed, "y");
    const vertical = widestCut(placed, "x");
    if (horizontal && (!vertical || horizontal.gap >= vertical.gap)) {
      return [...slice(horizontal.before), ...slice(horizontal.after)];
    }
    if (vertical) return [...slice(vertical.before), ...slice(vertical.after)];

    // Zbiór nierozdzielny: pudełka nachodzą na siebie. Wewnątrz porządkujemy
    // po (y, x, indeks) — to jedyne miejsce, w którym sortowanie po
    // współrzędnych jest właściwe, bo nie ma tu żadnej struktury do zgubienia.
    return [
      [...placed]
        .sort((a, b) => startOn(a, "y") - startOn(b, "y") || startOn(a, "x") - startOn(b, "x") || a.index - b.index)
        .map((entry) => entry.element),
    ];
  }

  return slice(elements.map((element, index) => ({ element, index })));
}

/** Piksele desktopu → jednostki płótna mobilnego (rozmiar FIZYCZNY bez zmian). */
function samePhysicalSize(units: number): number {
  return unitsForPx(units * GRID_UNIT_PX, MOBILE_DESIGN_WIDTH_PX);
}

/**
 * Rozmiar elementu na telefonie w pasie o szerokości `band`. Trzy tryby, w tej
 * kolejności: pudełko obejmujące treść (hug) → pas na całą szerokość (rodzaje
 * „rozciągliwe") → rozmiar fizyczny jak na desktopie.
 */
function mobileSize(element: CanvasElement, band: number): { w: number; h: number } {
  const size = sizeOf(element);
  const natural = hugBox(element, MOBILE_DESIGN_WIDTH_PX);
  const desktop = element.layout.desktop;

  const w =
    size.w === "hug" && natural
      ? Math.min(band, natural.w)
      : STRETCHY_KINDS.has(element.kind)
        ? band
        : Math.min(band, samePhysicalSize(desktop.w));

  if (size.h === "hug" && natural) return { w, h: natural.h };

  // Tekst mierzy się TREŚCIĄ przy nowej szerokości i nowym rozmiarze fontu —
  // proporcjonalne przeskalowanie wysokości dałoby pudełko, z którego akapit
  // wylewa się na telefonie (font przestaje maleć, wierszy przybywa).
  if (element.kind === "heading" || element.kind === "text") {
    return { w, h: textRowsAt(element.text, scaleOfElement(element), w, MOBILE_DESIGN_WIDTH_PX) };
  }
  // Zdjęcie trzyma PROPORCJE — inaczej kadr zmieniałby się razem z szerokością.
  if (element.kind === "image") {
    return { w, h: Math.max(1, Math.round((desktop.h * w) / Math.max(1, desktop.w))) };
  }
  return { w, h: samePhysicalSize(desktop.h) };
}

/**
 * Układ JEDNEJ grupy: treść w kolumnę, kształt-podkład wokół wyniku.
 *
 * Podkładem jest kształt-pudełko, który na desktopie NACHODZI na treść grupy —
 * czyli dokładnie to, czym jest baner sekcji CTA i kafel opinii. Kształt, który
 * na nic nie nachodzi, jest zwykłym elementem i układa się w kolumnie.
 */
function layoutGroup(
  group: readonly CanvasElement[],
  top: number,
  boxes: Record<string, Geometry>,
): number {
  const backdrops = group.filter(
    (element) =>
      element.kind === "shape" &&
      element.shape === "box" &&
      group.some((other) => other !== element && other.kind !== "shape" && intersects(element.layout.desktop, other.layout.desktop)),
  );
  const content = group.filter((element) => !backdrops.includes(element));
  const pad = backdrops.length > 0 ? CARD_PAD : 0;
  const band = CANVAS_CONTENT_COLUMNS - 2 * pad;

  let cursor = top + pad;
  for (const element of content) {
    const { w, h } = mobileSize(element, band);
    boxes[element.id] = {
      x: CANVAS_PAD_COLUMNS + pad,
      y: cursor,
      w,
      h,
      z: element.layout.desktop.z,
    };
    cursor += h + INNER_GAP;
  }
  if (content.length > 0) cursor -= INNER_GAP;

  const height = Math.max(1, cursor + pad - top);
  for (const backdrop of backdrops) {
    boxes[backdrop.id] = {
      x: CANVAS_PAD_COLUMNS,
      y: top,
      w: CANVAS_CONTENT_COLUMNS,
      h: height,
      z: backdrop.layout.desktop.z,
    };
  }
  return height;
}

/**
 * Układ mobilny całej sekcji. Automat liczy się dla WSZYSTKICH elementów — także
 * tych z ręczną poprawką — a poprawki nakładają się dopiero na wynik. Dzięki
 * temu skasowanie poprawki oddaje elementowi dokładnie to miejsce, które
 * automat trzymał dla niego przez cały czas.
 */
export function mobileLayoutOf(canvas: SectionCanvas): MobileLayout {
  const boxes: Record<string, Geometry> = {};
  let cursor = EDGE_PAD;

  for (const group of readingGroups(canvas.elements)) {
    cursor += layoutGroup(group, cursor, boxes) + GROUP_GAP;
  }
  if (canvas.elements.length > 0) cursor -= GROUP_GAP;

  const detached = new Set<string>();
  for (const element of canvas.elements) {
    const manual = element.layout.mobile;
    if (!manual) continue;
    detached.add(element.id);
    boxes[element.id] = manual;
    cursor = Math.max(cursor, manual.y + manual.h);
  }

  const rows = Math.min(
    SECTION_MAX_ROWS_MOBILE,
    Math.max(SECTION_MIN_ROWS, cursor + EDGE_PAD),
  );
  return { rows, boxes, detached };
}

/**
 * Geometria elementu na wskazanym breakpoincie. Jedno wejście dla renderu i dla
 * warstwy edycyjnej — pytanie „gdzie leży ten element na telefonie" ma mieć
 * JEDNĄ odpowiedź, a nie dwie prawie takie same.
 */
export function geometryAt(
  element: CanvasElement,
  breakpoint: "desktop" | "mobile",
  mobile: MobileLayout,
): Geometry {
  if (breakpoint === "desktop") return element.layout.desktop;
  return mobile.boxes[element.id] ?? element.layout.desktop;
}
