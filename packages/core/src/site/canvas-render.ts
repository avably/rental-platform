/**
 * REGUŁY RENDERU PŁÓTNA v2 — TREŚĆ NIGDY NIE ZNIKA (ADR-274).
 *
 * Płótno sekcji v2 stoi na geometrii ABSOLUTNEJ (ADR-084/087/088): element ma
 * współrzędne w procentach płótna, a płótno ma wysokość wyprowadzoną z jego
 * szerokości. Model jest wierny projektowi i ma dokładnie dwie wady, których
 * sam z siebie nie umie zauważyć — obie zebrał audyt UX 2026-08-25:
 *
 *   1. WARSTWA. Warstwa `z` jest LICZBĄ Z TREŚCI, a nie rolą. Zdjęcie
 *      przeciągnięte na nagłówek, kształt-podkład wyniesiony „na wierzch",
 *      kafel zastępczy z wyższym `z` niż akapit — każde z nich PRZYKRYWA tekst
 *      i nie ma w systemie nikogo, kto by temu zaprzeczył. Na produkcji
 *      (`/audyt-c`) skutkowało to hero, w którym h1, lead i CTA leżą pod
 *      dekoracją, a na telefonie sekcją PUSTĄ: kształt-podkład rozciągnięty
 *      przez auto-układ na całą kolumnę zasłaniał komplet treści.
 *
 *   2. WYSOKOŚĆ. Pudełko tekstu ma wysokość w JEDNOSTKACH PŁÓTNA, a tekst —
 *      w pikselach zaciśniętych `clamp()` do rozmiaru czytelnego. Poniżej
 *      szerokości, przy której skala dobija do swojego dolnego końca, pudełko
 *      dalej maleje, a tekst już nie: przy 768 px akapit potrzebuje dwa razy
 *      więcej miejsca, niż dla niego zarezerwowano, więc wchodzi pod element
 *      niżej albo wypada poza dolną krawędź sekcji (płótno PRZYCINA).
 *
 * ================== ODPOWIEDŹ: DWIE REGUŁY, ZERO MUTACJI DANYCH ==================
 *
 * Geometria zapisana przez najemcę jest DANYMI i ten moduł jej nie rusza. Obie
 * reguły liczą się przy renderze, z treści, funkcjami czystymi:
 *
 *   • {@link renderLayerZ} — PORZĄDEK MALOWANIA WEDŁUG ROLI. Dekoracja (zdjęcie,
 *     ikona, kształt) maluje się w paśmie DOLNYM, treść czytelna (nagłówek,
 *     akapit, przycisk, katalog) w GÓRNYM. Wewnątrz pasma kolejność zostaje
 *     dokładnie ta, którą zapisał operator, więc welon nad zdjęciem i karta nad
 *     tłem działają jak działały — zmienia się tylko to, że NIC z dekoracji nie
 *     wchodzi nad napis.
 *
 *   • {@link canvasStretchAt} — WYSOKOŚĆ SEKCJI ROŚNIE Z TREŚCIĄ. Dla zadanej
 *     szerokości płótna liczymy, ile jednostek potrzebuje najbardziej ściśnięty
 *     akapit, i oddajemy współczynnik, o który płótno ma się wydłużyć. Ponieważ
 *     WSZYSTKIE pudełka są procentem tej samej wysokości, rozciągnięcie płótna
 *     rozciąga je razem — układ zostaje proporcjonalny, a tekst dostaje miejsce.
 *     Przy szerokości projektowej współczynnik jest RÓWNY JEDEN z konstrukcji
 *     (patrz `base` niżej), więc desktop nie zmienia się ani o piksel.
 *
 *   • {@link isPublishableElement} — HIGIENA PUBLIKACJI (S-50). Kafel zdjęcia
 *     bez zdjęcia i element, który został przy treści startowej z palety, są
 *     RUSZTOWANIEM kreatora, a nie treścią strony: w kreatorze mają zostać
 *     (bez nich nie da się ich zaznaczyć), w sklepie nie mają czego pokazać.
 */
import { createElement } from "./element-factory";
import {
  PALETTE_ELEMENT_KINDS,
  normalizeImageSource,
  sizeOf,
  type CanvasElement,
  type CanvasElementKind,
  type Geometry,
} from "./elements";
import { PRESET_LOCALES } from "./presets";
import { scaleOfElement, textHeightUnitsAt } from "./text-metrics";

// -----------------------------------------------------------------------
// Pasma malowania — rola, nie liczba
// -----------------------------------------------------------------------

/**
 * Rodzaje, których zasłonięcie jest UTRATĄ TREŚCI. Zbiór wynika z pytania
 * „czy klient czyta to zdanie": nagłówek, akapit i etykieta przycisku niosą
 * słowa, a katalog — listę sprzętu z bazy.
 *
 * Zdjęcia NIE MA na tej liście, choć bywa treścią: przy kolizji z napisem to
 * napis ma być na wierzchu, bo zdjęcie zasłonięte w połowie dalej się ogląda,
 * a zdanie zasłonięte w połowie przestaje istnieć. Zdjęcie zostaje za to
 * w paśmie dekoracji NAD kształtami, więc karta nie przykryje fotografii.
 */
