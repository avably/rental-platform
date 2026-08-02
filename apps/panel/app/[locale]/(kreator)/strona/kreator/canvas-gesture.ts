"use client";

/**
 * SILNIK GESTÓW PŁÓTNA (K2c, ADR-087) — przeciąganie i zmiana rozmiaru elementu
 * na surowych zdarzeniach wskaźnika.
 *
 * Ten plik zastępuje mechanikę ruchu z K2 (ADR-084: przeciąganie przez dnd-kit,
 * stan Reacta na każdy ruch). Powód przyszedł z produkcji: przesuwanie
 * elementów działało źle — element szedł schodkami, płótno zaznaczało teksty,
 * paski narzędzi wyskakiwały spod kursora. Przyczyny trzeba było usunąć naraz,
 * bo każda z osobna zostawiała gest nadal szarpany.
 *
 * ================== TRZY ZASADY, KTÓRE TU OBOWIĄZUJĄ ==================
 *
 * 1. WSKAŹNIK NALEŻY DO GESTU. `setPointerCapture` przypina wszystkie kolejne
 *    zdarzenia do elementu, który gest zaczął — kursor może wyjechać poza
 *    płótno, poza obszar przewijania i poza własną sekcję, a ruch nadal trafia
 *    tam, gdzie trzeba. Przechwyt zwalnia się sam przy `pointerup`, więc nie ma
 *    stanu, który mógłby zostać po nieudanym sprzątaniu.
 *
 * 2. W TRAKCIE GESTU NIE MA STANU REACTA. Ruch jest zapisem do stylu DWÓCH
 *    węzłów (pudełko treści i ramka edycyjna), najwyżej RAZ na klatkę
 *    (`requestAnimationFrame`). Wcześniej przeciąganie było ciągiem `setState`
 *    — każdy piksel przerysowywał całe płótno z dwunastoma sekcjami i to
 *    właśnie widać było jako szarpanie. Przesunięcie idzie przez
 *    `translate3d`, bo transform nie unieważnia układu strony.
 *
 * 3. GEOMETRIA POWSTAJE DOPIERO NA `pointerup`. W trakcie ruchu pudełko trzyma
 *    punkt chwytu 1:1 (pozycja ułamkowa, {@link rawMove}), a przyciąganie do
 *    siatki i sąsiadów liczy się na bieżąco WYŁĄCZNIE po to, żeby je POKAZAĆ:
 *    prowadnice i obrys miejsca lądowania. Zapis do szkicu jest jeden na cały
 *    gest, więc „cofnij" cofa ruch, a nie piksel.
 *
 * Arytmetyka nadal mieszka w `@avably/core/site` (funkcje czyste, testowane bez
 * DOM-u). Tutaj zostaje wyłącznie obsługa zdarzeń i pisanie po stylach.
 */
import {
  CANVAS_COLUMNS,
  commitMove,
  commitResize,
  rawMove,
  rawResize,
  type CanvasMetrics,
  type Geometry,
  type Guide,
  type RawBox,
  type ResizeHandle,
  type SnapResult,
} from "@avably/core/site";
import { geometryStyle } from "@avably/ui";

/**
 * Próg uruchomienia gestu w pikselach. Bez niego zwykłe kliknięcie w element
 * byłoby przeciągnięciem o zero — a przeciągnięcie o zero NIE jest neutralne:
 * commit przepuszcza pozycję przez przyciąganie, więc klik w element stojący
 * tuż obok sąsiada dosuwałby go do niego bez pytania.
 */
export const GESTURE_ACTIVATION_PX = 4;

/** Ile pozycji prowadnic rysujemy na oś — pudełko ma trzy zaczepy na oś. */
const GUIDE_SLOTS_PER_AXIS = 3;

/** Rozmiar puli linii w warstwie podglądu (obie osie). */
export const GUIDE_SLOTS = GUIDE_SLOTS_PER_AXIS * 2;

export interface CanvasGestureOptions {
  /** Węzeł przejmujący wskaźnik: ramka elementu albo uchwyt rozmiaru. */
  capture: HTMLElement;
  /** Uchwyt rozmiaru albo `null`, gdy przesuwamy całe pudełko. */
  handle: ResizeHandle | null;
  /** Geometria w chwili chwytu — punkt odniesienia całego gestu. */
  base: Geometry;
  /** Geometrie POZOSTAŁYCH elementów sekcji — cele przyciągania. */
  neighbours: readonly Geometry[];
  /** Miara płótna zamrożona na czas gestu (jedna jednostka na obie osie). */
  metrics: CanvasMetrics;
  /** Warstwa wizualna: pudełko treści i ramka edycyjna jadą razem. */
  nodes: readonly (HTMLElement | null)[];
  /** Korzeń płótna — na czas gestu dostaje `data-dragging`. */
  root: HTMLElement | null;
  /** Warstwa podglądu gestu (prowadnice + obrys lądowania). */
  overlay: HTMLElement | null;
  /** Koniec gestu: JEDEN wpis w historii i JEDEN zapis. */
  onCommit: (geometry: Geometry) => void;
  /** Zmiana fazy gestu — płótno wycisza na ten czas interfejs najechania. */
  onPhase?: (dragging: boolean) => void;
}

