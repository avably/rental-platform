import type { CtaStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import { CtaButtons, ctaSurfaceOf } from "./cta-shared";
import { StructuredSectionShell } from "./shell";

/**
 * WEZWANIE — UKŁAD „DZIELONY" (E7, aneks ADR-094).
 *
 * Tekst po lewej, przyciski po prawej. Sekcja jest PASEM domykającym stronę
 * i nie zabiera całego ekranu — wariant dla stron, na których wezwanie stoi
 * między dwiema sekcjami treści, a nie zamiast nich.
 *
 * Poniżej progu kontenera schodzi w jedną kolumnę, czyli w to samo, co baner:
 * na 390 px „obok siebie" znaczy dwie kolumny po 170 px, a w nich przycisk
 * łamie się na trzy wiersze. Próg jest ten sam (40 rem), którym reszta sekcji
 * odróżnia telefon od strony.
 */
export function StructuredCtaSplit({
  content,
  styles,
}: {
  content: CtaStructuredContent;
  styles: TemplateStyles;
}) {
  const surface = ctaSurfaceOf(content.variant);
  return (
    <StructuredSectionShell type="cta" layout="split" background={content.background} styles={styles}>
      <div
        data-cta-panel={content.variant}
        className={cn(
          "flex flex-col gap-6 @min-[40rem]/site:flex-row @min-[40rem]/site:items-center @min-[40rem]/site:justify-between",
          surface.panel,
        )}
      >
        {/* `min-w-0` — bez niego długie zdanie rozpycha kolumnę tekstu i spycha
            przyciski poza kontener zamiast je złamać. */}
        <div className="flex min-w-0 flex-col gap-3">
          {content.heading ? (
            <h2 data-cta-heading className={cn(styles.sectionHeading, "mt-0")}>
              {content.heading}
            </h2>
          ) : null}
          {content.text ? (
            <p data-cta-text className={cn("max-w-2xl", surface.text)}>
              {content.text}
            </p>
          ) : null}
        </div>
        <CtaButtons content={content} className="shrink-0" />
      </div>
    </StructuredSectionShell>
  );
}
