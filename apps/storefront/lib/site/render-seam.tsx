/**
 * SZEW RENDERU SEKCJI — wszystko, czego pakiet UI mieć nie może, w jednym
 * miejscu (Faza 2, ADR-158).
 *
 * DLACZEGO POWSTAŁ. Do Fazy 2 sekcje rysowała DOKŁADNIE JEDNA trasa (`/store`),
 * więc szew mógł siedzieć w jej ciele: etykiety chrome'u, kafle produktów,
 * bilet formularza kontaktu, prefiks zdjęć. Od tej fazy najemca ma N stron
 * i każda rysuje te same sekcje — a szew rozkopiowany po trasach rozjeżdża się
 * po pierwszej zmianie etykiety. Rozjazd byłby CICHY: strona „Kontakt"
 * pokazywałaby formularz bez biletu albo kafle bez cech, bez jednego błędu.
 *
 * Funkcja jest świadomie „głupia": zbiera zależności, nie podejmuje decyzji
 * o wyglądzie. Decyzje układu zostają w rendererze, decyzje treści w bazie.
 */
import type { SiteRenderLabels } from "@avably/ui";

import { ContactCaptchaField } from "@/components/storefront/contact-captcha";
import { submitContactMessage } from "@/lib/actions/contact";
import type { PublicCategory } from "@/lib/checkout/contract";
import { toStorefrontCategories, toStorefrontProducts } from "@/lib/catalog/present";
import { issueContactTicket } from "@/lib/contact/ticket";
import { productPath } from "@/lib/catalog/product-path";
import { siteImageBaseUrl } from "@/lib/site/image-base";
import type { StorefrontContext } from "@/lib/storefront/context";

/** Etykiety CHROME'U renderu — mówią językiem SKLEPU, nie językiem kodu. */
export function siteRenderLabels(copy: StorefrontContext["copy"]): SiteRenderLabels {
  return {
    productsEmpty: copy.siteLabels.productsEmpty,
    categoriesEmpty: copy.siteLabels.categoriesEmpty,
    productsCatalog: copy.siteLabels.productsCatalog,
    productsCta: copy.siteLabels.productsCta,
    contactEmail: copy.siteLabels.contactEmail,
    contactPhone: copy.siteLabels.contactPhone,
    contactAddress: copy.siteLabels.contactAddress,
    contactMap: copy.siteLabels.contactMap,
    directionsAddress: copy.siteLabels.directionsAddress,
    directionsHours: copy.siteLabels.directionsHours,
    directionsMap: copy.siteLabels.directionsMap,
    directionsRoute: copy.siteLabels.directionsRoute,
    directionsChoose: copy.siteLabels.directionsChoose,
    directionsShowMap: copy.siteLabels.directionsShowMap,
    directionsMapNotice: copy.siteLabels.directionsMapNotice,
    directionsMapTitle: copy.siteLabels.directionsMapTitle,
    directionsMapPreview: copy.siteLabels.directionsMapPreview,
    galleryZoom: copy.siteLabels.galleryZoom,
    galleryClose: copy.siteLabels.galleryClose,
    galleryPrev: copy.siteLabels.galleryPrev,
    galleryNext: copy.siteLabels.galleryNext,
    galleryPosition: copy.siteLabels.galleryPosition,
    contactHours: copy.siteLabels.contactHours,
    contactForm: copy.siteLabels.contactForm,
    pricingFrom: copy.siteLabels.pricingFrom,
    pricingUnits: copy.siteLabels.pricingUnits,
    pricingCatalog: copy.siteLabels.pricingCatalog,
    testimonialsPrev: copy.siteLabels.testimonialsPrev,
    testimonialsNext: copy.siteLabels.testimonialsNext,
  };
}

export interface SiteRenderSeam {
  labels: SiteRenderLabels;
  products: ReturnType<typeof toStorefrontProducts>;
  categories: ReturnType<typeof toStorefrontCategories>;
  siteImageBase: string;
  contactForm: {
    ticket: ReturnType<typeof issueContactTicket>;
    submit: typeof submitContactMessage;
    captcha?: React.ReactElement;
  };
}

/**
 * Komplet zależności renderu sekcji dla WSKAZANEGO kontekstu najemcy.
 *
 * BILET FORMULARZA KONTAKTU (E4, ADR-095) powstaje przy KAŻDYM wywołaniu, bo
 * jest podpisanym znacznikiem chwili, w której odwiedzający zobaczył formularz.
 * Każda trasa sklepu jest `force-dynamic`, więc każde wyświetlenie dostaje
 * własny, świeży bilet — także wtedy, gdy formularz stoi na podstronie.
 */
/**
 * WEJŚCIE SZWU — kształt STRUKTURALNY, nie `StorefrontContext` (faza 4a,
 * ADR-185). Od tej fazy strona sprzętu ma własny, węższy kontekst: jedną
 * pozycję zamiast katalogu. Szew czyta z kontekstu dokładnie sześć rzeczy
 * i nazwanie ich wprost wpuszcza oba konteksty bez zmiany w wywołaniach.
 */
export type SiteRenderSeamInput = Pick<
  StorefrontContext,
  "copy" | "locale" | "currency" | "supabaseUrl" | "productSlugs"
> & {
  catalog: Pick<StorefrontContext["catalog"], "custom_fields" | "products"> & {
    /**
     * KATEGORIE — OPCJONALNE, bo węższe konteksty ich nie mają (strona sprzętu
     * niesie jedną pozycję, nie katalog). Trasa katalogu (`/store`) podaje pełną
     * listę; podstrona bez niej daje sekcję kategorii pokazującą sam nagłówek.
     */
    categories?: readonly PublicCategory[];
  };
};

export function buildSiteRenderSeam(ctx: SiteRenderSeamInput): SiteRenderSeam {
  const { catalog, copy, locale, currency, supabaseUrl } = ctx;

  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  return {
    labels: siteRenderLabels(copy),
    products: toStorefrontProducts(catalog.products, {
      supabaseUrl,
      currency,
      locale,
      words: { from: copy.common.from, perDay: copy.common.perDay },
      productHref: (productId) => productPath(ctx.productSlugs, productId),
      customFields: catalog.custom_fields,
      fieldLocale: locale,
    }),
    // Kategorie do sekcji „kategorie" (Faza 7). Węższy kontekst (strona sprzętu)
    // kategorii nie niesie — pusta lista daje sekcję z samym nagłówkiem.
    categories: toStorefrontCategories(catalog.categories ?? [], { supabaseUrl }),
    // Prefiks publicznego URL-a zdjęć sekcji (bucket site-images, 0043).
    // Wyrażenie mieszka w `./image-base`, bo tego samego prefiksu potrzebuje
    // znak firmy najemcy (ADR-160) — patrz nagłówek tamtego pliku.
    siteImageBase: siteImageBaseUrl(supabaseUrl),
    contactForm: {
      ticket: issueContactTicket(),
      submit: submitContactMessage,
      ...(turnstileSiteKey
        ? { captcha: <ContactCaptchaField siteKey={turnstileSiteKey} locale={locale} /> }
        : {}),
    },
  };
}