export const CANVAS_CONTENT_KINDS = [
  "heading",
  "text",
  "button",
  "catalog",
] as const satisfies readonly CanvasElementKind[];

/** Czy element niesie treść czytelną — jedno pytanie na cały system. */
export function isContentElement(element: CanvasElement): boolean {
  return (CANVAS_CONTENT_KINDS as readonly CanvasElementKind[]).includes(element.kind);
}

/**
 * WARSTWA RENDERU per element — pasmo dekoracji pod pasmem treści.
 *
 * Wynik jest ciągiem 0…n-1, więc mieści się w zakresie `z` ze schematu
 * (0…999) i nie ma jak przebić warstwy edycyjnej kreatora ani dialogów panelu.
 *
 * `sunk` to elementy, które mają iść pod SPÓD wszystkiego — używa go auto-układ
 * mobilny dla kształtów, którym sam wyznaczył rolę podkładu karty. Ich zapisane
 * `z` opisuje prostokąt z desktopu, a na telefonie ten sam kształt obejmuje CAŁĄ
 * grupę: bez zatopienia karta „na wierzchu" zasłaniałaby własną zawartość
 * (to jest dokładnie pusta sekcja z `/audyt-c` na 390 px).
 */
export function renderLayerZ(
  elements: readonly CanvasElement[],
  sunk?: ReadonlySet<string>,
): Record<string, number> {
  const band = (element: CanvasElement): number => {
    if (sunk?.has(element.id)) return 0;
    return isContentElement(element) ? 2 : 1;
  };
  const ordered = elements
    .map((element, index) => ({ element, index }))
    .sort(
      (a, b) =>
        band(a.element) - band(b.element) ||
        a.element.layout.desktop.z - b.element.layout.desktop.z ||
        a.index - b.index,
    );
  const layers: Record<string, number> = {};
  ordered.forEach((entry, position) => {
    layers[entry.element.id] = position;
  });
  return layers;
}

// -----------------------------------------------------------------------
// Wysokość sekcji rośnie z treścią
// -----------------------------------------------------------------------

/**
 * Sufit rozciągnięcia. Trzy, bo tyle wynosi najgorszy realny przypadek (akapit
 * przy dolnym końcu zacisku na najwęższym telefonie), a jednocześnie tyle, ile
 * jeszcze można nazwać „tą samą sekcją". Bez sufitu jeden akapit wklejony
 * z Worda potrafiłby rozciągnąć sekcję na ekran wysokości bloku.
 */
export const CANVAS_MAX_STRETCH = 3;

/** Element, którego wysokość WYNIKA Z ŁAMANIA TEKSTU — tylko takie liczymy. */
function reflows(element: CanvasElement): element is CanvasElement & { text: string } {
  if (element.kind !== "heading" && element.kind !== "text") return false;
  // Pudełko obejmujące treść (`hug`) renderuje się jako `max-content`, więc
  // nie przycina niczego i nie ma czego rozciągać — jego wysokość JEST treścią.
  return sizeOf(element).h === "fixed";
}

/**
 * MIEJSCE, KTÓRE TEKST MA DO DYSPOZYCJI — własne pudełko PLUS wolna przestrzeń
 * pod nim, aż do najbliższego elementu W TEJ SAMEJ KOLUMNIE.
 *
 * To nie jest poluzowanie reguły, tylko jej właściwe sformułowanie. Napis nie
 * musi mieścić się w prostokącie, którym operator zaznaczył dla niego miejsce —
 * pudełko tekstu nie ma tła ani ramki, więc wiersz, który wystaje o dziesięć
 * pikseli w pustkę, nie jest wadą. Wadą jest dopiero wejście POD sąsiada albo
 * poza dolną krawędź sekcji.
 *
 * Różnica jest ogromna w liczbach: bez niej cztery linie kontaktu w stopce,
 * które przy 640 px łamią się na dwa wiersze, żądały trzykrotnego rozciągnięcia
 * całej sekcji — czyli dziur po dziewięćdziesiąt pikseli w miejsce ośmiu.
 * Sąsiedztwo liczy się TYLKO w pionie i tylko dla elementów o wspólnym paśmie
 * poziomym: kolumna obok nie ma prawa ograniczać tej kolumny.
 */
function roomBelow(box: Geometry, others: readonly Geometry[], rows: number): number {
  let next = rows;
  for (const other of others) {
    if (other === box) continue;
    // Brak wspólnej kolumny — element stoi OBOK, nie POD.
    if (other.x >= box.x + box.w || box.x >= other.x + other.w) continue;
    // Zaczyna się przed dolną krawędzią pudełka — nie jest tym, na co tekst
    // mógłby wejść, rosnąc w dół (jest wyżej albo już się z nim przenika).
    if (other.y < box.y + box.h) continue;
    next = Math.min(next, other.y);
  }
  return Math.max(box.h, next - box.y);
}

