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
export {
  SiteRenderer,
  SiteChrome,
  DEFAULT_SITE_LABELS,
  DEFAULT_SITE_MONEY,
  type SiteMotionMode,
} from "./site-renderer";
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
// Płótno z elementami (K2, ADR-084) — render treści v2 i przeliczenie geometrii.
export { SectionCanvasRenderer, canvasBoxVariables, geometryStyle } from "./element-canvas";
