import type { UspStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import { AUTO_LAYOUT_CLASS, autoLayoutStyle } from "./auto-layout";
import { StructuredSectionShell } from "./shell";
import { UspEntry } from "./usp-shared";

/**
 * ATUTY — UKŁAD „BEZ OBUDOWY" (E7, aneks ADR-094).
 *
 * Ta sama trójka (znak, tytuł, zdanie) bez karty i bez obrysu. Sekcja wtapia
 * się w stronę zamiast konkurować z tą, która NAPRAWDĘ jest zestawieniem —
 * cennik i sprzęt rysują karty, więc trzecia ściana kafli obok nich zamienia
 * stronę w tablicę ogłoszeń.
 *
 * Auto-układ i wypełnianie rzędu są wspólne z układem kart: reguła jest jedna,
 * a jej druga kopia mogłaby się rozjechać tylko w jedną stronę — gorszą.
 */
export function StructuredUspPlain({
  content,
  styles,
}: {
  content: UspStructuredContent;
  styles: TemplateStyles;
}) {
  return (
    <StructuredSectionShell
      type="usp"
      layout="plain"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <ul
        data-usp-plain
        className={cn("mt-8", AUTO_LAYOUT_CLASS)}
        style={autoLayoutStyle(content.items.length)}
      >
        {content.items.map((item, index) => (
          <UspEntry key={index} item={item} index={index} styles={styles} />
        ))}
      </ul>
    </StructuredSectionShell>
  );
}
