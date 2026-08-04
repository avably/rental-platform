import type { StructuredSectionContent } from "@avably/core/site";

import type { TemplateStyles } from "../template";
import { StructuredFaqAccordion } from "./faq-accordion";
import { StructuredFaqOpenList } from "./faq-open-list";

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
export interface StructuredSectionProps {
  content: StructuredSectionContent;
  styles: TemplateStyles;
}

export type StructuredSectionComponent = (props: StructuredSectionProps) => React.ReactNode;

export const STRUCTURED_RENDERERS: Record<string, Record<string, StructuredSectionComponent>> = {
  faq: {
    accordion: StructuredFaqAccordion,
    "open-list": StructuredFaqOpenList,
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
  return STRUCTURED_RENDERERS[type]?.[layout];
}
