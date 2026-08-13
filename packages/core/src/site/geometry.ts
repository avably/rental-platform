/**
 * SILNIK GEOMETRII PŁÓTNA (K2, ADR-084) — przyciąganie, prowadnice, kolizje
 * z krawędziami, warstwy.
 *
 * Wszystko tutaj to FUNKCJE CZYSTE na jednostkach siatki: żadnego DOM-u,
 * żadnych pikseli, żadnego stanu. Warstwa interfejsu robi dokładnie dwie
 * rzeczy — przelicza piksele wskaźnika na jednostki i rysuje to, co dostanie.
 * Dzięki temu sedno kreatora (czy element trafia tam, gdzie operator myśli, że
 * trafia) da się udowodnić testem jednostkowym, a nie tylko okiem na zrzucie.
 *
 * PRZYCIĄGANIE MA DWA POZIOMY:
 *   1. SIATKA — jednostka jest granulacją ZAPISU, więc każda pozycja jest
 *      całkowita. To nie jest opcja: geometria ułamkowa nie przetrwałaby
 *      zaokrąglenia w renderze i psułaby porównania.
 *   2. SĄSIEDZI — krawędzie i środki innych elementów oraz krawędzie i środek
 *      płótna. Ten poziom da się WYŁĄCZYĆ (`snap: false`, modyfikator w
 *      kreatorze), gdy operator chce postawić element tuż obok, a nie równo.
 *
 * PROWADNICA JEST DOWODEM, NIE OZDOBĄ: zwracamy ją wyłącznie dla wyrównań,
 * które NAPRAWDĘ zaszły w zwróconej geometrii. Linia narysowana „mniej więcej"
 * kłamałaby dokładnie tam, gdzie operator jej ufa.
 */
import {
  CANVAS_COLUMNS,
  CANVAS_CONTENT_COLUMNS,
  CANVAS_DESIGN_WIDTH_PX,
  CANVAS_PAD_COLUMNS,
  GEOMETRY_MAX_ROWS,
  GUIDE_TOLERANCE_UNITS,
  type CanvasBreakpoint,
  type CanvasElement,
  type Geometry,
} from "./elements";

/** Najmniejszy element: 2 jednostki = 16 px przy szerokości projektowej. */
export const MIN_ELEMENT_UNITS = 2;

/** Krok strzałki i krok strzałki z Shiftem (jednostki siatki). */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;

export type GuideKind = "edge" | "center" | "canvas";
export type GuideAxis = "x" | "y";

/**
 * Prowadnica do narysowania. `at` to pozycja linii na swojej osi, a `from`/`to`
 * to jej zasięg na osi prostopadłej — linia obejmuje OBA wyrównane pudełka,
 * więc widać, co się z czym zrównało.
 */
export interface Guide {
  axis: GuideAxis;
  at: number;
  from: number;
  to: number;
  kind: GuideKind;
}

export interface SnapResult {
  geometry: Geometry;
  guides: Guide[];
}

export interface SnapContext {
  /** Wysokość płótna sekcji w jednostkach — sufit osi pionowej. */
  rows: number;
  /** Geometrie POZOSTAŁYCH elementów (bez przeciąganego). */
  neighbours: readonly Geometry[];
  /** Przyciąganie do sąsiadów i krawędzi płótna. Siatka działa zawsze. */
  snap: boolean;
  /** Zasięg przyciągania w jednostkach (domyślnie {@link GUIDE_TOLERANCE_UNITS}). */
  tolerance?: number;
}

/** Uchwyty zmiany rozmiaru — cztery rogi i cztery krawędzie. */
export const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

interface SnapTarget {
  at: number;
  crossStart: number;
  crossEnd: number;
  kind: GuideKind;
}

/**
 * Kandydaci wyrównania na jednej osi: krawędzie i środki sąsiadów plus
 * krawędzie i środek PŁÓTNA. Płótno jest w tym zbiorze świadomie — „na środku
 * sekcji" i „przy krawędzi" to najczęstsze intencje układu, a bez nich operator
 * trafiałby w środek wyłącznie przez przypadek.
 */
