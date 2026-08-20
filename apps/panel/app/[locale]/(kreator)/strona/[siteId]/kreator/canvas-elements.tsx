"use client";

/**
 * WARSTWA EDYCYJNA ELEMENTÓW (K2, ADR-084; silnik gestów przepisany w K2c,
 * ADR-087) — zaznaczenie, przeciąganie, osiem uchwytów rozmiaru, prowadnice,
 * klawiatura.
 *
 * Ten plik NIE rysuje strony. Stronę rysuje wspólny renderer (@avably/ui), a
 * warstwa edycyjna wchodzi do niego SZWEM `elementWrapper` — piętro niżej niż
 * `sectionWrapper` z K1 (ADR-083, decyzja 2). Ramka leży NAD elementem, ma
 * własną, wysoką warstwę i przejmuje wskaźnik; sam element zostaje treścią
 * strony, tak samo w kreatorze i w sklepie.
 *
 * ================== JEDEN MECHANIZM, NIE DWA ==================
 *
 * Do K2 przesunięcie szło przez dnd-kit, a zmiana rozmiaru surowymi zdarzeniami
 * wskaźnika. Dwa tory znaczyły dwie różne płynności tego samego gestu i dwa
 * miejsca na błąd; werdykt z produkcji dotyczył dokładnie tego toru, który szedł
 * przez bibliotekę. Od K2c OBA gesty prowadzi `startCanvasGesture`
 * (canvas-gesture.ts): przechwycony wskaźnik, jedna klatka na ruch, commit przy
 * puszczeniu.
 *
 * dnd-kit ZOSTAJE tam, gdzie modeluje swój problem — przy zmianie KOLEJNOŚCI
 * sekcji („przeciągnij coś na coś"). Geometria elementu nie ma celu upuszczenia,
 * ma współrzędne.
 *
 * Arytmetyka OBU gestów mieszka w `@avably/core/site` (funkcje czyste, testowane
 * bez DOM-u). Tutaj zostaje przeliczenie pikseli wskaźnika na jednostki siatki —
 * i to przeliczenie mierzy PŁÓTNO, nigdy okno (ADR-085).
 */
import {
  MIN_ELEMENT_UNITS,
  NUDGE_STEP,
  NUDGE_STEP_LARGE,
  RESIZE_HANDLES,
  canvasMetrics,
  nudgeGeometry,
  nudgeSize,
  sizeOf,
  type CanvasElement,
  type CanvasMetrics,
  type Geometry,
  type ResizeHandle,
} from "@avably/core/site";
import { geometryStyle } from "@avably/ui";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { GESTURE_ACTIVATION_PX, GUIDE_SLOTS, startCanvasGesture } from "./canvas-gesture";

/** Osie, które gest zmienił z „z treści" na „jawne" — patrz `ElementFrame.onCommit`. */
export interface FixedAxes {
  w: boolean;
  h: boolean;
}

/** Które wymiary rusza dany uchwyt. Róg rusza oba, krawędź jeden. */
function axesOf(handle: ResizeHandle): FixedAxes {
  return {
    w: handle === "e" || handle === "w" || handle.length === 2,
    h: handle === "n" || handle === "s" || handle.length === 2,
  };
}

/**
 * POMIAR PUDEŁKA Z DOM-u (K4, ADR-088).
 *
 * Wymiar `hug` nie ma liczby w treści — ma treść. Zapisana geometria jest przy
 * nim SZACUNKIEM (fabryka, konwersja, auto-układ mobilny), a prawdą jest to, co
 * naprawdę zajmuje pudełko na ekranie. Gest musi wychodzić z prawdy: inaczej
 * chwyt za uchwyt przyciskiem obejmującym napis skakałby na szacunkową
 * szerokość, a prowadnice pokazywałyby krawędź, której nie widać.
 */
function measuredGeometry(
  node: HTMLElement,
  grid: HTMLElement,
  metrics: CanvasMetrics,
  fallback: Geometry,
): Geometry {
  const box = node.getBoundingClientRect();
  const frame = grid.getBoundingClientRect();
  // jsdom (i pierwsza klatka przed układem) oddaje same zera — wtedy szacunek
  // z treści jest jedyną sensowną odpowiedzią.
  if (box.width <= 0 || box.height <= 0 || metrics.unit <= 0) return fallback;
  return {
    x: Math.max(0, Math.round((box.left - frame.left) / metrics.unit)),
    y: Math.max(0, Math.round((box.top - frame.top) / metrics.unit)),
    w: Math.max(MIN_ELEMENT_UNITS, Math.round(box.width / metrics.unit)),
    h: Math.max(MIN_ELEMENT_UNITS, Math.round(box.height / metrics.unit)),
    z: fallback.z,
  };
}

