import type { CtaStructuredContent, CtaVariant } from "@avably/core/site";

import { cn } from "../../lib/cn";
import { externalLinkRel } from "../links";

/**
 * WARIANT POWIERZCHNI WEZWANIA — JEDNO PRZEŁOŻENIE NA KLASY (E7, aneks ADR-094).
 *
 * ==================== PINEZKA, KTÓRĄ TO ZAMYKA ====================
 *
 * Baner CTA sprzed v3 miał decyzję kolorystyczną wpisaną w klasę powłoki
 * (`styles.ctaBanner` = zawsze pas odwrócony), taką samą w każdym motywie —
 * stąd pinezka „złe kolory w każdym szablonie": strona o jasnej dyrekcji
 * dostawała pośrodku czarny prostokąt, którego nie zamawiała.
 *
 * ==================== DLACZEGO TABLICA, A NIE `if`-y W DWÓCH UKŁADACH ====================
 *
 * Wariantów jest trzy, układów dwa. Sześć rozgałęzień rozsypanych po dwóch
 * plikach znaczyłoby, że wariant `accent` bywa poprawny w banerze i zapomniany
 * w układzie dzielonym — a widać to dopiero na stronie klienta. Tablica jest
 * jedna i oba układy czytają ją tak samo, więc mutacja „wariant ignorowany"
 * pali OBA układy naraz.
 *
 * ==================== DLACZEGO NIE `site-text-muted` NA AKCENCIE ====================
 *
 * Tekst przygaszony bierze `--site-ink-muted`, czyli atrament PASA. Na panelu
 * wypełnionym akcentem pas jest pod spodem, a nie pod tekstem — więc ta klasa
 * malowałaby napis kolorem obliczonym dla innego tła. Rejestr motywów nie ma
 * tokenu „przygaszony na wypełnieniu" i nie dostanie go przy okazji sekcji CTA
 * (byłaby to zmiana ADR-090 przemycona pod typem treści). Zdanie na wariancie
 * akcentowym bierze więc PEŁNY kolor etykiety — a to jest para, której kontrast
 * macierz liczy jako `accentOnFill`.
 */
interface CtaSurface {
  /** Obudowa treści wezwania — pusto dla wariantu bez panelu. */
  panel: string;
  /** Zdanie pod nagłówkiem. */
  text: string;
  /** Przycisk pierwszorzędny. */
  button: string;
  /**
   * Przycisk drugorzędny. OSOBNY od pierwszorzędnego także w wariancie
   * akcentowym, bo `site-cta-secondary` maluje etykietę atramentem PASA
   * (`--site-ink`) — na wypełnieniu akcentu byłby to kolor policzony dla innego
   * tła, czyli dokładnie ta wada, którą wariant `accent` ma zamknąć.
   */
  secondary: string;
}

const CTA_SURFACES: Record<CtaVariant, CtaSurface> = {
  // Bez panelu: wezwanie stoi wprost na pasie sekcji (pas wybiera `background`).
  plain: {
    panel: "",
    text: "site-text-muted",
    button: "site-cta",
    secondary: "site-cta-secondary",
  },
  // Panel o powierzchni karty z obrysem ze zmiennej kreski.
  panel: {
    panel: "site-card p-8",
    text: "site-text-muted",
    button: "site-cta",
    secondary: "site-cta-secondary",
  },
  // Panel wypełniony akcentem; napis i oba przyciski w kolorze etykiety na tym
  // wypełnieniu (przycisk pierwszorzędny ma parę ODWRÓCONĄ, czyli ten sam
  // iloraz kontrastu, co etykieta na wypełnieniu).
  accent: {
    panel: "site-panel-accent p-8",
    text: "",
    button: "site-cta-on-accent",
    secondary: "site-cta-outline-on-accent",
  },
};

export function ctaSurfaceOf(variant: CtaVariant): CtaSurface {
  return CTA_SURFACES[variant];
}

/**
 * PRZYCISKI WEZWANIA. Pierwszy jest pierwszorzędny (wypełnienie), drugi —
 * obrysowy: dwa jednakowo krzyczące przyciski obok siebie nie mówią, który jest
 * ścieżką główną, więc odwiedzający nie klika żadnego.
 *
 * `rel` linków wychodzących liczy `externalLinkRel` — ta sama reguła, co przy
 * przycisku płótna i kaflu galerii.
 */
export function CtaButtons({
  content,
  className,
}: {
  content: CtaStructuredContent;
  className?: string;
}) {
  const surface = ctaSurfaceOf(content.variant);
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {content.items.map((button, index) => (
        <a
          key={index}
          data-cta-button={index}
          href={button.href}
          rel={externalLinkRel(button.href)}
          className={cn(
            "inline-flex items-center",
            index === 0 ? surface.button : surface.secondary,
          )}
        >
          {button.label}
        </a>
      ))}
    </div>
  );
}
