"use client";

/**
 * MINI-CMS SEKCJI STRUKTURALNEJ (E1, ADR-094) — framework, nie formularz FAQ.
 *
 * ==================== CO TU JEST FRAMEWORKIEM ====================
 *
 * Ten plik nie zna słowa „pytanie”. Wie tylko, że sekcja strukturalna ma:
 * WARIANT UKŁADU, PAS motywu, opcjonalny nagłówek, LISTĘ WPISÓW o polach
 * opisanych w rejestrze (`itemFields`) i zestaw PRZEŁĄCZNIKÓW (`toggles`).
 * Wszystko, co odróżnia FAQ od cennika, siedzi w `STRUCTURED_SECTIONS`
 * (@avably/core/site) — więc kolejny typ (galeria, opinie, dojazd) dostaje ten
 * ekran bez ani jednej linii tutaj. Etykiety idą z i18n po kluczu
 * `structured.<typ>.…`, żeby dane rejestru zostały danymi, a nie tekstem UI.
 *
 * ==================== TRZY DECYZJE, KTÓRE WIDAĆ ====================
 *
 *   1. PRZEŁĄCZNIK UKŁADU NIE DOTYKA DANYCH. Przechodzi przez
 *      `withStructuredLayout`, którego jedyne zadanie to zmienić JEDNO pole —
 *      kontrakt bezstratności (`layout A → B → A` = ta sama treść) jest
 *      zamknięty w rdzeniu i ma tam własny test.
 *   2. USUNIĘCIE WPISU PYTA. Wpisu nie da się cofnąć jednym klawiszem (historia
 *      kreatora cofa, ale operator o tym nie wie w chwili kliknięcia w kosz),
 *      a skasowana odpowiedź to skasowana praca.
 *   3. KOLEJNOŚĆ MA DWIE DROGI: uchwyt do przeciągania i strzałki. Samo
 *      przeciąganie zamyka tę funkcję przed klawiaturą (WCAG 2.5.7), a same
 *      strzałki są wolne przy dłuższej liście.
 *
 * Zapis idzie SZKICEM edytora (historia + autozapis), jak płótno — bez własnego
 * przycisku „Zapisz” i bez drugiego wskaźnika stanu.
 */
import {
  appendStructuredItem,
  moveStructuredItem,
  patchStructuredItem,
  removeStructuredItem,
  structuredNewItemFor,
  structuredSpecOf,
  withStructuredLayout,
  SECTION_BACKGROUNDS,
  type StructuredSectionContent,
  type StructuredSectionType,
} from "@avably/core/site";
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
  Input,
  Label,
  Textarea,
} from "@avably/ui";
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";

import { PanelSelect } from "@/components/fields/panel-select";

type Update = (content: StructuredSectionContent) => StructuredSectionContent;

/** Wpisy treści — każdy typ strukturalny jest listowy (kontrakt rejestru). */
function itemsOf(content: StructuredSectionContent): Record<string, string>[] {
  return (content as unknown as { items: Record<string, string>[] }).items;
}

