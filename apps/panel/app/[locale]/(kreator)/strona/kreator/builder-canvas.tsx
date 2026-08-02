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
 */
import {
  bringToFront,
  plainTextOf,
  sendToBack,
  type CanvasElement,
  type Geometry,
  type SectionCanvas,
  type SectionType,
  type SiteTemplate,
  type TextRun,
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
  geometryStyle,
  type RenderSection,
  type StorefrontProduct,
} from "@avably/ui";
import {
  ArrowDown,
  ArrowUp,
  BringToFront,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  GripVertical,
  Plus,
  SendToBack,
  Settings2,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition, type ReactNode } from "react";

import { AddSectionDialog } from "@/app/[locale]/(panel)/strona/add-section-gallery";
import type { EditorSection } from "@/app/[locale]/(panel)/strona/content";
import { SecondaryStatusChip } from "@/lib/secondary-status";
import { siteImagePublicBase } from "@/lib/site-image-base";

import { ElementFrame } from "./canvas-elements";
import { InlineTextEditor } from "./inline-editor";
import { runsEqual } from "./inline-text";
import {
  duplicateElement,
  removeElement,
  replaceElement,
  type CanvasEditor,
} from "./use-canvas-editor";

type ActionResult = { ok: true } | { ok: false; error: string };

/** Szerokość CSS telefonu — SYMULOWANY VIEWPORT płótna, nie szerokość ekranu. */
const MOBILE_CANVAS_WIDTH = 390;

export type BuilderViewport = "desktop" | "mobile";

/** Zaznaczony element — para (sekcja, element): id elementu jest lokalne dla sekcji. */
export interface ElementSelection {
  sectionId: string;
  elementId: string;
}

/** Geometrie POZOSTAŁYCH elementów — cele przyciągania dla ruszanego. */
function neighboursOf(canvas: SectionCanvas, elementId: string): Geometry[] {
  return canvas.elements
    .filter((element) => element.id !== elementId)
    .map((element) => element.layout.desktop);
}

function withDesktop(element: CanvasElement, geometry: Geometry): CanvasElement {
  return { ...element, layout: { ...element.layout, desktop: geometry } } as CanvasElement;
}