/** Styl pudełka w procentach — TA SAMA funkcja, którą rysuje renderer. */
function boxStyle(box: RawBox, z: number, rows: number) {
  return geometryStyle({ ...box, z }, rows);
}

/**
 * Rysowanie warstwy podglądu: prowadnice tam, gdzie wyrównanie NAPRAWDĘ zajdzie,
 * i obrys pudełka w miejscu, w którym element wyląduje po upuszczeniu.
 *
 * Obrys jest tu świadomie, choć briefu nie było: skoro pudełko trzyma kursor
 * 1:1, a zapis przyciąga, to bez pokazania celu operator dowiadywałby się
 * o przyciągnięciu dopiero po fakcie. Prowadnica mówi „z czym równo", obrys
 * mówi „gdzie dokładnie".
 */
function paintOverlay(
  overlay: HTMLElement | null,
  landing: Geometry,
  guides: readonly Guide[],
  rows: number,
): void {
  if (!overlay) return;
  overlay.hidden = false;

  const ghost = overlay.querySelector<HTMLElement>("[data-canvas-ghost]");
  if (ghost) {
    const style = boxStyle(landing, landing.z, rows);
    ghost.style.left = String(style.left);
    ghost.style.top = String(style.top);
    ghost.style.width = String(style.width);
    ghost.style.height = String(style.height);
  }

  const slots = [...overlay.querySelectorAll<HTMLElement>("[data-canvas-guide-slot]")];
  // Kilka celów potrafi wypaść na TEJ SAMEJ pozycji (krawędź sąsiada i krawędź
  // płótna). Druga linia w tym samym miejscu nie niesie nic ponad pierwszą,
  // więc zostaje jedna — o zasięgu obejmującym oba pudełka.
  const merged = new Map<string, Guide>();
  for (const guide of guides) {
    const key = `${guide.axis}:${guide.at}`;
    const seen = merged.get(key);
    merged.set(
      key,
      seen
        ? { ...seen, from: Math.min(seen.from, guide.from), to: Math.max(seen.to, guide.to) }
        : guide,
    );
  }

  const lines = [...merged.values()].slice(0, slots.length);
  slots.forEach((slot, index) => {
    const guide = lines[index];
    if (!guide) {
      slot.hidden = true;
      slot.removeAttribute("data-canvas-guide");
      return;
    }
    slot.hidden = false;
    slot.setAttribute("data-canvas-guide", guide.axis);
    slot.setAttribute("data-guide-kind", guide.kind);
    if (guide.axis === "x") {
      slot.style.left = `${(guide.at / CANVAS_COLUMNS) * 100}%`;
      slot.style.top = `${(guide.from / rows) * 100}%`;
      slot.style.height = `${((guide.to - guide.from) / rows) * 100}%`;
      slot.style.width = "1px";
    } else {
      slot.style.top = `${(guide.at / rows) * 100}%`;
      slot.style.left = `${(guide.from / CANVAS_COLUMNS) * 100}%`;
      slot.style.width = `${((guide.to - guide.from) / CANVAS_COLUMNS) * 100}%`;
      slot.style.height = "1px";
    }
  });
}

function clearOverlay(overlay: HTMLElement | null): void {
  if (!overlay) return;
  overlay.hidden = true;
  for (const slot of overlay.querySelectorAll<HTMLElement>("[data-canvas-guide-slot]")) {
    slot.hidden = true;
    slot.removeAttribute("data-canvas-guide");
  }
}

/**
 * Uruchomienie gestu. Wołane z `pointerdown` — dalej gest żyje własnym życiem
 * na przechwyconym wskaźniku i kończy się sam.
 */
