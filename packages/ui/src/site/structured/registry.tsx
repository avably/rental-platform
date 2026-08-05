import type {
  StructuredContentOf,
  StructuredSectionContent,
  StructuredSectionType,
} from "@avably/core/site";

import type { TemplateStyles } from "../template";
import type { ContactFormBinding, SiteMoney, SiteRenderLabels } from "../types";
import { StructuredContactSplit } from "./contact-split";
import { StructuredContactStacked } from "./contact-stacked";
import { StructuredDirectionsSplit } from "./directions-split";
import { StructuredDirectionsStacked } from "./directions-stacked";
import { StructuredFaqAccordion } from "./faq-accordion";
import { StructuredFaqOpenList } from "./faq-open-list";
import { StructuredGalleryCarousel } from "./gallery-carousel";
import { StructuredGalleryGrid } from "./gallery-grid";
import { StructuredGalleryMasonry } from "./gallery-masonry";
import { StructuredPricingCards } from "./pricing-cards";
import { StructuredPricingTable } from "./pricing-table";
import { StructuredTestimonialsCarousel } from "./testimonials-carousel";
import { StructuredTestimonialsGrid } from "./testimonials-grid";

/**
 * REJESTR RENDERU SEKCJI STRUKTURALNYCH (E1, ADR-094) — para (typ, układ)
 * wskazuje DOKŁADNIE JEDEN komponent.
 *
 * Rejestr jest lustrem rejestru modelu (`STRUCTURED_SECTIONS` w @avably/core):
 * kontrakt kompletności w tym pakiecie porównuje oba zbiory w OBIE strony, więc
 * ani wariant układu bez komponentu, ani komponent bez wariantu nie przechodzą.
 * Bez tego lustra dopisanie układu do modelu kończyłoby się pustą sekcją na
 * stronie klienta — czyli awarią, której nie widać w żadnym logu.
 */
export interface StructuredSectionProps<
  TContent extends StructuredSectionContent = StructuredSectionContent,
> {
  content: TContent;
  styles: TemplateStyles;
  /**
   * Prefiks publicznego URL-a bucketa zdjęć sekcji. Typ MEDIALNY (E3) bez niego
   * rysuje kafle zastępcze zamiast pęknąć — render nie zależy od Storage.
   * Typ tekstowy go ignoruje.
   */
  siteImageBase?: string;
  /**
   * Etykiety chrome renderu (te same, którymi mówią sekcje v1). Powiększenie
   * zdjęcia ma przyciski, których nazwa jest JEDYNYM ich znaczeniem dla
   * czytnika ekranu, więc muszą przyjść z języka strony, a nie ze stałej.
   */
  labels: SiteRenderLabels;
  /**
   * Identyfikator sekcji. Typ z AKCJĄ (E4) odsyła go na serwer, bo to z niego
   * serwer wyprowadza adresata wiadomości — sam formularz adresu nie zna i nie
   * ma jak go podmienić. Typy bez akcji go ignorują.
   */
  sectionId?: string;
  /**
   * Szew formularza kontaktu (E4, ADR-095): akcja serwerowa, bilet z chwili
   * renderu i widget CAPTCHY. Podaje go WYŁĄCZNIE storefront; płótno kreatora
   * nie podaje nic i dostaje ten sam formularz w trybie podglądu.
   */
  contactForm?: ContactFormBinding;
  /**
   * ZGODA NA OSADZENIE OBCEJ RAMKI (E5, ADR-096). Podaje ją WYŁĄCZNIE sklep, bo
   * tylko jego polityka CSP wpuszcza źródło ramki dostawcy map. Typ z mapą
   * (dojazd) renderuje bez niej ten sam kafel w trybie PODGLĄDU — zdanie
   * zamiast ramki, którą polityka panelu i tak by ucięła. Typy bez osadzenia
   * ignorują tę flagę.
   */
  mapEmbed?: boolean;
  /**
   * WALUTA I ZAPIS KWOT (E6, aneks ADR-094). Podaje je WARSTWA DANYCH, bo
   * waluta jest ustawieniem najemcy, a nie treścią sekcji — patrz `SiteMoney`.
   * Typ bez kwot ją ignoruje; typ z kwotami dostaje ją ZAWSZE (renderer ma
   * wartość domyślną), więc cennik nie ma stanu „nie wiem, w czym to pokazać".
   */
  money: SiteMoney;
}

export type StructuredSectionComponent<
  TContent extends StructuredSectionContent = StructuredSectionContent,
> = (props: StructuredSectionProps<TContent>) => React.ReactNode;

/**
 * Rejestr WIE, jaka treść trafi do którego komponentu: klucz typu wybiera
 * wariant unii przez `StructuredContentOf`. Bez tego każdy komponent musiałby
 * przyjmować całą unię i zawężać ją u siebie — czyli powtarzać rozpoznanie
 * typu, które rejestr już zrobił, w tylu miejscach, ile jest układów.
 */
type StructuredRendererRegistry = {
  [T in StructuredSectionType]: Record<string, StructuredSectionComponent<StructuredContentOf<T>>>;
};

export const STRUCTURED_RENDERERS: StructuredRendererRegistry = {
  faq: {
    accordion: StructuredFaqAccordion,
    "open-list": StructuredFaqOpenList,
  },
  gallery: {
    grid: StructuredGalleryGrid,
    masonry: StructuredGalleryMasonry,
    carousel: StructuredGalleryCarousel,
  },
  contact: {
    stacked: StructuredContactStacked,
    split: StructuredContactSplit,
  },
  directions: {
    stacked: StructuredDirectionsStacked,
    split: StructuredDirectionsSplit,
  },
  pricing: {
    table: StructuredPricingTable,
    cards: StructuredPricingCards,
  },
  testimonials: {
    grid: StructuredTestimonialsGrid,
    carousel: StructuredTestimonialsCarousel,
  },
};

/**
 * Komponent dla treści albo `undefined`, gdy para (typ, układ) nie ma renderu.
 * Wołający (SiteRenderer) traktuje brak jako sekcję do POMINIĘCIA — treść
 * w nieznanym kształcie nie może położyć całej strony (ta sama zasada, co przy
 * degradacji pojedynczej sekcji w `parsePublishedSite`).
 */
export function structuredRendererFor(
  type: string,
  layout: string,
): StructuredSectionComponent | undefined {
  /*
   * JEDYNE rzutowanie w tym pliku. Wyszukanie idzie po DWÓCH NAPISACH z treści,
   * więc system typów nie ma jak przejść z klucza na wariant unii — a wołający
   * (SiteRenderer) i tak trzyma tę samą treść, z której te napisy pochodzą.
   * Zgodność pary (typ, układ) z komponentem pilnuje kontrakt kompletności
   * rejestru, czyli zbiór, a nie deklaracja typu.
   */
  const registry = STRUCTURED_RENDERERS as unknown as Record<
    string,
    Record<string, StructuredSectionComponent> | undefined
  >;
  return registry[type]?.[layout];
}
