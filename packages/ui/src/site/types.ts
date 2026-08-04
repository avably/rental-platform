/**
 * Kontrakt prezentacyjny sekcyjnego storefrontu (Zadanie 2.3b, render).
 *
 * Kształt TREŚCI sekcji ma JEDNO źródło — `@avably/core/site` (pas modelu 2.3a,
 * ADR-041). Import jest type-only (zerowy koszt runtime, bez zoda w bundlu UI):
 * render i podgląd panelu konsumują dokładnie te typy, których panel używa do
 * walidacji, więc podgląd nie może rozjechać się z tym, co da się zapisać.
 *
 * Pakiet UI zostaje czysto prezentacyjny: komponenty dostają sekcje jako propsy;
 * storefront (odczyt published) i panel (odczyt draft) wstrzykują je z własnych
 * warstw danych.
 */
import type {
  ContactContent,
  CtaContent,
  DeliveryContent,
  DirectionsContent,
  FaqContent,
  FooterContent,
  FreeformContent,
  GalleryContent,
  HeroContent,
  PricingContent,
  ProductsContent,
  SectionCanvas,
  SectionType,
  TestimonialsContent,
  UspContent,
} from "@avably/core/site";

export type {
  CanvasElement,
  Geometry,
  SectionCanvas,
  ContactContent,
  CtaContent,
  DeliveryContent,
  DirectionsContent,
  FaqContent,
  FooterContent,
  FreeformContent,
  GalleryContent,
  HeroContent,
  PricingContent,
  ProductsContent,
  SectionContent,
  SectionType,
  SiteTemplate,
  TestimonialsContent,
  UspContent,
} from "@avably/core/site";

/**
 * Sekcja do renderu: `{ id, position, type, content }` — strukturalnie zgodna z
 * `PublishedSection` (@avably/core/site), więc storefront podaje zwrotkę
 * `getPublishedSite` wprost. Panel buduje ją z draftu (włączone sekcje) do
 * podglądu. Unia dyskryminowana po `type` zawęża `content` w rendererze.
 *
 * TREŚĆ MOŻE BYĆ W DWÓCH GENERACJACH (K2, ADR-084): dotychczasowy kształt v1
 * albo PŁÓTNO z elementami (`SectionCanvas`, rozpoznawane po `version: 2`).
 * Typ sekcji zostaje ten sam — decyduje o tym, jak czytać treść v1, a przy v2
 * jest już tylko etykietą w interfejsie.
 */
type SectionContentByType = {
  hero: HeroContent;
  products: ProductsContent;
  pricing: PricingContent;
  faq: FaqContent;
  contact: ContactContent;
  freeform: FreeformContent;
  testimonials: TestimonialsContent;
  gallery: GalleryContent;
  usp: UspContent;
  cta: CtaContent;
  directions: DirectionsContent;
  delivery: DeliveryContent;
  footer: FooterContent;
};

/** Sekcja o treści WYŁĄCZNIE v1 — wejście dotychczasowych komponentów sekcji. */
export type LegacyRenderSection = {
  [T in SectionType]: { id: string; position: number; type: T; content: SectionContentByType[T] };
}[SectionType];

export type RenderSection = {
  [T in SectionType]: {
    id: string;
    position: number;
    type: T;
    content: SectionContentByType[T] | SectionCanvas;
  };
}[SectionType];

/**
 * Pojedynczy produkt katalogu w wersji publicznej (sekcja products). Ceny są
 * SFORMATOWANE w warstwie odczytu (zna locale/walutę tenanta), żeby pakiet UI
 * nie zależał od `formatMoney`. Publiczny odczyt katalogu ze storefrontu to
 * seam 2.4 — dziś render dostaje produkty tylko w podglądzie panelu.
 */
export interface StorefrontProduct {
  id: string;
  name: string;
  description: string | null;
  /** Gotowa etykieta ceny, np. „od 120,00 zł / doba”. */
  priceLabel: string;
  imageUrl: string | null;
  imageAlt: string;
  /**
   * Link do podstrony produktu (storefront publiczny 2.4b). Gdy podany, karta
   * jest klikalna. Podgląd w panelu go NIE podaje — karta zostaje statyczna
   * (edytor nie nawiguje do publicznej podstrony). Seam bez zmiany reszty
   * kontraktu: renderer i podgląd panelu działają tak samo.
   */
  href?: string;
}

/** Etykiety chrome renderu (locale tenanta). Treść sekcji jest autorska. */
export interface SiteRenderLabels {
  /** Fallback sekcji produktów, gdy katalog pusty / niedostępny publicznie. */
  productsEmpty: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  /** Etykieta linku do mapy w sekcji kontakt. */
  contactMap: string;
  /** Sekcja dojazd (0043) — etykiety adresu, godzin i linku do map. */
  directionsAddress: string;
  directionsHours: string;
  directionsMap: string;
}
