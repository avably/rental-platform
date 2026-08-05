import type { TestimonialsStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import { AUTO_LAYOUT_CLASS, autoLayoutStyle } from "./auto-layout";
import { StructuredSectionShell } from "./shell";
import { TestimonialCard } from "./testimonials-shared";

/**
 * OPINIE — UKŁAD „SIATKA" (E6, aneks ADR-094).
 *
 * Wszystkie opinie naraz. Liczba kolumn idzie od LICZBY OPINII (auto-układ,
 * patrz `auto-layout.ts`), więc jedna opinia dostaje pełną szerokość zamiast
 * jednej trzeciej i dwóch trzecich pustki obok, cztery stają w równych 2 + 2,
 * a siedem nie zostawia dziury w ostatnim rzędzie. To jest ta klasa wady,
 * którą E6 ma zamknąć: sekcja nie może wyglądać na niedokończoną dlatego, że
 * najemca wpisał nieparzystą liczbę wpisów.
 */
export function StructuredTestimonialsGrid({
  content,
  styles,
}: {
  content: TestimonialsStructuredContent;
  styles: TemplateStyles;
}) {
  return (
    <StructuredSectionShell
      type="testimonials"
      layout="grid"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <ul
        data-testimonials-grid
        className={cn("mt-8", AUTO_LAYOUT_CLASS)}
        style={autoLayoutStyle(content.items.length)}
      >
        {content.items.map((item, index) => (
          <li key={index} className="flex">
            <TestimonialCard item={item} data-testimonial={index} className="w-full" />
          </li>
        ))}
      </ul>
    </StructuredSectionShell>
  );
}
