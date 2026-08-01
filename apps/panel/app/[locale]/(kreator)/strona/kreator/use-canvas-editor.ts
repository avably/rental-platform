"use client";

/**
 * STAN EDYCJI PŁÓTNA (K2, ADR-084) — szkice sekcji, historia i autozapis.
 *
 * Jedno miejsce trzyma prawdę o tym, jak wygląda strona W TRAKCIE edycji.
 * Płótno rysuje SZKIC z tego stanu, a nie to, co przyszło z serwera — dzięki
 * temu przeciąganie jest natychmiastowe, a zapis idzie własnym tempem.
 *
 * ================== DLACZEGO AUTOZAPIS NIE ODŚWIEŻA RSC ==================
 *
 * Kanał `run` skorupy kończy sukces `router.refresh()` (K1, ADR-083, dec. 5) —
 * i słusznie, bo po dodaniu czy przestawieniu sekcji płótno musi zobaczyć nową
 * LISTĘ. Dla geometrii jest odwrotnie: odświeżenie przynosi dokładnie to, co
 * przed chwilą wysłaliśmy, a po drodze podmienia propsy w środku kolejnego
 * przeciągnięcia. Zapisy płótna idą więc kanałem BEZ odświeżania (`refresh:
 * false`) — wskaźnik „Zapisywanie…/Zapisano" zostaje jeden i wspólny.
 *
 * ================== RESYNCHRONIZACJA Z SERWERA ==================
 *
 * Szkic sekcji, którą już mamy, NIE jest nadpisywany propsami: edytor jest
 * jedynym piszącym, więc dane z serwera są w najlepszym razie równe temu, co
 * trzymamy, a w najgorszym starsze o jedno przeciągnięcie w locie. Z propsów
 * dochodzą wyłącznie sekcje NOWE, a znikają te usunięte.
 */
import {
  CANVAS_COLUMNS,
  isSectionCanvas,
  sectionCanvasFrom,
  type CanvasElement,
  type SectionCanvas,
} from "@avably/core/site";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EditorSection } from "@/app/[locale]/(panel)/strona/content";

import {
  canRedo as canRedoOf,
  canUndo as canUndoOf,
  changedKeys,
  commitHistory,
  initialHistory,
  redoHistory,
  replacePresent,
  undoHistory,
  type HistoryState,
} from "./canvas-history";

/** Zwłoka autozapisu. Krótsza mieli serwer w trakcie ruchu myszą, dłuższa każe czekać. */
export const AUTOSAVE_DELAY_MS = 700;

export type CanvasDrafts = Record<string, SectionCanvas>;

/**
 * Szkic płótna dla sekcji. Treść v1 jest KONWERTOWANA w locie — ta sama
 * funkcja, którą galeria tworzy nową sekcję (patrz `canvas-presets`), więc
 * sekcja sprzed K2 daje się edytować od razu, bez migracji danych. Zapis
 * utrwala wynik konwersji dopiero, gdy operator czegoś dotknie.
 */
function canvasOfSection(section: EditorSection): SectionCanvas {
  return isSectionCanvas(section.content)
    ? section.content
    : sectionCanvasFrom(section.type, section.content);
}

function draftsOf(sections: EditorSection[]): CanvasDrafts {
  return Object.fromEntries(sections.map((section) => [section.id, canvasOfSection(section)]));
}

/**
 * Dołożenie sekcji NOWYCH i odsianie usuniętych, bez ruszania szkiców, które
 * już mamy. Zwraca WEJŚCIE, gdy nic się nie zmieniło — dzięki temu odświeżenie
 * RSC nie generuje nowego stanu i nie remontuje płótna w trakcie pracy.
 */
function mergeDrafts(current: CanvasDrafts, sections: EditorSection[]): CanvasDrafts {
  let changed = Object.keys(current).length !== sections.length;
  const next: CanvasDrafts = {};
  for (const section of sections) {
    const existing = current[section.id];
    next[section.id] = existing ?? canvasOfSection(section);
    if (!existing) changed = true;
  }
  return changed ? next : current;
}

/** Identyfikator nowego elementu — musi przejść wzorzec ze schematu (małe znaki). */
export function newElementId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `el-${Math.random().toString(36).slice(2, 10)}`;
}

export interface CanvasEditor {
  canvasOf: (sectionId: string) => SectionCanvas | undefined;
  /**
   * Zmiana szkicu sekcji: JEDEN wpis w historii i JEDEN zaplanowany zapis.
   * Podgląd ruchu (przeciąganie w toku) NIE idzie tędy — siedzi w stanie
   * płótna i dokłada się dopiero przy rysowaniu, żeby „cofnij" cofało ruch,
   * a nie piksel.
   */
  mutate: (sectionId: string, update: (canvas: SectionCanvas) => SectionCanvas) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Natychmiastowy zapis wszystkiego, co czeka (wyjście z kreatora, publikacja). */
  flush: () => void;
}

