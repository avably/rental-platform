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
import { linkHrefSchema } from "./link-href";
import {
  structuredSchemaFor,
  type StructuredContentOf,
  type StructuredSectionContent,
} from "./structured";
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
 * Typy sekcji — lustro CHECK-a site_sections.type (0019 + 0043 + 0047).
 * Zamknięta lista (ADR-041/ADR-082): nowy typ = zmiana TEJ stałej + schemat Zod
 * niżej + CHECK w migracji. Sześć typów doszło w 0043 (kreator sekcyjny A2):
 * testimonials, gallery, usp, cta, directions, delivery. Trzynasty — `footer`
 * — doszedł w 0047 (K6, ADR-092) i jako jedyny jest PRZYPIĘTY do końca strony
 * (arytmetyka w `./section-order`, jedyność w bazie).
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
  "footer",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];
export const sectionTypeSchema = z.enum(SECTION_TYPES);

/**
 * Sekcje PRZYPIĘTE do końca strony i arytmetyka kolejności (K6, ADR-092) —
 * patrz `./section-order`. Osobny liść, bo korzystają z niego trzy warstwy:
 * płótno kreatora (czy sekcja da się przesunąć), akcja serwerowa (normalizacja
 * zapisanej kolejności ORAZ miejsce świeżej sekcji — E2) i testy arytmetyki
 * bez DOM-u.
 */
export {
  PINNED_LAST_TYPES,
  isPinnedLastType,
  normalizeSectionOrder,
  orderWithSectionBefore,
  type OrderedSection,
} from "./section-order";

/**
 * KOTWICE SEKCJI — adresy, które od zawsze niosą presety (`#produkty`,
 * `#kontakt`), a którym do teraz nie odpowiadał ŻADEN `id` w dokumencie.
 * Osobny liść z tego samego powodu, co `./section-order`: pytanie „jak nazywa
 * się to miejsce na stronie" pada w rendererze, w treści startowej i w testach,
 * a odpowiedź musi być jedna. Patrz `./section-anchors`.
 */
export { SECTION_ANCHORS, sectionAnchorHref, sectionAnchorIds } from "./section-anchors";

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
 * Cel przycisku CTA — allowlista schematów z `./link-href`, ta sama, którą
 * dostaje `href` elementu płótna v2 i `href` runu tekstowego.
 *
 * Nazwa lokalna zostaje, bo czyta ją kilkanaście schematów treści niżej i mówi
 * ona, CZYM to pole jest w tym pliku. Zniknęła natomiast trzecia kopia REGUŁY:
 * granica bezpieczeństwa ma jedno miejsce, a nie trzy identyczne, z których
 * każda niosła komentarz o tym, że kopii być nie może.
 */
const ctaHref = linkHrefSchema;

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

// -----------------------------------------------------------------------
// Typ sekcji z 0047 (K6, ADR-092) — STOPKA
// -----------------------------------------------------------------------

/**
 * STOPKA STRONY — dane kontaktowe, godziny, linki i nota o prawach.
 *
 * Trzy rzeczy odróżniają ją od `contact`, z którym łatwo ją pomylić:
 *   1. jest PRZYPIĘTA do końca strony (ADR-092) — operator nie może jej wsunąć
 *      nad hero, bo stopka nad treścią to błąd, którego nie chcemy udostępniać;
 *   2. jest JEDYNA na stronie — pilnuje tego unikat częściowy w 0047, nie
 *      dobra wola edytora;
 *   3. niesie `legal` (nota o prawach) jako pole WYMAGANE — stopka bez niej
 *      nie jest stopką, tylko drugą sekcją kontaktową.
 *
 * `links` to nawigacja pomocnicza (regulamin, polityka, kotwice sekcji) — ten
 * sam allowlistowany `ctaHref` co wszędzie: żadnego `javascript:`.
 */
export const footerContentSchema = z
  .object({
    businessName: blockTitle,
    address: shortText.optional(),
    phone: z.string().trim().min(1).max(40).optional(),
    email: z.string().trim().email().max(254).optional(),
    hours: shortText.optional(),
    links: z
      .array(
        z
          .object({
            label: buttonLabel,
            href: ctaHref,
          })
          .strict(),
      )
      .max(8)
      .optional(),
    legal: shortText,
  })
  .strict();

