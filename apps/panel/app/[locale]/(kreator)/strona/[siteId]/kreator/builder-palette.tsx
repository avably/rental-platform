"use client";

/**
 * LEWA PALETA KREATORA (K1, ADR-083) — dwie zakładki i stopka szablonu.
 *
 * „Sekcje" to TA SAMA galeria typów z presetami, co modal „+" na płótnie
 * (`SectionTypeGallery`) — jedna siatka, dwa opakowania. Kafel ma odtąd (K6,
 * ADR-092) DWIE drogi, tak samo jak kafel elementu od K3: kliknięcie dokłada
 * sekcję na końcu treści, a PRZECIĄGNIĘCIE wstawia ją w podświetlone miejsce
 * między sekcjami. Klik zostaje, bo przeciąganie nie ma odpowiednika
 * klawiaturowego — a „+" między sekcjami zostaje, bo jest drogą bez myszy.
 *
 * „Elementy" (K3, ADR-086) to kafle przeciągane NA sekcję albo dokładane
 * kliknięciem — patrz `element-palette.tsx`. Do K2 zakładka była jawną
 * zapowiedzią; teraz jest paletą.
 *
 * STYL STRONY siedzi w STOPCE palety (K5, ADR-090). Przełącznik „szablon
 * graficzny" (classic/bold) ZNIKŁ stąd decyzją właściciela: szablon nie jest
 * już skórką, tylko ŚWIATEM wizualnym wybieranym razem z gotową stroną
 * w galerii szablonów. W palecie zostaje to, co jest personalizacją W RAMACH
 * tego świata — akcent z palety motywu i para krojów. Obie zmiany idą do
 * SZKICU stylu i wchodzą na żywą stronę dopiero publikacją.
 */
import {
  FONT_PAIRS,
  SELECTABLE_FONT_PAIRS,
  accentsOf,
  themeTokens,
  type PaletteElementKind,
  type ResolvedSiteStyle,
  type SectionType,
  type SiteFontPair,
} from "@avably/core/site";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { SectionTypeGallery, type SectionDragHandlers } from "@/app/[locale]/(panel)/strona/add-section-gallery";
import { PanelSelect } from "@/components/fields/panel-select";

import { ElementPalette } from "./element-palette";

type PaletteTab = "sections" | "elements";

