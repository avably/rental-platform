/**
 * KLASY SEKCJI — JEDEN ZESTAW NA WSZYSTKIE MOTYWY (K5, ADR-090).
 *
 * ==================== CO ZNIKŁO I DLACZEGO ====================
 *
 * Do K5 stały tu DWIE tablice klas (`classic`, `bold`) i komponent dostawał
 * jedną z nich. Wyglądem strony rządził więc KOD: „szablon" był zestawem klas
 * Tailwinda, a każdy nowy świat wizualny znaczył trzecią tablicę, potem
 * czwartą — przy piętnastu motywach z briefu byłoby to piętnaście kopii tych
 * samych trzydziestu pól, z których każda mogła się rozjechać osobno.
 *
 * Odtąd tablica jest JEDNA, a różnice niosą ZMIENNE CSS wystawione przez motyw
 * (`@avably/core/site` → `styleTokensFor`). Klasy mówią, CZYM element jest
 * („to jest karta", „to jest przycisk pierwszorzędny"), a nie jak wygląda.
 * Dopisanie motywu nr 7 nie dotyka więc tego pliku ANI RAZU — i to jest cały
 * warunek postawiony przez właściciela.
 *
 * ==================== ANI JEDNEGO TOKENU APLIKACJI ====================
 *
 * W tym pliku nie ma prawa stać `bg-card`, `text-muted-foreground` ani
 * `bg-foreground`. To są kolory PANELU: strona najemcy dziedziczyła je bez
 * pytania, więc wyglądała jak panel i zmieniała się razem z nim. Wszystkie
 * powierzchnie i kolory tekstu idą przez `--site-*`, których wartości ustawia
 * arkusz per PAS (site.css), a wartości pasów wystawia render z rejestru
 * motywów. Pilnuje tego kontrakt `site-style.test.tsx` — klasa motywu
 * aplikacji w tej tablicy jest czerwona.
 *
 * RESPONSYWNOŚĆ IDZIE PO KONTENERZE, NIE PO OKNIE (ADR-085). Zamiast `sm:`
 * i `lg:` (media queries — szerokość OKNA) sekcje używają wariantów
 * kontenerowych `@min-[40rem]/site:` i `@min-[64rem]/site:`, celujących
 * w kontener `site` z korzenia `SiteRenderer`. Progi są DOKŁADNIE te same
 * liczby, co dotychczasowe breakpointy Tailwinda, więc sklep na realnych
 * szerokościach układa się jak przedtem — ale płótno kreatora zwężone do
 * 390 px dostaje układ telefonu, a nie desktopowy ściśnięty do 390 px.
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
  /** Wariant sekcji na pasie odwróconym (używany przez hero sekcji v1). */
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
  /** Stopka strony: owijka `<footer>` (odstępy) — K6, ADR-092. */
  footer: string;
  /** Stopka: pas treści z kreską odcinającą ją od reszty strony. */
  footerInner: string;
  /** Stopka: nazwa firmy. */
  footerName: string;
  /** Stopka: link pomocniczy (regulamin, polityka, kotwica). */
  footerLink: string;
  /**
   * Pas ODWRÓCONY płótna v2 (K2, ADR-084) — SAM kolor, bez odstępów: wysokość
   * sekcji v2 niesie geometria płótna, nie padding.
   */
  canvasInverted: string;
}

/**
 * KLASA PRZYCISKU PIERWSZORZĘDNEGO. Wypełnienie (`solid`/`outline`) jest
 * decyzją MOTYWU, a motyw jest danymi — więc przełącznikiem nie może być kod
 * komponentu. Rozstrzyga arkusz przez atrybut `data-site-button` na korzeniu
 * strony (site.css); tutaj stoi sam kształt i odstępy, wspólne dla obu.
 */
const STYLES: TemplateStyles = {
  page: "site-surface",
  section: "py-16 @min-[40rem]/site:py-20",
  sectionInverted: "py-16 @min-[40rem]/site:py-20 site-band-inverted",
  container: "mx-auto w-full max-w-5xl px-6",
  eyebrow: "site-eyebrow site-text-muted",
  sectionHeading: "landing-heading mt-3 break-words",
  lead: "mt-4 max-w-2xl text-lg site-text-muted",
  heroSection: "py-24 @min-[40rem]/site:py-32",
  heroHeading: "landing-display break-words",
  heroSubheading: "mt-6 max-w-2xl text-xl site-text-muted",
  cta: "site-cta mt-8 inline-flex items-center",
  card: "site-card flex flex-col overflow-hidden",
  cardTitle: "site-title text-lg tracking-tight",
  cardPrice: "mt-1 text-sm site-text-accent site-numeric",
  // LICZBĘ KOLUMN niesie arkusz (`.site-product-columns` w site.css), nie
  // utility: progi stoją w JEDNYM miejscu (PRODUCT_GRID_STEPS, lustro pilnowane
  // przez product-grid.test.ts), więc decyzja K1 o kolumnie na telefonie będzie
  // jedną zmianą, a nie polowaniem na `grid-cols-2` po plikach.
  productGrid: "mt-10 grid site-product-columns gap-4 @min-[40rem]/site:gap-6",
  faqItem: "site-rule py-4",
  faqQuestion: "site-title cursor-pointer list-none text-lg",
  subtleCard: "site-card flex flex-col p-6",
  ctaBanner: "site-banner site-band-inverted flex flex-col items-center px-6 py-12 text-center",
  // Alfa 10 % musi zgadzać się z bramką kontrastu (`ICON_TILE_ALPHA`), która
  // liczy kafelek jako MIESZANINĘ akcentu z pasem pod spodem.
  iconTile: "site-icon-tile flex size-11 items-center justify-center site-text-accent",
  footer: "site-footer pb-12 pt-6",
  footerInner: "site-rule-top pt-10",
  footerName: "site-title text-lg",
  footerLink: "site-link",
  canvasInverted: "site-band-inverted",
};

/**
 * Klasy sekcji. Argumentu nie ma i nie będzie: wygląd wynika ze zmiennych
 * motywu na korzeniu strony, a nie z tego, który motyw jest wybrany — dzięki
 * temu ten moduł nie musi znać rejestru motywów ani rosnąć razem z nim.
 */
export function siteStyles(): TemplateStyles {
  return STYLES;
}