/**
 * Treść sekcji: SEKCJA STRUKTURALNA v3 (E1, ADR-094), PŁÓTNO v2 (K2, ADR-084)
 * albo dotychczasowy kształt v1.
 *
 * Kolejność w unii nie jest przypadkiem — generacje rozpoznawalne po znaczniku
 * idą pierwsze (`v: 3`, potem `version: 2`), a schematy v1 są `.strict()`, więc
 * obcy klucz i tak by je odrzucił. Zbiory są rozłączne we wszystkie strony:
 * treść v1 nie ma ani `v`, ani `version`. Dzięki temu jsonb przyjmuje TRZY
 * generacje BEZ MIGRACJI, a wersję niesie sama treść, nie kolumna obok niej.
 *
 * Wariant strukturalny wchodzi Z REJESTRU (`structuredSchemaFor`), a nie z listy
 * pisanej ręcznie przy każdej z czterech map niżej: dopisanie typu do rejestru
 * ADR-094 rozszerza zapis, odczyt szkicu, odczyt publiczny i wejście upsertu
 * jednocześnie — albo nie rozszerza żadnego, co widać natychmiast.
 */
function contentUnionFor<T extends SectionType, S extends z.ZodTypeAny>(type: T, legacy: S) {
  const structured = structuredSchemaFor(type);
  const schema = structured
    ? z.union([structured, sectionCanvasSchema, legacy])
    : z.union([sectionCanvasSchema, legacy]);
  /*
   * RZUTOWANIE JEST TU KONIECZNE i ma jeden powód: obecność wariantu
   * strukturalnego rozstrzyga się W CZASIE WYKONANIA (przez rejestr), więc
   * TypeScript widziałby wyłącznie `ZodTypeAny` i cała treść sekcji zapadłaby
   * się do `unknown` — łącznie z typem `PublishedSection`, na którym stoi
   * storefront. Zbiór wartości jest za to znany STATYCZNIE: żadna z trzech
   * generacji nie jest szersza niż to, co wypisano niżej, a każdą z nich
   * i tak weryfikuje Zod przy parsowaniu.
   */
  return schema as unknown as z.ZodType<StructuredContentOf<T> | SectionCanvas | z.infer<S>>;
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
  footer: footerContentSchema,
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
  hero: contentUnionFor("hero", heroContentSchema),
  products: contentUnionFor("products", productsContentSchema),
  pricing: contentUnionFor("pricing", pricingContentSchema),
  faq: contentUnionFor("faq", faqContentSchema),
  contact: contentUnionFor("contact", contactContentSchema),
  freeform: contentUnionFor("freeform", freeformContentSchema),
  testimonials: contentUnionFor("testimonials", testimonialsContentSchema),
  gallery: contentUnionFor("gallery", galleryContentSchema),
  usp: contentUnionFor("usp", uspContentSchema),
  cta: contentUnionFor("cta", ctaContentSchema),
  directions: contentUnionFor("directions", directionsContentSchema),
  delivery: contentUnionFor("delivery", deliveryContentSchema),
  footer: contentUnionFor("footer", footerContentSchema),
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
export type FooterContent = z.infer<typeof footerContentSchema>;

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
  | DeliveryContent
  | FooterContent;

/**
 * Treść sekcji w DOWOLNEJ generacji. To jest typ, którym posługują się edytor,
 * render i warstwa danych — rozróżnienia dokonuje `isSectionCanvas`, a nie
 * osobne ścieżki w każdym z tych miejsc.
 */
export type SectionContent = LegacySectionContent | SectionCanvas | StructuredSectionContent;

/** Para (type, content) walidowana spójnie — wejście upsertu sekcji w panelu. */
export const sectionInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hero"), content: contentUnionFor("hero", heroContentSchema) }),
  z.object({ type: z.literal("products"), content: contentUnionFor("products", productsContentSchema) }),
  z.object({ type: z.literal("pricing"), content: contentUnionFor("pricing", pricingContentSchema) }),
  z.object({ type: z.literal("faq"), content: contentUnionFor("faq", faqContentSchema) }),
  z.object({ type: z.literal("contact"), content: contentUnionFor("contact", contactContentSchema) }),
  z.object({ type: z.literal("freeform"), content: contentUnionFor("freeform", freeformContentSchema) }),
  z.object({ type: z.literal("testimonials"), content: contentUnionFor("testimonials", testimonialsContentSchema) }),
  z.object({ type: z.literal("gallery"), content: contentUnionFor("gallery", galleryContentSchema) }),
  z.object({ type: z.literal("usp"), content: contentUnionFor("usp", uspContentSchema) }),
  z.object({ type: z.literal("cta"), content: contentUnionFor("cta", ctaContentSchema) }),
  z.object({ type: z.literal("directions"), content: contentUnionFor("directions", directionsContentSchema) }),
  z.object({ type: z.literal("delivery"), content: contentUnionFor("delivery", deliveryContentSchema) }),
  z.object({ type: z.literal("footer"), content: contentUnionFor("footer", footerContentSchema) }),
]);
export type SectionInput = z.infer<typeof sectionInputSchema>;

