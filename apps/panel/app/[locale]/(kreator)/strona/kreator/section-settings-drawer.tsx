"use client";

/**
 * PRAWA SZUFLADA „Ustawienia sekcji" (K1, ADR-083; płótno — K2, ADR-084).
 *
 * Szuflada ma DWA oblicza, bo treść sekcji ma dwie generacje:
 *   • sekcja v1 dostaje DOTYCHCZASOWY formularz treści (`SectionContentForm`) —
 *     ten sam kod, te same schematy, ta sama akcja;
 *   • sekcja v2 (płótno) dostaje wysokość i tło sekcji oraz treść ZAZNACZONEGO
 *     elementu. To celowo NIE jest edycja w miejscu (klik w tekst na płótnie) —
 *     ta przychodzi z K3 razem z paletą elementów. Bez tych pól K2 ODEBRAŁBY
 *     operatorowi możliwość, którą miał w K1: nowa sekcja rodzi się od razu
 *     jako płótno, więc jej treści nie ma już gdzie poprawić.
 *
 * Zmiany płótna idą przez SZKIC edytora (historia + autozapis), a nie własną
 * akcją — dlatego nie ma tu przycisku „Zapisz": jest jeden kanał zapisu i jeden
 * wskaźnik stanu na całą trasę.
 *
 * Baza szuflady to `Sheet` (Radix Dialog), więc pułapkę fokusu, Escape i powrót
 * fokusu na pasek narzędzi dostajemy z przetestowanego prymitywu.
 */
