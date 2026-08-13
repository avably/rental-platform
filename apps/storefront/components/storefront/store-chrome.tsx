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
import { SiteChrome, StoreShellFooter } from "@avably/ui";
import type { ReactNode } from "react";

import { StoreHeader } from "@/components/storefront/store-header";
import { shellSections, withAnchorBase } from "@/lib/site/page-sections";
import type { StoreLogo } from "@/lib/site/store-logo";
import type { StorefrontCopy } from "@/lib/storefront/copy";

/**
 * NAGŁÓWEK CHROME SKLEPU — stała mieszka od ADR-172 w pakiecie UI, razem
 * z kształtem powłoki, którą składa teraz zarówno sklep, jak i podgląd szkicu
 * w panelu. Re-eksport zostaje, bo trasy sklepu piszą nim nazwę najemcy na
 * ekranie „sklep w budowie" — i nie mają powodu wiedzieć, gdzie ta klasa żyje.
 */
export { SITE_HEADING } from "@avably/ui";

export function StoreChrome({
  style,
  copy,
  storeName,
  site,
  logo,
  siteImageBase,
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
   * ZNAK FIRMY NAJEMCY — WYMAGANY z tego samego powodu, co `site` (ADR-160).
   *
   * `null` jest legalną wartością i znaczy „najemca nie ma znaku" (albo nie
   * opublikował go jeszcze) — sklep wygląda wtedy dokładnie tak, jak wyglądał.
   * Brak PROPSU legalny nie jest: nowa trasa sklepu, która by go pominęła,
   * gasiłaby logo na jednej podstronie i na żadnej innej, bez ani jednego
   * błędu w konsoli. Wymagany props zamienia to przeoczenie w błąd typów.
   *
   * Gotowy adres i gotowy `alt` liczy `storeLogo` — powłoka nie zna ani
   * ścieżki w Storage, ani reguły wyboru tekstu zastępczego.
   */
  logo: StoreLogo | null;
  /**
   * PREFIKS PUBLICZNEGO URL-a ZDJĘĆ SEKCJI — WYMAGANY (ADR-172).
   *
   * Powłoka rysuje stopkę tym samym rendererem, co trasa katalogu, a element
   * obrazu na płótnie bez tego prefiksu rysuje się jako SZARY KAFEL ZASTĘPCZY
   * — na każdej trasie i bez jednego błędu w konsoli. Do ADR-172 powłoka
   * propsu nie podawała wcale; wada była uśpiona wyłącznie dlatego, że żadna
   * stopka najemcy nie miała jeszcze elementu obrazu. Wymagany props zamienia
   * to przeoczenie w błąd typów — tak samo jak `site` i `logo` wyżej.
   */
  siteImageBase: string;
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
      <StoreHeader copy={copy} storeName={storeName} logo={logo} />
      {children}
      {/*
        STOPKA POWŁOKI (faza 0, ADR-154) — od ADR-172 składa ją pakiet UI, ten
        sam, który składa ją w podglądzie szkicu. Sklep rozstrzyga tu dwie
        rzeczy, których pakiet znać nie ma prawa: PRZEŁĄCZNIK NAJEMCY „pokaż
        znak także w stopce" (ADR-160 — drugiego wgrania pod stopkę nie ma)
        i PREFIKS ZDJĘĆ, bez którego obraz w stopce byłby szarym kaflem.
      */}
      <StoreShellFooter
        sections={shellFooter}
        style={style}
        logo={logo?.inFooter ? logo : null}
        siteImageBase={siteImageBase}
      />
    </SiteChrome>
  );
}
