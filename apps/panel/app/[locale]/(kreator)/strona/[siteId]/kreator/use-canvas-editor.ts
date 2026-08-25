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
 *
 * ================== KOLEJKA PRZEŻYWA PORAŻKĘ (K3, ADR-169) ==================
 *
 * `flush()` czyścił `dirty` PRZED wysyłką i nie dopisywał sekcji z powrotem,
 * gdy zapis padł. Sekcja wypadała z kolejki NA ZAWSZE: następny autozapis jej
 * nie ponawiał, wyjście z kreatora widziało pusty zbiór, a wskaźnik przy
 * najbliższej udanej akcji obok meldował „Zapisano". Operator dostawał
 * potwierdzenie zapisu pracy, której w bazie nie ma.
 *
 * Odtąd `persist` ODPOWIADA, czy zapis wszedł, a porażka (`ok: false` tak samo
 * jak odrzucona obietnica) wraca do kolejki i zapala licznik `unsaved`.
 * Ponowienia NIE napędzamy własnym zegarem: odmowa merytoryczna — sufit
 * elementów, geometria poza płótnem, odrzucony adres — powtarzałaby się co
 * 700 ms w nieskończoność, waląc w serwer i niczego nie naprawiając. Ponawia
 * NASTĘPNY autozapis (kolejna zmiana operatora), jawne „Zapisz ponownie"
 * i `flush()` przy wyjściu z trasy.
 *
 * ============== `flush()` ODPOWIADA, CZY WOLNO WYJŚĆ (ADR-174) ==============
 *
 * ADR-169 zostawił jedną ścieżkę bez odpowiedzi: `flush()` nie zwracał NICZEGO,
 * więc wyjście „← Panel" odpalało zapis i nawigowało w tej samej instrukcji.
 * Kreator odmontowywał się, zanim `settle(id, false)` zdążył zapalić licznik —
 * a komunikat, który ADR-169 wyprowadził aż na `body`, nie miał się gdzie
 * pokazać, bo nie było już komponentu, który go rysuje. Operator wychodził
 * z przekonaniem, że zapisał, i widział brak przy następnym wejściu.
 *
 * `flush()` ma odtąd typ `Promise<boolean>`: `true` znaczy „kolejka pusta,
 * WSZYSTKO weszło do bazy". Odpowiedzią jest rozmiar zbioru `failed`, czyli
 * dokładnie ta sama wartość, którą wskaźnik pokazuje na pasku — dwa źródła
 * prawdy o zapisie byłyby powtórzeniem tej samej wady piętro wyżej.
 * Wołający, którym wynik jest niepotrzebny (zegar autozapisu, sprzątanie po
 * odmontowaniu), ignorują go jak dotąd.
 */
