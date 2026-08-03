/**
 * Model sekcyjny storefrontu (Zadanie 2.3a, ADR-041) — JEDYNE źródło kształtu
 * treści sekcji. Panel (server actions) waliduje tymi schematami każdy zapis
 * content_draft; storefront parsuje nimi opublikowany stan z
 * app.get_published_site. Edytor i render (2.3b) importują stąd — zmiana
 * kształtu treści to zmiana TEGO pliku, nigdy lokalna kopia.
 *
 * Treść sekcji to DANE tenanta (jego teksty EN/PL/dowolne), nie klucze i18n —
 * schematy pilnują kształtu i granic, nie języka.
 *
 * Granica bezpieczeństwa: `freeform.body` to tekst/markdown, NIE surowy HTML —
 * render NIE MOŻE wstawiać go przez dangerouslySetInnerHTML (XSS). `ctaHref`
 * przechodzi allowlistę schematów (http/https/ścieżka względna/kotwica), żeby
 * opublikowany przycisk nie mógł nieść `javascript:`.
 */
import { z } from "zod";

import { sectionCanvasSchema, type SectionCanvas } from "./elements";
import { uspIconSchema } from "./icons";
import { siteStyleSchema, type SiteStyle } from "./style";
import { siteTemplateSchema, type SiteTemplate } from "./templates";

/**
 * Tag cache Next.js dla treści storefrontu tenanta — jeden format po obu
 * stronach kontraktu: panel emituje revalidateTag(tenantCacheTag(id)) przy
 * publikacji, storefront taguje nim przyszłe wpisy cache (ISR — seam 2.4/2.6).
 */
