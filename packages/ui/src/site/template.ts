import type { SiteTemplate } from "./types";

/**
 * Tokeny wizualne szablonu storefrontu. Dwa szablony (`classic`, `bold`) to dwa
 * zestawy klas dla tych samych komponentów sekcji — komponent renderuje raz,
 * a wygląd wynika z wybranego zestawu. Dzięki temu podgląd w panelu i sklep
 * publiczny są renderowane TYM SAMYM kodem; różni je tylko przekazany szablon.
 *
 * `classic` — powściągliwy, serif w nagłówkach, jasny „papier”, dużo światła.
 * `bold` — wysoki kontrast, ciemny hero, wielka typografia sans, mocny akcent.
 */
export interface TemplateStyles {
  /** Zewnętrzna powłoka strony. */
  page: string;
  /** Owijka pojedynczej sekcji (odstępy pionowe). */
  section: string;
  /** Wariant sekcji na ciemnym tle (używany przez hero w `bold`). */
  sectionInverted: string;
  /** Kontener centrujący treść z maksymalną szerokością. */
  container: string;
  /** Mała etykieta „eyebrow” nad nagłówkiem. */
  eyebrow: string;
  /** Nagłówek sekcji (h2). */
  sectionHeading: string;
  /** Wprowadzenie/lead pod nagłówkiem. */
  lead: string;
  /** Hero: nagłówek (h1). */
  heroHeading: string;
  /** Hero: podtytuł. */
  heroSubheading: string;
  /** Hero: owijka sekcji hero (tło/wysokość). */
  heroSection: string;
  /** Przycisk CTA (akcent). */
  cta: string;
  /** Karta produktu. */
  card: string;
  /** Tytuł karty produktu. */
  cardTitle: string;
  /** Cena na karcie produktu. */
  cardPrice: string;
  /** Siatka produktów. */
  productGrid: string;
  /** Pozycja FAQ (details). */
  faqItem: string;
  /** Pytanie FAQ (summary). */
  faqQuestion: string;
}

const CLASSIC: TemplateStyles = {
  page: "bg-[var(--landing-paper)] text-[var(--landing-ink)]",
  section: "py-16 sm:py-20",
  sectionInverted: "py-16 sm:py-20 landing-dark-section",
  container: "mx-auto w-full max-w-4xl px-6",
  eyebrow: "text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground",
  sectionHeading: "landing-heading mt-3",
  lead: "mt-4 max-w-2xl text-lg text-muted-foreground",
  heroSection: "py-24 sm:py-32",
  heroHeading: "landing-display",
  heroSubheading: "mt-6 max-w-2xl text-xl text-muted-foreground",
  cta: "mt-8 inline-flex items-center rounded-full border border-current px-6 py-3 text-sm font-medium transition-colors hover:bg-foreground hover:text-[var(--background)]",
  card: "flex flex-col overflow-hidden rounded-lg border bg-card",
  cardTitle: "text-lg font-medium tracking-tight",
  cardPrice: "mt-1 text-sm text-muted-foreground",
  productGrid: "mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3",
  faqItem: "border-b py-4",
  faqQuestion: "cursor-pointer list-none text-lg font-medium",
};

const BOLD: TemplateStyles = {
  page: "bg-background text-foreground",
  section: "py-20 sm:py-28",
  sectionInverted: "py-20 sm:py-28 bg-foreground text-background",
  container: "mx-auto w-full max-w-5xl px-6",
  eyebrow: "text-sm font-bold uppercase tracking-[0.25em] text-primary",
  sectionHeading: "mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl",
  lead: "mt-5 max-w-2xl text-lg text-muted-foreground",
  heroSection: "bg-foreground text-background py-28 sm:py-40",
  heroHeading: "text-5xl font-extrabold tracking-tight sm:text-7xl",
  heroSubheading: "mt-6 max-w-2xl text-xl opacity-80",
  cta: "mt-10 inline-flex items-center rounded-md bg-primary px-8 py-4 text-base font-bold text-[var(--background)] shadow-lg transition-transform hover:scale-[1.03]",
  card: "flex flex-col overflow-hidden rounded-xl border-2 bg-card shadow-sm transition-shadow hover:shadow-md",
  cardTitle: "text-xl font-bold tracking-tight",
  cardPrice: "mt-1 text-base font-semibold text-primary",
  productGrid: "mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3",
  faqItem: "rounded-lg border-2 px-5 py-4",
  faqQuestion: "cursor-pointer list-none text-lg font-bold",
};

const STYLES: Record<SiteTemplate, TemplateStyles> = {
  classic: CLASSIC,
  bold: BOLD,
};

export function getTemplateStyles(template: SiteTemplate): TemplateStyles {
  return STYLES[template] ?? CLASSIC;
}
