import type { DirectionsStructuredContent } from "@avably/core/site";

import type { TemplateStyles } from "../template";
import type { SiteRenderLabels } from "../types";
import { DirectionsMapPanel } from "./directions-map";
import { DirectionsCards } from "./directions-shared";
import { StructuredSectionShell } from "./shell";

/**
 * DOJAZD — UKŁAD „ADRESY OBOK MAPY" (E5, ADR-096).
 *
 * Adresy po lewej, mapa po prawej: obie rzeczy widoczne naraz, więc kto zna
 * miasto, czyta adres, a kto nie zna — otwiera mapę bez przewijania. Ten sam
 * `items`, ta sama mechanika mapy; różnica jest WYŁĄCZNIE w kontenerze.
 *
 * DRUGA KOLUMNA DOPIERO OD 48 rem SZEROKOŚCI SEKCJI (`@min-[48rem]/site`,
 * ADR-085), a nie szerokości okna — poniżej progu układ schodzi do kolumny,
 * czyli do dokładnie tego, co robi wariant `stacked`. To jest w porządku:
 * wariant wybiera się dla ekranu, na którym jest miejsce.
 */
export function StructuredDirectionsSplit({
  content,
  styles,
  labels,
  mapEmbed,
}: {
  content: DirectionsStructuredContent;
  styles: TemplateStyles;
  labels: SiteRenderLabels;
  mapEmbed?: boolean;
}) {
  return (
    <StructuredSectionShell
      type="directions"
      layout="split"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <div className="mt-8 grid items-start gap-8 @min-[48rem]/site:grid-cols-2">
        <DirectionsCards items={content.items} labels={labels} className="flex flex-col gap-4" />
        <DirectionsMapPanel content={content} labels={labels} mapEmbed={mapEmbed} />
      </div>
    </StructuredSectionShell>
  );
}
