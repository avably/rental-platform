/**
 * ETYKIETY CHROME RENDERU STRONY NAJEMCY — w LOCALE TENANTA (L6, ADR-102).
 *
 * Podgląd szkicu odpowiada na pytanie „co zobaczy klient po publikacji", a
 * klient dostaje chrome renderu (etykiety formularza, jednostki cennika,
 * przyciski galerii) w języku SKLEPU — czyli `tenants.locale`, tej samej osi,
 * z której czyta storefront (`lib/storefront/locale.ts`). Do L6 podgląd szedł
 * bez propsu `labels` (spadał na `DEFAULT_SITE_LABELS`, polskie) i z locale
 * URL PANELU w pieniądzach — najemca EN widział w podglądzie polskie „doba".
 *
 * ŹRÓDŁEM stringów jest i18n PANELU (`site.renderLabels`), utrzymywane jako
 * LUSTRO `storefront.siteLabels` ze storefrontu. Panel nie może importować z
 * `apps/storefront` (osobna aplikacja, zero zależności między apkami), a
 * wspólny pakiet wymagałby ruszenia `@avably/ui` — więc kopia jest świadoma,
 * a dryf zamyka KONTRAKT RÓWNOŚCI w `test/site-preview-tenant-locale.test.tsx`:
 * poprawka etykiety w sklepie bez poprawki w panelu pali w CI.
 *
 * Czysty obiekt stringów, bez next-intl (wzorzec `storefront/copy.ts`): oś
 * tenancka nie przechodzi przez middleware i18n, więc provider nie ma tu
 * czego rozstrzygać.
 */
import type { SiteRenderLabels } from "@avably/ui";
import type { SupabaseClient } from "@supabase/supabase-js";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

/** Locale strony najemcy — ta sama para, którą zna storefront. */
export type TenantSiteLocale = "pl" | "en";

/**
 * Normalizuje wartość z bazy do wspieranego locale — lustro
 * `normalizeStorefrontLocale`: domyślnie `pl` (historyczny domyślny język
 * tenanta), nieznana wartość nie ma prawa wywrócić renderu podglądu.
 */
export function normalizeTenantSiteLocale(value: string | null | undefined): TenantSiteLocale {
  return value === "en" ? "en" : "pl";
}

/**
 * Locale strony najemcy z `tenants.locale` (0005) — odczyt tenant-scoped przez
 * RLS, jak każdy inny odczyt panelu. Brak wiersza / błąd spada na `pl` tym
 * samym ruchem, co nieznana wartość: podgląd ma się wyrenderować zawsze.
 */
export async function getTenantSiteLocale(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TenantSiteLocale> {
  const { data } = await supabase
    .from("tenants")
    .select("locale")
    .eq("id", tenantId)
    .maybeSingle();
  return normalizeTenantSiteLocale((data as { locale?: string } | null)?.locale);
}

const RENDER_LABELS: Record<TenantSiteLocale, typeof plMessages.site.renderLabels> = {
  pl: plMessages.site.renderLabels,
  en: enMessages.site.renderLabels,
};

/**
 * Komplet etykiet chrome renderu w języku strony najemcy — złożony JAWNIE,
 * pole po polu, jak w sklepie (`store/page.tsx`): kompilator pilnuje wtedy
 * kompletności względem `SiteRenderLabels`, a klucz zgubiony w JSON jest
 * błędem typu, nie polską etykietą u najemcy EN.
 */
export function siteRenderLabels(locale: TenantSiteLocale): SiteRenderLabels {
  const source = RENDER_LABELS[locale];
  return {
    productsEmpty: source.productsEmpty,
    categoriesEmpty: source.categoriesEmpty,
    productsCatalog: source.productsCatalog,
    productsCta: source.productsCta,
    contactEmail: source.contactEmail,
    contactPhone: source.contactPhone,
    contactAddress: source.contactAddress,
    contactMap: source.contactMap,
    directionsAddress: source.directionsAddress,
    directionsHours: source.directionsHours,
    directionsMap: source.directionsMap,
    directionsRoute: source.directionsRoute,
    directionsChoose: source.directionsChoose,
    directionsShowMap: source.directionsShowMap,
    directionsMapNotice: source.directionsMapNotice,
    directionsMapTitle: source.directionsMapTitle,
    directionsMapPreview: source.directionsMapPreview,
    galleryZoom: source.galleryZoom,
    galleryClose: source.galleryClose,
    galleryPrev: source.galleryPrev,
    galleryNext: source.galleryNext,
    galleryPosition: source.galleryPosition,
    galleryCredit: source.galleryCredit,
    contactHours: source.contactHours,
    contactForm: source.contactForm,
    pricingFrom: source.pricingFrom,
    pricingUnits: source.pricingUnits,
    pricingCatalog: source.pricingCatalog,
    testimonialsPrev: source.testimonialsPrev,
    testimonialsNext: source.testimonialsNext,
  };
}
