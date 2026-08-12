/**
 * POWŁOKA CAŁEGO SKLEPU — JEDEN KORZEŃ STRONY NAJEMCY (K6, ADR-092).
 *
 * Do K6 nagłówek sklepu stał jako RODZEŃSTWO renderu strony, czyli POZA
 * `.site-root`. Zmienne motywu żyją na korzeniu, więc nagłówek ich nie widział
 * i brał paletę PANELU: na motywie ciemnym klient dostawał jasny pasek nad
 * czarną stroną, a wybrany szablon „urywał się" pod pierwszym pikselem treści.
 *
 * Powłoka odwraca tę zależność: korzeń jest NAJWYŻEJ, a nagłówek stoi w środku,
 * razem z sekcjami. Dzięki temu chrome sklepu (nagłówek, koszyk, kasa) czerpie
 * kolor z tych samych zmiennych, co strona — bez ani jednej reguły per motyw.
 *
 * Korzeń jest DOKŁADNIE JEDEN na dokument: trasa katalogu woła renderer sekcji
 * z `asRoot={false}`, bo korzeń wystawia już ta powłoka. Dwa korzenie znaczyłyby
 * dwa kontenery zapytań `site` i podwójnie liczoną szerokość responsywności.
 */
import type { PublishedSite, ResolvedSiteStyle } from "@avably/core/site";
import { SiteChrome, SiteRenderer } from "@avably/ui";
import type { ReactNode } from "react";

import { StoreHeader } from "@/components/storefront/store-header";
import { shellSections, withAnchorBase } from "@/lib/site/page-sections";
import type { StorefrontCopy } from "@/lib/storefront/copy";

/**
 * NAGŁÓWEK CHROME SKLEPU (h1/h2/legenda/nazwa sklepu).
 *
 * `.site-title` niesie w arkuszu samą WAGĘ — krój nagłówka arkusz nakłada
 * wyłącznie przez klasy skal sekcji (`.landing-*`, `.canvas-type-*`), bo tam
 * „nagłówek" jest już rozpoznany. Chrome sklepu żadnej z tych klas nie ma, więc
 * bez tej deklaracji „Koszyk" byłby pisany krojem tekstu ciągłego, a hero tuż
 * obok — krojem nagłówkowym z tej samej pary. Krój bierzemy ze ZMIENNEJ motywu,
 * nie z nazwy rodziny: para krojów zostaje wyborem najemcy.
 */
export const SITE_HEADING = "site-title font-[family-name:var(--site-font-heading)]";

export function StoreChrome({
  style,
  copy,
  storeName,
  site,
  footerAnchorBase,
  revealNonce,
  className,
  children,
}: {
  style: ResolvedSiteStyle;
  copy: StorefrontCopy;
  storeName: string;
  /**
   * OPUBLIKOWANA STRONA NAJEMCY — WYMAGANA, nie opcjonalna (faza 0, ADR-154).
   *
   * Powłoka bierze z niej sekcje PRZYPIĘTE (stopkę). `null` jest legalną
   * wartością (sklep w budowie, tenant bez strony) i znaczy „nie ma czego
   * renderować"; brak PROPSU legalny nie jest — nowa trasa sklepu, która by go
   * pominęła, dostawała się z konstrukcji do stanu sprzed fazy 0: strona bez
   * stopki, bez jednego błędu w konsoli. Wymagany props zamienia to
   * przeoczenie w błąd typów.
   */
  site: PublishedSite | null;
  /**
   * PREFIKS KOTWIC STOPKI dla tras BEZ sekcji strony (patrz `withAnchorBase`).
   * Podaje go `PageShell` — jego użytkownicy to z definicji podstrony, na
   * których `#kontakt` nie ma celu. Trasa katalogu go NIE podaje, bo cele
   * kotwic stoją na niej.
   */
  footerAnchorBase?: string;
  /** Nonce CSP pod skrypt uzbrajający wejście sekcji (ADR-097). */
  revealNonce?: string;
  className?: string;
  children: ReactNode;
}) {
  const footer = shellSections(site);
  const shellFooter = footerAnchorBase ? withAnchorBase(footer, footerAnchorBase) : footer;

  return (
    // `min-h-screen` na KORZENIU, a nie na treści: powierzchnia motywu ma
    // sięgać dołu okna, inaczej pod krótką stroną (pusty koszyk) prześwituje
    // tło aplikacji i sklep kończy się w połowie ekranu.
    <SiteChrome
      style={style}
      revealNonce={revealNonce}
      className={className ? `min-h-screen ${className}` : "min-h-screen"}
    >
      <StoreHeader copy={copy} storeName={storeName} />
      {children}
      {/*
        STOPKA POWŁOKI (faza 0, ADR-154) — TEN SAM renderer i TA SAMA treść, co
        na stronie katalogu, tylko wywołany o piętro wyżej. Drugi renderer
        stopki znaczyłby drugie źródło prawdy o jej wyglądzie, a płótno kreatora
        przestałoby być dowodem na to, co zobaczy klient (ADR-083).

        `asRoot={false}`, bo korzeń wystawia `SiteChrome` wyżej — dwa korzenie
        to dwa kontenery zapytań `site` i podwójnie liczona szerokość (ADR-085).

        `anchors`, bo stopka niesie kotwicę `#stopka` z rejestru i jest w tym
        dokumencie JEDNA — dokładnie warunek, pod którym kotwice wolno włączyć.
      */}
      {shellFooter.length > 0 ? (
        <SiteRenderer sections={shellFooter} style={style} asRoot={false} anchors />
      ) : null}
    </SiteChrome>
  );
}