import {
  ELEMENT_ALIGNMENTS,
  SECTION_BACKGROUNDS,
  SECTION_MAX_ROWS,
  SECTION_MIN_ROWS,
  TEXT_VARIANTS,
  type CanvasElement,
  type SectionCanvas,
} from "@avably/core/site";
import {
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@avably/ui";
import { useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";

import type { EditorSection } from "@/app/[locale]/(panel)/strona/content";
import { SectionContentForm } from "@/app/[locale]/(panel)/strona/section-content-form";
import { PanelSelect } from "@/components/fields/panel-select";
import { FormMeasure } from "@/components/screens/form-measure";

import { replaceElement } from "./use-canvas-editor";

export function SectionSettingsDrawer({
  siteId,
  section,
  canvas,
  selectedElementId,
  onCanvasChange,
  onClose,
  onSaved,
}: {
  siteId: string;
  /** Sekcja w edycji albo null — szuflada zamknięta. */
  section: EditorSection | null;
  /** Szkic płótna tej sekcji (v2). Brak = sekcja jeszcze w kształcie v1. */
  canvas?: SectionCanvas;
  selectedElementId: string | null;
  onCanvasChange: (update: (canvas: SectionCanvas) => SectionCanvas) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("site");

  return (
    <Sheet open={section !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" data-section-settings className="w-full gap-4 overflow-y-auto sm:max-w-md">
        {section ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("builder.settingsTitle", { type: t(`sectionTypes.${section.type}`) })}</SheetTitle>
              <SheetDescription>
                {canvas ? t("builder.canvasSettingsDescription") : t("builder.settingsDescription")}
              </SheetDescription>
            </SheetHeader>
            {/*
              Szuflada jest po K1 JEDYNYM formularzem tego ekranu, więc to ona
              niesie wspólną miarę wiersza (P8). Szerokość samej szuflady jest
              dziś węższa niż miara — i dobrze: miara jest sufitem czytelności,
              a nie sposobem na rozepchnięcie panelu.

              `key` na id sekcji: formularz treści v1 trzyma pola w stanie
              klienta, więc bez remontu przełączenie szuflady na INNĄ sekcję
              pokazywałoby wartości poprzedniej.
            */}
            <FormMeasure>
              {canvas ? (
                <CanvasSettings
                  canvas={canvas}
                  selectedElementId={selectedElementId}
                  onChange={onCanvasChange}
                />
              ) : (
                <SectionContentForm key={section.id} siteId={siteId} section={section} onSaved={onSaved} />
              )}
            </FormMeasure>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function CanvasSettings({
  canvas,
  selectedElementId,
  onChange,
}: {
  canvas: SectionCanvas;
  selectedElementId: string | null;
  onChange: (update: (canvas: SectionCanvas) => SectionCanvas) => void;
}) {
  const t = useTranslations("site");
  const id = useId();
  const selected = canvas.elements.find((element) => element.id === selectedElementId) ?? null;

  /*
   * Wysokość płótna nie może zejść pod najniższy element — schemat odrzuciłby
   * taki zapis („element wychodzi poza dolną krawędź"), a operator zobaczyłby
   * komunikat walidacji zamiast wyjaśnienia. Podłoga jest więc policzona
   * z treści, a nie stała.
   */
  const floor = canvas.elements.reduce(
    (lowest, element) => Math.max(lowest, element.layout.desktop.y + element.layout.desktop.h),
    SECTION_MIN_ROWS,
  );

  return (
    <div data-canvas-settings className="flex flex-col gap-5">
      <Field label={t("canvas.rows")} htmlFor={`${id}-rows`}>
        <Input
          id={`${id}-rows`}
          type="number"
          inputMode="numeric"
          min={floor}
          max={SECTION_MAX_ROWS}
          value={canvas.rows}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isFinite(next)) return;
            const rows = Math.min(SECTION_MAX_ROWS, Math.max(floor, Math.round(next)));
            onChange((current) => (current.rows === rows ? current : { ...current, rows }));
          }}
        />
      </Field>

      <Field label={t("canvas.background")} htmlFor={`${id}-bg`}>
        <PanelSelect
          id={`${id}-bg`}
          value={canvas.background}
          onValueChange={(value) =>
            onChange((current) => ({ ...current, background: value as SectionCanvas["background"] }))
          }
          options={SECTION_BACKGROUNDS.map((value) => ({
            value,
            label: t(`canvas.backgrounds.${value}`),
          }))}
        />
      </Field>

      {selected ? (
        <ElementSettings
          element={selected}
          onChange={(update) => onChange((current) => replaceElement(current, selected.id, update))}
        />
      ) : (
        <p data-canvas-no-selection className="text-muted-foreground text-sm">
          {t("canvas.noSelection")}
        </p>
      )}
    </div>
  );
}

/**
 * Właściwości ZAZNACZONEGO elementu — treść i wyrównanie. Zakres świadomie
 * WĄSKI: picker zdjęcia, wybór ikony i ustawienia katalogu przychodzą razem
 * z paletą w K3. Tutaj chodzi o to, żeby płótno nie odebrało operatorowi
 * możliwości poprawienia tego, co widzi.
 */
function ElementSettings({
  element,
  onChange,
}: {
  element: CanvasElement;
  onChange: (update: (element: CanvasElement) => CanvasElement) => void;
}) {
  const t = useTranslations("site");
  const id = useId();

  function patch(changes: Partial<CanvasElement>) {
    onChange((current) => ({ ...current, ...changes }) as CanvasElement);
  }

  return (
    <div data-element-settings={element.kind} className="border-border flex flex-col gap-5 border-t pt-5">
      <p className="text-sm font-medium">{t(`elementKinds.${element.kind}`)}</p>

      {element.kind === "heading" || element.kind === "text" ? (
        <Field label={t("canvas.text")} htmlFor={`${id}-text`}>
          <Textarea
            id={`${id}-text`}
            rows={element.kind === "text" ? 5 : 2}
            value={element.text}
            onChange={(event) => {
              // Pusty tekst nie przejdzie schematu — nie zapisujemy go w ogóle,
              // zamiast wyświetlać błąd przy każdym skasowanym znaku.
              if (event.target.value.trim() === "") return;
              patch({ text: event.target.value } as Partial<CanvasElement>);
            }}
          />
        </Field>
      ) : null}

      {element.kind === "button" ? (
        <>
          <Field label={t("canvas.label")} htmlFor={`${id}-label`}>
            <Input
              id={`${id}-label`}
              value={element.label}
              onChange={(event) => {
                if (event.target.value.trim() === "") return;
                patch({ label: event.target.value } as Partial<CanvasElement>);
              }}
            />
          </Field>
          <Field label={t("canvas.href")} htmlFor={`${id}-href`}>
            <Input
              id={`${id}-href`}
              value={element.href}
              onChange={(event) => {
                if (event.target.value.trim() === "") return;
                patch({ href: event.target.value } as Partial<CanvasElement>);
              }}
            />
          </Field>
        </>
      ) : null}

      {element.kind === "image" ? (
        <Field label={t("canvas.alt")} htmlFor={`${id}-alt`}>
          <Input
            id={`${id}-alt`}
            value={element.alt}
            onChange={(event) => {
              if (event.target.value.trim() === "") return;
              patch({ alt: event.target.value } as Partial<CanvasElement>);
            }}
          />
        </Field>
      ) : null}

      {element.kind === "text" ? (
        <Field label={t("canvas.variant")} htmlFor={`${id}-variant`}>
          <PanelSelect
            id={`${id}-variant`}
            value={element.variant}
            onValueChange={(value) =>
              patch({ variant: value as (typeof TEXT_VARIANTS)[number] } as Partial<CanvasElement>)
            }
            options={TEXT_VARIANTS.map((value) => ({ value, label: t(`canvas.variants.${value}`) }))}
          />
        </Field>
      ) : null}

      {element.kind === "heading" || element.kind === "text" || element.kind === "button" ? (
        <Field label={t("canvas.align")} htmlFor={`${id}-align`}>
          <PanelSelect
            id={`${id}-align`}
            value={element.align}
            onValueChange={(value) =>
              patch({ align: value as (typeof ELEMENT_ALIGNMENTS)[number] } as Partial<CanvasElement>)
            }
            options={ELEMENT_ALIGNMENTS.map((value) => ({
              value,
              label: t(`canvas.alignments.${value}`),
            }))}
          />
        </Field>
      ) : null}
    </div>
  );
}
