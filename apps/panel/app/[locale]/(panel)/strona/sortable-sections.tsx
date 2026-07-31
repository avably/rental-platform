"use client";

/**
 * Lista sekcji edytora strony z przeciąganiem (Kreator A1).
 *
 * KOLEJNOŚĆ ZMIENIA SIĘ NA DWA SPOSOBY, oba wołające TĘ SAMĄ akcję zapisującą
 * PEŁEN komplet pozycji jednym przebiegiem:
 *   1. przeciągnięcie ZA UCHWYT (sześć kropek po lewej wiersza, wzorzec sklepowy)
 *      — dnd-kit/sortable, aktywacja wyłącznie z uchwytu (reszta wiersza to
 *      przyciski i formularz), z sensorem klawiatury dla a11y;
 *   2. strzałki „wyżej/niżej" w rzędzie akcji — fallback klawiaturowy, który
 *      działa też, gdy ktoś nie sięgnie po przeciąganie.
 *
 * Zmiana jest OPTYMISTYCZNA: lista przestawia się od razu, akcja zapisuje w tle,
 * a błąd COFA listę do stanu sprzed i pokazuje komunikat (role=alert). Reorder
 * to seria UPDATE-ów pozycji (0019) — przejściowe duplikaty są legalne, odczyt
 * rozstrzyga remis (position, id).
 *
 * Transform dnd-kit siada na `<li>` (element blokowy) — technika poprawna w
 * Safari, w przeciwieństwie do pozycjonowania na wierszach tabeli.
 */
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
} from "@avably/ui";
import type { SectionType } from "@avably/core/site";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { SecondaryStatusChip } from "@/lib/secondary-status";

import { AddSectionDialog } from "./add-section-gallery";
import type { EditorSection } from "./content";
import { SectionContentForm } from "./section-content-form";

type ActionResult = { ok: true } | { ok: false; error: string };

