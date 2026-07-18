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

/**
 * Tag cache Next.js dla treści storefrontu tenanta — jeden format po obu
 * stronach kontraktu: panel emituje revalidateTag(tenantCacheTag(id)) przy
 * publikacji, storefront taguje nim przyszłe wpisy cache (ISR — seam 2.4/2.6).
 */
export function tenantCacheTag(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/** Szablony strony — lustro CHECK-a sites.template (0019). */
export const SITE_TEMPLATES = ["classic", "bold"] as const;
export type SiteTemplate = (typeof SITE_TEMPLATES)[number];
export const siteTemplateSchema = z.enum(SITE_TEMPLATES);

/** Typy sekcji — lustro CHECK-a site_sections.type (0019). */
export const SECTION_TYPES = ["hero", "products", "pricing", "faq", "contact", "freeform"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];
export const sectionTypeSchema = z.enum(SECTION_TYPES);

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

export const SECTION_CONTENT_SCHEMAS = {
  hero: heroContentSchema,
  products: productsContentSchema,
  pricing: pricingContentSchema,
  faq: faqContentSchema,
  contact: contactContentSchema,
  freeform: freeformContentSchema,
} as const satisfies Record<SectionType, z.ZodTypeAny>;

export type HeroContent = z.infer<typeof heroContentSchema>;
export type ProductsContent = z.infer<typeof productsContentSchema>;
export type PricingContent = z.infer<typeof pricingContentSchema>;
export type FaqContent = z.infer<typeof faqContentSchema>;
export type ContactContent = z.infer<typeof contactContentSchema>;
export type FreeformContent = z.infer<typeof freeformContentSchema>;

export type SectionContent =
  | HeroContent
  | ProductsContent
  | PricingContent
  | FaqContent
  | ContactContent
  | FreeformContent;

/** Para (type, content) walidowana spójnie — wejście upsertu sekcji w panelu. */
export const sectionInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hero"), content: heroContentSchema }),
  z.object({ type: z.literal("products"), content: productsContentSchema }),
  z.object({ type: z.literal("pricing"), content: pricingContentSchema }),
  z.object({ type: z.literal("faq"), content: faqContentSchema }),
  z.object({ type: z.literal("contact"), content: contactContentSchema }),
  z.object({ type: z.literal("freeform"), content: freeformContentSchema }),
]);
export type SectionInput = z.infer<typeof sectionInputSchema>;

// -----------------------------------------------------------------------
// Kształt opublikowanej strony — wynik app.get_published_site (0019)
// -----------------------------------------------------------------------
//
// Storefront parsuje odpowiedź RPC tym schematem FAIL-CLOSED: payload, który
// nie jest opublikowaną stroną w znanym kształcie, nie dochodzi do renderu.

export const publishedSectionSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("hero"), content: heroContentSchema }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("products"), content: productsContentSchema }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("pricing"), content: pricingContentSchema }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("faq"), content: faqContentSchema }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("contact"), content: contactContentSchema }),
  z.object({ id: z.string().uuid(), position: z.number().int(), type: z.literal("freeform"), content: freeformContentSchema }),
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
  })
  .strict();

export interface PublishedSite {
  template: SiteTemplate;
  publishedAt: string;
  sections: PublishedSection[];
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

  return {
    template: envelope.data.template,
    publishedAt: envelope.data.published_at,
    sections,
  };
}