function axisTargets(
  axis: GuideAxis,
  neighbours: readonly Geometry[],
  rows: number,
): SnapTarget[] {
  const size = axis === "x" ? CANVAS_COLUMNS : rows;
  const crossSize = axis === "x" ? rows : CANVAS_COLUMNS;
  const targets: SnapTarget[] = [
    { at: 0, crossStart: 0, crossEnd: crossSize, kind: "canvas" },
    { at: size / 2, crossStart: 0, crossEnd: crossSize, kind: "canvas" },
    { at: size, crossStart: 0, crossEnd: crossSize, kind: "canvas" },
  ];

  for (const neighbour of neighbours) {
    const start = axis === "x" ? neighbour.x : neighbour.y;
    const extent = axis === "x" ? neighbour.w : neighbour.h;
    const crossStart = axis === "x" ? neighbour.y : neighbour.x;
    const crossEnd = crossStart + (axis === "x" ? neighbour.h : neighbour.w);
    targets.push(
      { at: start, crossStart, crossEnd, kind: "edge" },
      { at: start + extent / 2, crossStart, crossEnd, kind: "center" },
      { at: start + extent, crossStart, crossEnd, kind: "edge" },
    );
  }
  return targets;
}

/** Kolejność rozstrzygania remisów: krawędź przed środkiem, sąsiad przed płótnem. */
const KIND_RANK: Record<GuideKind, number> = { edge: 0, center: 1, canvas: 2 };

/** Cele, w które ZWRÓCONA pozycja trafia dokładnie — z nich powstają prowadnice. */
function hitsAt(start: number, size: number, targets: readonly SnapTarget[]): SnapTarget[] {
  const anchors = [start, start + size / 2, start + size];
  return targets.filter((target) => anchors.some((anchor) => anchor === target.at));
}

/**
 * Wyrównanie POZYCJI pudełka (przeciąganie): rozmiar jest stały, więc każdy
 * kandydat przesuwa całe pudełko. Rozważamy trzy zaczepy — lewą krawędź,
 * środek i prawą krawędź — bo tak myśli operator („wyrównaj do lewej", „na
 * środku", „do prawej").
 *
 * Kandydat, który wypadłby na UŁAMKU jednostki, jest ODRZUCANY. Ta zasada ma
 * konsekwencję, którą warto znać: wyrównanie ŚRODKÓW wymaga zgodnej parzystości
 * rozmiarów (dwa elementy o parzystej albo dwa o nieparzystej szerokości).
 * Alternatywą byłoby przyciąganie „prawie na środek" z błędem pół jednostki —
 * czyli prowadnica, która pokazuje równo tam, gdzie równo nie jest.
 */
function snapPosition(
  start: number,
  size: number,
  targets: readonly SnapTarget[],
  tolerance: number,
): number {
  const rounded = Math.round(start);
  const offsets = [0, size / 2, size];

  let best: { value: number; delta: number; rank: number; at: number } | null = null;
  for (const target of targets) {
    for (const offset of offsets) {
      const candidate = target.at - offset;
      if (!Number.isInteger(candidate)) continue;
      const delta = Math.abs(candidate - rounded);
      if (delta > tolerance) continue;
      const rank = KIND_RANK[target.kind];
      if (
        !best ||
        delta < best.delta ||
        (delta === best.delta && rank < best.rank) ||
        (delta === best.delta && rank === best.rank && target.at < best.at)
      ) {
        best = { value: candidate, delta, rank, at: target.at };
      }
    }
  }

  return best ? best.value : rounded;
}

