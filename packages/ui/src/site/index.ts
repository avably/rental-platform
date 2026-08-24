export * from "./types";
export { siteStyles, type TemplateStyles } from "./template";
export { parseInlineBold, parseParagraphs, SafeRichText } from "./rich-text";
export {
  ContactSection,
  ProductCards,
  CtaSection,
  DeliverySection,
  DirectionsSection,
  FaqSection,
  FooterSection,
  FreeformSection,
  GallerySection,
  HeroSection,
  PricingSection,
  ProductsSection,
  TestimonialsSection,
  UspSection,
} from "./sections";
// Sklejanie publicznego URL-a obiektu bucketa `site-images` — jedna zasada dla
// zdjęć sekcji i dla logo najemcy (ADR-160), więc wychodzi z pakietu.
export { siteImageUrl } from "./image-url";
export {
  SiteRenderer,
  SiteChrome,
  DEFAULT_SITE_LABELS,
  DEFAULT_SITE_MONEY,
  type SiteMotionMode,
} from "./site-renderer";
// Powłoka sklepu jako JEDEN kształt dla sklepu i podglądu szkicu (ADR-172).
export { SITE_HEADING, StoreShellFooter, StoreShellHeader } from "./store-shell";
// Kalendarz zakresu (faza 5, ADR-179) — jedna siatka dla powłoki sklepu
// (sam wybór terminu) i dla strony sprzętu (z liczbą wolnych sztuk per dzień).
export {
  SiteDateRangeCalendar,
  initialSiteCalendarMonth,
  isSiteCalendarMonth,
  nextSiteDateRange,
  shiftSiteCalendarMonth,
  siteCalendarDayState,
  siteCalendarMonthDays,
  siteCalendarMonthOf,
  siteCalendarRangeDays,
  siteCalendarWeekdayIndex,
  type SiteCalendarDayState,
  type SiteCalendarLabels,
  type SiteDateRangeCalendarProps,
  type SiteDateRangeSelection,
} from "./date-range-calendar";
// Dostępność na kaflu katalogu (faza 5, ADR-180) — kafel PYTA o liczbę wolnych
// sztuk, odpowiada powierzchnia, która zna termin. Brak dostawcy = kafel milczy.
export {
  SiteProductAvailabilityMark,
  SiteProductAvailabilityProvider,
  availabilityStateOf,
  LOW_STOCK_THRESHOLD,
  type SiteProductAvailability,
  type SiteProductAvailabilityState,
} from "./product-availability";
/*
 * KAFEL SPRZĘTU I STAN PUSTY — wychodzą z pakietu od ADR-186.
 *
 * Strona `/katalog` (faza 4b) rysuje TE SAME kafle, co sekcja sprzętu, ale bez
 * klasy `site-product-grid`: reguła „utnij ostatni, niepełny rząd" jest tam
 * uczciwa, bo pod spodem stoi odnośnik do katalogu — a na SAMYM katalogu
 * ucięłaby pozycje, po które klient właśnie przyszedł. Kafel musi być więc ten
 * sam co do znaku (druga kopia rozjechałaby się przy pierwszej poprawce
 * wyglądu), a siatka wokół niego — inna.
 */
export { ProductTile, ProductsEmpty } from "./structured/products-shared";
// Auto-układ listy wpisów (E6, aneks ADR-094) — liczba kolumn z LICZBY wpisów.
export { AUTO_LAYOUT_MAX_COLUMNS, autoColumns } from "./structured/auto-layout";
// `rel` linków wychodzących — jedna reguła na cały render (E1, ADR-094).
export { EXTERNAL_LINK_REL, externalLinkRel } from "./links";
// Pas motywu sekcji — wspólny dla płótna v2 i sekcji strukturalnych v3.
export { sectionBandClass } from "./bands";
// Sekcje strukturalne v3 (E1, ADR-094) — rejestr renderu para (typ, układ).
export {
  STRUCTURED_RENDERERS,
  structuredRendererFor,
  type StructuredSectionComponent,
  type StructuredSectionProps,
} from "./structured/registry";
// Ile wpisów sekcja odda do dokumentu (E8) — pytanie płótna o stan pusty.
export { structuredEntryCount } from "./structured/entries";
// Płótno z elementami (K2, ADR-084) — render treści v2 i przeliczenie geometrii.
export { SectionCanvasRenderer, canvasBoxVariables, geometryStyle } from "./element-canvas";
// Silnik podpięcia danych (faza 3, ADR-163) — wiązanie atrybutu z polem sprzętu.
export {
  bindingRecordOf,
  elementBindings,
  productBindingValues,
  resolveElementBinding,
  type ElementBindingResult,
  type SiteRecordContext,
} from "./binding-render";