export function startCanvasGesture(
  event: PointerEvent,
  {
    capture,
    handle,
    base,
    neighbours,
    metrics,
    nodes,
    root,
    overlay,
    onCommit,
    onPhase,
  }: CanvasGestureOptions,
): void {
  // Bez tego przeglądarka zaczyna ZAZNACZAĆ tekst sekcji pod kursorem (a na
  // obrazkach — własne przeciąganie pliku). `user-select: none` na płótnie
  // broni reszty gestu, ale zaznaczenia rozpoczętego tym jednym wciśnięciem już
  // nie cofnie.
  event.preventDefault();
  try {
    capture.setPointerCapture(event.pointerId);
  } catch {
    // Wskaźnik zdążył zniknąć między wciśnięciem a tą linijką (albo zdarzenie
    // przyszło z automatu). Przechwyt jest ULEPSZENIEM — bez niego gest nadal
    // działa, dopóki kursor jest nad elementem; wyjątek nie może go zabić.
  }

  const startX = event.clientX;
  const startY = event.clientY;
  const rows = metrics.rows;
  const live = nodes.filter((node): node is HTMLElement => node !== null);
  /** Styl, do którego wracamy po geście — dokładnie ten, który wystawił React. */
  const restore = boxStyle(base, base.z, rows);

  let pending: { dx: number; dy: number; alt: boolean } | null = null;
  let frame = 0;
  let active = false;
  let landed: Geometry = base;

  root?.setAttribute("data-dragging", "on");
  onPhase?.(true);

  function resolve(dx: number, dy: number, alt: boolean): { raw: RawBox; snapped: SnapResult } {
    const context = { neighbours, snap: !alt };
    const du = dx / metrics.unit;
    const dv = dy / metrics.unit;
    return handle
      ? {
          raw: rawResize(base, handle, du, dv, rows),
          snapped: commitResize(base, handle, dx, dy, metrics, context),
        }
      : {
          raw: rawMove(base, du, dv, rows),
          snapped: commitMove(base, dx, dy, metrics, context),
        };
  }

  /** Jeden zapis do stylu na klatkę — cała pętla rysowania gestu. */
  function draw(): void {
    frame = 0;
    if (!pending) return;
    const { raw, snapped } = resolve(pending.dx, pending.dy, pending.alt);
    landed = snapped.geometry;

    if (handle) {
      const style = boxStyle(raw, base.z, rows);
      for (const node of live) {
        node.style.left = String(style.left);
        node.style.top = String(style.top);
        node.style.width = String(style.width);
        node.style.height = String(style.height);
      }
    } else {
      const shiftX = (raw.x - base.x) * metrics.unit;
      const shiftY = (raw.y - base.y) * metrics.unit;
      for (const node of live) {
        node.style.transform = `translate3d(${shiftX}px, ${shiftY}px, 0)`;
      }
    }

    paintOverlay(overlay, landed, snapped.guides, rows);
  }

  function onMove(pointer: PointerEvent): void {
    const dx = pointer.clientX - startX;
    const dy = pointer.clientY - startY;
    // Próg liczy się od punktu wciśnięcia, ale przesunięcie NIE odejmuje progu:
    // dzięki temu odległość kursor–punkt chwytu jest stała od pierwszej klatki
    // do upuszczenia, a element nie „ucieka" o cztery piksele w bok.
    if (!active && Math.hypot(dx, dy) < GESTURE_ACTIVATION_PX) return;
    active = true;
    pending = { dx, dy, alt: pointer.altKey };
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function finish(): void {
    capture.removeEventListener("pointermove", onMove);
    capture.removeEventListener("pointerup", finish);
    capture.removeEventListener("pointercancel", finish);
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }

    // Ostatni ruch mógł nie doczekać swojej klatki — wtedy zamrożona pozycja
    // byłaby o klatkę stara. Liczymy ją tu, bo commit musi zgadzać się z tym,
    // gdzie operator PUŚCIŁ, a nie z tym, co zdążyliśmy narysować.
    if (active && pending) landed = resolve(pending.dx, pending.dy, pending.alt).snapped.geometry;

    clearOverlay(overlay);
    root?.removeAttribute("data-dragging");
    onPhase?.(false);

    /*
     * Kolejność: najpierw commit (React planuje przerysowanie z nową
     * geometrią), potem zdjęcie stylów gestu. Oba dzieją się przed malowaniem
     * klatki, więc pudełko nie mruga powrotem na pozycję wyjściową. Style
     * PRZYWRACAMY do wartości bazowej zamiast je kasować: gdy gest skończył się
     * tam, skąd wyszedł, React nie ma czego przerysować, a skasowana pozycja
     * zostałaby pusta.
     */
    if (active) onCommit(landed);
    for (const node of live) {
      node.style.transform = "";
      if (!handle) continue;
      node.style.left = String(restore.left);
      node.style.top = String(restore.top);
      node.style.width = String(restore.width);
      node.style.height = String(restore.height);
    }
  }

  capture.addEventListener("pointermove", onMove);
  capture.addEventListener("pointerup", finish);
  capture.addEventListener("pointercancel", finish);
}