export function tenantCacheTag(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/**
 * Szablony strony — lustro CHECK-a sites.template (0019). Definicja mieszka
 * w liściu `./templates`, bo od K5 czyta ją także `./style` (patrz komentarz
 * tam: cykl przez `z.enum` w chwili ładowania modułu).
 */
export { SITE_TEMPLATES, siteTemplateSchema, type SiteTemplate } from "./templates";

/**
 * Typy sekcji — lustro CHECK-a site_sections.type (0019 + 0043). Zamknięta
 * lista (ADR-041/ADR-082): nowy typ = zmiana TEJ stałej + schemat Zod niżej +
 * CHECK w migracji. Sześć typów doszło w 0043 (kreator sekcyjny A2):
 * testimonials, gallery, usp, cta, directions, delivery.
 */
export const SECTION_TYPES = [
  "hero",
  "products",
  "pricing",
  "faq",
  "contact",
  "freeform",
  "testimonials",
  "gallery",
  "usp",
  "cta",
  "directions",
  "delivery",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];
export const sectionTypeSchema = z.enum(SECTION_TYPES);

/**
 * Allowlista ikon (ADR-082) mieszka w `./icons` — korzystają z niej sekcja USP
 * (v1) i element `icon` płótna v2 (K2), a wspólny moduł zamyka cykl wartości
 * między tym plikiem a `./elements`.
 */
export { USP_ICONS, uspIconSchema, type UspIcon } from "./icons";

// -----------------------------------------------------------------------
// Cegiełki pól
// -----------------------------------------------------------------------

// trim + granice długości: puste stringi i wielosetkilobajtowe wklejki nie są
// treścią sekcji. Granice są celowo szczodre (treść marketingowa bywa długa),
// ale skończone — jsonb bez limitu to zaproszenie do składowania czegokolwiek.
const heading = z.string().trim().min(1).max(200);
const shortText = z.string().trim().min(1).max(500);
const longText = z.string().trim().min(1).max(10_000);

/**
 * Cel przycisku CTA: absolutny http(s), ścieżka względna ("/cennik") albo
 * kotwica ("#kontakt"). Allowlista, nie blocklista — `javascript:`, `data:`
 * i każdy przyszły egzotyczny scheme odpadają z definicji.
 */
const ctaHref = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine(
    (value) => {
      if (value.startsWith("/") || value.startsWith("#")) return true;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Dozwolone: adres http(s), ścieżka względna (/...) albo kotwica (#...)" },
  );

/**
 * Ścieżka obrazu w Storage (konwencja 0018: `{tenant}/{...}`), NIE dowolny URL
 * — render buduje publiczny URL sam, a hotlinkowanie obcych hostów nie
 * przechodzi przez CSP storefrontu.
 */
const imagePath = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine((value) => !value.includes("..") && !value.includes("://"), {
    message: "Ścieżka Storage, nie URL",
  });

// Cegiełki dla typów sekcji z 0043 (kreator A2). Te same zasady co wyżej: trim,
// granice min. 1 / skończone maksimum. Osobne nazwy zamiast literałów, żeby
// limit pola był jednym miejscem prawdy i był widoczny w schematach.
/** Nazwa/podpis autora opinii, tytuł atutu, tytuł pozycji dostawy. */
const blockTitle = z.string().trim().min(1).max(120);
/** Etykieta przycisku CTA (limit jak hero.ctaText). */
const buttonLabel = z.string().trim().min(1).max(80);
/** Tekst alternatywny zdjęcia w galerii (a11y) — zwięzły opis, nie akapit. */
const altText = z.string().trim().min(1).max(300);
/** Akapit średniej długości (opis dostawy) — dłuższy niż shortText, krótszy niż freeform. */
const mediumText = z.string().trim().min(1).max(2_000);

// -----------------------------------------------------------------------
// Schematy treści per typ sekcji (content_draft / content_published)
// -----------------------------------------------------------------------
//
// .strict(): nieznane klucze są błędem, nie balastem — jsonb przyjąłby
// wszystko, a literówka w nazwie pola ginęłaby bez śladu do chwili renderu.

export const heroContentSchema = z
  .object({
    heading,
    subheading: shortText.optional(),
    ctaText: z.string().trim().min(1).max(80).optional(),
    ctaHref: ctaHref.optional(),
    imagePath: imagePath.optional(),
  })
  .strict();

/** Lista produktów: pozycje idą z katalogu (render pobiera je osobno) — sekcja niesie tylko nagłówek. */
export const productsContentSchema = z
  .object({
    heading: heading.optional(),
  })
  .strict();

export const pricingContentSchema = z
  .object({
    heading: heading.optional(),
    note: shortText.optional(),
  })
  .strict();

export const faqContentSchema = z
  .object({
    heading: heading.optional(),
    items: z
      .array(
        z
          .object({
            q: shortText,
            a: longText,
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export const contactContentSchema = z
  .object({
    heading: heading.optional(),
    address: shortText.optional(),
    phone: z.string().trim().min(1).max(40).optional(),
    email: z.string().trim().email().max(254).optional(),
    /** Zapytanie do osadzonej mapy (np. "Kwiatowa 5, Warszawa") — tekst, nie URL. */
    mapQuery: shortText.optional(),
  })
  .strict();

/** body = tekst/markdown. NIE surowy HTML — render nie może go wstrzykiwać (XSS). */
export const freeformContentSchema = z
  .object({
    heading: heading.optional(),
    body: longText,
  })
  .strict();

// -----------------------------------------------------------------------
// Typy sekcji z 0043 (kreator sekcyjny A2, ADR-082)
// -----------------------------------------------------------------------
//
// Sekcje z pozycjami trzymają tablicę bloków (`items`) — reorder bloków W
// SEKCJI to etap C1; tu tablica jest płaska, a edytor dodaje/usuwa pozycje.
// Górne granice tablic są celowo skromne (strona sprzedażowa, nie katalog).

/** Opinie klientów — lista cytatów z podpisem. */
export const testimonialsContentSchema = z
  .object({
    heading: heading.optional(),
    items: z
      .array(
        z
          .object({
            quote: shortText,
            author: blockTitle,
            role: blockTitle.optional(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

/**
 * Galeria zdjęć — lista obrazów z bucketa sekcji (0043). `imagePath` to ścieżka
 * Storage (nie URL — jak w hero); render buduje publiczny URL sam. `alt`
 * wymagane: zdjęcie bez opisu alternatywnego to regres dostępności.
 */
export const galleryContentSchema = z
  .object({
    heading: heading.optional(),
    items: z
      .array(
        z
          .object({
            imagePath,
            alt: altText,
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

/** Atuty (USP) — lista kafli ikona + tytuł + tekst. Ikona z allowlisty USP_ICONS. */
export const uspContentSchema = z
  .object({
    heading: heading.optional(),
    items: z
      .array(
        z
          .object({
            icon: uspIconSchema,
            title: blockTitle,
            text: shortText,
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

/** Baner wezwania do działania — nagłówek + przycisk (href z tej samej allowlisty co hero). */
export const ctaContentSchema = z
  .object({
    heading,
    text: shortText.optional(),
    buttonLabel,
    buttonHref: ctaHref,
  })
  .strict();

/**
 * Dojazd — adres + opcjonalny LINK do map i godziny. Świadomie BEZ osadzania
 * obcych skryptów/iframe map (ADR-082): `mapsUrl` przechodzi tę samą allowlistę
 * schematów co ctaHref (żaden `javascript:`), render daje z niego zwykły link.
 */
export const directionsContentSchema = z
  .object({
    address: shortText,
    mapsUrl: ctaHref.optional(),
    hours: shortText.optional(),
  })
  .strict();

/** Informacja o dostawie — nagłówek + opis + opcjonalne pozycje (np. warianty dostawy). */
export const deliveryContentSchema = z
  .object({
    heading,
    text: mediumText,
    items: z
      .array(
        z
          .object({
            title: blockTitle,
            text: shortText,
          })
          .strict(),
      )
      .max(12)
      .optional(),
  })
  .strict();

/**
 * Treść sekcji: PŁÓTNO v2 albo dotychczasowy kształt v1 (K2, ADR-084).
 *
 * Kolejność w unii nie jest przypadkiem — płótno idzie pierwsze, bo jest
 * rozpoznawalne po `version: 2`, a schematy v1 są `.strict()`, więc obcy klucz
 * `version` i tak by je odrzucił. Zbiory są rozłączne w obie strony: treść v1
 * nie ma pola `version`, więc nie przejdzie jako płótno. Dzięki temu jsonb
 * przyjmuje obie generacje BEZ MIGRACJI, a wersję niesie sama treść, nie
 * kolumna obok niej.
 */
function withCanvas<T extends z.ZodTypeAny>(legacy: T) {
  return z.union([sectionCanvasSchema, legacy]);
}

export const SECTION_CONTENT_SCHEMAS = {
  hero: heroContentSchema,
  products: productsContentSchema,
  pricing: pricingContentSchema,
  faq: faqContentSchema,
  contact: contactContentSchema,
  freeform: freeformContentSchema,
  testimonials: testimonialsContentSchema,
  gallery: galleryContentSchema,
  usp: uspContentSchema,
  cta: ctaContentSchema,
  directions: directionsContentSchema,
  delivery: deliveryContentSchema,
} as const satisfies Record<SectionType, z.ZodTypeAny>;

/**
 * SCHEMAT ODCZYTU SZKICU — DOWOLNA GENERACJA TREŚCI (K4, ADR-088).
 *
 * Wada, którą ta mapa zamyka (znaleziona przy weryfikacji K4 na żywym
 * kreatorze, obecna od K2): edytor panelu parsował `content_draft` mapą
 * {@link SECTION_CONTENT_SCHEMAS}, czyli schematami WYŁĄCZNIE v1. Płótno v2
 * odpadało na walidacji i wołający podstawiał w jego miejsce PRESET typu —
 * a że preset wygląda dokładnie tak, jak świeżo dodana sekcja, objaw nie
 * przypominał błędu. Zapis działał (`sectionInputSchema` zna obie generacje),
 * więc geometria szła do bazy poprawnie i wracała stamtąd wyprana: każde
 * przeładowanie kreatora cofało układ do stanu startowego.
 *
 * Trzy miejsca, przez które przechodzi treść, mają odtąd jedną odpowiedź na
 * pytanie „co jest poprawną treścią sekcji": zapis (`sectionInputSchema`),
 * odczyt publiczny (`publishedSectionSchema`) i odczyt szkicu (ta mapa).
 */
export const SECTION_DRAFT_SCHEMAS = {
  hero: withCanvas(heroContentSchema),
  products: withCanvas(productsContentSchema),
  pricing: withCanvas(pricingContentSchema),
  faq: withCanvas(faqContentSchema),
  contact: withCanvas(contactContentSchema),
  freeform: withCanvas(freeformContentSchema),
  testimonials: withCanvas(testimonialsContentSchema),
  gallery: withCanvas(galleryContentSchema),
  usp: withCanvas(uspContentSchema),
  cta: withCanvas(ctaContentSchema),
  directions: withCanvas(directionsContentSchema),
  delivery: withCanvas(deliveryContentSchema),
} as const satisfies Record<SectionType, z.ZodTypeAny>;

export type HeroContent = z.infer<typeof heroContentSchema>;
export type ProductsContent = z.infer<typeof productsContentSchema>;
export type PricingContent = z.infer<typeof pricingContentSchema>;
export type FaqContent = z.infer<typeof faqContentSchema>;
export type ContactContent = z.infer<typeof contactContentSchema>;
export type FreeformContent = z.infer<typeof freeformContentSchema>;
export type TestimonialsContent = z.infer<typeof testimonialsContentSchema>;
export type GalleryContent = z.infer<typeof galleryContentSchema>;
export type UspContent = z.infer<typeof uspContentSchema>;
export type CtaContent = z.infer<typeof ctaContentSchema>;
export type DirectionsContent = z.infer<typeof directionsContentSchema>;
export type DeliveryContent = z.infer<typeof deliveryContentSchema>;

/** Treść sekcji w kształcie v1 (przed K2). Zbiór zamknięty — patrz `SectionContentAny`. */
export type LegacySectionContent =
  | HeroContent
  | ProductsContent
  | PricingContent
  | FaqContent
  | ContactContent
  | FreeformContent
  | TestimonialsContent
  | GalleryContent
  | UspContent
  | CtaContent
  | DirectionsContent
  | DeliveryContent;

/**
 * Treść sekcji w DOWOLNEJ generacji. To jest typ, którym posługują się edytor,
 * render i warstwa danych — rozróżnienia dokonuje `isSectionCanvas`, a nie
 * osobne ścieżki w każdym z tych miejsc.
 */
export type SectionContent = LegacySectionContent | SectionCanvas;

/** Para (type, content) walidowana spójnie — wejście upsertu sekcji w panelu. */
export const sectionInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hero"), content: withCanvas(heroContentSchema) }),
  z.object({ type: z.literal("products"), content: withCanvas(productsContentSchema) }),
  z.object({ type: z.literal("pricing"), content: withCanvas(pricingContentSchema) }),
  z.object({ type: z.literal("faq"), content: withCanvas(faqContentSchema) }),
  z.object({ type: z.literal("contact"), content: withCanvas(contactContentSchema) }),
  z.object({ type: z.literal("freeform"), content: withCanvas(freeformContentSchema) }),
  z.object({ type: z.literal("testimonials"), content: withCanvas(testimonialsContentSchema) }),
  z.object({ type: z.literal("gallery"), content: withCanvas(galleryContentSchema) }),
  z.object({ type: z.literal("usp"), content: withCanvas(uspContentSchema) }),
  z.object({ type: z.literal("cta"), content: withCanvas(ctaContentSchema) }),
  z.object({ type: z.literal("directions"), content: withCanvas(directionsContentSchema) }),
  z.object({ type: z.literal("delivery"), content: withCanvas(deliveryContentSchema) }),
]);
export type SectionInput = z.infer<typeof sectionInputSchema>;

// -----------------------------------------------------------------------
// Kształt opublikowanej strony — wynik app.get_published_site (0019)
// -----------------------------------------------------------------------
//
// Storefront parsuje odpowiedź RPC tym schematem FAIL-CLOSED: payload, który
// nie jest opublikowaną stroną w znanym kształcie, nie dochodzi do renderu.

export const publishedSectionSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("hero"), content: withCanvas(heroContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("products"), content: withCanvas(productsContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("pricing"), content: withCanvas(pricingContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("faq"), content: withCanvas(faqContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("contact"), content: withCanvas(contactContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("freeform"), content: withCanvas(freeformContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("testimonials"), content: withCanvas(testimonialsContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("gallery"), content: withCanvas(galleryContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("usp"), content: withCanvas(uspContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("cta"), content: withCanvas(ctaContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("directions"), content: withCanvas(directionsContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("delivery"), content: withCanvas(deliveryContentSchema) }),
]);
export type PublishedSection = z.infer<typeof publishedSectionSchema>;

/**
 * Powłoka odpowiedzi RPC. `sections` celowo jako `unknown[]` — pojedynczą
 * sekcję waliduje osobno publishedSectionSchema, żeby jedna niepoprawna
 * sekcja (np. treść sprzed zmiany schematu) DEGRADOWAŁA się do pominięcia,
 * a nie wywracała całej strony sklepu (patrz parsePublishedSite).
 */
export const publishedSiteEnvelopeSchema = z
  .object({
    template: siteTemplateSchema,
    published_at: z.string(),
    sections: z.array(z.unknown()),
    /**
     * STYL STRONY (K5, ADR-090) — klucz OPCJONALNY, i to w obie strony.
     *
     * Baza dokłada go wyłącznie dla strony z niepustym stylem (0046), więc
     * koperta bez niego jest stanem normalnym, a nie awarią. Sam styl jest
     * `unknown` i parsuje się OSOBNO (niżej), z tego samego powodu, dla którego
     * `sections` jest tablicą `unknown`: styl w kształcie sprzed zmiany
     * allowlisty ma zdegradować się do domyślnego, a nie położyć całej strony.
     */
    style: z.unknown().optional(),
  })
  .strict();

export interface PublishedSite {
  template: SiteTemplate;
  publishedAt: string;
  sections: PublishedSection[];
  /** Styl w kształcie zapisanym; render uzupełnia braki `resolveSiteStyle`. */
  style: SiteStyle;
}

/**
 * Parsowanie odpowiedzi app.get_published_site: powłoka FAIL-CLOSED (zły
 * kształt → null), sekcje INDYWIDUALNIE (niepoprawna sekcja jest pomijana —
 * opublikowana wcześniej treść w starym kształcie nie może położyć całej
 * strony po zmianie schematu). Kolejność przychodzi z bazy (position, id)
 * i jest zachowana.
 */
export function parsePublishedSite(payload: unknown): PublishedSite | null {
  const envelope = publishedSiteEnvelopeSchema.safeParse(payload);
  if (!envelope.success) return null;

  const sections: PublishedSection[] = [];
  for (const candidate of envelope.data.sections) {
    const section = publishedSectionSchema.safeParse(candidate);
    if (section.success) sections.push(section.data);
  }

  // Styl fail-SOFT (koperta jest fail-closed): nieznany kształt stylu znaczy
  // najwyżej „strona wygląda domyślnie", a nie „strona pokazuje coś, czego
  // pokazać nie wolno" — degradacja jest tu właściwą odpowiedzią, inaczej niż
  // przy sekcjach, gdzie chodzi o granicę draft/publish.
  const style = siteStyleSchema.safeParse(envelope.data.style ?? {});

  return {
    template: envelope.data.template,
    publishedAt: envelope.data.published_at,
    sections,
    style: style.success ? style.data : {},
  };
}

// Presety treści startowej sekcji (kreator A2, ADR-082) — patrz ./presets.
export { PRESET_LOCALES, presetContentFor, type PresetLocale } from "./presets";

// Szablony startowe — gotowe SKŁADY strony na pierwsze wejście do kreatora
// (K5, ADR-090). Presety odpowiadały na pustą sekcję, te na pustą stronę.
export {
  STARTER_LAYOUTS,
  STARTER_SECTION_BOUNDS,
  STARTER_TEMPLATES,
  starterTemplateCanvases,
  starterTemplatePhotoSlots,
  starterTemplateSections,
  starterTemplateTheme,
  type StarterSection,
  type StarterSectionCanvas,
  type StarterTemplate,
} from "./starter-templates";

// Kadry szablonów startowych — kuracja przez API dostawcy (K5 v2, ADR-090).
export {
  STARTER_PHOTOS,
  STARTER_PHOTO_QUERIES,
  STARTER_PHOTO_SLOTS,
  starterPhoto,
  type StarterPhotoSlot,
} from "./starter-photos";

// Motywy strony — rejestr światów wizualnych jako DANE (K5, ADR-090).
export {
  ACCENT_VARIANTS,
  BUTTON_FILLS,
  BUTTON_SHAPES,
  DEFAULT_THEME,
  SCRIM_ALPHA,
  SELECTABLE_THEMES,
  SITE_THEMES,
  SITE_THEME_TOKENS,
  THEME_BAND_KEYS,
  accentsOf,
  scrimBandOf,
  siteThemeSchema,
  themeTokens,
  variantsUsedBy,
  type AccentTokens,
  type AccentVariant,
  type ButtonFill,
  type ButtonShape,
  type SiteThemeId,
  type SiteThemeTokens,
  type ThemeBand,
  type ThemeBandKey,
  type ThemeShape,
  type ThemeType,
} from "./theme";

// Kroje: rodziny (pliki OFL w repo) i pary do wyboru (K5, ADR-090).
export {
  FONT_FAMILIES,
  FONT_PAIRS,
  SELECTABLE_FONT_PAIRS,
  SITE_FONT_PAIRS,
  fontPairStacks,
  fontStack,
  type FontFamilyId,
  type FontFamilyTokens,
  type FontPairTokens,
  type SiteFontPair,
} from "./fonts";

// Styl strony: motyw, akcent i para krojów wybrane przez operatora (K5, ADR-090).
export {
  ACTIVE_TOKENS,
  DEFAULT_SITE_STYLE,
  STYLE_TOKENS,
  bandTokenName,
  resolveSiteStyle,
  siteStyleSchema,
  styleTokensFor,
  type ResolvedSiteStyle,
  type SiteStyle,
} from "./style";

// Miara kontrastu — podstawa kontraktu palety (K5, ADR-090).
export {
  CONTRAST_AA_LARGE,
  CONTRAST_AA_TEXT,
  VISIBLE_EDGE,
  contrastRatio,
  flatten,
  relativeLuminance,
  rgbFromHex,
} from "./contrast";

// ---------------------------------------------------------------------
// Płótno z elementami — treść sekcji v2 (K2, ADR-084)
// ---------------------------------------------------------------------

export {
  CANVAS_BREAKPOINTS,
  CANVAS_COLUMNS,
  CANVAS_CONTENT_COLUMNS,
  CANVAS_DESIGN_WIDTH_PX,
  CANVAS_MOBILE_MAX_REM,
  CANVAS_PAD_COLUMNS,
  ELEMENT_ALIGNMENTS,
  ELEMENT_COLORS,
  ELEMENT_ICONS,
  ELEMENT_KINDS,
  FIXED_SIZE,
  GEOMETRY_MAX_ROWS,
  HUG_KINDS,
  HUG_SIZE,
  PALETTE_ELEMENT_KINDS,
  GRID_UNIT_PX,
  GUIDE_TOLERANCE_UNITS,
  HEADING_LEVELS,
  MAX_ELEMENTS_PER_SECTION,
  MOBILE_DESIGN_WIDTH_PX,
  MOBILE_STACK_FACTOR,
  SECTION_BACKGROUNDS,
  SECTION_CANVAS_VERSION,
  SECTION_MAX_ROWS,
  SECTION_MAX_ROWS_MOBILE,
  SECTION_MIN_ROWS,
  SIZE_MODES,
  BUTTON_VARIANTS,
  IMAGE_FITS,
  SHAPE_FILLS,
  SHAPE_KINDS,
  TEXT_VARIANTS,
  canvasElementSchema,
  elementSizeSchema,
  geometrySchema,
  imageSourceSchema,
  isSectionCanvas,
  mapLinkElementSchema,
  normalizeImageSource,
  sectionCanvasSchema,
  sizeOf,
  supportsHug,
  withSize,
  type ButtonVariant,
  type CanvasBreakpoint,
  type CanvasElement,
  type CanvasElementKind,
  type ElementAlignment,
  type ElementColor,
  type ElementLayout,
  type ElementSize,
  type Geometry,
  type HeadingLevel,
  type HugElementKind,
  type ImageSource,
  type PaletteElementKind,
  type ImageFit,
  type SectionBackground,
  type SectionCanvas,
  type ShapeFill,
  type ShapeKind,
  type SizeMode,
  type TextVariant,
} from "./elements";

export {
  MIN_ELEMENT_UNITS,
  NUDGE_STEP,
  NUDGE_STEP_LARGE,
  RESIZE_HANDLES,
  bringToFront,
  canvasMetrics,
  clampGeometry,
  commitMove,
  commitResize,
  geometryRect,
  normalizeLayers,
  nudgeGeometry,
  paintOrder,
  rawMove,
  rawResize,
  sendToBack,
  snapMove,
  snapResize,
  unitsFromPx,
  withGeometry,
  withoutMobileGeometry,
  type CanvasMetrics,
  type CanvasRect,
  type GestureContext,
  type Guide,
  type GuideAxis,
  type GuideKind,
  type RawBox,
  type ResizeHandle,
  type SnapContext,
  type SnapResult,
} from "./geometry";

export {
  SECTION_COMPOSITIONS,
  sectionCanvasFrom,
  sectionCanvasWith,
  type SectionComposition,
  type SectionMedia,
} from "./canvas-presets";

// Miary tekstu, skale typografii płótna i szacunek pudełka obejmującego treść
// (K4, ADR-088) — wspólne dla konwersji, fabryki i auto-układu mobilnego.
export {
  ICON_DESIGN_PX,
  ICON_MIN_PX,
  TEXT_SCALES,
  charsPerLineAt,
  fontPxAt,
  hugBox,
  iconPxAt,
  rowsPerLineAt,
  scaleOfElement,
  textRows,
  textRowsAt,
  unitPxAt,
  unitsForPx,
  type TextScale,
} from "./text-metrics";

// Auto-układ mobilny + ręczne poprawki per breakpoint (K4, ADR-088).
export {
  geometryAt,
  isDetachedOnMobile,
  mobileLayoutOf,
  type MobileLayout,
} from "./mobile-layout";

// Nowy element z palety — treść startowa i rozmiar domyślny (K3, ADR-086).
export { createElement, defaultSizeOf, freeSpotFor } from "./element-factory";

// Treść sformatowana elementów — runy, nie HTML (K3, ADR-086).
export {
  MAX_RUNS_PER_ELEMENT,
  linkHrefSchema,
  normalizeRuns,
  plainTextOf,
  richTextSchema,
  runsFromPlainText,
  textRunSchema,
  type RichText,
  type TextRun,
} from "./rich-text";