export function BuilderCanvas({
  template,
  sections,
  products,
  viewport,
  busy,
  run,
  reorderAction,
  toggleAction,
  duplicateAction,
  deleteAction,
  onAddSection,
  onOpenSettings,
  onChanged,
  editor,
  selection,
  onSelect,
  onPickImage,
}: {
  template: SiteTemplate;
  sections: EditorSection[];
  products: StorefrontProduct[];
  viewport: BuilderViewport;
  /** Trwa mutacja — uchwyty i pasek narzędzi szarzeją razem (R2, #135). */
  busy: boolean;
  /**
   * Uruchomienie mutacji W TRANZYCJI SKORUPY: jeden wskaźnik stanu zapisu na
   * całą trasę, jeden komunikat błędu. `onFail` cofa zmianę optymistyczną.
   */
  run: (action: () => Promise<ActionResult>, onFail?: () => void) => void;
  reorderAction: (orderedIds: string[]) => Promise<ActionResult>;
  toggleAction: (section: EditorSection) => Promise<ActionResult>;
  duplicateAction: (sectionId: string) => Promise<ActionResult>;
  deleteAction: (sectionId: string) => Promise<ActionResult>;
  /** Wstawienie sekcji na POZYCJI (index w skali listy bez nowej sekcji). */
  onAddSection: (type: SectionType, index: number, orderedIds: string[]) => void;
  onOpenSettings: (sectionId: string) => void;
  onChanged: () => void;
  /** Szkice płótna, historia i autozapis — jedna prawda o stanie edycji (K2). */
  editor: CanvasEditor;
  selection: ElementSelection | null;
  onSelect: (selection: ElementSelection | null) => void;
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

  // Sekcja pod kursorem / z fokusem — TYLKO ona pokazuje pasek narzędzi.
  // Stan Reacta, a nie samo `:hover`, bo pasek musi wychodzić też od klawiatury
  // (fokus wewnątrz sekcji) i nie może się mnożyć po dwunastu sekcjach naraz.
  const [activeId, setActiveId] = useState<string | null>(null);
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

  /** Koniec ruchu: JEDEN wpis w historii i JEDEN zapis na całe przeciągnięcie. */
  function commitGeometry(sectionId: string, elementId: string, geometry: Geometry) {
    editor.mutate(sectionId, (canvas) =>
      replaceElement(canvas, elementId, (element) => withDesktop(element, geometry)),
    );
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    commitOrder(arrayMove(order, index, target), order);
  }

  const orderedIds = order.map((s) => s.id);

  /** Sekcje do renderu: treść bierzemy ze SZKICU (plus podgląd ruchu), nie z propsów. */
  const rendered = order.map((section) => {
    const canvas = editor.canvasOf(section.id);
    return canvas
      ? { ...section, content: canvas }
      : section;
  });

  return (
    <div
      data-builder-canvas
      data-viewport={viewport}
      className="mx-auto flex w-full flex-col"
      style={viewport === "mobile" ? { maxWidth: MOBILE_CANVAS_WIDTH } : undefined}
    >
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        {order.length === 0 ? (
          <div data-builder-canvas-empty className="flex flex-col items-center gap-3 p-12 text-center">
            <p className="text-sm font-medium">{t("builder.emptyTitle")}</p>
            <p className="text-muted-foreground text-[13px] leading-[18px]">
              {t("builder.emptyBody")}
            </p>
            <AddSectionDialog
              disabled={locked}
              onAdd={(type) => onAddSection(type, 0, orderedIds)}
              trigger={
                <Button type="button" size="sm" variant="secondary" data-insert-at="0" loading={locked} disabled={locked}>
                  {t("sections.add")}
                </Button>
              }
            />
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
              <SiteRenderer
                sections={rendered as unknown as RenderSection[]}
                template={template}
                products={products}
                siteImageBase={siteImagePublicBase()}
                sectionWrapper={(section, children) => {
                  const index = order.findIndex((s) => s.id === section.id);
                  const editorSection = order[index];
                  if (!editorSection) return children;
                  const canvas = editor.canvasOf(editorSection.id);
                  const selected =
                    selection && selection.sectionId === editorSection.id
                      ? canvas?.elements.find((element) => element.id === selection.elementId)
                      : undefined;
                  return (
                    <CanvasSection
                      section={editorSection}
                      index={index}
                      total={order.length}
                      orderedIds={orderedIds}
                      active={activeId === editorSection.id}
                      locked={locked}
                      onActivate={() => {
                        // W trakcie gestu NIE zmieniamy stanu — patrz `dragging`.
                        if (!dragging.current) setActiveId(editorSection.id);
                      }}
                      onDeactivate={() => setActiveId((id) => (id === editorSection.id ? null : id))}
                      onMoveUp={() => move(index, -1)}
                      onMoveDown={() => move(index, 1)}
                      onToggle={() => run(() => toggleAction(editorSection))}
                      onDuplicate={() => run(() => duplicateAction(editorSection.id))}
                      onAddSection={onAddSection}
                      onOpenSettings={() => onOpenSettings(editorSection.id)}
                      deleteAction={deleteAction}
                      onDeleted={onChanged}
                      elementActions={
                        selected ? (
                          <ElementActions
                            locked={locked}
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

                  const isSelected =
                    selection?.sectionId === section.id && selection.elementId === element.id;
                  const editable = element.kind === "heading" || element.kind === "text";
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
                      <div
                        data-element-editing={element.id}
                        className="absolute"
                        style={{ ...geometryStyle(element.layout.desktop, canvas.rows), zIndex: 1_001 }}
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
                        rows={canvas.rows}
                        neighbours={neighboursOf(canvas, element.id)}
                        selected={isSelected}
                        locked={locked}
                        onSelect={() => {
                          setActiveId(section.id);
                          onSelect({ sectionId: section.id, elementId: element.id });
                        }}
                        onEdit={
                          editable
                            ? () => setEditing({ sectionId: section.id, elementId: element.id })
                            : element.kind === "image"
                              ? () => onPickImage({ sectionId: section.id, elementId: element.id })
                              : undefined
                        }
                        onCommit={(geometry) => commitGeometry(section.id, element.id, geometry)}
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
          „+" PRZED swoją sekcją, więc koniec strony nie ma czyjego brzegu użyć. */}
      {order.length > 0 ? (
        <InsertSlot
          index={order.length}
          orderedIds={orderedIds}
          disabled={locked}
          onAddSection={onAddSection}
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
  index,
  total,
  orderedIds,
  active,
  locked,
  onActivate,
  onDeactivate,
  onMoveUp,
  onMoveDown,
  onToggle,
  onDuplicate,
  onAddSection,
  onOpenSettings,
  deleteAction,
  onDeleted,
  elementActions,
  children,
}: {
  section: EditorSection;
  index: number;
  total: number;
  orderedIds: string[];
  active: boolean;
  locked: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onAddSection: (type: SectionType, index: number, orderedIds: string[]) => void;
  onOpenSettings: () => void;
  deleteAction: (sectionId: string) => Promise<ActionResult>;
  onDeleted: () => void;
  /**
   * Akcje ZAZNACZONEGO elementu (K2). Stoją w pasku SEKCJI, a nie przy samym
   * elemencie: płótno przycina zawartość, więc pasek przy elemencie stojącym
   * przy krawędzi zostałby obcięty — a przy ikonie 48 × 48 px byłby od niej
   * kilka razy szerszy.
   */
  elementActions?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("site");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    disabled: locked,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-canvas-section={section.id}
      data-section-id={section.id}
      data-section-type={section.type}
      data-section-order={index + 1}
      className={`relative${isDragging ? " z-20 opacity-80" : ""}`}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      onFocusCapture={onActivate}
    >
      <InsertSlot
        index={index}
        orderedIds={orderedIds}
        disabled={locked}
        onAddSection={onAddSection}
        variant="between"
      />

      {/* Obrys sekcji: warstwa NAD treścią, ale przepuszczająca kliknięcia —
          ramki elementów (K2) mają własną, wyższą warstwę wewnątrz płótna,
          a obrys nie ma prawa przechwytywać zdarzeń paska narzędzi. */}
      <div
        aria-hidden="true"
        data-section-outline={active ? "on" : "off"}
        className={`pointer-events-none absolute inset-0 z-10 border-2 transition-colors [transition-duration:var(--motion-fast)] ${
          active ? "border-accent" : "border-transparent"
        }`}
      />

      {active ? (
        <div
          data-section-toolbar={section.id}
          className="border-border bg-background absolute top-2 right-2 z-20 flex flex-wrap items-center gap-1 rounded-md border p-1"
        >
          <button
            type="button"
            data-drag-handle
            aria-label={t("sections.dragHandle")}
            className="text-muted-foreground hover:text-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-7 cursor-grab touch-none items-center justify-center rounded-md border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
            disabled={locked}
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
            disabled={locked || index === 0}
            onClick={onMoveUp}
          />
          <ToolbarButton
            label={t("sections.moveDown")}
            marker="move-down"
            icon={<ArrowDown className="size-4" aria-hidden />}
            loading={locked}
            disabled={locked || index === total - 1}
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
            onClick={onOpenSettings}
          />
          <DeleteSectionDialog
            section={section}
            deleteAction={deleteAction}
            onDeleted={onDeleted}
            disabled={locked}
          />
          {elementActions}
        </div>
      ) : null}

      {/* Sekcja wyłączona zostaje na płótnie, ale mówi wprost, że klient jej nie
          zobaczy — przygaszenie SAMO w sobie byłoby zagadką, nie komunikatem. */}
      {!section.enabled ? (
        <div data-section-hidden={section.id} className="absolute top-2 left-2 z-20">
          <SecondaryStatusChip axis="site-section" value="disabled" />
        </div>
      ) : null}

      <div className={section.enabled ? undefined : "opacity-50"}>{children}</div>
    </div>
  );
}

/**
 * Akcje zaznaczonego elementu: warstwa, kopia, usunięcie. Usunięcie elementu
 * NIE pyta o potwierdzenie (w odróżnieniu od usunięcia sekcji), bo cofnij
 * przywraca je jednym kliknięciem — a sekcji cofnąć się nie da, jej usunięcie
 * kasuje wiersz w bazie.
 */
function ElementActions({
  locked,
  onToFront,
  onToBack,
  onDuplicate,
  onRemove,
}: {
  locked: boolean;
  onToFront: () => void;
  onToBack: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("site");
  return (
    <span
      data-element-actions
      className="border-border ml-1 flex items-center gap-1 border-l pl-2"
    >
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
 * Miejsce wstawienia sekcji („+ Dodaj sekcję" MIĘDZY sekcjami).
 *
 * Przycisk jest W DRZEWIE zawsze, a nie dorysowywany na hover: inaczej
 * klawiatura nie miałaby jak do niego dojść, a operator bez myszy zostałby z
 * jedynym „+" na końcu strony. Hover i fokus tylko go ODSŁANIAJĄ (opacity),
 * więc płótno w spoczynku wygląda jak strona.
 */
function InsertSlot({
  index,
  orderedIds,
  disabled,
  onAddSection,
  variant,
}: {
  index: number;
  orderedIds: string[];
  disabled: boolean;
  onAddSection: (type: SectionType, index: number, orderedIds: string[]) => void;
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
      <AddSectionDialog
        disabled={disabled}
        onAdd={(type) => onAddSection(type, index, orderedIds)}
        trigger={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-insert-at={index}
            loading={disabled}
            disabled={disabled}
            className={
              variant === "between"
                ? "opacity-0 transition-opacity [transition-duration:var(--motion-fast)] group-hover/insert:opacity-100 focus-visible:opacity-100"
                : undefined
            }
          >
            <Plus className="size-4" aria-hidden />
            {t("builder.addHere")}
          </Button>
        }
      />
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
          <DialogDescription>{t("sections.confirmRemoveBody")}</DialogDescription>
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
