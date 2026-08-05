import type { DirectionsStructuredContent } from "@avably/core/site";

import type { TemplateStyles } from "../template";
import type { SiteRenderLabels } from "../types";
import { DirectionsMapPanel } from "./directions-map";
import { DirectionsCards } from "./directions-shared";
import { StructuredSectionShell } from "./shell";

/**
 * DOJAZD — UKŁAD „ADRESY, POD NIMI MAPA" (E5, ADR-096).
 *
 * Adresy w rzędzie kart, mapa pod nimi na PEŁNEJ szerokości sekcji. To jest
 * układ domyślny z dwóch powodów: czyta się tak samo na telefonie i na
 * monitorze, a mapa — jedyny element tej sekcji, który realnie potrzebuje
 * miejsca — dostaje go tyle, ile ma strona.
 *
 * Karty schodzą do jednej kolumny poniżej 48 rem SZEROKOŚCI SEKCJI (zapytanie
 * kontenerowe `@min-[48rem]/site`, ADR-085), a nie szerokości okna: na płótnie
 * kreatora zwężonym do 390 px sekcja ma zachowywać się jak na telefonie, bo po
 * to płótno jest podglądem.
 */
export function StructuredDirectionsStacked({
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
      layout="stacked"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <div className="mt-8 flex flex-col gap-8">
        <DirectionsCards
          items={content.items}
          labels={labels}
          className="grid gap-4 @min-[48rem]/site:grid-cols-2"
        />
        <DirectionsMapPanel content={content} labels={labels} mapEmbed={mapEmbed} />
      </div>
    </StructuredSectionShell>
  );
}
