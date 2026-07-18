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
  FaqContent,
  FreeformContent,
  HeroContent,
  PricingContent,
  ProductsContent,
  SectionType,
} from "@avably/core/site";

export type {
  ContactContent,
  FaqContent,
  FreeformContent,
  HeroContent,
  PricingContent,
  ProductsContent,
  SectionContent,
  SectionType,
  SiteTemplate,
} from "@avably/core/site";

/**
 * Sekcja do renderu: `{ id, position, type, content }` — strukturalnie zgodna z
 * `PublishedSection` (@avably/core/site), więc storefront podaje zwrotkę
 * `getPublishedSite` wprost. Panel buduje ją z draftu (włączone sekcje) do
 * podglądu. Unia dyskryminowana po `type` zawęża `content` w rendererze.
 */
type RenderSectionOf<T extends SectionType, C> = {
  id: string;
  position: number;
  type: T;
  content: C;
};

export type RenderSection =
  | RenderSectionOf<"hero", HeroContent>
  | RenderSectionOf<"products", ProductsContent>
  | RenderSectionOf<"pricing", PricingContent>
  | RenderSectionOf<"faq", FaqContent>
  | RenderSectionOf<"contact", ContactContent>
  | RenderSectionOf<"freeform", FreeformContent>;

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
}
