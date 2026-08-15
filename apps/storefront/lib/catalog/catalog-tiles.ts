/**
 * USTAWIENIA KAFLA NA STRONIE `/katalog` (faza 4b, ADR-186).
 *
 * ==================== SKĄD KATALOG BIERZE WYGLĄD KAFLA ====================
 *
 * Strona katalogu nie ma własnego wiersza `sites` i mieć go nie powinna:
 * jest LISTĄ KOLEKCJI, a nie stroną, którą najemca redaguje sekcja po sekcji
 * (model stron z Fazy 2 zostaje nietknięty). Kafel potrzebuje jednak tych
 * samych trzech decyzji, co kafel w sekcji sprzętu: który podtytuł, które
 * cechy i jaka etykieta przycisku.
 *
 * Bierze je stamtąd, gdzie najemca JE PODJĄŁ — z pierwszej sekcji sprzętu na
 * jego opublikowanej stronie głównej. Alternatywy są dwie i obie gorsze:
 * własny zestaw ustawień znaczyłby drugie miejsce, w którym trzeba je ustawić
 * (i cichy rozjazd między kaflem na stronie głównej a kaflem w katalogu),
 * a sztywne wartości domyślne skasowałyby pracę, którą operator już wykonał.
 *
 * Najemca bez opublikowanej sekcji sprzętu dostaje wartości domyślne — czyli
 * kafel ze zdjęciem, nazwą i ceną, dokładnie tak jak sekcja sprzed fazy 1b.
 */
import {
  PRODUCTS_LAYOUTS,
  isStructuredSection,
  type ProductsStructuredContent,
  type PublishedSection,
  STRUCTURED_SECTION_VERSION,
} from "@avably/core/site";

import { CATALOG_PAGE_SIZE } from "@avably/core";

/**
 * Kafel bez ani jednego wskazania — stan najemcy, który nie opublikował sekcji
 * sprzętu. `source`/`items`/`limit` są tu formalnością kontraktu typu: pozycje
 * do narysowania podaje TRASA (jedna strona wyników z bazy), a nie treść.
 */
const DOMYSLNY: ProductsStructuredContent = {
  v: STRUCTURED_SECTION_VERSION,
  type: "products",
  layout: PRODUCTS_LAYOUTS[0],
  background: "default",
  source: "catalog",
  items: [],
  limit: CATALOG_PAGE_SIZE as ProductsStructuredContent["limit"],
  featureFields: [],
};

/**
 * Ustawienia kafla dla strony katalogu — z sekcji sprzętu najemcy albo domyślne.
 *
 * `limit` i `source` są NADPISYWANE bezwarunkowo i to jest istotne: sufit
 * z sekcji („pokaż 8 pozycji") ani wybór ręczny („pokaż te trzy") nie mają
 * prawa obciąć strony katalogu, na którą klient wszedł właśnie po pełną listę.
 * Z sekcji jedzie to, co dotyczy WYGLĄDU pozycji, i nic ponadto.
 */
export function catalogTileContent(
  sections: readonly PublishedSection[] | undefined,
): ProductsStructuredContent {
  const sekcja = (sections ?? []).find(
    (section) => section.type === "products" && isStructuredSection(section.content),
  );
  const tresc =
    sekcja && isStructuredSection(sekcja.content) && sekcja.content.type === "products"
      ? sekcja.content
      : null;
  if (!tresc) return DOMYSLNY;

  return {
    ...tresc,
    // Układ kafla zostaje z sekcji (siatka albo lista), tło i nagłówek — nie:
    // nagłówek strony katalogu jest jej własny, a pas motywu rysuje trasa.
    background: "default",
    source: "catalog",
    items: [],
    limit: CATALOG_PAGE_SIZE as ProductsStructuredContent["limit"],
  };
}
