"use client";

/**
 * WARSTWA EDYCYJNA ELEMENTÓW (K2, ADR-084) — zaznaczenie, przeciąganie, osiem
 * uchwytów rozmiaru, prowadnice, klawiatura.
 *
 * Ten plik NIE rysuje strony. Stronę rysuje wspólny renderer (@avably/ui), a
 * warstwa edycyjna wchodzi do niego SZWEM `elementWrapper` — piętro niżej niż
 * `sectionWrapper` z K1 (ADR-083, decyzja 2). Ramka leży NAD elementem, ma
 * własną, wysoką warstwę i przejmuje wskaźnik; sam element zostaje treścią
 * strony, tak samo w kreatorze i w sklepie.
 *
 * ================== DWA MECHANIZMY, DWA POWODY ==================
 *
 * PRZESUNIĘCIE idzie przez dnd-kit (ten sam kontekst, co kolejność sekcji z
 * K1): dostajemy próg aktywacji, autoprzewijanie płótna i jedno miejsce, w
 * którym zaczyna się każde przeciąganie w kreatorze.
 *
 * ZMIANA ROZMIARU idzie surowymi zdarzeniami wskaźnika, bo dnd-kit modeluje
 * „przeciągnij COŚ na COŚ", a uchwyt rozmiaru nie ma celu upuszczenia — ma
 * przesuwaną KRAWĘDŹ. Przepychanie tego przez bibliotekę dokładałoby warstwę
 * tłumaczenia bez ani jednej rzeczy w zamian.
 *
 * Arytmetyka OBU jest ta sama i mieszka w `@avably/core/site` (funkcje czyste,
 * testowane bez DOM-u). Tutaj zostaje wyłącznie przeliczenie pikseli wskaźnika
 * na jednostki siatki — i to przeliczenie mierzy PŁÓTNO, nigdy okno (ADR-085).
 */
import {
  CANVAS_COLUMNS,
  CANVAS_DESIGN_WIDTH_PX,
  GRID_UNIT_PX,
  NUDGE_STEP,
  NUDGE_STEP_LARGE,
  RESIZE_HANDLES,
  nudgeGeometry,
  snapResize,
  type CanvasElement,
  type Geometry,
  type Guide,
  type ResizeHandle,
} from "@avably/core/site";
import { geometryStyle } from "@avably/ui";
import { useDraggable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Warstwa ramek. Elementy tenanta sięgają `z` = 999 (schemat), więc warstwa
 * edycyjna musi stać ponad nimi — a że płótno jest własnym kontekstem układania
 * (`isolate` w rendererze), nie ma jak wyjść nad interfejs panelu.
 */
const FRAME_Z = 1_000;

/** Klucz przeciągania elementu w dnd-kit — prefiks odróżnia go od id sekcji. */
export const ELEMENT_DRAG_PREFIX = "element:";

export interface ElementDragData {
  kind: "element";
  sectionId: string;
  elementId: string;
  /** Szerokość PŁÓTNA w pikselach w chwili chwytu — miarą jest kontener, nie okno. */
  gridWidth: () => number;
}

/** Szerokość jednej kolumny w pikselach dla zmierzonego płótna. */
export function columnWidth(gridWidthPx: number): number {
  return (gridWidthPx > 0 ? gridWidthPx : CANVAS_DESIGN_WIDTH_PX) / CANVAS_COLUMNS;
}

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
 * PROWADNICE — rysowane w układzie współrzędnych PŁÓTNA, więc linia stoi
 * dokładnie tam, gdzie wypadło wyrównanie. Warstwa jest nieklikalna: prowadnica
 * jest informacją, a nie celem.
 */
export function GuideOverlay({ guides }: { guides: Guide[] }) {
  if (guides.length === 0) return null;
  return (
    <div
      data-canvas-guides
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: FRAME_Z + 2 }}
    >
      {guides.map((guide, index) => (
        <span
          key={`${guide.axis}-${guide.at}-${guide.kind}-${index}`}
          data-canvas-guide={guide.axis}
          data-guide-kind={guide.kind}
          className="bg-accent absolute"
          style={
            guide.axis === "x"
              ? {
                  left: `${(guide.at / CANVAS_COLUMNS) * 100}%`,
                  top: guide.from * GRID_UNIT_PX,
                  height: (guide.to - guide.from) * GRID_UNIT_PX,
                  width: 1,
                }
              : {
                  top: guide.at * GRID_UNIT_PX,
                  left: `${(guide.from / CANVAS_COLUMNS) * 100}%`,
                  width: `${((guide.to - guide.from) / CANVAS_COLUMNS) * 100}%`,
                  height: 1,
                }
          }
        />
      ))}
    </div>
  );
}

