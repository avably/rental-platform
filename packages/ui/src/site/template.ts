import type { SiteTemplate } from "./types";

/**
 * Tokeny wizualne szablonu storefrontu. Dwa szablony (`classic`, `bold`) to dwa
 * zestawy klas dla tych samych komponentów sekcji — komponent renderuje raz,
 * a wygląd wynika z wybranego zestawu. Dzięki temu podgląd w panelu i sklep
 * publiczny są renderowane TYM SAMYM kodem; różni je tylko przekazany szablon.
 *
 * `classic` — powściągliwy, serif w nagłówkach, jasny „papier”, dużo światła.
 * `bold` — wysoki kontrast, ciemny hero, wielka typografia sans, mocny akcent.
 *
 * RESPONSYWNOŚĆ IDZIE PO KONTENERZE, NIE PO OKNIE (ADR-085). Zamiast `sm:`
 * i `lg:` (media queries — szerokość OKNA) sekcje używają wariantów
 * kontenerowych `@min-[40rem]/site:` i `@min-[64rem]/site:`, celujących
 * w kontener `site` z korzenia `SiteRenderer`. Progi są DOKŁADNIE te same
 * liczby, co dotychczasowe breakpointy Tailwinda (`sm` = 40rem, `lg` = 64rem),
 * więc sklep na realnych szerokościach układa się jak przedtem — ale płótno
 * kreatora zwężone do 390 px dostaje wreszcie układ telefonu, a nie desktopowy
 * ściśnięty do 390 px. Progi zapisane są JAWNIE (`40rem`/`64rem`), a nie
 * nazwanym rozmiarem kontenera z motywu: liczba, która musi zostać zgodna
 * z `sm:`/`lg:`, ma stać w klasie, a nie w słowniku obok.
 *
 * Siatki NIE dają więcej niż 2 kolumny poniżej 40rem (decyzja właściciela
 * 2026-08-01: produkty na telefonie w dwóch kolumnach). Pilnuje tego
 * `site-container-contract.test.ts`, razem z zakazem `sm:`/`lg:` i `vw`.
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
  /** Kafel bloku (opinia, pozycja dostawy) — lżejszy niż karta produktu (0043). */
  subtleCard: string;
  /** Baner sekcji CTA — mocny akcent tła, ustawia kolor tekstu potomków (0043). */
  ctaBanner: string;
  /** Kafelek ikony w sekcji USP (0043). */
  iconTile: string;
  /**
   * Pas ODWRÓCONY płótna v2 (K2, ADR-084) — SAM kolor, bez odstępów: wysokość
   * sekcji v2 niesie geometria płótna, nie padding. Dlatego osobny wpis, a nie
   * `sectionInverted` (ten dokłada `py-*`, które w sekcji o zadanej wysokości
   * przesuwałoby całą zawartość względem współrzędnych).
   */
  canvasInverted: string;
}

const CLASSIC: TemplateStyles = {
  // Tekst strony to `--foreground`, NIE `--landing-ink`. `--landing-ink` jest
  // kolorem PASA ciemnego (tło `.landing-dark-section`) i w motywie ciemnym
  // celowo równa się `--secondary` — użyty jako kolor tekstu dawał niemal
  // niewidoczny napis na tle strony (kontrast ~1,2:1). W motywie jasnym obie
  // wartości są tożsame, więc render sklepu nie zmienia się ani o piksel.
  page: "bg-[var(--landing-paper)] text-foreground",
  section: "py-16 @min-[40rem]/site:py-20",
  sectionInverted: "py-16 @min-[40rem]/site:py-20 landing-dark-section",
  container: "mx-auto w-full max-w-4xl px-6",
  eyebrow: "text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground",
  sectionHeading: "landing-heading mt-3 break-words",
  lead: "mt-4 max-w-2xl text-lg text-muted-foreground",
  heroSection: "py-24 @min-[40rem]/site:py-32",
  heroHeading: "landing-display break-words",
  heroSubheading: "mt-6 max-w-2xl text-xl text-muted-foreground",
  cta: "mt-8 inline-flex items-center rounded-full border border-current px-6 py-3 text-sm font-medium transition-colors hover:bg-foreground hover:text-[var(--background)]",
  card: "flex flex-col overflow-hidden rounded-lg border bg-card",
  cardTitle: "text-lg font-medium tracking-tight",
  cardPrice: "mt-1 text-sm text-muted-foreground",
  productGrid: "mt-10 grid grid-cols-2 gap-4 @min-[40rem]/site:gap-6 @min-[64rem]/site:grid-cols-3",
  faqItem: "border-b py-4",
  faqQuestion: "cursor-pointer list-none text-lg font-medium",
  subtleCard: "flex flex-col rounded-lg border bg-card p-6",
  ctaBanner: "flex flex-col items-center rounded-xl border bg-[var(--landing-paper)] px-6 py-12 text-center text-foreground",
  iconTile: "flex size-11 items-center justify-center rounded-lg border text-foreground",
  canvasInverted: "landing-dark-section",
};

const BOLD: TemplateStyles = {
  page: "bg-background text-foreground",
  section: "py-20 @min-[40rem]/site:py-28",
  sectionInverted: "py-20 @min-[40rem]/site:py-28 bg-foreground text-background",
  container: "mx-auto w-full max-w-5xl px-6",
  eyebrow: "text-sm font-bold uppercase tracking-[0.25em] text-primary",
  sectionHeading: "mt-4 text-4xl font-extrabold tracking-tight break-words @min-[40rem]/site:text-5xl",
  lead: "mt-5 max-w-2xl text-lg text-muted-foreground",
  heroSection: "bg-foreground text-background py-28 @min-[40rem]/site:py-40",
  heroHeading: "text-5xl font-extrabold tracking-tight break-words @min-[40rem]/site:text-7xl",
  heroSubheading: "mt-6 max-w-2xl text-xl opacity-80",
  cta: "mt-10 inline-flex items-center rounded-md bg-primary px-8 py-4 text-base font-bold text-[var(--background)] transition-transform hover:scale-[1.03]",
  card: "flex flex-col overflow-hidden rounded-xl border-2 bg-card",
  cardTitle: "text-xl font-bold tracking-tight",
  cardPrice: "mt-1 text-base font-semibold text-primary",
  productGrid: "mt-12 grid grid-cols-2 gap-4 @min-[40rem]/site:gap-8 @min-[64rem]/site:grid-cols-3",
  faqItem: "rounded-lg border-2 px-5 py-4",
  faqQuestion: "cursor-pointer list-none text-lg font-bold",
  subtleCard: "flex flex-col rounded-xl border-2 bg-card p-6",
  ctaBanner: "flex flex-col items-center rounded-2xl bg-foreground px-6 py-14 text-center text-background",
  iconTile: "flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary",
  canvasInverted: "bg-foreground text-background",
};

const STYLES: Record<SiteTemplate, TemplateStyles> = {
  classic: CLASSIC,
  bold: BOLD,
};

export function getTemplateStyles(template: SiteTemplate): TemplateStyles {
  return STYLES[template] ?? CLASSIC;
}