// -----------------------------------------------------------------------
// Kształt opublikowanej strony — wynik app.get_published_site (0019)
// -----------------------------------------------------------------------
//
// Storefront parsuje odpowiedź RPC tym schematem FAIL-CLOSED: payload, który
// nie jest opublikowaną stroną w znanym kształcie, nie dochodzi do renderu.

export const publishedSectionSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("hero"), content: contentUnionFor("hero", heroContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("products"), content: contentUnionFor("products", productsContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("pricing"), content: contentUnionFor("pricing", pricingContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("faq"), content: contentUnionFor("faq", faqContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("contact"), content: contentUnionFor("contact", contactContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("freeform"), content: contentUnionFor("freeform", freeformContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("testimonials"), content: contentUnionFor("testimonials", testimonialsContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("gallery"), content: contentUnionFor("gallery", galleryContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("usp"), content: contentUnionFor("usp", uspContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("cta"), content: contentUnionFor("cta", ctaContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("directions"), content: contentUnionFor("directions", directionsContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("delivery"), content: contentUnionFor("delivery", deliveryContentSchema) }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("footer"), content: contentUnionFor("footer", footerContentSchema) }),
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

/*
 * WALUTA W MODELU STRONY (E6). Sekcja cennika niesie kwoty, więc render musi
 * wiedzieć, W CZYM je pokazać — a wie to warstwa danych (ustawienie najemcy).
 * Typ jedzie tą samą drogą, co reszta modelu treści, żeby pakiet UI nie musiał
 * sięgać po drugi punkt wejścia rdzenia dla jednej nazwy.
 */
export type { CurrencyCode } from "../money";

// Szablony startowe — gotowe SKŁADY strony na pierwsze wejście do kreatora
// (K5, ADR-090). Presety odpowiadały na pustą sekcję, te na pustą stronę.
export {
  STARTER_CONTENT_MINIMUMS,
  STARTER_LAYOUTS,
  STARTER_SECTION_BOUNDS,
  STARTER_TEMPLATES,
  starterTemplateContents,
  starterTemplatePhotoSlots,
  starterTemplateSections,
  starterTemplateTheme,
  type StarterGalleryItem,
  type StarterSection,
  type StarterSectionContent,
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

// Ruch: presety wejścia sekcji, wskazywane NAZWĄ przez motyw (K6, ADR-092).
export {
  SITE_MOTIONS,
  SITE_MOTION_PRESETS,
  motionPreset,
  type SiteMotionId,
  type SiteMotionPreset,
} from "./motion";

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

// ---------------------------------------------------------------------
// Sekcje strukturalne — treść v3 (E1, ADR-094)
// ---------------------------------------------------------------------

export {
  CONTACT_ENTRY_KINDS,
  CONTACT_LAYOUTS,
  CONTACT_MESSAGE_FIELDS,
  DIRECTIONS_LAYOUTS,
  FAQ_LAYOUTS,
  GALLERY_COLUMNS,
  GALLERY_GAPS,
  GALLERY_LAYOUTS,
  MAP_PROVIDER_ORIGIN,
  PRICING_CATALOG_HREF,
  PRICING_LAYOUTS,
  PRICING_PRICE_MODES,
  PRICING_UNITS,
  STRUCTURED_SECTIONS,
  STRUCTURED_SECTION_TYPES,
  STRUCTURED_SECTION_VERSION,
  STRUCTURED_THEME_ROLES,
  appendStructuredItem,
  contactEntriesFromLegacy,
  contactFormVisible,
  contactMapHref,
  contactMessageErrors,
  ctaFromLegacy,
  ctaStructuredSchema,
  CTA_LAYOUTS,
  CTA_VARIANTS,
  deliveryFromLegacy,
  deliveryPriceLabel,
  deliveryStructuredSchema,
  DELIVERY_LAYOUTS,
  fullRowCount,
  contactMessageSchema,
  contactRecipient,
  contactStructuredSchema,
  contactTelHref,
  directionsLocationsFromLegacy,
  directionsMapEmbedSrc,
  directionsRouteHref,
  directionsStructuredSchema,
  faqPageJsonLd,
  faqStructuredSchema,
  galleryItemsFromLegacy,
  galleryStructuredSchema,
  isStructuredSection,
  isStructuredType,
  moveStructuredItem,
  parseContactMessage,
  patchStructuredField,
  patchStructuredItem,
  pricingHeadAndNoteFromLegacy,
  pricingPriceLabel,
  pricingStructuredSchema,
  productsCatalogLinkVisible,
  productsHeadingFromLegacy,
  productsStructuredSchema,
  PRODUCTS_CATALOG_HREF,
  PRODUCTS_LAYOUTS,
  PRODUCTS_LIMITS,
  PRODUCTS_MAX_FEATURES,
  PRODUCTS_SOURCES,
  removeStructuredItem,
  structuredFromLegacy,
  structuredItemsMatter,
  structuredNewItemFor,
  structuredPresetFor,
  structuredSchemaFor,
  structuredSpecOf,
  testimonialsFromLegacy,
  testimonialsStructuredSchema,
  uspItemsFromLegacy,
  uspStructuredSchema,
  USP_LAYOUTS,
  withStructuredLayout,
  type ContactEntryKind,
  type ContactLayout,
  type ContactMessageField,
  type ContactMessageFieldError,
  type ContactMessageFieldErrors,
  type ContactMessageInput,
  type ContactMessageParse,
  type ContactStructuredContent,
  type ContactStructuredItem,
  type ContactSubmitInput,
  type ContactSubmitResult,
  type CtaLayout,
  type CtaLegacyParts,
  type CtaStructuredContent,
  type CtaVariant,
  type DeliveryLayout,
  type DeliveryStructuredContent,
  type DeliveryStructuredItem,
  type DirectionsLayout,
  type DirectionsStructuredContent,
  type DirectionsStructuredItem,
  type FaqLayout,
  type FaqStructuredContent,
  type GalleryColumns,
  type GalleryGap,
  type GalleryLayout,
  type GalleryStructuredContent,
  type GalleryStructuredItem,
  type PricingLayout,
  type PricingPriceMode,
  type PricingPriceWords,
  type PricingStructuredContent,
  type PricingStructuredItem,
  type PricingUnit,
  type ProductsLayout,
  type ProductsLimit,
  type ProductsSource,
  type ProductsStructuredContent,
  type ProductsStructuredItem,
  type StructuredChoiceSpec,
  type StructuredContentOf,
  type StructuredEditorShape,
  type StructuredFieldEmpty,
  type StructuredFieldKind,
  type StructuredFieldSpec,
  type StructuredPickEntry,
  type StructuredPresetLocale,
  type StructuredSectionContent,
  type StructuredSectionSpec,
  type StructuredSectionType,
  type StructuredThemeRole,
  type StructuredToggleSpec,
  type TestimonialsLayout,
  type TestimonialsStructuredContent,
  type TestimonialsStructuredItem,
  type UspLayout,
  type UspStructuredContent,
  type UspStructuredItem,
  TESTIMONIALS_LAYOUTS,
} from "./structured";

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

/**
 * Cel odnośnika — JEDNA allowlista schematów na cały produkt (`./link-href`).
 * Eksport stoi tu, a nie przy runach tekstu, bo reguła nie należy do żadnej
 * z trzech generacji treści: obowiązuje `ctaHref` v1, `href` elementu płótna v2
 * i `href` runu tak samo.
 */
export { linkHrefSchema } from "./link-href";

// Treść sformatowana elementów — runy, nie HTML (K3, ADR-086).
export {
  MAX_RUNS_PER_ELEMENT,
  normalizeRuns,
  plainTextOf,
  richTextSchema,
  runsFromPlainText,
  textRunSchema,
  type RichText,
  type TextRun,
} from "./rich-text";
