/**
 * Formatowanie kwot. Waluta jest DANYMI, nie stałą — PLN jest dziś jedyną
 * walutą rozliczeniową, ale nic w kodzie nie może tego zakładać (EUR/USD
 * dochodzą wraz z rynkami poza PL).
 *
 * Kwoty trzymamy w jednostkach podrzędnych (grosze/cents) jako `int` — liczby
 * zmiennoprzecinkowe nie nadają się do pieniędzy.
 */

export const SUPPORTED_CURRENCIES = ["PLN", "EUR", "USD"] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/** Waluta rozliczeniowa domyślna dla nowych planów (rynek startowy: PL). */
export const DEFAULT_CURRENCY: CurrencyCode = "PLN";

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Ile jednostek podrzędnych mieści się w jednostce głównej. Wszystkie
 * obsługiwane dziś waluty mają wykładnik 2; waluty zerowo-groszowe (JPY) będą
 * wymagały wpisu tutaj, dlatego wartość jest w tabeli, a nie w literale 100.
 */
const MINOR_UNITS_PER_MAJOR: Record<CurrencyCode, number> = {
  PLN: 100,
  EUR: 100,
  USD: 100,
};

/**
 * Kwota do wyświetlenia w danym locale. Locale steruje ZAPISEM (separatory,
 * pozycja symbolu), waluta — symbolem: "1 299,00 zł" w `pl`, "PLN 1,299.00"
 * w `en`. To dwie niezależne osie i nie wolno ich sklejać.
 */
export function formatMoney(amountMinor: number, currency: CurrencyCode, locale: string): string {
  const divisor = MINOR_UNITS_PER_MAJOR[currency];
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountMinor / divisor);
}