/** Wyrównanie POJEDYNCZEJ krawędzi (zmiana rozmiaru) — rusza się jeden bok. */
function snapEdge(value: number, targets: readonly SnapTarget[], tolerance: number): number {
  const rounded = Math.round(value);
  let best: { value: number; delta: number; rank: number } | null = null;
  for (const target of targets) {
    if (!Number.isInteger(target.at)) continue;
    const delta = Math.abs(target.at - rounded);
    if (delta > tolerance) continue;
    const rank = KIND_RANK[target.kind];
    if (!best || delta < best.delta || (delta === best.delta && rank < best.rank)) {
      best = { value: target.at, delta, rank };
    }
  }
  return best ? best.value : rounded;
}

function guidesFrom(
  axis: GuideAxis,
  hits: readonly SnapTarget[],
  crossStart: number,
  crossEnd: number,
): Guide[] {
  return hits.map((hit) => ({
    axis,
    at: hit.at,
    from: Math.min(hit.crossStart, crossStart),
    to: Math.max(hit.crossEnd, crossEnd),
    kind: hit.kind,
  }));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), Math.max(min, max));
}

/**
 * Element ZAWSZE mieści się w płótnie. To nie jest kosmetyka: element wystający
 * poza sekcję rozjeżdża publiczną stronę, a schemat treści (superRefine) i tak
 * by go odrzucił — lepiej, żeby przeciąganie zatrzymywało się o krawędź, niż
 * żeby zapis padał komunikatem o błędzie.
 */
export function clampGeometry(geometry: Geometry, rows: number): Geometry {
  const w = clampNumber(geometry.w, MIN_ELEMENT_UNITS, CANVAS_COLUMNS);
  const h = clampNumber(geometry.h, MIN_ELEMENT_UNITS, Math.max(MIN_ELEMENT_UNITS, rows));
  return {
    x: clampNumber(geometry.x, 0, CANVAS_COLUMNS - w),
    y: clampNumber(geometry.y, 0, Math.max(0, rows - h)),
    w,
    h,
    z: clampNumber(geometry.z, 0, 999),
  };
}

/**
 * Przeciągnięcie o `(dx, dy)` jednostek (mogą być ułamkowe — to przeliczone
 * piksele wskaźnika). Zwraca geometrię PO przyciągnięciu i prowadnice, które
 * naprawdę obowiązują.
 */
export function snapMove(base: Geometry, dx: number, dy: number, context: SnapContext): SnapResult {
  const tolerance = context.tolerance ?? GUIDE_TOLERANCE_UNITS;
  const rows = clampNumber(context.rows, MIN_ELEMENT_UNITS, GEOMETRY_MAX_ROWS);

  if (!context.snap) {
    return {
      geometry: clampGeometry({ ...base, x: base.x + dx, y: base.y + dy }, rows),
      guides: [],
    };
  }

  const xTargets = axisTargets("x", context.neighbours, rows);
  const yTargets = axisTargets("y", context.neighbours, rows);

  const geometry = clampGeometry(
    {
      ...base,
      x: snapPosition(base.x + dx, base.w, xTargets, tolerance),
      y: snapPosition(base.y + dy, base.h, yTargets, tolerance),
    },
    rows,
  );

  // Przyciągnięcie mogło zostać ŚCIĘTE przez krawędź płótna — prowadnice liczymy
  // z pozycji KOŃCOWEJ, nie z zamiaru, żeby linia nie wisiała tam, gdzie
  // elementu ostatecznie nie ma.
  return {
    geometry,
    guides: [
      ...guidesFrom("x", hitsAt(geometry.x, geometry.w, xTargets), geometry.y, geometry.y + geometry.h),
      ...guidesFrom("y", hitsAt(geometry.y, geometry.h, yTargets), geometry.x, geometry.x + geometry.w),
    ],
  };
}

/**
 * Zmiana rozmiaru za uchwyt. Uchwyt decyduje, KTÓRE krawędzie się ruszają —
 * przeciwległe stoją. Rozmiar nie schodzi poniżej {@link MIN_ELEMENT_UNITS} i
 * nie wychodzi poza płótno; przy dojściu do minimum krawędź się zatrzymuje,
 * a element NIE zaczyna wędrować (typowa wada naiwnej implementacji: uchwyt „w"
 * przy minimalnej szerokości przesuwałby lewy bok w prawo bez końca).
 */
