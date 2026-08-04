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
export { SiteRenderer, SiteChrome, DEFAULT_SITE_LABELS, type SiteMotionMode } from "./site-renderer";
// Płótno z elementami (K2, ADR-084) — render treści v2 i przeliczenie geometrii.
export { SectionCanvasRenderer, canvasBoxVariables, geometryStyle } from "./element-canvas";