import {
  CANVAS_COLUMNS,
  SECTION_MAX_ROWS,
  isSectionCanvas,
  isStructuredSection,
  sectionCanvasFrom,
  type CanvasElement,
  type Geometry,
  type SectionCanvas,
  type SectionContent,
  type StructuredSectionContent,
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

/**
 * SZKIC SEKCJI — PŁÓTNO v2 ALBO SEKCJA STRUKTURALNA v3 (E1, ADR-094).
 *
 * Do E1 szkicem było wyłącznie płótno, więc każda treść, która nim nie była,
 * przechodziła przez konwersję. Sekcja strukturalna MUSI być z tej konwersji
 * wyjęta — spłaszczenie jej do pudełek jest dokładnie tą wadą, którą ADR-094
 * likwiduje (pary FAQ zamieniały się w luźne nagłówki i akapity).
 *
 * Poza tym rozróżnieniem obie generacje jadą JEDNYM kanałem: ta sama historia
 * cofania, ten sam autozapis, ten sam wskaźnik „Zapisywanie…/Zapisano”.
 */
export type SectionDraft = SectionCanvas | StructuredSectionContent;
export type CanvasDrafts = Record<string, SectionDraft>;

/**
 * Szkic sekcji. Treść v3 zostaje sobą; treść v1 jest KONWERTOWANA do płótna
 * w locie — ta sama funkcja, którą galeria tworzy nową sekcję (patrz
 * `canvas-presets`), więc sekcja sprzed K2 daje się edytować od razu, bez
 * migracji danych. Zapis utrwala wynik konwersji dopiero, gdy operator czegoś
 * dotknie.
 */
function draftOfSection(section: EditorSection): SectionDraft {
  if (isStructuredSection(section.content)) return section.content;
  return isSectionCanvas(section.content)
    ? section.content
    : sectionCanvasFrom(section.type, section.content);
}

function draftsOf(sections: EditorSection[]): CanvasDrafts {
  return Object.fromEntries(sections.map((section) => [section.id, draftOfSection(section)]));
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
    next[section.id] = existing ?? draftOfSection(section);
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
  /**
   * Szkic sekcji w DOWOLNEJ generacji — tego pyta płótno, żeby narysować to,
   * co operator ma przed oczami, a nie to, co przyszło z serwera.
   */
  contentOf: (sectionId: string) => SectionDraft | undefined;
  /**
   * Szkic sekcji WYŁĄCZNIE jako płótno. Sekcja strukturalna daje `undefined`
   * i to jest właściwa odpowiedź: nie ma w niej elementów, uchwytów ani
   * geometrii, więc wołający (warstwa edycyjna płótna) ma ją pominąć.
   */
  canvasOf: (sectionId: string) => SectionCanvas | undefined;
  /** Szkic sekcji WYŁĄCZNIE jako treść strukturalna (mini-CMS w szufladzie). */
  structuredOf: (sectionId: string) => StructuredSectionContent | undefined;
  /**
   * Zmiana szkicu sekcji: JEDEN wpis w historii i JEDEN zaplanowany zapis.
   * Podgląd ruchu (przeciąganie w toku) NIE idzie tędy — siedzi w stanie
   * płótna i dokłada się dopiero przy rysowaniu, żeby „cofnij" cofało ruch,
   * a nie piksel.
   */
  mutate: (sectionId: string, update: (canvas: SectionCanvas) => SectionCanvas) => void;
  /** Ten sam kanał dla treści strukturalnej — historia i autozapis bez zmian. */
  mutateStructured: (
    sectionId: string,
    update: (content: StructuredSectionContent) => StructuredSectionContent,
  ) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * ILE SEKCJI NIE WESZŁO DO BAZY (K3, ADR-169) — sekcje, których ostatni
   * zapis został ODRZUCONY i które czekają na ponowienie. Zero znaczy „wszystko,
   * co operator zrobił, serwer potwierdził"; wszystko powyżej zera jest
   * warunkiem, pod którym wskaźnik NIE MA PRAWA powiedzieć „Zapisano".
   */
  unsaved: number;
  /**
   * Natychmiastowy zapis wszystkiego, co czeka (wyjście z kreatora, publikacja).
   *
   * ODPOWIADA, CZY WOLNO WYJŚĆ (ADR-174): `true` znaczy „kolejka pusta, komplet
   * w bazie". `false` znaczy, że co najmniej jedna sekcja została odrzucona —
   * wołający, który nawiguje, MUSI na tę odpowiedź poczekać, inaczej odmontuje
   * kreator razem z jedynym miejscem, w którym ta odmowa może się pokazać.
   */
  flush: () => Promise<boolean>;
}

export function useCanvasEditor({
  sections,
  persist,
}: {
  sections: EditorSection[];
  /**
   * Zapis sekcji, który MUSI ODPOWIEDZIEĆ, czy wszedł (K3, ADR-169). Zapis
   * bez odpowiedzi nie daje się odróżnić od zapisu udanego — a to jest cała
   * ta wada: kolejka nie wiedziała, że ma czego pilnować.
   */
  persist: (section: EditorSection, content: SectionContent) => Promise<boolean>;
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
  /**
   * Sekcje, których zapis SERWER ODRZUCIŁ — podzbiór tego, co czeka w kolejce.
   * Osobny zbiór, a nie sam rozmiar `dirty`, bo `dirty` jest niepuste także
   * przez zwykłe 700 ms zwłoki po każdym ruchu myszą: gdyby wskaźnik czytał
   * jego rozmiar, migałby „nie zapisano" przy każdym poprawnym geście i uczył
   * operatora ignorować dokładnie ten stan, który ma go ostrzec.
   */
  const failed = useRef(new Set<string>());
  const [unsaved, setUnsaved] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Rozstrzygnięcie POJEDYNCZEGO zapisu. Porażka wraca do kolejki — to jest
   * ta jedna linia, której brak kasował pracę operatora.
   */
  const settle = useCallback((id: string, ok: boolean) => {
    if (ok) {
      failed.current.delete(id);
    } else {
      dirty.current.add(id);
      failed.current.add(id);
    }
    setUnsaved(failed.current.size);
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const ids = [...dirty.current];
    dirty.current.clear();
    /*
     * Zapisy idą RÓWNOLEGLE, jak przed ADR-174 — sekcje są od siebie niezależne,
     * a szeregowanie ich tylko po to, żeby doczekać odpowiedzi, przedłużałoby
     * wyjście o sumę czasów zamiast o najdłuższy z nich. Czekamy natomiast na
     * KOMPLET: bez tego `flush()` odpowiadałby, zanim serwer cokolwiek powie.
     */
    await Promise.all(
      ids.map(async (id) => {
        const section = sectionsRef.current.get(id);
        const content = historyRef.current.present[id];
        if (!section || !content) {
          // Sekcji już nie ma (usunięta, przeładowana z serwera) — nie ma czego
          // zapisywać ani czego ponawiać. Zostawienie jej w liczniku trzymałoby
          // wskaźnik na „nie zapisano" po sekcji, której operator sam się pozbył.
          if (failed.current.delete(id)) setUnsaved(failed.current.size);
          return;
        }
        try {
          settle(id, await persistRef.current(section, content));
        } catch {
          settle(id, false);
        }
      }),
    );
    /*
     * Odpowiedź czyta zbiór `failed`, a nie wyniki TEJ tury: sekcja odrzucona
     * wcześniej i nieruszona teraz dalej nie jest w bazie, a wyjście z kreatora
     * pyta o stan CAŁEJ pracy, nie o ostatnią wysyłkę. To ta sama wartość,
     * którą pokazuje wskaźnik — jedno źródło prawdy o zapisie.
     */
    return failed.current.size === 0;
  }, [settle]);

  const schedule = useCallback(
    (ids: string[]) => {
      for (const id of ids) dirty.current.add(id);
      if (dirty.current.size === 0) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  // Zamknięcie kreatora nie może zjeść ostatniego przeciągnięcia. Odpowiedź jest
  // tu bez adresata — komponentu, który mógłby pokazać odmowę, już nie ma.
  useEffect(() => () => void flush(), [flush]);

  /**
   * Rdzeń obu mutacji: jeden wpis w historii i jeden zaplanowany zapis. Funkcja
   * `update` dostaje szkic dopiero po sprawdzeniu GENERACJI (`guard`) — bez
   * tego przekształcenie płótna dostałoby treść strukturalną i odwrotnie,
   * a wynik zapisałby się do bazy.
   */
  const mutateDraft = useCallback(
    (
      sectionId: string,
      guard: (draft: SectionDraft) => boolean,
      update: (draft: never) => SectionDraft,
    ) => {
      const current = historyRef.current;
      const draft = current.present[sectionId];
      if (!draft || !guard(draft)) return;
      const next = (update as (draft: SectionDraft) => SectionDraft)(draft);
      if (next === draft) return;
      historyRef.current = commitHistory(current, { ...current.present, [sectionId]: next });
      setHistory(historyRef.current);
      schedule([sectionId]);
    },
    [schedule],
  );

  const mutate = useCallback<CanvasEditor["mutate"]>(
    (sectionId, update) => mutateDraft(sectionId, isSectionCanvas, update as (d: never) => SectionDraft),
    [mutateDraft],
  );

  const mutateStructured = useCallback<CanvasEditor["mutateStructured"]>(
    (sectionId, update) =>
      mutateDraft(sectionId, isStructuredSection, update as (d: never) => SectionDraft),
    [mutateDraft],
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
    contentOf: useCallback((sectionId: string) => history.present[sectionId], [history.present]),
    canvasOf: useCallback(
      (sectionId: string) => {
        const draft = history.present[sectionId];
        return draft && isSectionCanvas(draft) ? draft : undefined;
      },
      [history.present],
    ),
    structuredOf: useCallback(
      (sectionId: string) => {
        const draft = history.present[sectionId];
        return draft && isStructuredSection(draft) ? draft : undefined;
      },
      [history.present],
    ),
    mutate,
    mutateStructured,
    undo: useCallback(() => step(undoHistory), [step]),
    redo: useCallback(() => step(redoHistory), [step]),
    canUndo: canUndoOf(history),
    canRedo: canRedoOf(history),
    unsaved,
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

/**
 * Odstęp między dotychczasową treścią sekcji a elementem dokładanym KLIKNIĘCIEM
 * (jednostki siatki). Ta sama liczba, którą do tej pory stosował `freeSpotFor`
 * z rdzenia — zmienia się nie odstęp, tylko to, co robi płótno, gdy odstęp
 * przestaje się mieścić.
 */
export const APPEND_GAP_ROWS = 2;

/**
 * MIEJSCE NA ELEMENT DOKŁADANY KLIKNIĘCIEM — POD TREŚCIĄ, A SEKCJA ROŚNIE
 * (K-11, audyt UX 2026-08-25).
 *
 * Rdzeniowy `freeSpotFor` liczył `y = min(najniższy + 2, rows - h)`, czyli
 * PRZYCINAŁ pozycję do wysokości sekcji. Dopóki sekcja miała zapas, wynik był
 * poprawny; gdy zapasu zabrakło — a to jest stan każdej gotowej sekcji
 * szablonu, bo jej wysokość jest dobrana do treści — nowy element lądował NA
 * istniejącej treści. Operator dostawał nagłówek dokładnie na zdjęciu hero i
 * musiał go najpierw znaleźć, potem odsunąć.
 *
 * Odtąd sekcja USTĘPUJE: pozycja jest zawsze pod najniższym elementem, a
 * wysokość płótna rośnie do `y + h`, jeśli trzeba. To zachowawcza poprawka
 * geometrii, nie przebudowa silnika układu — element dalej jest pudełkiem
 * o współrzędnych absolutnych i dalej można go przesunąć gestem.
 *
 * SUFIT `SECTION_MAX_ROWS` (schemat 2.3a) zostaje ostatnim słowem: sekcja
 * napełniona pod korek nie urośnie i wtedy — dopiero wtedy — element wraca do
 * przycięcia. To NIE jest cicha porażka: taka sekcja jest pełna także dla
 * zapisu, a zapis odrzucający geometrię spoza płótna zostawiłby operatora
 * z komunikatem zamiast z elementem.
 */
export function appendSpotBelow(
  size: { w: number; h: number },
  canvas: { rows: number; elements: readonly CanvasElement[] },
): { geometry: Geometry; rows: number } {
  const bottom = canvas.elements.reduce(
    (lowest, element) => Math.max(lowest, element.layout.desktop.y + element.layout.desktop.h),
    0,
  );
  const x = Math.max(0, Math.min(12, CANVAS_COLUMNS - size.w));
  const wanted = bottom + APPEND_GAP_ROWS;
  // Sufit dotyczy DOLNEJ krawędzi, nie samego `y`: element wysoki na 10
  // jednostek postawiony na 235 wystawałby poza płótno, którego nie da się już
  // powiększyć.
  const y = Math.max(0, Math.min(wanted, SECTION_MAX_ROWS - size.h));
  const rows = Math.min(SECTION_MAX_ROWS, Math.max(canvas.rows, y + size.h));
  return {
    geometry: { x, y, w: size.w, h: size.h, z: canvas.elements.length },
    rows,
  };
}