export function snapResize(
  base: Geometry,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  context: SnapContext,
): SnapResult {
  const tolerance = context.tolerance ?? GUIDE_TOLERANCE_UNITS;
  const rows = clampNumber(context.rows, MIN_ELEMENT_UNITS, GEOMETRY_MAX_ROWS);
  const targetsX = context.snap ? axisTargets("x", context.neighbours, rows) : [];
  const targetsY = context.snap ? axisTargets("y", context.neighbours, rows) : [];

  const movesWest = handle === "w" || handle === "nw" || handle === "sw";
  const movesEast = handle === "e" || handle === "ne" || handle === "se";
  const movesNorth = handle === "n" || handle === "nw" || handle === "ne";
  const movesSouth = handle === "s" || handle === "sw" || handle === "se";

  let left = base.x;
  let right = base.x + base.w;
  let top = base.y;
  let bottom = base.y + base.h;

  if (movesWest) left = clampNumber(snapEdge(left + dx, targetsX, tolerance), 0, right - MIN_ELEMENT_UNITS);
  if (movesEast) {
    right = clampNumber(snapEdge(right + dx, targetsX, tolerance), left + MIN_ELEMENT_UNITS, CANVAS_COLUMNS);
  }
  if (movesNorth) top = clampNumber(snapEdge(top + dy, targetsY, tolerance), 0, bottom - MIN_ELEMENT_UNITS);
  if (movesSouth) {
    bottom = clampNumber(snapEdge(bottom + dy, targetsY, tolerance), top + MIN_ELEMENT_UNITS, rows);
  }

  const geometry = clampGeometry(
    { x: left, y: top, w: right - left, h: bottom - top, z: base.z },
    rows,
  );

  // Prowadnica wychodzi z KOŃCOWEGO pudełka i tylko dla krawędzi, które
  // faktycznie się ruszały — bok stojący w miejscu nie jest niczyim wyrównaniem.
  const movedX = [movesWest ? geometry.x : null, movesEast ? geometry.x + geometry.w : null];
  const movedY = [movesNorth ? geometry.y : null, movesSouth ? geometry.y + geometry.h : null];
  const hitX = targetsX.filter((target) => movedX.includes(target.at));
  const hitY = targetsY.filter((target) => movedY.includes(target.at));

  return {
    geometry,
    guides: [
      ...guidesFrom("x", hitX, geometry.y, geometry.y + geometry.h),
      ...guidesFrom("y", hitY, geometry.x, geometry.x + geometry.w),
    ],
  };
}

/**
 * Krok klawiaturą. Strzałki są PRECYZYJNE (jedna jednostka) i celowo NIE
 * przyciągają się do sąsiadów: klawiatura służy do dostrojenia tego, czego
 * mysz nie trafiła — przyciąganie odbierałoby jej jedyny powód istnienia.
 */
export function nudgeGeometry(
  base: Geometry,
  direction: "left" | "right" | "up" | "down",
  step: number,
  rows: number,
): Geometry {
  const dx = direction === "left" ? -step : direction === "right" ? step : 0;
  const dy = direction === "up" ? -step : direction === "down" ? step : 0;
  return clampGeometry({ ...base, x: base.x + dx, y: base.y + dy }, rows);
}

/**
 * KROK ROZMIARU KLAWIATURĄ (ADR-173) — bliźniak {@link nudgeGeometry} dla drugiej
 * pary liczb w geometrii.
 *
 * Do ADR-173 klawiatura umiała WYŁĄCZNIE przesuwać: osiem uchwytów rozmiaru było
 * fokusowalnymi przyciskami, które na Enter i Spację nie robiły nic. Element
 * fokusowalny bez skutku jest gorszy niż niefokusowalny — obiecuje obsługę,
 * której nie ma, i każdy zaznaczony element wstawiał w kolejność Tab osiem
 * martwych przystanków.
 *
 * Kotwicą jest LEWY GÓRNY RÓG, a ruszają się krawędzie prawa i dolna — czyli
 * dokładnie to, co robi uchwyt `se`. Nie jest to podobieństwo, tylko TA SAMA
 * funkcja ({@link snapResize}) z wyłączonym przyciąganiem: gdyby klawiatura
 * liczyła sobie sama, powstałaby druga, „prawie taka sama" ścieżka rozmiaru,
 * a różnice między nią a myszą wychodziłyby dopiero u operatora.
 *
 * Przyciąganie jest wyłączone z tego samego powodu, co przy {@link nudgeGeometry}:
 * klawiatura służy do dostrojenia tego, czego mysz nie trafiła.
 */
