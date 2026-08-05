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
import type { ReactNode } from "react";

import type {
  ContactContent,
  ContactSubmitInput,
  ContactSubmitResult,
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
  StructuredSectionContent,
  TestimonialsContent,
  UspContent,
} from "@avably/core/site";

export type {
  CanvasElement,
  Geometry,
  SectionCanvas,
  ContactContent,
  ContactStructuredContent,
  ContactSubmitInput,
  ContactSubmitResult,
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
  StructuredSectionContent,
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
    /**
     * TRZY GENERACJE TREŚCI (E1, ADR-094): kształt v1 typu, PŁÓTNO v2
     * (`SectionCanvas`) albo SEKCJA STRUKTURALNA v3 (`StructuredSectionContent`).
     * Rozstrzygają `isStructuredSection` / `isSectionCanvas` — po jednym
     * pytaniu na generację, w jednym miejscu na cały system.
     */
    content: SectionContentByType[T] | SectionCanvas | StructuredSectionContent;
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

/**
 * ETYKIETY FORMULARZA KONTAKTU (E4, ADR-095).
 *
 * Formularz jest CHROME renderu, nie treścią najemcy: „Imię", „Wiadomość"
 * i komunikat o błędzie mówią językiem STRONY, a nie językiem pola, którego
 * operator nigdy nie wypełniał. Stąd komplet tutaj, a nie w treści sekcji —
 * i stąd domyślne wartości w `DEFAULT_SITE_LABELS`, dzięki którym płótno
 * kreatora rysuje ten sam formularz, co sklep.
 */
export interface ContactFormLabels {
  /** Nagłówek nad formularzem (h3 pod nagłówkiem sekcji). */
  title: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  submit: string;
  /** Etykieta przycisku w trakcie wysyłki — zastępuje `submit`. */
  sending: string;
  /** Potwierdzenie po przyjęciu wiadomości (komunikat w motywie). */
  success: string;
  /** Notka RODO pod formularzem — zdanie o tym, po co zbieramy dane. */
  privacyNote: string;
  /** Etykieta odnośnika do polityki prywatności (gdy sekcja go niesie). */
  privacyLink: string;
  /** Komunikaty błędów: per pole i całego zgłoszenia. */
  errors: {
    required: string;
    invalid: string;
    tooLong: string;
    captcha: string;
    rateLimited: string;
    /** Bilet nieważny — formularz otwarty zbyt długo albo wysłany za szybko. */
    expired: string;
    /** Sekcja nie ma adresata albo poczta jest niedostępna. */
    unavailable: string;
    server: string;
  };
}

/**
 * SZEW FORMULARZA KONTAKTU — wszystko, czego render nie ma prawa mieć sam.
 *
 * Renderer jest JEDEN dla sklepu i dla płótna kreatora (ADR-083), a akcja
 * serwerowa istnieje wyłącznie w storefroncie: to on ma nagłówek tenanta,
 * weryfikator CAPTCHY i tor poczty. Pakiet UI dostaje więc wiązanie, a nie
 * implementację — i rysuje TEN SAM formularz w obu miejscach. Bez wiązania
 * (płótno kreatora) formularz jest PODGLĄDEM: pełne drzewo, wyłączone
 * z interakcji, żeby operator widział, co dostanie klient.
 */
export interface ContactFormBinding {
  /**
   * Bilet z chwili renderu — podpisany serwerowo znacznik czasu. Wraca do akcji
   * bez zmian; formularz nie zna jego budowy i nie ma jak jej podrobić.
   */
  ticket: string;
  /** Akcja serwerowa storefrontu. Adresata wyprowadza SERWER, nie formularz. */
  submit: (input: ContactSubmitInput) => Promise<ContactSubmitResult>;
  /**
   * Widget CAPTCHY wstawiany przez storefront (gotowe drzewo, nie komponent).
   * Zapisuje token do UKRYTEGO POLA formularza zamiast wołać zwrotkę — dzięki
   * temu przechodzi przez granicę serwer→klient jako zwykłe dane, a pakiet UI
   * nie musi znać ani dostawcy, ani jego klucza. Brak = CAPTCHA wyłączona
   * (dev/CI bez kluczy); bramka i tak stoi po stronie serwera.
   */
  captcha?: ReactNode;
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
  /**
   * DOJAZD STRUKTURALNY (E5, ADR-096). Sześć etykiet, bo tyle rzeczy w tej
   * sekcji mówi CHROME renderu, a nie najemca:
   *   • `directionsRoute` — odnośnik nawigacji przy każdym punkcie;
   *   • `directionsChoose` — nazwa grupy wyboru punktu nad mapą (czytnik ekranu
   *     zapowiada ją przed każdą opcją, więc bez niej wybór jest bezimienny);
   *   • `directionsShowMap` — przycisk, którym odwiedzający prosi o mapę;
   *   • `directionsMapNotice` — zdanie o tym, co się po tym kliknięciu stanie
   *     (mapa ładuje się z serwisu zewnętrznego). Bez niego przycisk wygląda na
   *     zwykłe „rozwiń";
   *   • `directionsMapTitle` — tytuł ramki mapy (WCAG 4.1.2). `{location}`
   *     podmienia render nazwą punktu;
   *   • `directionsMapPreview` — zdanie w miejscu mapy na powierzchniach
   *     edycyjnych panelu, których polityka CSP ramki dostawcy nie wpuszcza.
   */
  directionsRoute: string;
  directionsChoose: string;
  directionsShowMap: string;
  directionsMapNotice: string;
  directionsMapTitle: string;
  directionsMapPreview: string;
  /**
   * GALERIA STRUKTURALNA (E3, aneks ADR-094). Przyciski powiększenia i pasa
   * karuzeli mają w środku SAM ZNAK graficzny, więc ich dostępna nazwa jest
   * jedynym, co słyszy czytnik ekranu — musi przyjść z języka strony, a nie
   * ze stałej zaszytej w komponencie.
   */
  galleryZoom: string;
  galleryClose: string;
  galleryPrev: string;
  galleryNext: string;
  /** Wzorzec licznika w powiększeniu — `{current}` i `{total}` podmienia render. */
  galleryPosition: string;
  /**
   * KONTAKT STRUKTURALNY (E4, ADR-095). Etykieta godzin otwarcia jest nowa —
   * sekcja v1 nie znała tego rodzaju danych. Pozostałe rodzaje wpisów mówią
   * etykietami, które sekcja kontaktu miała od 2.3b (`contactEmail`,
   * `contactPhone`, `contactAddress`, `contactMap`), bo to są te same pojęcia
   * i dwie ich nazwy w jednym sklepie byłyby usterką, a nie funkcją.
   */
  contactHours: string;
  contactForm: ContactFormLabels;
}
