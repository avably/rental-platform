"use client";

/**
 * PŁÓTNO KREATORA (K1, ADR-083; elementy — K2, ADR-084) — szkic strony
 * renderowany TYM SAMYM `SiteRenderer` co sklep, z warstwą edycyjną wniesioną
 * przez `sectionWrapper` (sekcje) i `elementWrapper` (elementy).
 *
 * To jest cała idea architektury: renderer zostaje JEDEN. Płótno nie jest
 * „podobne do strony" — jest stroną, tylko obłożoną obrysem, pływającym paskiem
 * narzędzi, miejscami na „+" oraz ramkami elementów z uchwytami rozmiaru. Fork
 * renderera dałby dwa źródła prawdy o wyglądzie sekcji; warstwa edycyjna wchodzi
 * więc SZWEM, a nie kopią (kontrakt: apps/storefront nie podaje żadnej owijki,
 * więc do publicznego renderu nie ma czym wnieść ani jednego jej elementu).
 *
 * PŁÓTNO POKAZUJE RÓWNIEŻ SEKCJE WYŁĄCZONE — jawnie oznaczone chipem osi
 * `site-section`. To nie jest podgląd, tylko edytor: sekcja wyłączona musi dać
 * się znaleźć, włączyć i poprawić. Gwarancji „klient tego nie zobaczy" nie
 * niesie tu żaden filtr UI, tylko `app.get_published_site` (0019).
 *
 * ================== CO ZMIENIŁ K5a (ADR-091) ==================
 *
 * SEKCJA USUNIĘTA ZOSTAJE NA PŁÓTNIE. Usunięcie sekcji opublikowanej jest od
 * 0045 operacją SZKICU (`deleted_in_draft`), a nie kasowaniem wiersza: na
 * stronie klienta sekcja stoi do najbliższej publikacji, więc kreator ma
 * pokazywać ją tak, jak jest — z chipem „usunięta w szkicu" i akcją
 * „przywróć" stojącą przy chipie, a nie schowaną w pasku pod kursorem.
 * Warstwa edycyjna jest jej odbierana (nie ma po co poprawiać treści, która
 * zaraz zniknie), pasek narzędzi też — zostaje przywrócenie i nic poza nim.
 *
 * ================== DWA POZIOMY PRZECIĄGANIA ==================
 *
 * KOLEJNOŚĆ SEKCJI zmienia się dwoma drogami wołającymi TĘ SAMĄ akcję z pełnym
 * kompletem pozycji: uchwytem (dnd-kit) i strzałkami w pasku narzędzi. To jest
 * problem „przeciągnij coś na coś" i biblioteka modeluje go wprost.
 *
 * GEOMETRIA ELEMENTÓW od K2c (ADR-087) NIE przechodzi tędy w ogóle. Element nie
 * ma celu upuszczenia, ma współrzędne — jego gest prowadzi własny silnik na
 * przechwyconym wskaźniku (canvas-gesture.ts), który w trakcie ruchu pisze po
 * stylach, a nie po stanie Reacta. Płótno dowiaduje się o wyniku RAZ, przy
 * puszczeniu: jeden wpis w historii i jeden zapis na cały gest. Wcześniej każdy
 * piksel ruchu szedł przez `setState` i przerysowywał całą stronę — i to było
 * widać jako szarpanie.
 *
 * ================== HIERARCHIA ZAZNACZENIA (E2) ==================
 *
 * Pinezka właściciela 39a4327a: kliknięcie elementu pokazywało JEDEN pasek
 * z akcjami sekcji I elementu naraz, więc „usuń" znaczyło dwie różne rzeczy
 * w odległości dwóch ikon. Model jest odtąd dwupoziomowy, jak w dojrzałych
 * kreatorach:
 *
 *   • NAJECHANIE maluje obrys i nic poza tym — najechanie nie jest wyborem;
 *   • KLIK W TŁO SEKCJI zaznacza SEKCJĘ → pasek niesie akcje sekcji;
 *   • KLIK W ELEMENT zaznacza ELEMENT → pasek niesie WYŁĄCZNIE akcje elementu,
 *     a sekcja-kontekst trzyma dyskretny, STAŁY obrys (nic nie jest przygaszane
 *     — reszta strony pozostaje czytelna, bo operator ustawia element WZGLĘDEM
 *     niej);
 *   • PASEK ŚCIEŻKI („Sekcja › Element") mówi, gdzie się stoi, i jest DROGĄ
 *     w górę: klik w człon sekcji zaznacza sekcję. Ta sama droga bez myszy to
 *     Escape (obsługiwany w skorupie — patrz `site-builder.tsx`).
 */