export function nudgeSize(
  base: Geometry,
  direction: "left" | "right" | "up" | "down",
  step: number,
  rows: number,
): Geometry {
  const dx = direction === "left" ? -step : direction === "right" ? step : 0;
  const dy = direction === "up" ? -step : direction === "down" ? step : 0;
  return snapResize(base, "se", dx, dy, { rows, neighbours: [], snap: false }).geometry;
}

// -----------------------------------------------------------------------
// Warstwa tła a warstwy elementów (ADR-173, aneks do ADR-088)
// -----------------------------------------------------------------------

/**
 * CZY ELEMENT MALUJE SIĘ POD CAŁĄ TREŚCIĄ (ADR-173).
 *
 * Renderer trzyma elementy rozciągnięte do krawędzi w OSOBNEJ warstwie, dziecku
 * sekcji, stojącym w drzewie przed siatką treści — tło hero ma sięgać krawędzi
 * okna, a siatka ma sufit szerokości (kolumna czytelności). Warstwa ma własny
 * kontekst składania (`isolation: isolate`), więc `z` jej elementów obowiązuje
 * WEWNĄTRZ niej, a ona sama jako całość zostaje pod siatką.
 *
 * Konsekwencja, którą trzeba znać w każdej operacji na warstwach: dla takiego
 * elementu „na wierzch" i „na spód" zmieniają zapisane `z` i nie zmieniają ani
 * jednego piksela. Dlatego reguła stoi TUTAJ, w rdzeniu, a nie wyłącznie
 * w rendererze: warstwami rządzi ten plik i to on musi wiedzieć, kiedy jego
 * arytmetyka nie ma jak zadziałać.
 *
 * Kopia reguły w rendererze (`bleedsToEdges`) zostaje do czasu, aż weźmie ją
 * stamtąd pas pakietu UI. Zgodności obu pilnuje test kontraktowy przez RENDER
 * (`canvas-operacje-skutek.test.tsx`) — porównanie źródeł niczego by nie
 * dowiodło, bo dowód ma pochodzić z tego, gdzie element naprawdę ląduje.
 */
export function paintsBehindContent(element: CanvasElement): boolean {
  if (element.kind !== "image" && element.kind !== "shape") return false;
  const box = element.layout.desktop;
  return box.x === 0 && box.w === CANVAS_COLUMNS;
}

/**
 * WYPROWADZENIE ELEMENTU Z WARSTWY TŁA (ADR-173) — wejście w PAS TREŚCI.
 *
 * Przynależność do warstwy tła jest w GEOMETRII, nie w osobnym polu treści, więc
 * jedyną drogą wyjścia jest zmiana geometrii. To nie jest obejście: element
 * pełnoekranowy i element leżący nad tekstem to dwie różne rzeczy i nie da się
 * być obiema naraz — pas tła jest z definicji pod kolumną czytelności.
 *
 * Docelowe pudełko nie jest „o jednostkę węższe" (to wyglądałoby na usterkę),
 * tylko dokładnie takie, jak pas treści, którym stoi cała reszta strony
 * ({@link CANVAS_PAD_COLUMNS}, {@link CANVAS_CONTENT_COLUMNS}). Pion zostaje
 * nietknięty — operator prosił o zmianę warstwy, a nie o przesunięcie.
 *
 * Droga POWROTNA istnieje i jest tą samą drogą, którą operator tu trafił:
 * rozciągnięcie elementu z powrotem do obu krawędzi znów czyni z niego tło.
 */