/**
 * Warstwa ramek. Elementy tenanta sięgają `z` = 999 (schemat), więc warstwa
 * edycyjna musi stać ponad nimi — a że płótno jest własnym kontekstem układania
 * (`isolate` w rendererze), nie ma jak wyjść nad interfejs panelu.
 */
const FRAME_Z = 1_000;

const HANDLE_POSITION: Record<ResizeHandle, string> = {
  nw: "left-0 top-0",
  n: "left-1/2 top-0 -translate-x-1/2",
  ne: "right-0 top-0",
  e: "right-0 top-1/2 -translate-y-1/2",
  se: "right-0 bottom-0",
  s: "left-1/2 bottom-0 -translate-x-1/2",
  sw: "left-0 bottom-0",
  w: "left-0 top-1/2 -translate-y-1/2",
};

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: "cursor-nwse-resize",
  n: "cursor-ns-resize",
  ne: "cursor-nesw-resize",
  e: "cursor-ew-resize",
  se: "cursor-nwse-resize",
  s: "cursor-ns-resize",
  sw: "cursor-nesw-resize",
  w: "cursor-ew-resize",
};

/**
 * WARSTWA PODGLĄDU GESTU — prowadnice i obrys miejsca lądowania.
 *
 * Linie są w drzewie ZAWSZE, tylko schowane: gest zaczyna się w tym samym
 * zdarzeniu, w którym element zostaje zaznaczony, więc warstwa dorysowana przez
 * Reacta byłaby gotowa dopiero po pierwszej klatce ruchu. Pętla gestu pisze po
 * ich stylach wprost (canvas-gesture.ts) — żaden `setState` nie wchodzi między
 * rękę operatora a to, co widzi.
 *
 * Współrzędne są W UKŁADZIE PŁÓTNA (procenty obu osi), więc linia stoi dokładnie
 * tam, gdzie wypadło wyrównanie. Warstwa jest nieklikalna: prowadnica jest
 * informacją, a nie celem.
 */
function GestureOverlay({ overlayRef }: { overlayRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={overlayRef}
      data-canvas-gesture-layer
      aria-hidden="true"
      hidden
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: FRAME_Z + 2 }}
    >
      <span data-canvas-ghost className="absolute border-2 border-dashed border-[var(--builder-selection)]" />
      {Array.from({ length: GUIDE_SLOTS }, (_, index) => (
        <span
          key={index}
          data-canvas-guide-slot={index}
          hidden
          className="bg-accent absolute"
        />
      ))}
    </div>
  );
}

