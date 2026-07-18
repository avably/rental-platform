/**
 * Locale osi TENANCKIEJ storefrontu. Język sklepu bierze się z `tenants.locale`
 * (zwracane przez app.get_public_catalog jako tenant.locale), a NIE z prefiksu
 * URL ani preferencji przeglądarki — kupujący widzi sklep w języku ustawionym
 * przez najemcę (patrz i18n/routing.ts, docblock osi tenanckiej).
 */
export type StorefrontLocale = "pl" | "en";

export const STOREFRONT_LOCALES: readonly StorefrontLocale[] = ["pl", "en"] as const;

/**
 * Normalizuje wartość z bazy do wspieranego locale. Domyślnie `pl` — historyczny
 * domyślny język tenanta (patrz (tenant)/layout.tsx). Nieznana wartość nie ma
 * prawa wywrócić renderu sklepu.
 */
export function normalizeStorefrontLocale(value: string | null | undefined): StorefrontLocale {
  return value === "en" ? "en" : "pl";
}
