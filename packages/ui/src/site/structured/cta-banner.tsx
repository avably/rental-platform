import type { CtaStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import { bindOrphans } from "../orphans";
import type { TemplateStyles } from "../template";
import { CtaButtons, ctaSurfaceOf } from "./cta-shared";
import { StructuredSectionShell } from "./shell";

/**
 * WEZWANIE — UKŁAD „BANER" (E7, aneks ADR-094).
 *
 * Wszystko wyśrodkowane, przyciski pod tekstem. Sekcja jest PRZYSTANKIEM:
 * strona zatrzymuje się i pyta, więc nic obok nie konkuruje o wzrok.
 *
 * Powierzchnia (bez panelu / karta / wypełnienie akcentem) idzie z WARIANTU
 * treści, a nie z klasy szablonu — to jest cała różnica wobec banera sprzed v3,
 * który był odwrócony zawsze i w każdym motywie.
 */
export function StructuredCtaBanner({
  content,
  styles,
}: {
  content: CtaStructuredContent;
  styles: TemplateStyles;
}) {
  const surface = ctaSurfaceOf(content.variant);
  return (
    <StructuredSectionShell
      type="cta"
      layout="banner"
      background={content.background}
      styles={styles}
    >
      <div
        data-cta-panel={content.variant}
        className={cn("flex flex-col items-center gap-4 text-center", surface.panel)}
      >
        {/*
          Nagłówek sekcji NIE idzie przez powłokę: w banerze stoi wewnątrz
          panelu, bo to panel jest tu sekcją. Powłoka rysuje go nad treścią —
          na wariancie akcentowym wypadłby poza wypełnienie i wziąłby kolor
          pasa zamiast koloru etykiety.
        */}
        {content.heading ? (
          <h2 data-cta-heading className={cn(styles.sectionHeading, "mt-0")}>
            {bindOrphans(content.heading)}
          </h2>
        ) : null}
        {content.text ? (
          <p data-cta-text className={cn("max-w-2xl", surface.text)}>
            {bindOrphans(content.text)}
          </p>
        ) : null}
        <CtaButtons content={content} className="justify-center" />
      </div>
    </StructuredSectionShell>
  );
}
