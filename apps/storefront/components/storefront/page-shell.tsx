/**
 * POWŁOKA PODSTRON SKLEPU (produkt, koszyk, checkout) — TEN SAM ŚWIAT, CO
 * KATALOG (K5 v2, ADR-090; korzeń wydzielony w K6, ADR-092).
 *
 * Do K5 powłoka nakładała klasy „szablonu graficznego" (classic/bold), więc
 * podstrony dziedziczyły tło i typografię z motywu APLIKACJI. Od ADR-090 strona
 * najemcy ma własny świat wizualny — i podstrony muszą w nim stać, inaczej
 * klient przechodzi z ciemnego, luksusowego katalogu na białą stronę produktu
 * i ma wrażenie, że wyszedł ze sklepu.
 *
 * Od K6 powłoka nie buduje korzenia sama — bierze go z `StoreChrome`, wspólnego
 * dla WSZYSTKICH tras sklepu, i przez to renderuje też NAGŁÓWEK. Wcześniej
 * nagłówek wołała każda trasa osobno, obok powłoki, czyli poza korzeniem:
 * jedyne miejsce w sklepie, do którego motyw nie sięgał. Trasa, która chce
 * nagłówek pod motywem, nie ma już czego zrobić źle — dostaje go z powłoki.
 */
import type { PublishedSite, ResolvedSiteStyle } from "@avably/core/site";
import { cn, SITE_CONTAINER } from "@avably/ui";
import type { ReactNode } from "react";

import { StoreChrome, type StoreTermInput } from "@/components/storefront/store-chrome";
import { HOME_PAGE_SLUG, pagePathFromSlug } from "@avably/core/site";
import type { CategoryNavItem } from "@/lib/catalog/category-nav";
import type { StoreLogo } from "@/lib/site/store-logo";
import type { StorefrontCopy } from "@/lib/storefront/copy";

export function PageShell({
  style,
  copy,
  storeName,
  site,
  logo,
  siteImageBase,
  term,
  categoryNav,
  currentPath,
  children,
  className,
}: {
  style: ResolvedSiteStyle;
  copy: StorefrontCopy;
  storeName: string;
  /**
   * Opublikowana strona — powłoka bierze z niej STOPKĘ (faza 0, ADR-154).
   * Wymagana z tego samego powodu, co w `StoreChrome`: podstrona, która by ją
   * pominęła, wracałaby do stanu „stopka urywa się poza katalogiem".
   */
  site: PublishedSite | null;
  /**
   * Znak firmy najemcy (ADR-160) — wymagany z tego samego powodu, co `site`:
   * podstrona, która by go pominęła, gasiłaby logo dokładnie na sobie.
   */
  logo: StoreLogo | null;
  /**
   * Prefiks publicznego URL-a zdjęć sekcji (ADR-172) — wymagany z tego samego
   * powodu, co `site` i `logo`: bez niego element obrazu w stopce rysuje się
   * jako szary kafel zastępczy, na tej jednej podstronie i na żadnej innej.
   */
  siteImageBase: string;
  /**
   * TERMIN NAJMU (faza 5, ADR-179) — przekazywany dalej do powłoki. Wymagany
   * z tego samego powodu, co `site`, `logo` i `siteImageBase` wyżej: podstrona,
   * która by go pominęła, gasiłaby pasek terminu dokładnie na sobie.
   *
   * `null` na trasach, które NIE SPRZEDAJĄ: płatność, jej status, dokumenty.
   */
  term: StoreTermInput | null;
  /**
   * MENU KATEGORII (S-30 audytu 2026-08-25, na bazie ADR-247/266) — te same
   * pozycje wejść do stron kategorii, które nagłówek pokazuje na stronie
   * głównej i katalogu. Do S-30 podstrony nie podawały nic i poza katalogiem
   * nagłówek nie miał ŻADNEJ nawigacji do oferty (samo logo i koszyk).
   * Podaje je trasa: z pełnego katalogu (`categoryNavItems`) albo z wąskiego
   * odczytu (`loadCategoryNav`, ADR-266).
   */
  categoryNav?: readonly CategoryNavItem[];
  /**
   * Publiczna ścieżka bieżącej strony (S-52) — do oznaczenia self-linków
   * stopki (`aria-current="page"`); patrz `StoreChrome`.
   */
  currentPath?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <StoreChrome
      style={style}
      copy={copy}
      storeName={storeName}
      site={site}
      logo={logo}
      siteImageBase={siteImageBase}
      term={term}
      categoryNav={categoryNav}
      currentPath={currentPath}
      /*
        KOTWICE STOPKI PROWADZĄ NA STRONĘ GŁÓWNĄ (faza 0; poprawione w ADR-186).
        Użytkownicy tej powłoki to z definicji PODSTRONY — nie ma na nich sekcji,
        więc czysta kotwica `#kontakt` byłaby odnośnikiem, który nie robi nic.
        Celem jest strona GŁÓWNA, bo to na niej stoją sekcje, do których stopka
        odsyła (`#kontakt`, `#produkty`). Do ADR-186 stała katalogu wskazywała
        `/store`, czyli wewnętrzny adres tej samej strony głównej, więc oba
        znaczenia mieściły się przypadkiem w jednej wartości; od chwili, w której
        katalog dostał WŁASNĄ stronę, kotwica musi wskazywać kanon strony
        głównej — inaczej `#kontakt` prowadziłby tam, gdzie kontaktu nie ma.
      */
      footerAnchorBase={pagePathFromSlug(HOME_PAGE_SLUG)}
    >
      {/* Wspólna siatka strony najemcy (S-58) — patrz `SITE_CONTAINER`. */}
      <main className={cn(SITE_CONTAINER, "py-10", className)}>{children}</main>
    </StoreChrome>
  );
}
