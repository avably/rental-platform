import type { UspStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import { AUTO_LAYOUT_CLASS, autoLayoutStyle } from "./auto-layout";
import { StructuredSectionShell } from "./shell";
import { UspEntry } from "./usp-shared";

/**
 * ATUTY — UKŁAD „KARTY" (E7, aneks ADR-094).
 *
 * Każdy atut w karcie z obrysem: kafle są policzalne wzrokiem, a sekcja czyta
 * się jak zestawienie. Wariant dla stron, na których atuty są ARGUMENTEM, a nie
 * tłem.
 *
 * LICZBA KOLUMN IDZIE OD LICZBY ATUTÓW (auto-układ E6), a nie z kontrolki
 * w szufladzie: cztery atuty stają w 2 + 2 (a nie 3 + 1), jeden zajmuje pełną
 * szerokość, siedem nie zostawia pustej komórki w ostatnim rzędzie — bo rząd
 * wypełniają WPISY, a nie puste ślady po nieistniejących.
 */
export function StructuredUspCards({
  content,
  styles,
}: {
  content: UspStructuredContent;
  styles: TemplateStyles;
}) {
  return (
    <StructuredSectionShell
      type="usp"
      layout="cards"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <ul
        data-usp-cards
        className={cn("mt-8", AUTO_LAYOUT_CLASS)}
        style={autoLayoutStyle(content.items.length)}
      >
        {content.items.map((item, index) => (
          <UspEntry key={index} item={item} index={index} styles={styles} className="site-card p-5" />
        ))}
      </ul>
    </StructuredSectionShell>
  );
}