export function liftIntoContentBand(element: CanvasElement): CanvasElement {
  const box = element.layout.desktop;
  if (box.x === CANVAS_PAD_COLUMNS && box.w === CANVAS_CONTENT_COLUMNS) return element;
  return withGeometry(element, "desktop", {
    ...box,
    x: CANVAS_PAD_COLUMNS,
    w: CANVAS_CONTENT_COLUMNS,
  });
}

// -----------------------------------------------------------------------
// Miara płótna i gest wskaźnika (K2c, ADR-087)
// -----------------------------------------------------------------------

/**
 * MIARA PŁÓTNA — bok jednostki siatki w pikselach, TEN SAM na obu osiach.
 *
 * Do K2c oś X liczyła się w procentach kontenera, a oś Y w stałych
 * `GRID_UNIT_PX`. Siatka była więc kwadratowa przy DOKŁADNIE jednej szerokości
 * płótna ({@link CANVAS_DESIGN_WIDTH_PX}) i krzywiła się tym mocniej, im węższe
 * okno: przy płótnie 830 px kolumna miała ~5,8 px, a wiersz wciąż 8. Bolało to
 * operatora na trzy sposoby naraz — przeciągnięcie o 10 px w prawo znaczyło co
 * innego niż o 10 px w dół, przyciąganie „na środek" wypadało gdzie indziej,
 * niż widać, a układ złożony na szerokim ekranie rozjeżdżał się w pionie na
 * węższym.
 *
 * Jednostka jest teraz JEDNA: szerokość płótna przez liczbę kolumn. Wysokość
 * płótna z niej WYNIKA (`rows × unit`), więc siatka jest kwadratowa przy każdej
 * szerokości, a układ skaluje się proporcjonalnie — tak samo w kreatorze i w
 * sklepie, bo renderer jest wspólny.
 */
export interface CanvasMetrics {
  /** Bok jednostki siatki w pikselach — wspólny dla osi X i Y. */
  unit: number;
  /** Szerokość płótna w pikselach (zmierzona albo projektowa, gdy brak pomiaru). */
  width: number;
  /** Wysokość płótna w pikselach — z definicji `rows × unit`. */
  height: number;
  /** Wysokość płótna w jednostkach, sprowadzona do dozwolonego zakresu. */
  rows: number;
}

/**
 * Miara dla ZMIERZONEGO płótna. Szerokość 0 (pomiar przed pierwszym układem)
 * spada na szerokość projektową — lepiej policzyć gest w skali 1:1 niż podzielić
 * przez zero i wysłać element w nieskończoność.
 */
export function canvasMetrics(containerWidthPx: number, rows: number): CanvasMetrics {
  const width = containerWidthPx > 0 ? containerWidthPx : CANVAS_DESIGN_WIDTH_PX;
  const safeRows = clampNumber(rows, MIN_ELEMENT_UNITS, GEOMETRY_MAX_ROWS);
  const unit = width / CANVAS_COLUMNS;
  return { unit, width, height: safeRows * unit, rows: safeRows };
}

/** Piksele wskaźnika → jednostki siatki. TA SAMA miara dla `dx` i dla `dy`. */
export function unitsFromPx(px: number, metrics: CanvasMetrics): number {
  return px / metrics.unit;
}

/** Pudełko o wymiarach ułamkowych — pozycja W TRAKCIE gestu, przed przyciągnięciem. */
export interface RawBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pudełko w pikselach — warstwa wizualna gestu i pomiary w testach. */
export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Jednostki → piksele. Obie osie mnożą się przez `unit`, więc kwadrat
 * w jednostkach jest kwadratem na ekranie — to jest cała teza tej miary.
 */
export function geometryRect(box: RawBox, metrics: CanvasMetrics): CanvasRect {
  return {
    left: box.x * metrics.unit,
    top: box.y * metrics.unit,
    width: box.w * metrics.unit,
    height: box.h * metrics.unit,
  };
}

