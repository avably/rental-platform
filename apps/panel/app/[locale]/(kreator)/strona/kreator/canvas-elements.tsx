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
  NUDGE_STEP,
  NUDGE_STEP_LARGE,
  RESIZE_HANDLES,
  canvasMetrics,
  nudgeGeometry,
  type CanvasElement,
  type Geometry,
  type ResizeHandle,
} from "@avably/core/site";
import { geometryStyle } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { GUIDE_SLOTS, startCanvasGesture } from "./canvas-gesture";

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
      <span data-canvas-ghost className="border-accent absolute border-2 border-dashed" />
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
  rows,
  neighbours,
  selected,
  locked,
  onSelect,
  onCommit,
  onPhase,
}: {
  element: CanvasElement;
  rows: number;
  /** Geometrie POZOSTAŁYCH elementów sekcji — cele przyciągania. */
  neighbours: Geometry[];
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
  /** Koniec gestu — jeden wpis w historii i jeden zapis. */
  onCommit: (geometry: Geometry) => void;
  /** Początek i koniec gestu — płótno wycisza na ten czas interfejs najechania. */
  onPhase: (dragging: boolean) => void;
}) {
  const t = useTranslations("site");
  const frameRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const box = element.layout.desktop;

  /**
   * Strzałki przesuwają o jednostkę, z Shiftem o dziesięć. `preventDefault`
   * jest konieczny: bez niego strzałka najpierw przewinęłaby płótno, a element
   * uciekłby operatorowi z oczu przy pierwszym kroku.
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
    onCommit(nudgeGeometry(box, direction, event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP, rows));
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

    startCanvasGesture(event.nativeEvent, {
      capture: event.currentTarget,
      handle,
      base: box,
      neighbours,
      metrics: canvasMetrics(grid.clientWidth, rows),
      nodes: [grid.querySelector<HTMLElement>(`[data-element-id="${element.id}"]`), frame],
      root: frame.closest<HTMLElement>("[data-builder-canvas]"),
      overlay: overlayRef.current,
      onCommit,
      onPhase,
    });
  }

  return (
    <>
      <div
        ref={frameRef}
        data-element-frame={element.id}
        data-element-selected={selected ? "on" : "off"}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={t(`elementKinds.${element.kind}`)}
        className={`absolute touch-none outline-none ${
          locked ? "cursor-not-allowed" : "cursor-move"
        } ${
          selected
            ? "border-accent border-2"
            : "hover:border-accent/60 focus-visible:border-accent border-2 border-transparent"
        }`}
        style={{ ...geometryStyle(box, rows), zIndex: FRAME_Z }}
        onFocus={onSelect}
        onPointerDown={(event) => {
          // Zaznaczenie idzie PRZED gestem i zdarza się także wtedy, gdy ruch
          // nie przekroczy progu — klik w element ma go zaznaczyć, a nie ruszyć.
          event.stopPropagation();
          onSelect();
          beginGesture(event, null);
        }}
        onKeyDown={handleKeyDown}
      >
        {selected && !locked
          ? RESIZE_HANDLES.map((handle) => (
              <button
                key={handle}
                type="button"
                data-resize-handle={handle}
                aria-label={t(`resizeHandles.${handle}`)}
                onPointerDown={(event) => {
                  // Bez tego wciśnięcie uchwytu uruchomiłoby TAKŻE przeciąganie
                  // ramki i pudełko zaczęłoby jechać zamiast się rozciągać.
                  event.stopPropagation();
                  onSelect();
                  beginGesture(event, handle);
                }}
                className={`border-accent bg-background absolute size-2.5 touch-none border ${HANDLE_POSITION[handle]} ${HANDLE_CURSOR[handle]}`}
              />
            ))
          : null}
      </div>
      <GestureOverlay overlayRef={overlayRef} />
    </>
  );
}
