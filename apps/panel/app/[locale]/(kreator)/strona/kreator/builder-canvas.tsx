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
 * kompletem pozycji: uchwytem (dnd-kit) i strzałkami w pasku narzędzi.
 * GEOMETRIA ELEMENTÓW żyje w szkicu klienta (`useCanvasEditor`) i zapisuje się
 * sama, z opóźnieniem — dlatego oba przeciągania stoją w JEDNYM `DndContext`,
 * rozróżniane po `data.kind` chwytanego obiektu, a nie w dwóch zagnieżdżonych.
 *
 * PODGLĄD RUCHU NIE IDZIE PRZEZ HISTORIĘ: pozycja w trakcie przeciągania siedzi
 * w osobnym stanie i dokłada się do szkicu dopiero przy rysowaniu. Gdyby każdy
 * piksel ruchu wchodził do szkicu, „cofnij" cofałoby o piksel, a nie o ruch.
 */
import {
  GRID_UNIT_PX,
  bringToFront,
  sendToBack,
  snapMove,
  type CanvasElement,
  type Geometry,
  type Guide,
  type SectionCanvas,
  type SectionType,
  type SiteTemplate,
} from "@avably/core/site";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
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
  type RenderSection,
  type StorefrontProduct,
} from "@avably/ui";
import { GripVertical, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { AddSectionDialog } from "@/app/[locale]/(panel)/strona/add-section-gallery";
import type { EditorSection } from "@/app/[locale]/(panel)/strona/content";
import { SecondaryStatusChip } from "@/lib/secondary-status";
import { siteImagePublicBase } from "@/lib/site-image-base";

import { ElementFrame, columnWidth, type ElementDragData } from "./canvas-elements";
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

/** Pozycja w trakcie ruchu — poza szkicem i poza historią (patrz nagłówek). */
interface GeometryPreview {
  sectionId: string;
  elementId: string;
  geometry: Geometry;
}

/** Stan przeciągania: miara płótna i punkt wyjścia zamrożone na czas ruchu. */
interface ElementDrag {
  sectionId: string;
  elementId: string;
  base: Geometry;
  perColumn: number;
  latest: Geometry;
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

/** Szkic + ewentualny podgląd ruchu — to, co widzi operator w tej klatce. */
function withPreview(
  canvas: SectionCanvas,
  sectionId: string,
  preview: GeometryPreview | null,
): SectionCanvas {
  if (!preview || preview.sectionId !== sectionId) return canvas;
  return replaceElement(canvas, preview.elementId, (element) =>
    withDesktop(element, preview.geometry),
  );
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
  const [preview, setPreview] = useState<GeometryPreview | null>(null);
  // Prowadnice bieżącego ruchu. Najwyżej jeden element rusza się naraz, więc
  // jeden stan wystarcza na całe płótno.
  const [guides, setGuides] = useState<{ elementId: string; lines: Guide[] } | null>(null);
  const drag = useRef<ElementDrag | null>(null);

  /*
   * Alt wyłącza przyciąganie do sąsiadów. dnd-kit nie niesie stanu modyfikatorów
   * w zdarzeniu ruchu, więc śledzimy go osobno — inaczej „bez przyciągania"
   * działałoby przy zmianie rozmiaru (surowe zdarzenia wskaźnika), a przy
   * przeciąganiu nie, co jest gorsze niż brak tej możliwości w ogóle.
   */
  const altHeld = useRef(false);
  useEffect(() => {
    const sync = (event: KeyboardEvent) => {
      altHeld.current = event.altKey;
    };
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
    };
  }, []);

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

  function elementDragData(event: DragStartEvent | DragMoveEvent | DragEndEvent) {
    const data = event.active.data.current as Partial<ElementDragData> | undefined;
    return data?.kind === "element" ? (data as ElementDragData) : null;
  }

  function handleDragStart(event: DragStartEvent) {
    const data = elementDragData(event);
    if (!data) return;
    const canvas = editor.canvasOf(data.sectionId);
    const element = canvas?.elements.find((item) => item.id === data.elementId);
    if (!element) return;
    onSelect({ sectionId: data.sectionId, elementId: data.elementId });
    drag.current = {
      sectionId: data.sectionId,
      elementId: data.elementId,
      base: element.layout.desktop,
      // Miara PŁÓTNA, nie okna (ADR-085) — zamrożona na czas ruchu, żeby zmiana
      // szerokości w trakcie przeciągania nie przeskalowała przebytej już drogi.
      perColumn: columnWidth(data.gridWidth()),
      latest: element.layout.desktop,
    };
  }

  function handleDragMove(event: DragMoveEvent) {
    const active = drag.current;
    const canvas = active ? editor.canvasOf(active.sectionId) : undefined;
    if (!active || !canvas) return;
    const result = snapMove(
      active.base,
      event.delta.x / active.perColumn,
      event.delta.y / GRID_UNIT_PX,
      { rows: canvas.rows, neighbours: neighboursOf(canvas, active.elementId), snap: !altHeld.current },
    );
    active.latest = result.geometry;
    setGuides({ elementId: active.elementId, lines: result.guides });
    setPreview({ sectionId: active.sectionId, elementId: active.elementId, geometry: result.geometry });
  }

  function handleDragEnd(event: DragEndEvent) {
    const active = drag.current;
    if (active) {
      drag.current = null;
      setGuides(null);
      setPreview(null);
      commitGeometry(active.sectionId, active.elementId, active.latest);
      return;
    }

    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    const from = order.findIndex((s) => s.id === dragged.id);
    const to = order.findIndex((s) => s.id === over.id);
    if (from === -1 || to === -1) return;
    commitOrder(arrayMove(order, from, to), order);
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
      ? { ...section, content: withPreview(canvas, section.id, preview) }
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
          >
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
                      onActivate={() => setActiveId(editorSection.id)}
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
                  return (
                    <>
                      {children}
                      <ElementFrame
                        element={element}
                        sectionId={section.id}
                        rows={canvas.rows}
                        neighbours={neighboursOf(canvas, element.id)}
                        selected={
                          selection?.sectionId === section.id && selection.elementId === element.id
                        }
                        locked={locked}
                        guides={guides?.elementId === element.id ? guides.lines : EMPTY_GUIDES}
                        onSelect={() => {
                          setActiveId(section.id);
                          onSelect({ sectionId: section.id, elementId: element.id });
                        }}
                        onPreview={(geometry, lines) => {
                          setGuides({ elementId: element.id, lines });
                          setPreview({ sectionId: section.id, elementId: element.id, geometry });
                        }}
                        onCommit={(geometry) => {
                          setGuides(null);
                          setPreview(null);
                          commitGeometry(section.id, element.id, geometry);
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

/** Stała referencja pustej listy — nowa tablica w propsie remontowałaby ramkę. */
const EMPTY_GUIDES: Guide[] = [];

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
          <ToolbarButton label={t("sections.moveUp")} loading={locked} disabled={locked || index === 0} onClick={onMoveUp} />
          <ToolbarButton
            label={t("sections.moveDown")}
            loading={locked}
            disabled={locked || index === total - 1}
            onClick={onMoveDown}
          />
          <ToolbarButton
            label={section.enabled ? t("sections.disable") : t("sections.enable")}
            loading={locked}
            disabled={locked}
            onClick={onToggle}
          />
          <ToolbarButton label={t("sections.duplicate")} loading={locked} disabled={locked} onClick={onDuplicate} />
          <ToolbarButton label={t("builder.settings")} loading={locked} disabled={locked} onClick={onOpenSettings} />
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
      <ToolbarButton label={t("elements.toFront")} disabled={locked} loading={locked} onClick={onToFront} />
      <ToolbarButton label={t("elements.toBack")} disabled={locked} loading={locked} onClick={onToBack} />
      <ToolbarButton
        label={t("elements.duplicate")}
        disabled={locked}
        loading={locked}
        onClick={onDuplicate}
      />
      <ToolbarButton label={t("elements.remove")} disabled={locked} loading={locked} onClick={onRemove} />
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
function ToolbarButton({
  label,
  onClick,
  disabled,
  loading,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Button type="button" size="sm" variant="secondary" onClick={onClick} loading={loading} disabled={disabled}>
      {label}
    </Button>
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
        <Button type="button" size="sm" variant="destructive" data-section-remove disabled={disabled}>
          {t("sections.remove")}
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