export function BuilderPalette({
  open,
  onToggle,
  disabled,
  style,
  onAddSection,
  onAddElement,
  onDropElement,
  onDragElementOver,
  onDragElementEnd,
  onDragSection,
  unavailableSectionTypes,
  onSaveStyle,
}: {
  open: boolean;
  onToggle: () => void;
  disabled: boolean;
  style: ResolvedSiteStyle;
  /** Dodanie sekcji na KOŃCU strony (paleta nie zna pozycji). */
  onAddSection: (type: SectionType) => void;
  /** Dodanie ELEMENTU kliknięciem kafla (K3) — ląduje pod treścią sekcji. */
  onAddElement: (kind: PaletteElementKind) => void;
  /** Upuszczenie kafla na płótno — element ląduje POD KURSOREM (K3). */
  onDropElement: (kind: PaletteElementKind, pointer: { x: number; y: number }) => boolean;
  /** Ruch kafla ELEMENTU nad płótnem — wskaż sekcję, która go przyjmie (K6). */
  onDragElementOver: (pointer: { x: number; y: number }) => void;
  /** Koniec gestu kafla elementu — zdejmij wskazanie (K6). */
  onDragElementEnd: () => void;
  /**
   * Przeciągnięcie kafla SEKCJI na płótno (K6, ADR-092). Paleta sama nie liczy
   * miejsca wstawienia — nie widzi płótna; przekazuje surowe współrzędne
   * skorupie, która widzi oba.
   */
  onDragSection: SectionDragHandlers;
  /** Typy, których strona nie przyjmie drugi raz (dziś: stopka) — ADR-092. */
  unavailableSectionTypes: readonly SectionType[];
  /** Zapis stylu — CAŁY stan, nie pojedyncze pole (scalanie robi akcja). */
  onSaveStyle: (style: ResolvedSiteStyle) => void;
}) {
  const t = useTranslations("site");
  const locale = useLocale();
  const [tab, setTab] = useState<PaletteTab>("sections");
  const idPrefix = useId();

  if (!open) {
    return (
      <aside
        data-builder-palette="collapsed"
        className="border-border bg-card flex w-12 shrink-0 flex-col items-center border-r py-3"
      >
        <PaletteToggle open={false} onToggle={onToggle} label={t("builder.paletteExpand")} />
      </aside>
    );
  }

  return (
    <aside
      data-builder-palette="expanded"
      className="border-border bg-card flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-r p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("builder.paletteHeading")}</h2>
        <PaletteToggle open onToggle={onToggle} label={t("builder.paletteCollapse")} />
      </div>

      <div role="tablist" aria-label={t("builder.paletteHeading")} className="border-border flex gap-1 rounded-md border p-1">
        {(["sections", "elements"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${value}`}
            aria-selected={tab === value}
            aria-controls={`${idPrefix}-panel-${value}`}
            data-palette-tab={value}
            onClick={() => setTab(value)}
            className={`focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex-1 cursor-pointer rounded-sm border border-transparent px-3 py-1.5 text-sm outline-none transition-colors [transition-duration:var(--motion-fast)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 ${
              tab === value ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(value === "sections" ? "builder.tabSections" : "builder.tabElements")}
          </button>
        ))}
      </div>

      {tab === "sections" ? (
        <div
          role="tabpanel"
          id={`${idPrefix}-panel-sections`}
          aria-labelledby={`${idPrefix}-tab-sections`}
          className="flex flex-col gap-2"
        >
          <p className="text-muted-foreground text-[13px] leading-[18px]">{t("builder.tabSectionsHint")}</p>
          <SectionTypeGallery
            columns="single"
            disabled={disabled}
            onAdd={onAddSection}
            drag={onDragSection}
            unavailable={unavailableSectionTypes}
          />
        </div>
      ) : (
        <div
          role="tabpanel"
          id={`${idPrefix}-panel-elements`}
          aria-labelledby={`${idPrefix}-tab-elements`}
          data-palette-elements
        >
          <ElementPalette
            disabled={disabled}
            onAdd={onAddElement}
            onDrop={onDropElement}
            onDragOver={onDragElementOver}
            onDragEnd={onDragElementEnd}
          />
        </div>
      )}

      <StylePanel disabled={disabled} style={style} locale={locale} idPrefix={idPrefix} onSave={onSaveStyle} />

    </aside>
  );
}


/**
 * PANEL „STYL STRONY" (K5, ADR-090) — personalizacja W RAMACH motywu.
 *
 * Operator nie wybiera tu koloru, tylko AKCENT Z PALETY SWOJEGO MOTYWU. Zbiór
 * jest zamknięty i należy do motywu, bo tylko wtedy da się UDOWODNIĆ, że każdy
 * wybór daje czytelną stronę — dowodem jest wyczerpująca bramka kontrastu
 * w @avably/core/site, która chodzi po tym samym rejestrze, z którego pochodzą
 * próbki niżej. Dowolny hex byłby obietnicą bez pokrycia: szesnastu milionów
 * kombinacji nikt nie policzy.
 *
 * Para krojów jest wspólna dla wszystkich motywów, więc wybiera się ją z pełnej
 * listy — motyw wnosi tu tylko wartość domyślną.
 */
function StylePanel({
  disabled,
  style,
  locale,
  idPrefix,
  onSave,
}: {
  disabled: boolean;
  style: ResolvedSiteStyle;
  locale: string;
  idPrefix: string;
  onSave: (style: ResolvedSiteStyle) => void;
}) {
  const t = useTranslations("site");
  const theme = themeTokens(style.theme);
  const language = locale === "en" ? "en" : "pl";

  return (
    <div data-builder-style className="border-border mt-auto flex flex-col gap-3 border-t pt-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t("style.legend")}</h3>
        {/* Opis dyrekcji jest DANYMI motywu — panel go tylko pokazuje. */}
        <p className="text-muted-foreground text-[13px] leading-[18px]">{theme.mood[language]}</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-[13px] font-medium">{t("style.accent")}</legend>
        <div className="flex flex-wrap gap-2">
          {accentsOf(style.theme).map((accent) => {
            const wariant = theme.bands.default.accent;
            const swatch = theme.accents[accent]![wariant]!.fill;
            const active = accent === style.accent;
            return (
              <button
                key={accent}
                type="button"
                data-style-accent={accent}
                aria-pressed={active}
                aria-label={accent}
                disabled={disabled}
                onClick={() => onSave({ ...style, accent })}
                className={`size-7 cursor-pointer rounded-full border-2 transition-transform [transition-duration:var(--motion-fast)] disabled:cursor-not-allowed ${
                  active ? "border-foreground scale-110" : "border-border hover:scale-105"
                }`}
                style={{ background: swatch }}
              />
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1" data-style-font-pair>
        <label htmlFor={`${idPrefix}-font-pair`} className="text-[13px] font-medium">
          {t("style.fontPair")}
        </label>
        {/* Kontrolka panelu, nie natywny `select` — kontrakt powłoki (ADR-063)
            pilnuje jednego wyglądu pól w całej aplikacji. */}
        <PanelSelect
          id={`${idPrefix}-font-pair`}
          value={style.fontPair}
          disabled={disabled}
          onValueChange={(value) => onSave({ ...style, fontPair: value as SiteFontPair })}
          options={SELECTABLE_FONT_PAIRS.map((pair) => ({
            value: pair,
            label: FONT_PAIRS[pair].label[language],
          }))}
        />
      </div>
    </div>
  );
}

function PaletteToggle({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  const Icon = open ? PanelLeftClose : PanelLeftOpen;
  return (
    <button
      type="button"
      data-palette-toggle
      aria-label={label}
      aria-expanded={open}
      onClick={onToggle}
      className="text-muted-foreground hover:text-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-8 cursor-pointer items-center justify-center rounded-md border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