export function ElementFrame({
  element,
  box,
  rows,
  detached,
  selected,
  locked,
  onSelect,
  onEdit,
  onCommit,
  onPhase,
}: {
  element: CanvasElement;
  /**
   * Geometria AKTYWNEGO breakpointu — na telefonie z auto-układu albo z ręcznej
   * poprawki, na desktopie z treści. Ramka nie liczy jej sama, bo źródłem
   * prawdy o układzie mobilnym jest jedna funkcja czysta na całą sekcję.
   */
  box: Geometry;
  rows: number;
  /** Element ma RĘCZNĄ poprawkę mobilną — ramka mówi to wprost (K4, ADR-088). */
  detached?: boolean;
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
  /**
   * Wejście w EDYCJĘ TREŚCI elementu (K3): tekst edytuje się w miejscu, obraz
   * otwiera picker, a od ADR-166 KAŻDY pozostały rodzaj otwiera szufladę
   * właściwości. Ramka nie wie, którą z tych dróg dostała — i nie musi; wie
   * płótno. Parametr zostaje opcjonalny, bo ramka ma działać także wtedy, gdy
   * wołający świadomie nie ma czego pod dwuklikiem otworzyć.
   */
  onEdit?: () => void;
  /**
   * Koniec gestu — jeden wpis w historii i jeden zapis. `fixed` mówi, które
   * wymiary przestały wynikać z treści: pociągnięcie za uchwyt JEST decyzją
   * „ma być tyle" (K4, ADR-088).
   */
  onCommit: (geometry: Geometry, fixed?: FixedAxes) => void;
  /** Początek i koniec gestu — płótno wycisza na ten czas interfejs najechania. */
  onPhase: (dragging: boolean) => void;
}) {
  const t = useTranslations("site");
  const frameRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  /*
   * WEJŚCIE W EDYCJĘ vs GEST (K3 na silniku K2c, ADR-087).
   *
   * Zaznaczenie zdarza się na WCIŚNIĘCIU, bo od niego zaczyna się też gest.
   * Gdyby drugie wciśnięcie w zaznaczony tekst od razu otwierało edytor,
   * ramka znikałaby pod palcem w chwili, w której silnik dopiero przechwycił
   * wskaźnik — przeciągnięcie zamieniałoby się w przypadkowe pisanie.
   *
   * Dlatego decyzja zapada na KLIKNIĘCIU (czyli po puszczeniu) i tylko wtedy,
   * gdy wskaźnik nie odjechał dalej niż PRÓG GESTU. Drogę mierzymy sami, z
   * własnych zdarzeń: sygnał fazy silnika podnosi się już przy chwycie (flaga
   * `data-dragging` musi wisieć od pierwszej klatki), więc nie odpowiada na
   * pytanie „czy to było przeciągnięcie".
   */
  const downPointRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const wasSelectedRef = useRef(false);
  const size = sizeOf(element);
  const hugs = size.w === "hug" || size.h === "hug";
  /** Pudełko z GEOMETRII — jedno przeliczenie na render, wspólne dla stylu i efektu. */
  const boxStyle = geometryStyle(box, rows);
  const cssWidth = String(boxStyle.width);
  const cssHeight = String(boxStyle.height);

  /*
   * RAMKA RÓWNA SIĘ PUDEŁKU TREŚCI (K4, ADR-088, decyzja właściciela).
   *
   * Przy wymiarze jawnym wystarczy geometria — ramka i pudełko liczą się z tej
   * samej liczby. Przy `hug` pudełko wyznacza TREŚĆ (`max-content` w arkuszu),
   * więc jedynym uczciwym źródłem rozmiaru jest pomiar: ramka pusta w środku,
   * której kazano by objąć treść, miałaby zero szerokości.
   *
   * Obserwator pilnuje zmian treści i szerokości płótna. Na czas gestu pomiar
   * MILCZY — wtedy stylami pudełka rządzi silnik i zapis obserwatora walczyłby
   * z nim o ten sam atrybut.
   */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (!hugs) {
      // Powrót z `hug` na wymiar jawny zostawiłby po sobie rozmiar w pikselach
      // z ostatniego pomiaru. Wpisujemy procent Z GEOMETRII, zamiast kasować
      // właściwość: skasowana zniknęłaby też Reactowi, który ma ją u siebie
      // za aktualną i nie odtworzyłby jej przy następnym renderze.
      frame.style.width = cssWidth;
      frame.style.height = cssHeight;
      return;
    }
    const grid = frame.closest<HTMLElement>("[data-canvas-grid]");
    const node = grid?.querySelector<HTMLElement>(`[data-element-id="${element.id}"]`);
    if (!grid || !node) return;

    const apply = () => {
      if (frame.closest<HTMLElement>("[data-builder-canvas]")?.hasAttribute("data-dragging")) return;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      if (size.w === "hug") frame.style.width = `${rect.width}px`;
      if (size.h === "hug") frame.style.height = `${rect.height}px`;
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [element.id, hugs, size.w, size.h, cssWidth, cssHeight]);

  /**
   * Droga liczy się z RUCHU WSKAŹNIKA, a nie ze współrzędnych kliknięcia:
   * silnik przechwytuje wskaźnik na tej ramce, więc `pointermove` trafia tu
   * także wtedy, gdy kursor wyjechał poza pudełko — a `click` niesie pozycję
   * niepewnie (zdarzenia z klawiatury i syntetyczne dają zera).
   */
  function trackPointer(event: { clientX: number; clientY: number }): void {
    const from = downPointRef.current;
    if (!from || movedRef.current) return;
    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > GESTURE_ACTIVATION_PX) {
      movedRef.current = true;
    }
  }

  /**
   * KLAWIATURA UMIE OBA GESTY (ADR-173, audyt W8).
   *
   * Strzałki PRZESUWAJĄ o jednostkę, z Shiftem o dziesięć. Strzałki z Ctrl
   * (albo Cmd) ZMIENIAJĄ ROZMIAR tym samym krokiem — kotwicą jest lewy górny
   * róg, więc prawo/dół powiększa, lewo/góra zmniejsza; to jest dokładnie
   * uchwyt `se` bez myszy, przez tę samą funkcję czystą i ten sam `onCommit`,
   * żeby tryb wymiaru przechodził na jawny identycznie jak po geście.
   *
   * Do ADR-173 rozmiaru NIE dało się zmienić klawiaturą w ogóle: osiem uchwytów
   * było fokusowalnymi przyciskami z samym `onPointerDown`, więc Enter i Spacja
   * na nich nie robiły nic. Uchwyty są odtąd poza kolejnością Tab i poza drzewem
   * dostępności (patrz niżej) — obietnica obsługi, której nie ma, jest gorsza
   * niż jej brak.
   *
   * MODYFIKATOREM JEST Ctrl/Cmd, A NIE Alt: Alt ma na płótnie zajęte znaczenie
   * — w trakcie gestu wyłącza przyciąganie (canvas-gesture.ts). Jedno oznaczenie
   * na dwie różne rzeczy uczyłoby operatora reguły, która raz działa, a raz nie.
   *
   * `preventDefault` jest konieczny w obu gałęziach: bez niego strzałka najpierw
   * przewinęłaby płótno (a Cmd+strzałka cofnęłaby historię przeglądarki)
   * i element uciekłby operatorowi z oczu przy pierwszym kroku.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (locked) return;
    const direction =
      event.key === "ArrowLeft"
        ? "left"
        : event.key === "ArrowRight"
          ? "right"
          : event.key === "ArrowUp"
            ? "up"
            : event.key === "ArrowDown"
              ? "down"
              : null;
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
    if (event.ctrlKey || event.metaKey) {
      // Oś bierze się z kierunku, tak samo jak przy uchwycie: pozioma strzałka
      // rusza szerokość, pionowa — wysokość. `axesOf` jest jednym miejscem,
      // w którym ta odpowiedniość mieszka.
      onCommit(nudgeSize(box, direction, step, rows), axesOf(direction === "up" || direction === "down" ? "s" : "e"));
      return;
    }
    onCommit(nudgeGeometry(box, direction, step, rows));
  }

  /**
   * Wspólny start obu gestów. Miara płótna jest brana RAZ, w chwili chwytu, i
   * zamrożona do końca ruchu (ADR-085: mierzymy kontener, nie okno) — zmiana
   * szerokości w trakcie przeciągania nie ma prawa przeskalować przebytej drogi.
   *
   * Warstwa wizualna to DWA węzły: pudełko treści (renderer) i ramka edycyjna.
   * Jadą razem, bo operator widzi je jako jedną rzecz.
   */
  function beginGesture(event: ReactPointerEvent<HTMLElement>, handle: ResizeHandle | null) {
    if (locked || !event.isPrimary || event.button !== 0) return;
    const frame = frameRef.current;
    const grid = frame?.closest<HTMLElement>("[data-canvas-grid]") ?? null;
    if (!frame || !grid) return;

    const metrics = canvasMetrics(grid.clientWidth, rows);
    const self = grid.querySelector<HTMLElement>(`[data-element-id="${element.id}"]`);

    /*
     * PUNKT ODNIESIENIA I CELE PRZYCIĄGANIA IDĄ Z EKRANU, nie z treści. Dla
     * pudełek o wymiarze jawnym to ta sama liczba (pomiar wraca do geometrii),
     * dla `hug` to jedyna prawda — a prowadnica pokazująca krawędź, której
     * nie widać, jest gorsza niż brak prowadnicy.
     */
    const neighbours: Geometry[] = [];
    for (const node of grid.querySelectorAll<HTMLElement>("[data-element-id]")) {
      const id = node.getAttribute("data-element-id");
      if (!id || id === element.id) continue;
      neighbours.push(measuredGeometry(node, grid, metrics, box));
    }

    startCanvasGesture(event.nativeEvent, {
      capture: event.currentTarget,
      handle,
      base: self ? measuredGeometry(self, grid, metrics, box) : box,
      neighbours,
      metrics,
      box: self,
      frame,
      root: frame.closest<HTMLElement>("[data-builder-canvas]"),
      overlay: overlayRef.current,
      onCommit: (geometry) => onCommit(geometry, handle ? axesOf(handle) : undefined),
      onPhase,
    });
  }

  return (
    <>
      <div
        ref={frameRef}
        data-element-frame={element.id}
        data-element-selected={selected ? "on" : "off"}
        data-element-detached={detached ? "on" : undefined}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        /*
         * SKRÓTY OGŁOSZONE TAM, GDZIE DZIAŁAJĄ (ADR-173). Ramka jest jedyną
         * kontrolką warstwy edycyjnej, która przyjmuje klawiaturę, więc to ona
         * ma powiedzieć, co przyjmuje. Atrybut jest maszynowy (a nie napis), bo
         * napis przy każdym elementie na płótnie byłby szumem — a czytnik ekranu
         * i tak przeczyta go z drzewa dostępności.
         */
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Control+ArrowUp Control+ArrowDown Control+ArrowLeft Control+ArrowRight"
        aria-label={
          detached
            ? `${t(`elementKinds.${element.kind}`)} - ${t("elements.detached")}`
            : t(`elementKinds.${element.kind}`)
        }
        /*
         * Wygląd obrysu (kolor, grubość, otoczka) siedzi w arkuszu panelu przy
         * tokenie `--builder-selection` — patrz komentarz tam. Tutaj zostaje
         * WYŁĄCZNIE zachowanie: kursor i stan zablokowania. Obrys rysuje się
         * `outline`, a nie `border`, więc zaznaczenie nie zjada ani piksela
         * treści pod sobą (pinezka o przesuwającym się tekście).
         */
        className={`absolute touch-none outline-none ${
          locked ? "cursor-not-allowed" : "cursor-move"
        }`}
        style={{ ...boxStyle, zIndex: FRAME_Z }}
        onFocus={onSelect}
        onPointerDown={(event) => {
          // Zaznaczenie idzie PRZED gestem i zdarza się także wtedy, gdy ruch
          // nie przekroczy progu — klik w element ma go zaznaczyć, a nie ruszyć.
          event.stopPropagation();
          wasSelectedRef.current = selected;
          downPointRef.current = { x: event.clientX, y: event.clientY };
          movedRef.current = false;
          onSelect();
          beginGesture(event, null);
        }}
        onPointerMove={trackPointer}
        onClick={() => {
          // Drugi klik w JUŻ zaznaczony element otwiera jego treść — ale tylko
          // wtedy, gdy to naprawdę był klik, a nie koniec przeciągnięcia.
          if (!onEdit || !wasSelectedRef.current || movedRef.current) return;
          onEdit();
        }}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => {
          // Dwuklik działa też na elemencie jeszcze NIEZAZNACZONYM — po
          // przeciągnięciu nie zadziała, bo wskaźnik odjechał od punktu chwytu.
          if (!onEdit || movedRef.current) return;
          onEdit();
        }}
      >
        {/* MARKER ODPIĘCIA (K4, ADR-088) — element z ręczną poprawką mobilną
            ma to mówić SAM, bez klikania i bez zaglądania do szuflady. Kropka
            stoi w rogu ramki, żeby nie zasłaniać treści, i niesie własną
            etykietę dla czytnika ekranu. */}
        {detached ? (
          <span
            data-element-detached-badge
            title={t("elements.detached")}
            className="bg-accent absolute -top-1 -right-1 size-2 rounded-full"
          />
        ) : null}
        {selected && !locked
          ? RESIZE_HANDLES.map((handle) => (
              <button
                key={handle}
                type="button"
                data-resize-handle={handle}
                aria-label={t(`resizeHandles.${handle}`)}
                /*
                 * UCHWYT JEST POWIERZCHNIĄ MYSZY, NIE PRZYSTANKIEM TABA
                 * (ADR-173, audyt W8). Osiem uchwytów w kolejności Tab przy
                 * KAŻDYM zaznaczonym elemencie było ośmioma obietnicami bez
                 * pokrycia — mają wyłącznie `onPointerDown`, więc Enter i Spacja
                 * nie robiły nic. Klawiaturowy odpowiednik gestu żyje odtąd na
                 * ramce (Ctrl/Cmd + strzałki), więc uchwyt schodzi z drzewa
                 * dostępności zamiast udawać kontrolkę.
                 */
                tabIndex={-1}
                aria-hidden="true"
                onPointerDown={(event) => {
                  // Bez tego wciśnięcie uchwytu uruchomiłoby TAKŻE przeciąganie
                  // ramki i pudełko zaczęłoby jechać zamiast się rozciągać.
                  event.stopPropagation();
                  onSelect();
                  beginGesture(event, handle);
                }}
                // Kolory uchwytu też idą z arkusza (`[data-resize-handle]`).
                className={`absolute size-2.5 touch-none ${HANDLE_POSITION[handle]} ${HANDLE_CURSOR[handle]}`}
              />
            ))
          : null}
      </div>
      <GestureOverlay overlayRef={overlayRef} />
    </>
  );
}
