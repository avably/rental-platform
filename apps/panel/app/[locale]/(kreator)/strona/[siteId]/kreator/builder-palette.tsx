"use client";

/**
 * LEWA PALETA KREATORA (K1, ADR-083) — dwie zakładki i stopka szablonu.
 *
 * „Sekcje" jest od E2 WEJŚCIEM DO PICKERA z kontekstem „na końcu strony", a nie
 * drugą listą typów. Powody są dwa. Po pierwsze, decyzja właściciela z grilla
 * planu „Sekcje 2.0" wycięła przeciąganie sekcji z palety — kafel przestał więc
 * mieć drugą drogę i został zwykłym przyciskiem. Po drugie, typ sekcji wybiera
 * się odtąd Z PODGLĄDEM (`section-picker.tsx`); lista bez podglądów obok listy
 * z podglądami byłaby dwoma miejscami wyboru tego samego, z których jedno mówi
 * mniej.
 *
 * „Elementy" (K3, ADR-086) to kafle przeciągane NA sekcję albo dokładane
 * kliknięciem — patrz `element-palette.tsx`. Ta zakładka zostaje BEZ ZMIAN:
 * element ma współrzędne, więc jego przeciąganie odpowiada na pytanie, na które
 * klik nie odpowiada. Do K2 zakładka była jawną zapowiedzią; teraz jest paletą.
 *
 * STYL STRONY siedzi w STOPCE palety (K5, ADR-090). Przełącznik „szablon
 * graficzny" (classic/bold) ZNIKŁ stąd decyzją właściciela: szablon nie jest
 * już skórką, tylko ŚWIATEM wizualnym wybieranym razem z gotową stroną
 * w galerii szablonów. W palecie zostaje to, co jest personalizacją W RAMACH
 * tego świata — akcent z palety motywu i para krojów. Obie zmiany idą do
 * SZKICU stylu i wchodzą na żywą stronę dopiero publikacją.
 */
import { type PaletteElementKind, type ResolvedSiteStyle } from "@avably/core/site";
import { Button } from "@avably/ui";
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { ElementPalette } from "./element-palette";
// STYL STRONY (akcent + para krojów) mieszka w osobnym liściu (ADR-230), bo
// reużywa go też ekran „Wygląd sklepu"; tu jest wpięty w stopkę palety.
import { StylePanel } from "./builder-style-panel";

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
  onSaveStyle,
}: {
  open: boolean;
  onToggle: () => void;
  disabled: boolean;
  style: ResolvedSiteStyle;
  /** Otwarcie pickera z kontekstem „na końcu strony" (E2). */
  onAddSection: () => void;
  /** Dodanie ELEMENTU kliknięciem kafla (K3) — ląduje pod treścią sekcji. */
  onAddElement: (kind: PaletteElementKind) => void;
  /** Upuszczenie kafla na płótno — element ląduje POD KURSOREM (K3). */
  onDropElement: (kind: PaletteElementKind, pointer: { x: number; y: number }) => boolean;
  /** Ruch kafla ELEMENTU nad płótnem — wskaż sekcję, która go przyjmie (K6). */
  onDragElementOver: (pointer: { x: number; y: number }) => void;
  /** Koniec gestu kafla elementu — zdejmij wskazanie (K6). */
  onDragElementEnd: () => void;
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
          <Button
            type="button"
            variant="secondary"
            data-palette-add-section
            disabled={disabled}
            loading={disabled}
            onClick={onAddSection}
          >
            <Plus className="size-4" aria-hidden />
            {t("sections.add")}
          </Button>
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
