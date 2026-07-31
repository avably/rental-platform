"use client";

/**
 * LEWA PALETA KREATORA (K1, ADR-083) — dwie zakładki i stopka szablonu.
 *
 * „Sekcje" to TA SAMA galeria 12 typów z presetami, co modal „+" na płótnie
 * (`SectionTypeGallery`) — jedna siatka, dwa opakowania. Kliknięcie kafla w
 * palecie dokłada sekcję na KOŃCU strony; wstawienie w środku ma własną drogę
 * („+" między sekcjami), bo to inna intencja, a nie inny sposób.
 *
 * „Elementy" to jawna ZAPOWIEDŹ, nie atrapa kontrolek: paleta elementów
 * przeciąganych na sekcję przychodzi z K3 i do tego czasu zakładka mówi wprost,
 * czego jeszcze nie ma. Pusta zakładka bez zdania wyglądałaby na awarię.
 *
 * SZABLON GRAFICZNY siedzi w STOPCE palety, a nie na launcherze: launcher
 * przestał być miejscem edycji strony (K1), a wybór szablonu jest edycją —
 * zmienia wygląd każdej sekcji na płótnie obok. Docelowo wchłonie go panel
 * „Styl strony" z K5 razem z kolorem akcentu i parą fontów.
 */
import { SITE_TEMPLATES, type SectionType, type SiteTemplate } from "@avably/core/site";
import { Button } from "@avably/ui";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { SectionTypeGallery } from "@/app/[locale]/(panel)/strona/add-section-gallery";

type PaletteTab = "sections" | "elements";

export function BuilderPalette({
  open,
  onToggle,
  disabled,
  template,
  onAddSection,
  onSaveTemplate,
}: {
  open: boolean;
  onToggle: () => void;
  disabled: boolean;
  template: SiteTemplate;
  /** Dodanie sekcji na KOŃCU strony (paleta nie zna pozycji). */
  onAddSection: (type: SectionType) => void;
  onSaveTemplate: (template: SiteTemplate) => void;
}) {
  const t = useTranslations("site");
  const [tab, setTab] = useState<PaletteTab>("sections");
  const [choice, setChoice] = useState<SiteTemplate>(template);
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
          <SectionTypeGallery columns="single" disabled={disabled} onAdd={onAddSection} />
        </div>
      ) : (
        <div
          role="tabpanel"
          id={`${idPrefix}-panel-elements`}
          aria-labelledby={`${idPrefix}-tab-elements`}
          data-palette-elements-soon
          className="border-border flex flex-col gap-2 rounded-lg border border-dashed p-4"
        >
          <p className="text-sm font-medium">{t("builder.elementsSoonTitle")}</p>
          <p className="text-muted-foreground text-[13px] leading-[18px]">{t("builder.elementsSoonBody")}</p>
        </div>
      )}

      <div data-builder-template className="border-border mt-auto flex flex-col gap-2 border-t pt-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-sm font-medium">{t("template.legend")}</legend>
          {SITE_TEMPLATES.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="template"
                value={option}
                checked={choice === option}
                disabled={disabled}
                onChange={() => setChoice(option)}
              />
              {t(`template.template_${option}`)}
            </label>
          ))}
        </fieldset>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={disabled}
          disabled={disabled}
          onClick={() => onSaveTemplate(choice)}
        >
          {t("template.save")}
        </Button>
      </div>
    </aside>
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
