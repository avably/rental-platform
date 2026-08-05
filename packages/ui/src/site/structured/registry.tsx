import type {
  StructuredContentOf,
  StructuredSectionContent,
  StructuredSectionType,
} from "@avably/core/site";

import type { TemplateStyles } from "../template";
import type { SiteRenderLabels } from "../types";
import { StructuredFaqAccordion } from "./faq-accordion";
import { StructuredFaqOpenList } from "./faq-open-list";
import { StructuredGalleryCarousel } from "./gallery-carousel";
import { StructuredGalleryGrid } from "./gallery-grid";
import { StructuredGalleryMasonry } from "./gallery-masonry";

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