export function StructuredSectionForm({
  content,
  onChange,
  onConvertHint,
}: {
  content: StructuredSectionContent;
  onChange: (update: Update) => void;
  /** Miejsce na komunikat/akcję spoza mini-CMS (np. konwersja) — opcjonalne. */
  onConvertHint?: React.ReactNode;
}) {
  const t = useTranslations("site");
  const locale = useLocale();
  const id = useId();
  const type = content.type as StructuredSectionType;
  const spec = structuredSpecOf(type);
  const items = itemsOf(content);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /*
   * Identyfikator wpisu dla przeciągania. Wpisy NIE MAJĄ własnego id w treści
   * (i nie powinny — to dane najemcy, nie encje), więc kluczem jest POZYCJA.
   * Wystarcza, bo lista przebudowuje się przy każdej zmianie kolejności,
   * a `dnd-kit` potrzebuje stabilności wyłącznie na czas jednego gestu.
   */
  const ids = items.map((_, index) => `${id}-item-${index}`);

  function handleDragEnd(event: DragEndEvent) {
    const from = ids.indexOf(String(event.active.id));
    const to = event.over ? ids.indexOf(String(event.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    onChange((current) => moveStructuredItem(current, from, to));
  }

  return (
    <div data-cms-form={type} className="flex flex-col gap-5">
      {/* WARIANT UKŁADU — zmiana wyglądu, która nie rusza ani jednego wpisu. */}
      <Field label={t("structured.layout")} htmlFor={`${id}-layout`}>
        <PanelSelect
          id={`${id}-layout`}
          value={content.layout}
          onValueChange={(value) => onChange((current) => withStructuredLayout(current, value))}
          options={spec.layouts.map((layout) => ({
            value: layout,
            label: t(`structured.${type}.layouts.${layout}`),
          }))}
        />
      </Field>

      <Field label={t("canvas.background")} htmlFor={`${id}-bg`}>
        <PanelSelect
          id={`${id}-bg`}
          value={content.background}
          onValueChange={(value) =>
            onChange((current) => ({ ...current, background: value }) as StructuredSectionContent)
          }
          options={SECTION_BACKGROUNDS.map((value) => ({
            value,
            label: t(`canvas.backgrounds.${value}`),
          }))}
        />
      </Field>

      <Field label={t("structured.heading")} htmlFor={`${id}-heading`}>
        <Input
          id={`${id}-heading`}
          value={content.heading ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            onChange(
              (current) =>
                ({
                  ...current,
                  // Nagłówek jest OPCJONALNY — pusty znaczy „bez nagłówka”,
                  // a nie „pusty napis”, którego schemat i tak by nie przyjął.
                  heading: value.trim() === "" ? undefined : value,
                }) as StructuredSectionContent,
            );
          }}
        />
      </Field>

      {spec.toggles.map((toggle) => (
        <label
          key={toggle.key}
          data-cms-toggle={toggle.key}
          className="flex items-center gap-2 text-sm"
        >
          <input
            type="checkbox"
            className="size-4"
            checked={Boolean((content as unknown as Record<string, unknown>)[toggle.key])}
            onChange={(event) =>
              onChange(
                (current) =>
                  ({ ...current, [toggle.key]: event.target.checked }) as StructuredSectionContent,
              )
            }
          />
          {t(`structured.${type}.toggles.${toggle.key}`)}
        </label>
      ))}

      <div className="border-border flex flex-col gap-3 border-t pt-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{t(`structured.${type}.itemsTitle`)}</p>
          <span data-cms-count className="text-muted-foreground text-xs">
            {items.length} / {spec.maxItems}
          </span>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex list-none flex-col gap-3 p-0">
              {items.map((item, index) => (
                <ItemRow
                  key={ids[index]}
                  sortableId={ids[index]!}
                  index={index}
                  total={items.length}
                  type={type}
                  item={item}
                  canRemove={items.length > spec.minItems}
                  onPatch={(key, value) =>
                    onChange((current) => patchStructuredItem(current, index, key, value))
                  }
                  onMove={(direction) =>
                    onChange((current) => moveStructuredItem(current, index, index + direction))
                  }
                  onRemove={() => onChange((current) => removeStructuredItem(current, index))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-cms-add
          disabled={items.length >= spec.maxItems}
          onClick={() =>
            onChange((current) => appendStructuredItem(current, structuredNewItemFor(type, locale)))
          }
        >
          <Plus className="size-4" aria-hidden />
          {t(`structured.${type}.addItem`)}
        </Button>
      </div>

      {onConvertHint}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * JEDEN WPIS LISTY. Pola rysują się z rejestru (`itemFields`), więc wiersz nie
 * zna nazw pól ani ich liczby — ta sama komórka obsłuży „pytanie/odpowiedź”
 * i „nazwa/cena/jednostka”.
 */
function ItemRow({
  sortableId,
  index,
  total,
  type,
  item,
  canRemove,
  onPatch,
  onMove,
  onRemove,
}: {
  sortableId: string;
  index: number;
  total: number;
  type: StructuredSectionType;
  item: Record<string, string>;
  canRemove: boolean;
  onPatch: (key: string, value: string) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("site");
  const id = useId();
  const spec = structuredSpecOf(type);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-cms-item={index}
      className={`border-border bg-card flex flex-col gap-3 rounded-md border p-3${
        isDragging ? " opacity-80" : ""
      }`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-cms-drag={index}
          aria-label={t("structured.dragHandle")}
          className="text-muted-foreground hover:text-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-7 cursor-grab touch-none items-center justify-center rounded-md border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <span className="text-muted-foreground text-xs">{index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label={t("structured.moveUp")}
            marker={`up-${index}`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
            icon={<ArrowUp className="size-4" aria-hidden />}
          />
          <IconButton
            label={t("structured.moveDown")}
            marker={`down-${index}`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            icon={<ArrowDown className="size-4" aria-hidden />}
          />
          <RemoveItemDialog
            type={type}
            index={index}
            disabled={!canRemove}
            onConfirm={onRemove}
          />
        </div>
      </div>

      {spec.itemFields.map((field) =>
        field.kind === "multiline" ? (
          <Field
            key={field.key}
            label={t(`structured.${type}.fields.${field.key}`)}
            htmlFor={`${id}-${field.key}`}
          >
            <Textarea
              id={`${id}-${field.key}`}
              data-cms-field={field.key}
              rows={field.rows ?? 3}
              value={item[field.key] ?? ""}
              onChange={(event) => {
                // Pusta wartość nie przejdzie schematu — nie zapisujemy jej
                // w ogóle, zamiast pokazywać błąd przy każdym skasowanym znaku
                // (ta sama zasada, co w ustawieniach elementu płótna).
                if (event.target.value.trim() === "") return;
                onPatch(field.key, event.target.value);
              }}
            />
          </Field>
        ) : (
          <Field
            key={field.key}
            label={t(`structured.${type}.fields.${field.key}`)}
            htmlFor={`${id}-${field.key}`}
          >
            <Input
              id={`${id}-${field.key}`}
              data-cms-field={field.key}
              value={item[field.key] ?? ""}
              onChange={(event) => {
                if (event.target.value.trim() === "") return;
                onPatch(field.key, event.target.value);
              }}
            />
          </Field>
        ),
      )}
    </li>
  );
}

function IconButton({
  label,
  marker,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  marker: string;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-cms-move={marker}
      disabled={disabled}
      onClick={onClick}
      className={`text-muted-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-7 items-center justify-center rounded-md border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 ${
        disabled ? "cursor-not-allowed opacity-50" : "hover:text-foreground cursor-pointer"
      }`}
    >
      {icon}
    </button>
  );
}

/**
 * USUNIĘCIE WPISU PYTA (decyzja 2 z nagłówka pliku). Ostatniego wpisu usunąć
 * się nie da — sekcja bez ani jednej pozycji to atrapa, którą ADR-094 usuwa
 * z produktu; przycisk zostaje w drzewie, ale wyłączony, żeby reguła była
 * widoczna zamiast zgadywana.
 */
function RemoveItemDialog({
  type,
  index,
  disabled,
  onConfirm,
}: {
  type: StructuredSectionType;
  index: number;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("site");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={t("structured.removeItem")}
          title={t("structured.removeItem")}
          data-cms-remove={index}
          disabled={disabled}
          className={`text-muted-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-7 items-center justify-center rounded-md border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 ${
            disabled ? "cursor-not-allowed opacity-50" : "hover:text-destructive cursor-pointer"
          }`}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("structured.removeTitle")}</DialogTitle>
          <DialogDescription>{t(`structured.${type}.removeBody`)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("structured.removeCancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button type="button" data-cms-remove-confirm onClick={onConfirm}>
              {t("structured.removeConfirm")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
