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

/**
 * TRZY FORMY LICZEBNIKA. Polski ma trzy („1 sztuka / 2 sztuki / 5 sztuk"),
 * angielski dwie — więc w słownikach EN `few` jest kopią `many`, a parytet
 * kluczy pilnuje test. Trzymamy szablony, nie gotowe napisy: token wstawia
 * wołający, bo raz jest nim `{total}` (licznik pozycji), a raz `{units}`
 * (chip dostępności).
 */
export interface PluralForms {
  one: string;
  few: string;
  many: string;
}

/**
 * WYBÓR FORMY LICZEBNIKA — jedno miejsce reguły dla całego produktu.
 *
 * Rozstrzyga `Intl.PluralRules`, a nie drabinka `if` po końcówkach: ta myli się
 * po polsku na 12–14 („12 sztuki") i na setkach. Kategorie CLDR spoza `one`
 * i `few` schodzą na `many` — dla obu naszych języków to jest właściwa forma
 * domyślna (`other` w angielskim czyta się jak `many`).
 *
 * Reguła żyje w rdzeniu, a nie w słowniku sklepu, bo pytają o nią DWA pakiety:
 * trasy sklepu (licznik pozycji, koszyk) i renderer kafla z pakietu UI, który
 * słownika najemcy nie zna. Druga kopia znaczyłaby „Została 1 szt." w jednym
 * miejscu i „Zostały 1 szt." w drugim — dokładnie ta wada, którą F11 zamyka.
 */
export function pluralFormOf(count: number, locale: Locale, forms: PluralForms): string {
  const rule = new Intl.PluralRules(bcp47(locale)).select(count);
  return rule === "one" ? forms.one : rule === "few" ? forms.few : forms.many;
}