export function ElementFrame({
  element,
  sectionId,
  rows,
  neighbours,
  selected,
  locked,
  guides,
  onSelect,
  onPreview,
  onCommit,
}: {
  element: CanvasElement;
  sectionId: string;
  rows: number;
  /** Geometrie POZOSTAŁYCH elementów sekcji — cele przyciągania. */
  neighbours: Geometry[];
  selected: boolean;
  locked: boolean;
  /** Prowadnice tego elementu (niepuste tylko w trakcie jego ruchu). */
  guides: Guide[];
  onSelect: () => void;
  /** Podgląd w trakcie ruchu — bez wpisu do historii. */
  onPreview: (geometry: Geometry, guides: Guide[]) => void;
  /** Koniec ruchu — jeden wpis w historii i jeden zapis. */
  onCommit: (geometry: Geometry) => void;
}) {
  const t = useTranslations("site");
  const frameRef = useRef<HTMLDivElement | null>(null);
  const box = element.layout.desktop;

  const { setNodeRef, listeners } = useDraggable({
    id: `${ELEMENT_DRAG_PREFIX}${element.id}`,
    disabled: locked,
    data: {
      kind: "element",
      sectionId,
      elementId: element.id,
      gridWidth: () => (frameRef.current?.offsetParent as HTMLElement | null)?.clientWidth ?? 0,
    } satisfies ElementDragData,
  });

  function attachRef(node: HTMLDivElement | null) {
    frameRef.current = node;
    setNodeRef(node);
  }

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

  function startResize(handle: ResizeHandle) {
    return (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (locked) return;
      event.preventDefault();
      // Bez tego wciśnięcie uchwytu obudziłoby sensor przeciągania elementu i
      // pudełko zaczęłoby jechać zamiast się rozciągać.
      event.stopPropagation();
      onSelect();

      const perColumn = columnWidth(
        (frameRef.current?.offsetParent as HTMLElement | null)?.clientWidth ?? 0,
      );
      const startX = event.clientX;
      const startY = event.clientY;
      let last = box;

      const move = (pointer: globalThis.PointerEvent) => {
        const result = snapResize(
          box,
          handle,
          (pointer.clientX - startX) / perColumn,
          (pointer.clientY - startY) / GRID_UNIT_PX,
          // Alt wyłącza przyciąganie do sąsiadów — siatka zostaje, bo jednostka
          // jest granulacją zapisu, a nie preferencją.
          { rows, neighbours, snap: !pointer.altKey },
        );
        last = result.geometry;
        onPreview(result.geometry, result.guides);
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        onCommit(last);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    };
  }

  return (
    <>
      <div
        ref={attachRef}
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
        style={{ ...geometryStyle(box), zIndex: FRAME_Z }}
        onFocus={onSelect}
        {...listeners}
        /*
         * KOLEJNOŚĆ MA ZNACZENIE — `listeners` z dnd-kit wnosi WŁASNE
         * `onPointerDown` (sensor wskaźnika) i `onKeyDown` (sensor klawiatury),
         * więc oba nasze handlery muszą stać PO rozsypaniu, inaczej znikają bez
         * śladu (React bierze ostatni props o tej nazwie).
         *
         * Wskaźnik: wołamy handler dnd-kit sami, bo przeciąganie ma działać.
         * Klawiatura: NIE wołamy — dla pudełka o geometrii absolutnej „chwyt
         * spacją i strzałki" z sensora sortowalnej listy liczyłby pozycję
         * sąsiada w liście, której tu nie ma; strzałki są tu krokiem o
         * jednostkę siatki i to jest cała historia klawiatury na płótnie.
         */
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect();
          (listeners as { onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void } | undefined)?.onPointerDown?.(
            event,
          );
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
                onPointerDown={startResize(handle)}
                className={`border-accent bg-background absolute size-2.5 border ${HANDLE_POSITION[handle]} ${HANDLE_CURSOR[handle]}`}
              />
            ))
          : null}
      </div>
      <GuideOverlay guides={guides} />
    </>
  );
}
