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
  isStructuredType,
  type StructuredSectionContent,
  ELEMENT_ALIGNMENTS,
  ELEMENT_COLORS,
  ELEMENT_ICONS,
  HEADING_LEVELS,
  SECTION_BACKGROUNDS,
  SECTION_MAX_ROWS,
  SECTION_MIN_ROWS,
  TEXT_VARIANTS,
  sizeOf,
  supportsHug,
  withSize,
  type CanvasElement,
  type SectionCanvas,
} from "@avably/core/site";
import {
  Button,
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

import { StructuredSectionForm } from "./structured-section-form";
import { replaceElement } from "./use-canvas-editor";

export function SectionSettingsDrawer({
  siteId,
  importSources,
  section,
  canvas,
  structured,
  selectedElementId,
  onCanvasChange,
  onStructuredChange,
  onConvert,
  onPickImage,
  onClose,
  onSaved,
}: {
  siteId: string;
  /**
   * Wpisy z innych modułów panelu do skopiowania w mini-CMS (E5, ADR-096).
   * Szuflada ich nie czyta — podaje dalej mini-CMS-owi, który zestawia je
   * z deklaracją `itemsImport` w rejestrze typu.
   */
  importSources?: Record<string, readonly unknown[]>;
  /** Sekcja w edycji albo null — szuflada zamknięta. */
  section: EditorSection | null;
  /** Szkic płótna tej sekcji (v2). Brak = sekcja w kształcie v1 albo v3. */
  canvas?: SectionCanvas;
  /** Szkic sekcji STRUKTURALNEJ (v3, ADR-094) — wtedy szuflada jest mini-CMS-em. */
  structured?: StructuredSectionContent;
  selectedElementId: string | null;
  onCanvasChange: (update: (canvas: SectionCanvas) => SectionCanvas) => void;
  onStructuredChange: (
    update: (content: StructuredSectionContent) => StructuredSectionContent,
  ) => void;
  /**
   * KONWERSJA „Przełącz na sekcję 2.0” (ADR-094, decyzja właściciela z grilla).
   * Podana wyłącznie dla sekcji, której typ MA silnik strukturalny, a treść go
   * jeszcze nie używa. Wstawia świeży preset POD spodem — bez zgadywania treści.
   */
  onConvert?: () => void;
  /** Otwarcie pickera zdjęcia dla ZAZNACZONEGO elementu (K3). */
  onPickImage?: () => void;
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
                {structured
                  ? t("structured.drawerDescription")
                  : canvas
                    ? t("builder.canvasSettingsDescription")
                    : t("builder.settingsDescription")}
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
              {structured ? (
                /*
                  SEKCJA STRUKTURALNA (v3, ADR-094) — szuflada JEST edytorem
                  treści: lista wpisów, pola z rejestru typu, wariant układu.
                  Na płótnie nie ma czego zaznaczać, więc nie ma tu ani ustawień
                  elementu, ani wysokości sekcji (tę niesie treść, nie geometria).
                */
                <StructuredSectionForm
                  key={section.id}
                  siteId={siteId}
                  content={structured}
                  importSources={importSources}
                  onChange={onStructuredChange}
                />
              ) : canvas ? (
                <CanvasSettings
                  canvas={canvas}
                  selectedElementId={selectedElementId}
                  onChange={onCanvasChange}
                  onPickImage={onPickImage}
                  convert={
                    onConvert && isStructuredType(section.type) ? (
                      <ConvertToStructured type={section.type} onConvert={onConvert} />
                    ) : null
                  }
                />
              ) : (
                <>
                  <SectionContentForm key={section.id} siteId={siteId} section={section} onSaved={onSaved} />
                  {onConvert && isStructuredType(section.type) ? (
                    <ConvertToStructured type={section.type} onConvert={onConvert} />
                  ) : null}
                </>
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
  onPickImage,
  convert,
}: {
  canvas: SectionCanvas;
  selectedElementId: string | null;
  onChange: (update: (canvas: SectionCanvas) => SectionCanvas) => void;
  onPickImage?: () => void;
  /** Akcja „Przełącz na sekcję 2.0” albo `null` — patrz `ConvertToStructured`. */
  convert?: ReactNode;
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
          onPickImage={onPickImage}
          onChange={(update) => onChange((current) => replaceElement(current, selected.id, update))}
        />
      ) : (
        <p data-canvas-no-selection className="text-muted-foreground text-sm">
          {t("canvas.noSelection")}
        </p>
      )}

      {convert}
    </div>
  );
}

/**
 * „PRZEŁĄCZ NA SEKCJĘ 2.0" (ADR-094, decyzja właściciela z grilla 2026-08-04).
 *
 * Konwersja jest RĘCZNA i mówi to wprost. Wstawia POD spodem świeżą sekcję
 * strukturalną tego samego typu z presetem, a starą zostawia nietkniętą —
 * operator przepisuje treść i kasuje starą, kiedy skończy.
 *
 * Dlaczego bez auto-mapowania: treść spłaszczona do płótna nie niesie już
 * informacji, który napis był pytaniem, a który odpowiedzią. Zgadywanie dałoby
 * wynik poprawny czasem i cicho przestawiony resztę razy — a to jest gorsze niż
 * przepisanie trzech akapitów, bo błędu nie widać.
 *
 * Komponent jest GENERYCZNY: pokazuje się dla KAŻDEGO typu, który ma silnik
 * strukturalny (dziś FAQ, po E3–E7 dziewięć typów) — bez zmian w tym pliku.
 */
function ConvertToStructured({ type, onConvert }: { type: string; onConvert: () => void }) {
  const t = useTranslations("site");

  return (
    <div data-cms-convert={type} className="border-border flex flex-col gap-2 border-t pt-5">
      <p className="text-sm font-medium">{t("structured.convertTitle")}</p>
      <p className="text-muted-foreground text-[13px] leading-[18px]">
        {t("structured.convertBody")}
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-cms-convert-action
        className="self-start"
        onClick={onConvert}
      >
        {t("structured.convertAction")}
      </Button>
    </div>
  );
}

/**
 * Właściwości ZAZNACZONEGO elementu (K3, ADR-086): treść, wyrównanie, SKALA
 * nagłówka, KOLOR z tokenów, opis alternatywny zdjęcia i wybór ikony
 * z allowlisty.
 *
 * Szuflada jest UZUPEŁNIENIEM edycji w miejscu, nie jej substytutem: tekst
 * poprawia się klikając w niego na płótnie, a tutaj siedzi to, czego nie da
 * się pokazać w samej treści — role, skale i wybory ze zbiorów zamkniętych.
 * Ani rozmiar fontu, ani kolor NIE są tu liczbą: operator wybiera pozycję ze
 * skali szablonu i rolę z motywu, więc zmiana jednego albo drugiego przestawia
 * stronę razem z nimi.
 */
function ElementSettings({
  element,
  onChange,
  onPickImage,
}: {
  element: CanvasElement;
  onChange: (update: (element: CanvasElement) => CanvasElement) => void;
  onPickImage?: () => void;
}) {
  const t = useTranslations("site");
  const id = useId();

  function patch(changes: Partial<CanvasElement>) {
    onChange((current) => ({ ...current, ...changes }) as CanvasElement);
  }

  const size = sizeOf(element);

  return (
    <div data-element-settings={element.kind} className="border-border flex flex-col gap-5 border-t pt-5">
      <p className="text-sm font-medium">{t(`elementKinds.${element.kind}`)}</p>

      {/*
        POWRÓT WYMIARU DO TREŚCI (K4, ADR-088, decyzja właściciela).
        Pociągnięcie za uchwyt ustawia wymiar JAWNY i to jest właściwy domyślny
        kierunek — tu jest droga z powrotem. Przycisk pokazuje się wyłącznie
        wtedy, gdy jest co przywracać: wymiar już objęty treścią nie ma czego
        obejmować drugi raz.
      */}
      {supportsHug(element.kind) && (size.w === "fixed" || size.h === "fixed") ? (
        <div className="flex flex-wrap gap-2">
          {size.w === "fixed" ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-element-hug="w"
              onClick={() => onChange((current) => withSize(current, { ...size, w: "hug" }))}
            >
              {t("canvas.hugWidth")}
            </Button>
          ) : null}
          {size.h === "fixed" ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-element-hug="h"
              onClick={() => onChange((current) => withSize(current, { ...size, h: "hug" }))}
            >
              {t("canvas.hugHeight")}
            </Button>
          ) : null}
        </div>
      ) : null}

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
        <>
          <Field label={t("canvas.alt")} htmlFor={`${id}-alt`}>
            <Input
              id={`${id}-alt`}
              value={element.alt}
              onChange={(event) => {
                // Opis alternatywny jest WYMAGANY przez schemat (dostępność) —
                // pustki nie zapisujemy, zamiast pokazywać błąd walidacji przy
                // każdym skasowanym znaku.
                if (event.target.value.trim() === "") return;
                patch({ alt: event.target.value } as Partial<CanvasElement>);
              }}
            />
          </Field>
          {onPickImage ? (
            <Button type="button" size="sm" variant="secondary" data-element-image-pick onClick={onPickImage}>
              {t("canvas.changeImage")}
            </Button>
          ) : null}
        </>
      ) : null}

      {element.kind === "icon" ? (
        <Field label={t("canvas.icon")} htmlFor={`${id}-icon`}>
          {/* Wybór z ALLOWLISTY (ADR-082) — treść tenanta nie może wskazać
              symbolu, którego render nie zna. */}
          <PanelSelect
            id={`${id}-icon`}
            value={element.name}
            onValueChange={(value) => patch({ name: value } as Partial<CanvasElement>)}
            options={ELEMENT_ICONS.map((value) => ({ value, label: value }))}
          />
        </Field>
      ) : null}

      {element.kind === "heading" ? (
        <Field label={t("canvas.level")} htmlFor={`${id}-level`}>
          {/* Wielkość nagłówka to SKALA szablonu, nie liczba pikseli — trzy
              poziomy mapują się na `landing-display`, nagłówek sekcji i tytuł
              bloku, więc zmiana szablonu przestawia je razem ze stroną. */}
          <PanelSelect
            id={`${id}-level`}
            value={String(element.level)}
            onValueChange={(value) => patch({ level: Number(value) as 1 | 2 | 3 } as Partial<CanvasElement>)}
            options={HEADING_LEVELS.map((value) => ({
              value: String(value),
              label: t(`canvas.levels.${value}`),
            }))}
          />
        </Field>
      ) : null}

      {element.kind === "heading" || element.kind === "text" ? (
        <Field label={t("canvas.color")} htmlFor={`${id}-color`}>
          {/* Kolor z TOKENÓW motywu (ADR-086) — dowolny odcień zamroziłby jedną
              wartość na zawsze i rozjechał kontrast po zmianie motywu. */}
          <PanelSelect
            id={`${id}-color`}
            value={element.color ?? "default"}
            onValueChange={(value) =>
              patch({ color: value as (typeof ELEMENT_COLORS)[number] } as Partial<CanvasElement>)
            }
            options={ELEMENT_COLORS.map((value) => ({ value, label: t(`canvas.colors.${value}`) }))}
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
