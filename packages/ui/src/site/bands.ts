import type { SectionBackground } from "@avably/core/site";

import type { TemplateStyles } from "./template";

/**
 * PAS MOTYWU SEKCJI — jedno przełożenie `background` → klasa arkusza na cały
 * render strony (ADR-090).
 *
 * Wydzielone w E1 (ADR-094), bo od tej chwili pytają o to DWA silniki treści:
 * płótno v2 (`SectionCanvasRenderer`) i sekcje strukturalne v3. Dwie kopie tego
 * `if`-a znaczyłyby, że pas dodany do modelu treści działa w jednym silniku
 * i nie działa w drugim — a widać to dopiero na stronie klienta.
 *
 * `default` nie ma klasy świadomie: zmienne pasa domyślnego siedzą już na
 * korzeniu strony (`site-root`), więc dokładanie ich drugi raz byłoby szumem.
 */
export function sectionBandClass(
  background: SectionBackground,
  styles: TemplateStyles,
): string | undefined {
  if (background === "muted") return "site-band-muted";
  if (background === "inverted") return styles.canvasInverted;
  return undefined;
}
