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
import type { ResolvedSiteStyle } from "@avably/core/site";
import { SiteChrome } from "@avably/ui";
import type { ReactNode } from "react";

import { StoreHeader } from "@/components/storefront/store-header";
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
  className,
  children,
}: {
  style: ResolvedSiteStyle;
  copy: StorefrontCopy;
  storeName: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // `min-h-screen` na KORZENIU, a nie na treści: powierzchnia motywu ma
    // sięgać dołu okna, inaczej pod krótką stroną (pusty koszyk) prześwituje
    // tło aplikacji i sklep kończy się w połowie ekranu.
    <SiteChrome style={style} className={className ? `min-h-screen ${className}` : "min-h-screen"}>
      <StoreHeader copy={copy} storeName={storeName} />
      {children}
    </SiteChrome>
  );
}