export function useCanvasEditor({
  sections,
  persist,
}: {
  sections: EditorSection[];
  persist: (section: EditorSection, canvas: SectionCanvas) => void;
}): CanvasEditor {
  const [history, setHistory] = useState<HistoryState<CanvasDrafts>>(() =>
    initialHistory(draftsOf(sections)),
  );

  /*
   * Historia mieszka jednocześnie w STANIE (render) i w REFERENCJI (zdarzenia).
   * Referencja jest konieczna, bo funkcja aktualizująca `setHistory` wykonuje
   * się PÓŹNIEJ niż zdarzenie, a zapis musi wiedzieć JUŻ TERAZ, czy i co się
   * zmieniło — inaczej dwie operacje w jednym zdarzeniu (usunięcie elementu i
   * zdjęcie zaznaczenia) czytałyby ten sam, nieaktualny szkic. Same operacje
   * aktualizują OBA naraz; efekt niżej domyka przypadki, w których stan zmienił
   * się z innego powodu (resynchronizacja z propsów).
   */
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // Resync z propsów W RENDERZE (bez kaskady efektów) — wzorzec z K1.
  const [syncedFrom, setSyncedFrom] = useState(sections);
  if (syncedFrom !== sections) {
    setSyncedFrom(sections);
    setHistory((current) => {
      const merged = mergeDrafts(current.present, sections);
      return merged === current.present ? current : replacePresent(current, merged);
    });
  }

  const sectionsById = useMemo(
    () => new Map(sections.map((section) => [section.id, section])),
    [sections],
  );

  // Referencje dla opóźnionego zapisu: timer odpala się poza renderem, więc musi
  // czytać AKTUALNY stan, a nie ten domknięty w chwili planowania.
  const sectionsRef = useRef(sectionsById);
  useEffect(() => {
    sectionsRef.current = sectionsById;
  }, [sectionsById]);
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  const dirty = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const ids = [...dirty.current];
    dirty.current.clear();
    for (const id of ids) {
      const section = sectionsRef.current.get(id);
      const canvas = historyRef.current.present[id];
      if (section && canvas) persistRef.current(section, canvas);
    }
  }, []);

  const schedule = useCallback(
    (ids: string[]) => {
      for (const id of ids) dirty.current.add(id);
      if (dirty.current.size === 0) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  // Zamknięcie kreatora nie może zjeść ostatniego przeciągnięcia.
  useEffect(() => () => flush(), [flush]);

  const mutate = useCallback<CanvasEditor["mutate"]>(
    (sectionId, update) => {
      const current = historyRef.current;
      const canvas = current.present[sectionId];
      if (!canvas) return;
      const nextCanvas = update(canvas);
      if (nextCanvas === canvas) return;
      historyRef.current = commitHistory(current, { ...current.present, [sectionId]: nextCanvas });
      setHistory(historyRef.current);
      schedule([sectionId]);
    },
    [schedule],
  );

  const step = useCallback(
    (move: (state: HistoryState<CanvasDrafts>) => HistoryState<CanvasDrafts>) => {
      const current = historyRef.current;
      const next = move(current);
      if (next === current) return;
      historyRef.current = next;
      setHistory(next);
      // Zapisujemy TYLKO sekcje, które cofnięcie naprawdę ruszyło.
      schedule(changedKeys(current.present, next.present));
    },
    [schedule],
  );

  return {
    canvasOf: useCallback((sectionId: string) => history.present[sectionId], [history.present]),
    mutate,
    undo: useCallback(() => step(undoHistory), [step]),
    redo: useCallback(() => step(redoHistory), [step]),
    canUndo: canUndoOf(history),
    canRedo: canRedoOf(history),
    flush,
  };
}

// -----------------------------------------------------------------------
// Operacje na płótnie — czyste przekształcenia dla `mutate`
// -----------------------------------------------------------------------

/** Podmiana jednego elementu (geometria, treść) z zachowaniem kolejności. */
export function replaceElement(
  canvas: SectionCanvas,
  elementId: string,
  update: (element: CanvasElement) => CanvasElement,
): SectionCanvas {
  let touched = false;
  const elements = canvas.elements.map((element) => {
    if (element.id !== elementId) return element;
    const next = update(element);
    if (next !== element) touched = true;
    return next;
  });
  return touched ? { ...canvas, elements } : canvas;
}

/** Kopia elementu odsunięta o dwie jednostki — inaczej leżałaby dokładnie pod oryginałem. */
export function duplicateElement(canvas: SectionCanvas, elementId: string): SectionCanvas {
  const source = canvas.elements.find((element) => element.id === elementId);
  if (!source) return canvas;
  const box = source.layout.desktop;
  const copy = {
    ...source,
    id: newElementId(),
    layout: {
      ...source.layout,
      desktop: {
        ...box,
        x: Math.min(box.x + 2, CANVAS_COLUMNS - box.w),
        y: Math.min(box.y + 2, Math.max(0, canvas.rows - box.h)),
      },
    },
  } as CanvasElement;
  return { ...canvas, elements: [...canvas.elements, copy] };
}

export function removeElement(canvas: SectionCanvas, elementId: string): SectionCanvas {
  const elements = canvas.elements.filter((element) => element.id !== elementId);
  return elements.length === canvas.elements.length ? canvas : { ...canvas, elements };
}