export function SortableSections({
  siteId,
  sections,
  reorderAction,
  toggleAction,
  duplicateAction,
  deleteAction,
  onAddSection,
  onChanged,
  onSectionSaved,
}: {
  siteId: string;
  sections: EditorSection[];
  /** Zapis PEŁNEGO kompletu pozycji jednym przebiegiem (patrz reorderSections). */
  reorderAction: (orderedIds: string[]) => Promise<ActionResult>;
  toggleAction: (section: EditorSection) => Promise<ActionResult>;
  duplicateAction: (sectionId: string) => Promise<ActionResult>;
  deleteAction: (sectionId: string) => Promise<ActionResult>;
  /** Dodanie sekcji TUŻ ZA daną (akcja „dodaj poniżej" w wierszu). */
  onAddSection: (type: SectionType, afterSectionId: string) => void;
  /** Odświeżenie RSC po udanej mutacji (server action zrobił revalidatePath). */
  onChanged: () => void;
  /**
   * Udany zapis TREŚCI sekcji. Osobno od `onChanged`, bo tylko tu wiadomo,
   * KTÓRA sekcja się zmieniła — podgląd przewija się do niej po przeładowaniu
   * (kreator A3).
   */
  onSectionSaved: (sectionId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Lokalna, optymistyczna kolejność. Resync z serwerem po każdej revalidacji:
  // gdy props `sections` przyjdą nową referencją (router.refresh po mutacji),
  // przyjmujemy je jako źródło prawdy. Korekta stanu z propsów W RENDERZE, nie
  // w efekcie — wzorzec „You Might Not Need an Effect" (bez kaskady renderów).
  const [order, setOrder] = useState<EditorSection[]>(sections);
  const [syncedFrom, setSyncedFrom] = useState(sections);
  if (syncedFrom !== sections) {
    setSyncedFrom(sections);
    setOrder(sections);
  }

  const sensors = useSensors(
    // Krótki próg ruchu: klik w uchwyt (bez przeciągnięcia) nie startuje dnd,
    // a Safari nie gubi pierwszego pointermove.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * Optymistyczny zapis kolejności z rollbackiem: ustaw listę od razu, zapisz
   * komplet pozycji jedną akcją; błąd cofa do `previous` i pokazuje komunikat.
   */
  function commitOrder(next: EditorSection[], previous: EditorSection[]) {
    setError(null);
    setOrder(next);
    startTransition(async () => {
      const result = await reorderAction(next.map((s) => s.id));
      if (result.ok) onChanged();
      else {
        setOrder(previous);
        setError(result.error);
      }
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.findIndex((s) => s.id === active.id);
    const to = order.findIndex((s) => s.id === over.id);
    if (from === -1 || to === -1) return;
    commitOrder(arrayMove(order, from, to), order);
  }

  /** Strzałka wyżej/niżej — ten sam optymistyczny zapis co przeciąganie. */
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    commitOrder(arrayMove(order, index, target), order);
  }

  /** Toggle/duplikat: jedna tranzycja, błąd w tym samym alercie co reorder. */
  function runRow(action: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) onChanged();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol data-site-sections className="flex list-none flex-col gap-4 p-0">
            {order.map((section, index) => (
              <SortableSectionRow
                key={section.id}
                siteId={siteId}
                section={section}
                index={index}
                total={order.length}
                pending={pending}
                onMoveUp={() => move(index, -1)}
                onMoveDown={() => move(index, 1)}
                onToggle={() => runRow(() => toggleAction(section))}
                onDuplicate={() => runRow(() => duplicateAction(section.id))}
                onAddSection={onAddSection}
                deleteAction={deleteAction}
                onDeleted={onChanged}
                onSaved={onSectionSaved}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

/** Jeden wiersz sekcji: uchwyt przeciągania + nagłówek + formularz z rzędem akcji. */
function SortableSectionRow({
  siteId,
  section,
  index,
  total,
  pending,
  onMoveUp,
  onMoveDown,
  onToggle,
  onDuplicate,
  onAddSection,
  deleteAction,
  onDeleted,
  onSaved,
}: {
  siteId: string;
  section: EditorSection;
  index: number;
  total: number;
  pending: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onAddSection: (type: SectionType, afterSectionId: string) => void;
  deleteAction: (sectionId: string) => Promise<ActionResult>;
  onDeleted: () => void;
  onSaved: (sectionId: string) => void;
}) {
  const t = useTranslations("site");
  // Uchwyt jest wyłączony w trakcie zapisu — przeciąganie w połowie tranzycji
  // rozjeżdżałoby optymistyczną listę z tym, co właśnie leci do bazy.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    disabled: pending,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-section-type={section.type}
      data-section-order={index + 1}
      className={`border-border bg-card flex flex-col gap-4 rounded-lg border p-5${
        isDragging ? " relative z-10 shadow-lg" : ""
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            data-drag-handle
            aria-label={t("sections.dragHandle")}
            className="text-muted-foreground hover:text-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring -ml-1 flex size-7 cursor-grab touch-none items-center justify-center rounded-md border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
          <h3 className="text-base leading-[22px] font-semibold">
            {`${String(index + 1).padStart(2, "0")} · ${t(`sectionTypes.${section.type}`)}`}
          </h3>
        </div>
        <SecondaryStatusChip axis="site-section" value={section.enabled ? "enabled" : "disabled"} />
      </header>
      <SectionContentForm
        siteId={siteId}
        section={section}
        onSaved={() => onSaved(section.id)}
        actions={
          <>
            <RowButton
              label={t("sections.moveUp")}
              loading={pending}
              disabled={pending || index === 0}
              onClick={onMoveUp}
            />
            <RowButton
              label={t("sections.moveDown")}
              loading={pending}
              disabled={pending || index === total - 1}
              onClick={onMoveDown}
            />
            <RowButton
              label={section.enabled ? t("sections.disable") : t("sections.enable")}
              loading={pending}
              disabled={pending}
              onClick={onToggle}
            />
            <RowButton
              label={t("sections.duplicate")}
              loading={pending}
              disabled={pending}
              onClick={onDuplicate}
            />
            <AddSectionDialog
              disabled={pending}
              onAdd={(type) => onAddSection(type, section.id)}
              trigger={
                <Button type="button" size="sm" variant="secondary" disabled={pending}>
                  {t("sections.addBelow")}
                </Button>
              }
            />
            <DeleteSectionDialog
              section={section}
              deleteAction={deleteAction}
              onDeleted={onDeleted}
              disabled={pending}
            />
          </>
        }
      />
    </li>
  );
}

/**
 * Usunięcie sekcji WYMAGA potwierdzenia w oknie (wzorzec R6b/ban-toggle) — dziś
 * usuwało jednym kliknięciem, a usunięta sekcja znika z podglądu i (po kolejnej
 * publikacji) ze strony. Własna tranzycja + zamknięcie okna dopiero na sukcesie;
 * błąd zostaje w oknie (role=alert).
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

/**
 * Akcja wiersza sekcji (kolejność, włączenie, duplikat) — jeden rozmiar dla
 * całego rzędu. `loading` dzieli wspólną tranzycję listy, więc akcje wiersza
 * sygnalizują zajętość razem, tak jak razem szarzeją na `disabled` (R2, #135).
 */
function RowButton({
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
