/**
 * Języki produktu. Avably jest międzynarodowy od startu — kod nigdzie nie
 * zakłada polskiego, mimo że GTM startuje w PL.
 *
 * Uwaga: to są DWIE niezależne osie i mylenie ich kosztuje bugi.
 *
 * 1. Locale PLATFORMY — język panelu i stron marketingowych. Wybierany przez
 *    prefiks ścieżki (`/en`, `/pl`), obsługiwany przez next-intl.
 * 2. Locale TENANTA — język storefrontu konkretnego najemcy (kolumna
 *    `tenants.locale`). Najemca z EN-owym storefrontem może pracować w panelu
 *    po polsku i odwrotnie.
 */

export const LOCALES = ["en", "pl"] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Domyślne locale platformy. EN, nie PL — domyślny język to decyzja
 * produktowa (produkt międzynarodowy), nie odbicie kolejności wejścia na
 * rynki.
 */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Domyślne locale nowego tenanta. PL, bo pierwsi najemcy są z rynku
 * polskiego — oś niezależna od DEFAULT_LOCALE.
 */
export const DEFAULT_TENANT_LOCALE: Locale = "pl";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Locale -> tag BCP 47 do `<html lang>`, `Intl.*` i hreflang. Trzymane jawnie,
 * bo "en"/"pl" to identyfikatory routingu, a nie automatycznie poprawne tagi
 * językowe dla wszystkiego, co dojdzie później (np. "pt-BR").
 */
const BCP47: Record<Locale, string> = {
  en: "en",
  pl: "pl",
};

export function bcp47(locale: Locale): string {
  return BCP47[locale];
}