import {
  bringToFront,
  geometryAt,
  isBoundAttribute,
  isDetachedOnMobile,
  isPinnedLastType,
  mobileLayoutOf,
  plainTextOf,
  sendToBack,
  sizeOf,
  structuredItemsMatter,
  withGeometry,
  withSize,
  withoutMobileGeometry,
  type CanvasBreakpoint,
  type Geometry,
  type MobileLayout,
  type SectionCanvas,
  type SectionType,
  type TextRun,
  type ResolvedSiteStyle,
} from "@avably/core/site";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  SiteRenderer,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  canvasBoxVariables,
  structuredEntryCount,
  type RenderSection,
  type SiteMoney,
  type StorefrontProduct,
} from "@avably/ui";
import {
  ArrowDown,
  ArrowUp,
  BringToFront,
  ChevronRight,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  GripVertical,
  Plus,
  RotateCcw,
  SendToBack,
  Settings2,
  Trash2,
  Wand2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";

import type { EditorSection } from "@/app/[locale]/(panel)/strona/content";
import { SecondaryStatusChip } from "@/lib/secondary-status";
import { siteImagePublicBase } from "@/lib/site-image-base";

import { ElementFrame, type FixedAxes } from "./canvas-elements";
import { InlineTextEditor } from "./inline-editor";
import { runsEqual } from "./inline-text";
import type { InsertTarget } from "./section-picker";
import type { StructuredFormTab } from "./structured-section-form";
import {
  duplicateElement,
  removeElement,
  replaceElement,
  type CanvasEditor,
} from "./use-canvas-editor";

type ActionResult = { ok: true } | { ok: false; error: string };

/** Szerokość CSS telefonu — SYMULOWANY VIEWPORT płótna, nie szerokość ekranu. */
const MOBILE_CANVAS_WIDTH = 390;

/**
 * NAJWĘŻSZE płótno w widoku „komputer" — 40 rem, czyli dokładnie próg, poniżej
 * którego renderer przechodzi na geometrię mobilną (K4, ADR-088).
 *
 * Bez tej podłogi wąskie okno operatora (albo rozwinięta paleta na laptopie)
 * zwężałoby płótno pod próg i kreator CICHO pokazywałby układ telefonu, mimo
 * że przełącznik stoi na „komputer" — a gest zapisywałby wtedy do slotu
 * desktopowego to, co widać w mobilnym. Scena przewija się w poziomie zamiast
 * ściskać płótno.
 */
const DESKTOP_CANVAS_MIN_WIDTH = "40rem";

export type BuilderViewport = "desktop" | "mobile";

/** Zaznaczony element — para (sekcja, element): id elementu jest lokalne dla sekcji. */
export interface ElementSelection {
  sectionId: string;
  elementId: string;
}

/**
 * ZAZNACZENIE W HIERARCHII (E2). Jeden stan na oba poziomy, bo poziomy nie są
 * niezależne: element ZAWSZE stoi w sekcji, a dwa osobne stany pozwoliłyby na
 * zaznaczenie elementu w jednej sekcji i sekcji obok naraz — czyli na pytanie
 * „co usunie kosz", na które nie ma dobrej odpowiedzi.
 */
export interface BuilderSelection {
  sectionId: string;
  /** Brak = poziom SEKCJI. Obecne = poziom ELEMENTU w tej sekcji. */
  elementId?: string;
}

/** Poziom zaznaczenia WIDZIANY PRZEZ SEKCJĘ: nie ta sekcja / ona / jej element. */
type SelectionLevel = "none" | "section" | "element";

/**
 * BREAKPOINT, KTÓRY OPERATOR EDYTUJE (K4, ADR-088) — wprost z przełącznika
 * szerokości płótna. Płótno w trybie „komputer" ma zagwarantowaną szerokość
 * co najmniej 40 rem (patrz `site-builder.tsx`), więc to, co widać, i to, co
 * się zapisuje, dotyczy TEGO SAMEGO układu; renderer wybiera go z szerokości
 * kontenera, a nie z tej flagi.
 */
function breakpointOf(viewport: BuilderViewport): CanvasBreakpoint {
  return viewport === "mobile" ? "mobile" : "desktop";
}

export function BuilderCanvas({
  style,
  sections,
  products,
  money,
  viewport,
  busy,
  dropSectionId,
  flashId,
  run,
  reorderAction,
  toggleAction,
  duplicateAction,
  deleteAction,
  restoreAction,
  onInsert,
  onOpenSettings,
  onChanged,
  editor,
  selection,
  onSelect,
  onPickImage,
}: {
  /** Styl szkicu — płótno renderuje TYM SAMYM kodem, co sklep (ADR-090). */
  style: ResolvedSiteStyle;
  sections: EditorSection[];
  products: StorefrontProduct[];
  /** Waluta i zapis kwot najemcy (E6) — płótno rysuje cennik tak, jak sklep. */
  money: SiteMoney;
  viewport: BuilderViewport;
  /** Trwa mutacja — uchwyty i pasek narzędzi szarzeją razem (R2, #135). */
  busy: boolean;
  /**
   * Sekcja, która przyjmie przeciągany właśnie ELEMENT (K6, ADR-092), albo
   * `null`. Do K6 upuszczenie elementu było „w ciemno" — operator widział cel
   * dopiero po fakcie.
   */
  dropSectionId: string | null;
  /**
   * Sekcja ŚWIEŻO WSTAWIONA (E2) — miga przez chwilę i gaśnie. Bez tego
   * kliknięcie „+" na długiej stronie kończy się pytaniem „weszła czy nie",
   * a odpowiedzi trzeba szukać wzrokiem po całym płótnie.
   */
  flashId: string | null;
  /**
   * Uruchomienie mutacji W TRANZYCJI SKORUPY: jeden wskaźnik stanu zapisu na
   * całą trasę, jeden komunikat błędu. `onFail` cofa zmianę optymistyczną.
   */
  run: (action: () => Promise<ActionResult>, onFail?: () => void) => void;
  reorderAction: (orderedIds: string[]) => Promise<ActionResult>;
  toggleAction: (section: EditorSection) => Promise<ActionResult>;
  duplicateAction: (sectionId: string) => Promise<ActionResult>;
  deleteAction: (sectionId: string) => Promise<ActionResult>;
  /** Cofnięcie usunięcia sekcji przed publikacją (K5a, ADR-091). */
  restoreAction: (sectionId: string) => Promise<ActionResult>;
  /** Otwarcie pickera na WSKAZANYM miejscu — „+" nie zna typów sekcji (E2). */
  onInsert: (target: InsertTarget) => void;
  /**
   * Otwarcie szuflady sekcji. Od E8 wołający MOŻE wskazać zakładkę mini-CMS-u:
   * przycisk pustego stanu obiecuje „dodaj pierwszy wpis", więc musi wylądować
   * na liście wpisów, a nie tam, gdzie operator był ostatnio.
   */
  onOpenSettings: (sectionId: string, tab?: StructuredFormTab) => void;
  onChanged: () => void;
  /** Szkice płótna, historia i autozapis — jedna prawda o stanie edycji (K2). */
  editor: CanvasEditor;
  selection: BuilderSelection | null;
  onSelect: (selection: BuilderSelection | null) => void;
  /** Otwarcie pickera zdjęcia (K3) — właścicielem okna jest skorupa, bo zna `siteId`. */
  onPickImage: (target: ElementSelection) => void;
}) {
  const t = useTranslations("site");
  // Optymistyczna kolejność z resyncem z propsów W RENDERZE (bez kaskady
  // efektów) — ten sam wzorzec, co lista sekcji z A1.
  const [order, setOrder] = useState<EditorSection[]>(sections);
  const [syncedFrom, setSyncedFrom] = useState(sections);
  if (syncedFrom !== sections) {
    setSyncedFrom(sections);
    setOrder(sections);
  }

  /*
   * Sekcja POD KURSOREM. Od E2 najechanie maluje WYŁĄCZNIE obrys — narzędzia
   * wychodzą z ZAZNACZENIA, nie z hoveru. Stan Reacta, a nie samo `:hover`,
   * bo obrys ma wychodzić także od klawiatury (fokus wewnątrz sekcji), a przy
   * gescie elementu musi umieć zamilknąć (patrz `dragging`).
   */
  const [hoverId, setHoverId] = useState<string | null>(null);
  /**
   * Element w EDYCJI TREŚCI (K3). Osobno od zaznaczenia, bo to dwa różne stany:
   * zaznaczony element da się przesuwać i zmieniać mu rozmiar, edytowany —
   * przyjmuje pisanie i NIE może jednocześnie jechać za kursorem. Gest K2c
   * (ADR-087) nie startuje na elemencie w edycji, a `data-dragging` nie
   * podnosi się w tym czasie ani razu — dzięki temu `user-select: none`
   * z arkusza nie odbiera `contenteditable` możliwości zaznaczania.
   */
  const [editing, setEditing] = useState<ElementSelection | null>(null);

  /*
   * Trwa gest elementu. Flaga jest REFERENCJĄ, a nie stanem: jej jedyne zadanie
   * to POWSTRZYMAĆ przerysowanie płótna w trakcie ruchu. Najechanie kursorem na
   * kolejną sekcję ustawiałoby `activeId`, a każdy taki `setState` to render
   * całej strony w środku przeciągania — czyli dokładnie to szarpanie, które
   * K2c usuwa. Warstwę wizualną paska narzędzi wycisza CSS po `data-dragging`.
   */
  const dragging = useRef(false);

  const locked = busy;
  const breakpoint = breakpointOf(viewport);

  /**
   * Układ mobilny per sekcja — liczony TĄ SAMĄ czystą funkcją, co w rendererze
   * (ADR-088). Płótno potrzebuje go osobno, bo ramki zaznaczenia i gest muszą
   * wiedzieć, gdzie element leży NA TELEFONIE; wynik jest z definicji ten sam,
   * bo wejściem jest ta sama treść.
   */
  const mobileOf = (canvas: SectionCanvas): MobileLayout => mobileLayoutOf(canvas);

  /** Wysokość płótna dla AKTYWNEGO breakpointu (geometrię elementu daje `geometryAt`). */
  const activeRows = (canvas: SectionCanvas, mobile: MobileLayout): number =>
    breakpoint === "mobile" ? mobile.rows : canvas.rows;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function commitOrder(next: EditorSection[], previous: EditorSection[]) {
    setOrder(next);
    run(
      () => reorderAction(next.map((s) => s.id)),
      () => setOrder(previous),
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    const from = order.findIndex((s) => s.id === dragged.id);
    const to = order.findIndex((s) => s.id === over.id);
    if (from === -1 || to === -1) return;
    commitOrder(arrayMove(order, from, to), order);
  }

  /**
   * Zatwierdzenie treści po edycji w miejscu. Pusty wynik ZOSTAWIA poprzedni
   * tekst: element bez treści nie przeszedłby schematu i zniknąłby z płótna
   * bez śladu, więc skasowanie wszystkiego traktujemy jak rezygnację.
   */
  function commitRuns(sectionId: string, elementId: string, runs: TextRun[]) {
    if (runs.length === 0) return;
    editor.mutate(sectionId, (canvas) =>
      replaceElement(canvas, elementId, (element) => {
        if (element.kind !== "heading" && element.kind !== "text") return element;
        if (runsEqual(element.runs, runs)) return element;
        // `text` i `runs` jadą RAZEM — schemat płótna wymaga, żeby spłaszczenie
        // runów równało się tekstowi (ADR-086).
        const text = plainTextOf(runs);
        const single = runs.length === 1 && !runs[0]!.bold && !runs[0]!.italic && !runs[0]!.href;
        return single ? { ...element, text, runs: undefined } : { ...element, text, runs };
      }),
    );
  }

  /**
   * Koniec ruchu: JEDEN wpis w historii i JEDEN zapis na całe przeciągnięcie.
   *
   * ================== DWA SLOTY, JEDEN GEST (K4, ADR-088) ==================
   *
   * Ten sam silnik zapisuje do INNEGO slotu geometrii zależnie od breakpointu.
   * Na telefonie powstaje RĘCZNA POPRAWKA (`layout.mobile`) i nic poza nią się
   * nie rusza — desktop zostaje bajtowo taki, jaki był. To nie jest ostrożność,
   * tylko definicja: układ mobilny jest WYPROWADZONY z desktopu, więc poprawka
   * ruszająca źródło poprawiałaby jednocześnie samą siebie i cały desktop.
   *
   * Poprawka mobilna ma z definicji wymiar JAWNY — operator narysował pudełko
   * i ma ono zostać takie, jak je narysował. Tryb `hug` opisuje projekt
   * desktopowy i zostaje nietknięty; „wróć do auto" oddaje jedno i drugie.
   */
  function commitGeometry(
    sectionId: string,
    elementId: string,
    geometry: Geometry,
    fixed?: FixedAxes,
  ) {
    editor.mutate(sectionId, (canvas) =>
      replaceElement(canvas, elementId, (element) => {
        const moved = withGeometry(element, breakpoint, geometry);
        if (breakpoint === "mobile" || !fixed) return moved;
        // Pociągnięcie za uchwyt JEST decyzją „ma być tyle" — i dotyczy
        // wyłącznie osi, których uchwyt naprawdę dotknął.
        const size = sizeOf(element);
        const next = {
          w: fixed.w ? ("fixed" as const) : size.w,
          h: fixed.h ? ("fixed" as const) : size.h,
        };
        return next.w === size.w && next.h === size.h ? moved : withSize(moved, next);
      }),
    );
  }

  /** Zdjęcie ręcznej poprawki mobilnej — element wraca pod auto-układ. */
  function resetMobile(sectionId: string, elementId: string) {
    editor.mutate(sectionId, (canvas) => replaceElement(canvas, elementId, withoutMobileGeometry));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    commitOrder(arrayMove(order, index, target), order);
  }

  const orderedIds = order.map((s) => s.id);

  /**
   * Sekcje do renderu: treść bierzemy ze SZKICU (plus podgląd ruchu), nie
   * z propsów. Od E1 (ADR-094) szkicem bywa też treść STRUKTURALNA — pytamy
   * więc o treść w dowolnej generacji, a nie wyłącznie o płótno. Zapytanie
   * `canvasOf` zwracałoby dla sekcji strukturalnej `undefined`, przez co
   * płótno rysowałoby wersję sprzed ostatniej edycji w szufladzie.
   */
  const rendered = order.map((section) => {
    const content = editor.contentOf(section.id);
    return content ? { ...section, content } : section;
  });

  return (
    <div
      data-builder-canvas
      data-viewport={viewport}
      className="mx-auto flex w-full flex-col"
      style={
        viewport === "mobile"
          ? { maxWidth: MOBILE_CANVAS_WIDTH }
          : { minWidth: DESKTOP_CANVAS_MIN_WIDTH }
      }
    >
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        {order.length === 0 ? (
          <div data-builder-canvas-empty className="flex flex-col items-center gap-3 p-12 text-center">
            <p className="text-sm font-medium">{t("builder.emptyTitle")}</p>
            <p className="text-muted-foreground text-[13px] leading-[18px]">
              {t("builder.emptyBody")}
            </p>
            {/* Pusta strona ma dokładnie jedno miejsce — koniec, czyli brak
                kotwicy. To ta sama droga, co „+" i kafel palety. */}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-insert-at="0"
              loading={locked}
              disabled={locked}
              onClick={() => onInsert({})}
            >
              {t("sections.add")}
            </Button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
              <SiteRenderer
                sections={rendered as unknown as RenderSection[]}
                style={style}
                /*
                 * PŁÓTNO STOI (K6, ADR-092). Sekcja, która przenika przy
                 * każdym przewinięciu palety, nie jest podglądem strony —
                 * jest migotaniem, przez które nie da się nic ustawić.
                 * Animacje ogląda się w PODGLĄDZIE szkicu i na sklepie.
                 */
                motion="off"
                products={products}
                money={money}
                siteImageBase={siteImagePublicBase()}
                sectionWrapper={(section, children) => {
                  const index = order.findIndex((s) => s.id === section.id);
                  const editorSection = order[index];
                  if (!editorSection) return children;
                  const canvas = editor.canvasOf(editorSection.id);
                  const structuredContent = editor.structuredOf(editorSection.id);
                  const selected =
                    selection && selection.sectionId === editorSection.id && selection.elementId
                      ? canvas?.elements.find((element) => element.id === selection.elementId)
                      : undefined;
                  const level: SelectionLevel =
                    selection?.sectionId !== editorSection.id
                      ? "none"
                      : selection.elementId
                        ? "element"
                        : "section";
                  return (
                    <CanvasSection
                      section={editorSection}
                      /*
                        SEKCJA STRUKTURALNA (E1, ADR-094) nie ma elementów do
                        zaznaczania — jej jedyną drogą edycji jest szuflada,
                        więc klik w CAŁĄ sekcję ma ją otwierać.
                      */
                      structured={Boolean(structuredContent)}
                      /*
                        PUSTY STAN (E8) — liczy się to, co sekcja ODDA DO
                        DOKUMENTU, a nie długość jej listy: sekcja sprzętu przy
                        źródle „katalog" ma listę pustą z założenia i mimo to
                        pokazuje pozycje (a przy pustym katalogu — nie pokazuje
                        nic, mając tę samą listę). Rozstrzyga `structuredEntryCount`
                        z pakietu renderu, czyli ta sama wiedza, którą maluje.

                        Sekcja USUNIĘTA W SZKICU pustego stanu nie dostaje: jej
                        treść jest już poza edycją (K5a), więc przycisk „dodaj
                        pierwszy wpis" obiecywałby pracę do kosza.
                      */
                      empty={
                        structuredContent &&
                        !editorSection.deletedInDraft &&
                        structuredEntryCount(structuredContent, products) === 0
                          ? {
                              type: structuredContent.type,
                              inDrawer: structuredItemsMatter(structuredContent),
                            }
                          : null
                      }
                      index={index}
                      total={order.length}
                      level={level}
                      hovered={hoverId === editorSection.id}
                      dropTarget={dropSectionId === editorSection.id}
                      flash={flashId === editorSection.id}
                      locked={locked}
                      onHover={(inside) => {
                        // W trakcie gestu NIE zmieniamy stanu — patrz `dragging`.
                        if (dragging.current) return;
                        setHoverId((id) =>
                          inside ? editorSection.id : id === editorSection.id ? null : id,
                        );
                      }}
                      onSelectSection={() => onSelect({ sectionId: editorSection.id })}
                      onMoveUp={() => move(index, -1)}
                      onMoveDown={() => move(index, 1)}
                      onToggle={() => run(() => toggleAction(editorSection))}
                      onDuplicate={() => run(() => duplicateAction(editorSection.id))}
                      onInsert={onInsert}
                      onOpenSettings={(tab) => onOpenSettings(editorSection.id, tab)}
                      deleteAction={deleteAction}
                      onDeleted={onChanged}
                      onRestore={() => run(() => restoreAction(editorSection.id))}
                      elementLabel={selected ? t(`elementKinds.${selected.kind}`) : undefined}
                      elementActions={
                        selected ? (
                          <ElementActions
                            locked={locked}
                            onSettings={() => onOpenSettings(editorSection.id)}
                            onAutoMobile={
                              breakpoint === "mobile" && isDetachedOnMobile(selected)
                                ? () => resetMobile(editorSection.id, selected.id)
                                : undefined
                            }
                            onToFront={() =>
                              editor.mutate(editorSection.id, (current) => ({
                                ...current,
                                elements: bringToFront(current.elements, selected.id),
                              }))
                            }
                            onToBack={() =>
                              editor.mutate(editorSection.id, (current) => ({
                                ...current,
                                elements: sendToBack(current.elements, selected.id),
                              }))
                            }
                            onDuplicate={() =>
                              editor.mutate(editorSection.id, (current) =>
                                duplicateElement(current, selected.id),
                              )
                            }
                            onRemove={() => {
                              editor.mutate(editorSection.id, (current) =>
                                removeElement(current, selected.id),
                              );
                              onSelect(null);
                            }}
                          />
                        ) : null
                      }
                    >
                      {children}
                    </CanvasSection>
                  );
                }}
                elementWrapper={(section, element, children) => {
                  const canvas = editor.canvasOf(section.id);
                  if (!canvas) return children;
                  /*
                   * Sekcja USUNIĘTA W SZKICU nie dostaje warstwy edycyjnej
                   * (K5a, ADR-091): jej treść jest już poza edycją — zostaje
                   * na płótnie po to, żeby pokazać, co jeszcze stoi na żywej
                   * stronie, a nie po to, żeby ją poprawiać. Bez tej bramki
                   * autozapis geometrii pisałby do szkicu sekcji przeznaczonej
                   * do skasowania przy najbliższej publikacji.
                   */
                  if (order.find((s) => s.id === section.id)?.deletedInDraft) return children;

                  const mobile = mobileOf(canvas);
                  const box = geometryAt(element, breakpoint, mobile);
                  const rows = activeRows(canvas, mobile);
                  const isSelected =
                    selection?.sectionId === section.id && selection.elementId === element.id;
                  /*
                   * TREŚĆ ZWIĄZANA Z KATALOGIEM NIE JEST EDYTOWALNA NA PŁÓTNIE
                   * (faza 3, ADR-163).
                   *
                   * To jest ta jedna mina, którą narzędzia rynkowe ratują
                   * ostrzeżeniem w dokumentacji: jedno płótno, na którym da się
                   * edytować i szablon, i dane oglądanej pozycji, rozróżniane
                   * wyłącznie kolorem obrysu. My rozstrzygamy to konstrukcyjnie:
                   * kliknięcie w związany napis ZAZNACZA element (szuflada mówi,
                   * skąd wartość pochodzi) i nie otwiera edytora tekstu — nie ma
                   * więc stanu, w którym operator pisze w wartość, której render
                   * i tak nie pokaże.
                   */
                  const editable =
                    (element.kind === "heading" || element.kind === "text") &&
                    !isBoundAttribute(element, "text");
                  const isEditing =
                    editing?.sectionId === section.id && editing.elementId === element.id;

                  /*
                   * EDYCJA W MIEJSCU siada na OWIJCE wyrenderowanego elementu,
                   * więc edytowany tekst ma dokładnie tę typografię, którą
                   * zobaczy klient. Ramka na czas pisania znika — jedno pudełko
                   * nie może naraz jechać za kursorem i przyjmować liter.
                   */
                  if (isEditing && editable) {
                    return (
                      /*
                       * PUDEŁKO EDYCJI JEST TYM SAMYM PUDEŁKIEM, CO RENDER.
                       *
                       * Do tej poprawki owijka edycji miała własne, liczone tu
                       * współrzędne (`geometryStyle`), a w środku stał
                       * wyrenderowany element — czyli `.canvas-box`, który
                       * pozycjonuje się SAM, absolutnie, względem najbliższego
                       * pozycjonowanego przodka. Tym przodkiem stawała się
                       * owijka, więc współrzędne dodawały się do siebie i tekst
                       * odskakiwał dokładnie o (x, y) elementu w chwili wejścia
                       * w edycję (pinezka właściciela 2026-08-03).
                       *
                       * Odtąd owijka bierze KOMPLET zmiennych z tej samej
                       * funkcji, co render (`canvasBoxVariables`) i klasę
                       * `canvas-box`, a arkusz panelu neutralizuje pozycjonowanie
                       * pudełka w środku. Dzięki temu pudełko obejmujące treść
                       * (`hug`) też zostaje sobą — własne przeliczenie gubiło
                       * `max-content` i zmieniało szerokość, przez co tekst
                       * zawijał się inaczej niż przed kliknięciem.
                       */
                      <div
                        data-element-editing={element.id}
                        className="canvas-box"
                        style={
                          {
                            ...canvasBoxVariables(element, canvas.rows, mobile),
                            zIndex: 1_001,
                          } as CSSProperties
                        }
                      >
                        <InlineTextEditor
                          onCommit={(runs) => commitRuns(section.id, element.id, runs)}
                          onCancel={() => setEditing(null)}
                        >
                          {children}
                        </InlineTextEditor>
                      </div>
                    );
                  }

                  return (
                    <>
                      {children}
                      <ElementFrame
                        element={element}
                        box={box}
                        rows={rows}
                        detached={breakpoint === "mobile" && mobile.detached.has(element.id)}
                        selected={isSelected}
                        locked={locked}
                        onSelect={() => onSelect({ sectionId: section.id, elementId: element.id })}
                        /*
                          DWUKLIK OTWIERA TREŚĆ — ZAWSZE (ADR-166).

                          Do ADR-166 handler był podawany WYŁĄCZNIE dla tekstu
                          (edycja w miejscu) i zdjęcia (picker), więc dwuklik
                          w przycisk, ikonę czy kształt nie robił nic — a to
                          jest najgorsza z możliwych odpowiedzi, bo nie da się
                          jej odróżnić od zepsutego interfejsu. Rodzaje bez
                          edycji w miejscu dostają odtąd SZUFLADĘ: zaznaczamy
                          element (dwuklik działa też na niezaznaczonym) i
                          otwieramy jego właściwości.
                        */
                        onEdit={
                          editable
                            ? () => setEditing({ sectionId: section.id, elementId: element.id })
                            : element.kind === "image"
                              ? () => onPickImage({ sectionId: section.id, elementId: element.id })
                              : () => {
                                  onSelect({ sectionId: section.id, elementId: element.id });
                                  onOpenSettings(section.id);
                                }
                        }
                        onCommit={(geometry, fixed) =>
                          commitGeometry(section.id, element.id, geometry, fixed)
                        }
                        onPhase={(active) => {
                          dragging.current = active;
                        }}
                      />
                    </>
                  );
                }}
              />
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Ostatnie miejsce wstawienia stoi POZA rendererem: owijka sekcji niesie
          „+" PRZED swoją sekcją, więc koniec strony nie ma czyjego brzegu użyć.

          Strona ze STOPKĄ (K6, ADR-092) tego miejsca nie ma: pod stopką nic nie
          stoi i stać nie może, a slot, który po upuszczeniu przesuwa sekcję nad
          stopkę, kłamałby o wyniku. Ostatnim miejscem jest wtedy „+" NAD stopką,
          czyli jej własny slot `between`. */}
      {order.length > 0 && !isPinnedLastType(order[order.length - 1]!.type) ? (
        <InsertSlot
          index={order.length}
          disabled={locked}
          onInsert={onInsert}
          variant="trailing"
        />
      ) : null}
    </div>
  );
}

/**
 * Jedna sekcja na płótnie: treść z renderera + warstwa edycyjna wokół niej.
 * `relative` siedzi na DIV-ie (element blokowy) — technika poprawna z
 * konstrukcji we wszystkich silnikach, w odróżnieniu od pozycjonowania na
 * wierszach tabeli.
 */
function CanvasSection({
  section,
  structured,
  empty,
  index,
  total,
  level,
  hovered,
  dropTarget,
  flash,
  locked,
  onHover,
  onSelectSection,
  onMoveUp,
  onMoveDown,
  onToggle,
  onDuplicate,
  onInsert,
  onOpenSettings,
  deleteAction,
  onDeleted,
  onRestore,
  elementLabel,
  elementActions,
  children,
}: {
  section: EditorSection;
  /** Sekcja strukturalna: klik w całą sekcję otwiera szufladę (ADR-094). */
  structured: boolean;
  /**
   * SEKCJA NIE MA CZEGO POKAZAĆ (E8) albo `null`. `inDrawer` mówi, czy naprawa
   * jest w szufladzie tej sekcji — patrz `StructuredEmptyState`.
   */
  empty: { type: string; inDrawer: boolean } | null;
  index: number;
  total: number;
  /** Poziom zaznaczenia W TEJ sekcji (E2) — patrz nagłówek pliku. */
  level: SelectionLevel;
  /** Kursor (albo fokus) jest w tej sekcji — sam obrys, bez narzędzi. */
  hovered: boolean;
  /** Przeciągany element wyląduje W TEJ sekcji — pokaż obrys celu. */
  dropTarget: boolean;
  /** Sekcja właśnie weszła na stronę — mignij i zgaś (E2). */
  flash: boolean;
  locked: boolean;
  onHover: (inside: boolean) => void;
  onSelectSection: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onInsert: (target: InsertTarget) => void;
  /** Otwarcie szuflady, opcjonalnie na WSKAZANEJ zakładce mini-CMS-u (E8). */
  onOpenSettings: (tab?: StructuredFormTab) => void;
  deleteAction: (sectionId: string) => Promise<ActionResult>;
  onDeleted: () => void;
  /** Cofnięcie usunięcia (K5a) — jedyna akcja sekcji-nagrobka. */
  onRestore: () => void;
  /** Nazwa rodzaju zaznaczonego elementu — ostatni człon paska ścieżki. */
  elementLabel?: string;
  /**
   * Akcje ZAZNACZONEGO elementu (K2). Stoją w pasku PRZY SEKCJI, a nie przy
   * samym elemencie: płótno przycina zawartość, więc pasek przy elemencie
   * stojącym przy krawędzi zostałby obcięty — a przy ikonie 48 × 48 px byłby od
   * niej kilka razy szerszy. Od E2 stoją tam ZAMIAST akcji sekcji, nigdy obok.
   */
  elementActions?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("site");
  /**
   * SEKCJA PRZYPIĘTA (K6, ADR-092) — stopka. Nie da się jej przeciągnąć ani
   * przesunąć strzałkami, bo jej miejsce nie jest wyborem operatora. Uchwyt
   * ZOSTAJE w drzewie, ale wyłączony: znikający uchwyt kazałby zgadywać, czy
   * to awaria interfejsu, czy reguła.
   */
  const pinned = isPinnedLastType(section.type);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    disabled: locked || pinned,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-canvas-section={section.id}
      data-section-id={section.id}
      data-section-type={section.type}
      data-section-order={index + 1}
      {...(pinned ? { "data-section-pinned": "on" } : {})}
      {...(dropTarget ? { "data-drop-target": "on" } : {})}
      {...(flash ? { "data-section-flash": "on" } : {})}
      className={`relative${isDragging ? " z-20 opacity-80" : ""}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocusCapture={() => onHover(true)}
      /*
        KLIK W TŁO SEKCJI ZAZNACZA SEKCJĘ (E2). Na WCIŚNIĘCIU, a nie na
        kliknięciu, z jednego powodu: ramka elementu zatrzymuje `pointerdown`
        u siebie (tam zaczyna się gest), więc wciśnięcie w element NIE dochodzi
        tutaj i nie nadpisuje zaznaczenia elementu sekcją. Na `click` doszłoby —
        i każdy klik w element kończyłby się paskiem sekcji.
      */
      onPointerDown={() => {
        if (locked || section.deletedInDraft) return;
        onSelectSection();
      }}
    >
      {/* Miejsce wstawienia NAD tą sekcją. Kotwicą jest sekcja, przed którą
          slot stoi — czyli ta. Wciśnięcie nie może przy okazji zaznaczyć
          sekcji: „+" mówi o miejscu, nie o tym, co jest edytowane. */}
      <div onPointerDown={(event) => event.stopPropagation()}>
        <InsertSlot
          index={index}
          beforeId={section.id}
          beforeType={section.type}
          disabled={locked}
          onInsert={onInsert}
          variant="between"
        />
      </div>

      {/* Obrys sekcji: warstwa NAD treścią, ale przepuszczająca kliknięcia —
          ramki elementów (K2) mają własną, wyższą warstwę wewnątrz płótna,
          a obrys nie ma prawa przechwytywać zdarzeń paska narzędzi.

          Cztery stany, bo cztery różne zdania (arkusz panelu, token warstwy
          edycyjnej — nie akcent motywu najemcy): `hover` („tu jesteś"),
          `selected` („to jest zaznaczone"), `context` („element, który
          edytujesz, stoi w TEJ sekcji" — dyskretny i STAŁY, bez przygaszania
          czegokolwiek dookoła) oraz `off`. */}
      <div
        aria-hidden="true"
        data-section-outline={
          level === "element" ? "context" : level === "section" ? "selected" : hovered ? "hover" : "off"
        }
        className="pointer-events-none absolute inset-0 z-10 transition-[outline-color] [transition-duration:var(--motion-fast)]"
      />

      {/*
        POWIERZCHNIA KLIKNIĘCIA SEKCJI STRUKTURALNEJ (E1, ADR-094).

        Sekcja strukturalna nie ma w środku niczego, co dałoby się zaznaczyć —
        próba klikania jej accordionu na płótnie byłaby edycją POZORNĄ (stan
        podglądu, nie treść). Zamiast tego cała sekcja jest jednym przyciskiem
        otwierającym szufladę: to jedyna droga edycji i ma być pierwszą, którą
        operator znajdzie.

        `<button>`, a nie `onClick` na `div`: klawiatura, focus i rola w drzewie
        dostępności mają działać bez dopisywania ich ręcznie. Warstwa siedzi POD
        paskiem narzędzi sekcji (z-20), więc uchwyt, strzałki i kosz zostają
        klikalne.

        Klik ZAZNACZA i OTWIERA naraz (E2): sekcja strukturalna nie ma poziomu
        elementu, więc jej jedyne zaznaczenie to zaznaczenie sekcji, a jedyna
        edycja to szuflada. Rozdzielanie tego na dwa kliknięcia dokładałoby krok
        bez ani jednej nowej możliwości.
      */}
      {structured && !section.deletedInDraft ? (
        <button
          type="button"
          data-cms-open={section.id}
          aria-label={t("structured.openSettings")}
          disabled={locked}
          onClick={() => {
            onSelectSection();
            onOpenSettings();
          }}
          className="focus-visible:outline-accent dark:focus-visible:outline-ring absolute inset-0 z-10 cursor-pointer outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:-outline-offset-4"
        />
      ) : null}

      {/*
        NARZĘDZIA JEDNEGO POZIOMU (E2, pinezka 39a4327a).

        Pasek wychodzi z ZAZNACZENIA (nie z najechania) i niesie akcje DOKŁADNIE
        jednego poziomu. Przy zaznaczonym elemencie nie ma tu ani uchwytu sekcji,
        ani jej kosza — droga do nich prowadzi przez pasek ścieżki albo Escape,
        czyli przez świadome wyjście o poziom wyżej.

        Wciśnięcie na pasku NIE schodzi do tła sekcji: bez tego kliknięcie
        „usuń element" najpierw zaznaczyłoby sekcję i skasowałoby własny cel.
      */}
      {level !== "none" && !section.deletedInDraft ? (
        <div
          data-section-toolbar={section.id}
          data-toolbar-scope={level}
          onPointerDown={(event) => event.stopPropagation()}
          className="border-border bg-background absolute top-2 right-2 z-20 flex flex-wrap items-center gap-1 rounded-md border p-1"
        >
          <SelectionPath
            sectionLabel={t(`sectionTypes.${section.type}`)}
            elementLabel={level === "element" ? elementLabel : undefined}
            onSelectSection={onSelectSection}
          />
          {level === "element" ? (
            elementActions
          ) : (
            <>
              <button
                type="button"
                data-drag-handle
                aria-label={t("sections.dragHandle")}
                className="text-muted-foreground hover:text-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-7 cursor-grab touch-none items-center justify-center rounded-md border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                disabled={locked || pinned}
                {...attributes}
                {...listeners}
              >
                <GripVertical className="size-4" aria-hidden />
              </button>
              <ToolbarButton
                label={t("sections.moveUp")}
                marker="move-up"
                icon={<ArrowUp className="size-4" aria-hidden />}
                loading={locked}
                disabled={locked || pinned || index === 0}
                onClick={onMoveUp}
              />
              <ToolbarButton
                label={t("sections.moveDown")}
                marker="move-down"
                icon={<ArrowDown className="size-4" aria-hidden />}
                loading={locked}
                disabled={locked || pinned || index === total - 1}
                onClick={onMoveDown}
              />
              <ToolbarButton
                label={section.enabled ? t("sections.disable") : t("sections.enable")}
                marker="toggle"
                icon={
                  section.enabled ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />
                }
                loading={locked}
                disabled={locked}
                onClick={onToggle}
              />
              <ToolbarButton
                label={t("sections.duplicate")}
                marker="duplicate"
                icon={<Copy className="size-4" aria-hidden />}
                loading={locked}
                disabled={locked}
                onClick={onDuplicate}
              />
              <ToolbarButton
                label={t("builder.settings")}
                marker="settings"
                icon={<Settings2 className="size-4" aria-hidden />}
                loading={locked}
                disabled={locked}
                /*
                  Owijka, a nie `onClick={onOpenSettings}`: od E8 pierwszym
                  argumentem jest ZAKŁADKA, a `<button>` podałby tu zdarzenie
                  myszy. Szuflada dostałaby wtedy „zakładkę", której nie ma
                  w zbiorze, i otworzyłaby się na wyglądzie zamiast na wpisach.
                */
                onClick={() => onOpenSettings()}
              />
              <DeleteSectionDialog
                section={section}
                deleteAction={deleteAction}
                onDeleted={onDeleted}
                disabled={locked}
              />
            </>
          )}
        </div>
      ) : null}

      {/* Sekcja wyłączona zostaje na płótnie, ale mówi wprost, że klient jej nie
          zobaczy — przygaszenie SAMO w sobie byłoby zagadką, nie komunikatem.

          Sekcja USUNIĘTA W SZKICU (K5a) mówi coś odwrotnego i mocniejszego:
          klient JĄ WIDZI, a zniknie dopiero po publikacji. Dlatego jej chip
          wypiera chip wyłączenia (dwa naraz kłóciłyby się o znaczenie), a
          „Przywróć" stoi PRZY chipie i jest widoczne bez najeżdżania kursorem
          — cofnięcie pomyłki nie może wymagać odnalezienia paska narzędzi. */}
      {section.deletedInDraft ? (
        <div
          data-section-deleted={section.id}
          className="border-border bg-background absolute top-2 left-2 z-20 flex items-center gap-2 rounded-md border p-1 pl-2"
        >
          <SecondaryStatusChip axis="site-section" value="deleted" />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-section-restore
            disabled={locked}
            loading={locked}
            onClick={onRestore}
          >
            <RotateCcw className="size-4" aria-hidden />
            {t("sections.restore")}
          </Button>
        </div>
      ) : !section.enabled ? (
        <div data-section-hidden={section.id} className="absolute top-2 left-2 z-20">
          <SecondaryStatusChip axis="site-section" value="disabled" />
        </div>
      ) : null}

      <div className={section.enabled && !section.deletedInDraft ? undefined : "opacity-50"}>
        {children}
      </div>

      {/*
        PUSTY STAN SEKCJI (E8) — POD treścią, nie zamiast niej.

        Sekcja bez wpisów renderuje się na sklepie tak, jak renderowała się do
        E8 (jedno zdanie dla odwiedzającego) i tak samo wygląda w podglądzie —
        pustka na sklepie jest problemem operatora, nie klienta, więc nie
        wymyślamy tam treści. To, czego brakowało, to ODPOWIEDŹ NA PYTANIE
        „i co ja mam z tym zrobić": stoi więc TUTAJ, w warstwie edycyjnej, jako
        blok pod sekcją. Nakładka na sekcję zasłoniłaby jej nagłówek, czyli
        jedyną rzecz, po której operator poznaje, o którą sekcję chodzi.

        Warstwa jest CAŁA po stronie panelu — pakiet renderu jej nie zna, więc
        do sklepu nie ma jej czym wnieść nawet przypadkiem (ta sama zasada, co
        przy obrysie i pasku narzędzi).
      */}
      {empty ? (
        <StructuredEmptyState
          type={empty.type}
          inDrawer={empty.inDrawer}
          locked={locked}
          onOpen={() => onOpenSettings("items")}
        />
      ) : null}
    </div>
  );
}

/**
 * SEKCJA, KTÓRA NIE POKAŻE NIC — I DROGA WYJŚCIA (E8).
 *
 * ==================== DWIE KLASY PUSTKI, DWIE ODPOWIEDZI ====================
 *
 * Pustkę da się naprawić w SZUFLADZIE tej sekcji albo POZA nią, i to jest cała
 * różnica, którą operator musi zobaczyć:
 *
 *   • `inDrawer` — lista wpisów sekcji coś znaczy i jest pusta (sekcja sprzętu
 *     ze źródłem „wybrane pozycje" bez ani jednego wskazania). Wtedy stoi tu
 *     DUŻY przycisk, który otwiera szufladę OD RAZU na liście wpisów;
 *   • bez `inDrawer` — treść sekcji bierze się skądinąd i tam trzeba pójść
 *     (sekcja sprzętu ze źródłem „katalog" przy pustym katalogu). Wtedy stoi tu
 *     ZDANIE mówiące, gdzie iść, i ŻADNEGO przycisku: przycisk otwierający
 *     szufladę obiecywałby naprawę, której w niej nie ma.
 *
 * Etykiety idą z i18n po kluczu REJESTRU (`structured.<typ>.canvasEmpty.*`),
 * jak cała reszta mini-CMS-u, więc kolejny typ, który dopuści pustą listę,
 * wchodzi tu bez zmiany ani jednej linii — a kontrakt i18n dopilnuje, żeby nie
 * wszedł z gołym kluczem na ekranie.
 */
function StructuredEmptyState({
  type,
  inDrawer,
  locked,
  onOpen,
}: {
  type: string;
  inDrawer: boolean;
  locked: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("site");

  return (
    /*
      `relative z-10` — powierzchnia otwierająca szufladę (`data-cms-open`)
      leży NAD całą sekcją, więc blok bez własnej warstwy dostałby kliknięcie
      przeznaczone dla przycisku. Ta sama warstwa, późniejsza kolejność w
      drzewie: przycisk wygrywa, a kliknięcie obok niego dalej otwiera szufladę.
    */
    <div
      data-canvas-empty={type}
      className="border-border text-muted-foreground relative z-10 m-3 flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center"
    >
      <p className="text-sm font-medium">{t(`structured.${type}.canvasEmpty.title`)}</p>
      {inDrawer ? (
        <Button type="button" size="lg" data-canvas-empty-action disabled={locked} onClick={onOpen}>
          <Plus className="size-4" aria-hidden />
          {t(`structured.${type}.canvasEmpty.action`)}
        </Button>
      ) : (
        <p data-canvas-empty-elsewhere className="text-[13px] leading-[18px]">
          {t(`structured.${type}.canvasEmpty.elsewhere`)}
        </p>
      )}
    </div>
  );
}

/**
 * Akcje zaznaczonego elementu: WŁAŚCIWOŚCI, warstwa, kopia, usunięcie.
 * Usunięcie elementu NIE pyta o potwierdzenie (w odróżnieniu od usunięcia
 * sekcji), bo cofnij przywraca je jednym kliknięciem — a sekcji cofnąć się nie
 * da, jej usunięcie kasuje wiersz w bazie.
 *
 * ============ WŁAŚCIWOŚCI STOJĄ PIERWSZE (ADR-166) ============
 *
 * Do ADR-166 pasek elementu miał wyłącznie akcje UKŁADU (warstwa, kopia,
 * usunięcie) i ani jednego wejścia w TREŚĆ. Pola etykiety i adresu przycisku
 * istniały w szufladzie od K3, ale jedyny przycisk, który ją otwierał, stał na
 * pasku SEKCJI — a ten znika w chwili zaznaczenia elementu (narzędzia jednego
 * poziomu, ADR-088/E2). Szuflada jest przy tym modalna, więc „otwórz przy
 * sekcji, potem kliknij element" też nie jest drogą: nakładka przykrywa płótno.
 * Skutek zgłoszony przez właściciela wprost: „ej a jak niby mam edytować
 * przycisk?".
 *
 * Miejsce jest PIERWSZE w pasku, bo pasek sekcji otwierają akcje MIEJSCA
 * (uchwyt, strzałki), a element miejsca w kolejności nie ma — więc slot otwarcia
 * należy się temu, po co operator tu przyszedł. Ikona jest TA SAMA, co przy
 * ustawieniach sekcji: to jest ta sama czynność o poziom niżej, a dwa symbole
 * na jedno znaczenie kazałyby się uczyć różnicy, której nie ma.
 */
function ElementActions({
  locked,
  onSettings,
  onToFront,
  onToBack,
  onDuplicate,
  onRemove,
  onAutoMobile,
}: {
  locked: boolean;
  /** Otwarcie szuflady na właściwościach TEGO elementu (ADR-166). */
  onSettings: () => void;
  onToFront: () => void;
  onToBack: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  /**
   * Powrót pod auto-układ mobilny (K4, ADR-088). Akcja pojawia się WYŁĄCZNIE
   * wtedy, gdy jest co cofać: w widoku telefonu, na elemencie z ręczną
   * poprawką. Przycisk wyszarzony „na zawsze" uczyłby, że nic nie robi.
   */
  onAutoMobile?: () => void;
}) {
  const t = useTranslations("site");
  return (
    <span
      data-element-actions
      className="border-border ml-1 flex items-center gap-1 border-l pl-2"
    >
      <ToolbarButton
        label={t("elements.settings")}
        marker="element-settings"
        icon={<Settings2 className="size-4" aria-hidden />}
        disabled={locked}
        loading={locked}
        onClick={onSettings}
      />
      {onAutoMobile ? (
        <ToolbarButton
          label={t("elements.autoMobile")}
          marker="element-auto-mobile"
          icon={<Wand2 className="size-4" aria-hidden />}
          disabled={locked}
          loading={locked}
          onClick={onAutoMobile}
        />
      ) : null}
      <ToolbarButton
        label={t("elements.toFront")}
        marker="element-front"
        icon={<BringToFront className="size-4" aria-hidden />}
        disabled={locked}
        loading={locked}
        onClick={onToFront}
      />
      <ToolbarButton
        label={t("elements.toBack")}
        marker="element-back"
        icon={<SendToBack className="size-4" aria-hidden />}
        disabled={locked}
        loading={locked}
        onClick={onToBack}
      />
      <ToolbarButton
        label={t("elements.duplicate")}
        marker="element-duplicate"
        icon={<CopyPlus className="size-4" aria-hidden />}
        disabled={locked}
        loading={locked}
        onClick={onDuplicate}
      />
      <ToolbarButton
        label={t("elements.remove")}
        marker="element-remove"
        icon={<Trash2 className="size-4" aria-hidden />}
        variant="destructive"
        disabled={locked}
        loading={locked}
        onClick={onRemove}
      />
    </span>
  );
}

/**
 * PASEK ŚCIEŻKI „Sekcja › Element" (E2).
 *
 * Dwa zadania naraz i oba są odpowiedzią na tę samą pinezkę: MÓWI, na którym
 * poziomie stoi operator (skoro pasek narzędzi pokazuje już tylko jeden), i
 * JEST DROGĄ w górę — klik w człon sekcji zaznacza sekcję.
 *
 * Człon bieżący nie jest przyciskiem: „kliknij to, na czym już stoisz" to
 * kontrolka bez skutku. Nawigacja niesie własną nazwę, bo w drzewie dostępności
 * dwa napisy oddzielone znakiem „›" nie mówią nic same z siebie.
 */
function SelectionPath({
  sectionLabel,
  elementLabel,
  onSelectSection,
}: {
  sectionLabel: string;
  /** Obecna WYŁĄCZNIE na poziomie elementu — wtedy sekcja staje się drogą w górę. */
  elementLabel?: string;
  onSelectSection: () => void;
}) {
  const t = useTranslations("site");
  const atElement = elementLabel !== undefined;

  return (
    <nav
      data-selection-path
      aria-label={t("builder.pathLabel")}
      className="text-muted-foreground border-border mr-1 flex items-center gap-1 border-r pr-2 text-[13px] leading-[18px]"
    >
      {atElement ? (
        <button
          type="button"
          data-path-step="section"
          title={t("builder.pathSelectSection")}
          onClick={onSelectSection}
          className="hover:text-foreground focus-visible:outline-accent dark:focus-visible:outline-ring max-w-[10rem] cursor-pointer truncate rounded-sm underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2"
        >
          {sectionLabel}
        </button>
      ) : (
        <span data-path-step="section" aria-current="true" className="text-foreground max-w-[10rem] truncate font-medium">
          {sectionLabel}
        </span>
      )}
      {atElement ? (
        <>
          <ChevronRight className="size-3 shrink-0" aria-hidden />
          <span data-path-step="element" aria-current="true" className="text-foreground max-w-[10rem] truncate font-medium">
            {elementLabel}
          </span>
        </>
      ) : null}
    </nav>
  );
}

/**
 * Miejsce wstawienia sekcji („+ Dodaj sekcję" MIĘDZY sekcjami).
 *
 * Przycisk jest W DRZEWIE zawsze, a nie dorysowywany na hover: inaczej
 * klawiatura nie miałaby jak do niego dojść, a operator bez myszy zostałby z
 * jedynym „+" na końcu strony. Hover i fokus tylko go ODSŁANIAJĄ (opacity),
 * więc płótno w spoczynku wygląda jak strona.
 *
 * Od E2 slot niesie KOTWICĘ, nie indeks: identyfikator sekcji, nad którą stanie
 * nowa (`beforeId`), albo nic — i wtedy znaczy koniec strony. `data-insert-slot`
 * zostaje liczbą, bo to jest kolejność w drzewie i po niej testy oraz operator
 * rozpoznają, o które miejsce chodzi.
 */
function InsertSlot({
  index,
  beforeId,
  beforeType,
  disabled,
  onInsert,
  variant,
}: {
  index: number;
  beforeId?: string;
  beforeType?: SectionType;
  disabled: boolean;
  onInsert: (target: InsertTarget) => void;
  variant: "between" | "trailing";
}) {
  const t = useTranslations("site");

  return (
    <div
      data-insert-slot={index}
      className={`group/insert z-30 flex justify-center ${
        variant === "between" ? "absolute inset-x-0 top-0 -translate-y-1/2" : "relative py-3"
      }`}
    >
      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-insert-at={index}
        loading={disabled}
        disabled={disabled}
        onClick={() => onInsert({ beforeId, beforeType })}
        className={
          variant === "between"
            ? "opacity-0 transition-opacity [transition-duration:var(--motion-fast)] group-hover/insert:opacity-100 focus-visible:opacity-100"
            : undefined
        }
      >
        <Plus className="size-4" aria-hidden />
        {t("builder.addHere")}
      </Button>
    </div>
  );
}

/** Akcja paska narzędzi sekcji — jeden rozmiar dla całego paska (R2, #135). */
/**
 * AKCJA PASKA — IKONA, NIE NAPIS (decyzja właściciela 2026-08-01, ADR-086).
 *
 * Pasek narzędzi wychodzi NAD sekcją i przy sześciu napisach zasłaniał to,
 * czego dotyczy — a przy zaznaczonym elemencie dokładał jeszcze cztery. Ikona
 * zajmuje tyle, co jedno słowo, i nie rośnie razem z tłumaczeniem.
 *
 * Znaczenie nie może zniknąć razem z napisem, więc każda ikona niesie DWA
 * kanały: `aria-label` (czytnik ekranu, testy) i tooltip (kursor). Kontrakt
 * a11y w `builder-toolbars.test.tsx` iteruje wszystkie akcje obu pasków i
 * wymaga etykiety od każdej — dodanie akcji bez niej zapala test.
 */
function ToolbarButton({
  label,
  icon,
  onClick,
  disabled,
  loading,
  variant = "secondary",
  marker,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "secondary" | "destructive";
  marker?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={variant}
          aria-label={label}
          data-toolbar-action={marker ?? label}
          onClick={onClick}
          loading={loading}
          disabled={disabled}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Usunięcie sekcji WYMAGA potwierdzenia (wzorzec R6b) — na płótnie tym bardziej,
 * bo pasek narzędzi wychodzi od samego najechania kursorem.
 *
 * OSTRZEŻENIE MÓWI PRAWDĘ O SKUTKU (K5a, ADR-091), a skutek jest inny dla
 * sekcji opublikowanej (znika ze strony klienta dopiero przy publikacji, do
 * tego czasu da się ją przywrócić) niż dla nigdy nieopublikowanej (ginie od
 * razu i bezpowrotnie). Do 0045 dialog obiecywał to pierwsze WSZYSTKIM —
 * i było to nieprawdą dla obu.
 */
function DeleteSectionDialog({
  section,
  deleteAction,
  onDeleted,
  disabled,
}: {
  section: EditorSection;
  deleteAction: (sectionId: string) => Promise<ActionResult>;
  onDeleted: () => void;
  disabled: boolean;
}) {
  const t = useTranslations("site");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteAction(section.id);
      if (result.ok) {
        setOpen(false);
        onDeleted();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="destructive"
          data-section-remove
          data-toolbar-action="remove"
          aria-label={t("sections.remove")}
          disabled={disabled}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sections.confirmRemoveTitle")}</DialogTitle>
          <DialogDescription data-remove-scope={section.published ? "published" : "draft-only"}>
            {section.published
              ? t("sections.confirmRemoveBodyPublished")
              : t("sections.confirmRemoveBodyDraft")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                {t("sections.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              data-section-remove-confirm
              loading={pending}
              disabled={pending}
            >
              {t("sections.confirmRemove")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