/** Przycięcie BEZ zaokrąglania — pozycja w trakcie gestu jest ułamkowa. */
function clampFloat(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * SUROWA pozycja przeciągania: bez zaokrągleń i bez przyciągania, ale już
 * w granicach płótna.
 *
 * To jest to, co widać pod kursorem. Zaokrąglanie w locie było źródłem
 * „schodków" zgłoszonych z produkcji — element skakał co jednostkę zamiast
 * jechać za ręką, a przy nierównych osiach skakał w pionie i w poziomie
 * o różną odległość. Przyciągnięcie zdarza się dopiero w commit
 * ({@link snapMove}), a prowadnica pokazuje je z wyprzedzeniem.
 *
 * Przycięcie do płótna jest tu ŚWIADOME i jest jedynym odstępstwem od zasady
 * „element trzyma kursor 1:1": pudełko zatrzymuje się o krawędź, zamiast
 * wyjechać poza sekcję i wrócić skokiem przy upuszczeniu.
 */
export function rawMove(base: Geometry, dx: number, dy: number, rows: number): RawBox {
  const safeRows = clampNumber(rows, MIN_ELEMENT_UNITS, GEOMETRY_MAX_ROWS);
  return {
    x: clampFloat(base.x + dx, 0, CANVAS_COLUMNS - base.w),
    y: clampFloat(base.y + dy, 0, Math.max(0, safeRows - base.h)),
    w: base.w,
    h: base.h,
  };
}

/**
 * SUROWY rozmiar w trakcie ciągnięcia uchwytu — bliźniak {@link rawMove} dla
 * krawędzi. Ta sama zasada, co w {@link snapResize}: uchwyt rusza tylko swoje
 * boki, przeciwległe stoją, rozmiar nie schodzi poniżej
 * {@link MIN_ELEMENT_UNITS} i nie wychodzi poza płótno.
 */
export function rawResize(
  base: Geometry,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  rows: number,
): RawBox {
  const safeRows = clampNumber(rows, MIN_ELEMENT_UNITS, GEOMETRY_MAX_ROWS);

  let left = base.x;
  let right = base.x + base.w;
  let top = base.y;
  let bottom = base.y + base.h;

  if (handle === "w" || handle === "nw" || handle === "sw") {
    left = clampFloat(left + dx, 0, right - MIN_ELEMENT_UNITS);
  }
  if (handle === "e" || handle === "ne" || handle === "se") {
    right = clampFloat(right + dx, left + MIN_ELEMENT_UNITS, CANVAS_COLUMNS);
  }
  if (handle === "n" || handle === "nw" || handle === "ne") {
    top = clampFloat(top + dy, 0, bottom - MIN_ELEMENT_UNITS);
  }
  if (handle === "s" || handle === "sw" || handle === "se") {
    bottom = clampFloat(bottom + dy, top + MIN_ELEMENT_UNITS, safeRows);
  }

  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Kontekst gestu bez `rows` — wysokość płótna niesie już {@link CanvasMetrics}. */
export type GestureContext = Omit<SnapContext, "rows">;

/**
 * PIPELINE COMMITU PRZECIĄGNIĘCIA: surowe piksele wskaźnika → jednostki (jedną
 * miarą na obie osie) → przyciąganie → przycięcie do płótna → geometria.
 *
 * Warstwa interfejsu nie liczy tu NICZEGO od siebie i nie ma własnej miary osi
 * pionowej — dzięki temu „co się zapisze po upuszczeniu" jest dowodliwe testem
 * bez DOM-u, a nie tylko okiem na zrzucie.
 */
export function commitMove(
  base: Geometry,
  dxPx: number,
  dyPx: number,
  metrics: CanvasMetrics,
  context: GestureContext,
): SnapResult {
  return snapMove(base, unitsFromPx(dxPx, metrics), unitsFromPx(dyPx, metrics), {
    ...context,
    rows: metrics.rows,
  });
}

/** Ten sam pipeline dla uchwytu rozmiaru — patrz {@link commitMove}. */
export function commitResize(
  base: Geometry,
  handle: ResizeHandle,
  dxPx: number,
  dyPx: number,
  metrics: CanvasMetrics,
  context: GestureContext,
): SnapResult {
  return snapResize(base, handle, unitsFromPx(dxPx, metrics), unitsFromPx(dyPx, metrics), {
    ...context,
    rows: metrics.rows,
  });
}

// -----------------------------------------------------------------------
// Warstwy (z-order)
// -----------------------------------------------------------------------

/** Podmiana geometrii elementu na wskazanym breakpoincie (bez mutacji wejścia). */
export function withGeometry(
  element: CanvasElement,
  breakpoint: CanvasBreakpoint,
  geometry: Geometry,
): CanvasElement {
  return { ...element, layout: { ...element.layout, [breakpoint]: geometry } } as CanvasElement;
}

/**
 * Zdjęcie RĘCZNEJ POPRAWKI mobilnej (K4, ADR-088) — element wraca pod automat.
 * Kasujemy KLUCZ, a nie ustawiamy „pustej" geometrii: obecność tego pola jest
 * jedynym znacznikiem odpięcia, więc pole obecne i puste znaczyłoby dwie
 * rzeczy naraz.
 */
export function withoutMobileGeometry(element: CanvasElement): CanvasElement {
  if (element.layout.mobile === undefined) return element;
  return { ...element, layout: { desktop: element.layout.desktop } } as CanvasElement;
}

/**
 * Normalizacja warstw do ciągu 0…n-1 z zachowaniem kolejności. Bez niej „na
 * wierzch" klikane w kółko dobijałoby do sufitu `z` ze schematu, a różnice
 * między warstwami rosłyby bez powodu.
 *
 * Warstwa jest WSPÓLNA dla obu breakpointów: „na wierzch" znaczy to samo na
 * telefonie, co na desktopie. Ręczna poprawka mobilna dostaje więc tę samą
 * liczbę — inaczej element wyniesiony na wierzch zostawałby pod spodem
 * dokładnie tam, gdzie operator ustawił go ręcznie.
 */
export function normalizeLayers(elements: readonly CanvasElement[]): CanvasElement[] {
  const zById = new Map<string, number>();
  paintOrder(elements).forEach((element, position) => zById.set(element.id, position));
  return elements.map((element) => {
    const z = zById.get(element.id) ?? 0;
    const withDesktop = withGeometry(element, "desktop", { ...element.layout.desktop, z });
    const mobile = element.layout.mobile;
    return mobile ? withGeometry(withDesktop, "mobile", { ...mobile, z }) : withDesktop;
  });
}

/** Element na WIERZCH — dostaje najwyższą warstwę, reszta zostaje pod nim. */
export function bringToFront(elements: readonly CanvasElement[], id: string): CanvasElement[] {
  if (!elements.some((element) => element.id === id)) return [...elements];
  return normalizeLayers(
    elements.map((element) =>
      element.id === id
        ? withGeometry(element, "desktop", { ...element.layout.desktop, z: elements.length })
        : element,
    ),
  );
}

/** Element na SPÓD — dostaje warstwę 0, reszta idzie o jedną w górę. */
export function sendToBack(elements: readonly CanvasElement[], id: string): CanvasElement[] {
  if (!elements.some((element) => element.id === id)) return [...elements];
  return normalizeLayers(
    elements.map((element) =>
      withGeometry(element, "desktop", {
        ...element.layout.desktop,
        z: element.id === id ? 0 : element.layout.desktop.z + 1,
      }),
    ),
  );
}

/** Kolejność MALOWANIA: rosnąco po warstwie, remis rozstrzyga kolejność w tablicy. */
export function paintOrder(elements: readonly CanvasElement[]): CanvasElement[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.layout.desktop.z - b.element.layout.desktop.z || a.index - b.index)
    .map((entry) => entry.element);
}