/**
 * WSPÓŁCZYNNIK ROZCIĄGNIĘCIA PŁÓTNA przy zadanej szerokości.
 *
 * `boxOf` oddaje pudełko elementu na TYM breakpoincie (desktop bierze geometrię
 * z treści, telefon — z auto-układu), a `designWidthPx` jest szerokością, przy
 * której to pudełko powstało. Mianownik to `max(miejsce pod tekstem, potrzeba
 * przy projektowej)` i to on daje gwarancję „desktop bez zmian": przy
 * szerokości projektowej licznik nie przekracza mianownika, więc wynik to
 * dokładnie 1 — także dla pudełka, które operator sam sobie zwęził (jego układ
 * zostaje jego układem).
 */
export function canvasStretchAt(
  elements: readonly CanvasElement[],
  boxOf: (element: CanvasElement) => Geometry,
  rows: number,
  canvasWidthPx: number,
  designWidthPx: number,
): number {
  const boxes = elements.map(boxOf);
  let stretch = 1;
  for (const [index, element] of elements.entries()) {
    if (!reflows(element)) continue;
    const box = boxes[index]!;
    const scale = scaleOfElement(element);
    /*
     * Miara CIĄGŁA, nie zaokrąglona do jednostki siatki. Sufit jest właściwy
     * dla pudełka („ma mieścić"), a tu liczy się proporcja: przy 1024 px
     * drobny tekst stopki rośnie o cztery procent, a zaokrąglony do jednostki —
     * o trzydzieści trzy, czyli sekcja bez wady dostawałaby jedną trzecią
     * wysokości w prezencie (złapane w weryfikacji ADR-274).
     */
    const design = textHeightUnitsAt(element.text, scale, box.w, designWidthPx);
    const base = Math.max(1, roomBelow(box, boxes, rows), design);
    const need = textHeightUnitsAt(element.text, scale, box.w, canvasWidthPx);
    stretch = Math.max(stretch, need / base);
  }
  /*
   * Trzy miejsca po przecinku: wynik jedzie do CSS jako proporcja, a chwiejna
   * końcówka zmieniałaby bajty strony przy każdym renderze bez zmiany układu.
   * Zaokrąglenie idzie w GÓRĘ — w dół potrafiłoby zabrać te trzy tysięczne,
   * których brakuje do zmieszczenia ostatniego wiersza, a cała ta funkcja
   * istnieje po to, żeby ten wiersz się zmieścił.
   */
  return Math.ceil(Math.min(CANVAS_MAX_STRETCH, stretch) * 1000) / 1000;
}

// -----------------------------------------------------------------------
// Higiena publikacji (S-50)
// -----------------------------------------------------------------------

/**
 * Napisy, z którymi element RODZI SIĘ w palecie. Zbiór nie jest przepisany
 * ręcznie — powstaje z `createElement`, czyli z tego samego źródła, z którego
 * bierze go kreator (ta sama zasada, co w ostrzeżeniach publikacji): kopia
 * literałów rozjechałaby się przy pierwszej zmianie copy, a reguła zgasłaby
 * po cichu.
 */
let starterCopy: Set<string> | null = null;

function paletteStartCopy(): Set<string> {
  if (starterCopy) return starterCopy;
  const sink = new Set<string>();
  const geometry: Geometry = { x: 0, y: 0, w: 10, h: 10, z: 0 };
  for (const locale of PRESET_LOCALES) {
    for (const kind of PALETTE_ELEMENT_KINDS) {
      const element = createElement(kind, "wzorzec", geometry, locale);
      if ("text" in element && typeof element.text === "string") sink.add(element.text.trim());
    }
  }
  starterCopy = sink;
  return sink;
}

/**
 * KAFEL ZDJĘCIA BEZ ZDJĘCIA. Element związany z katalogiem (`bindings.source`)
 * zdjęcie DOSTANIE przy renderze — brak własnego źródła nie jest tam brakiem.
 */
export function isEmptyImageElement(element: CanvasElement): boolean {
  return (
    element.kind === "image" && !normalizeImageSource(element) && !element.bindings?.source
  );
}

/**
 * NAPIS INSTRUKTAŻOWY Z PALETY („Kliknij, żeby napisać własny tekst.").
 *
 * Wiązanie z katalogiem wyłącza regułę: napis obok jest wtedy wartością
 * PROJEKTOWĄ, do której render i tak nie sięga, a treść przychodzi ze sprzętu.
 */
export function isStarterCopyElement(element: CanvasElement): boolean {
  if (element.kind !== "heading" && element.kind !== "text") return false;
  if (element.bindings?.text) return false;
  return paletteStartCopy().has(element.text.trim());
}

/**
 * Czy element ma co pokazać KLIENTOWI. Kreator pyta o to samo i odpowiedź
 * IGNORUJE — rusztowanie musi tam zostać, żeby dało się je zaznaczyć, wypełnić
 * albo skasować (ta sama lekcja, co przy elemencie wyciętym wiązaniem, PR #172).
 */
export function isPublishableElement(element: CanvasElement): boolean {
  return !isEmptyImageElement(element) && !isStarterCopyElement(element);
}
