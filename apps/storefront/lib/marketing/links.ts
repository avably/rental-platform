import { PANEL_URL, type Locale } from "@avably/core";

/**
 * Adresy panelu wołane ze stron marketingowych.
 *
 * Kanon domen (`brand.ts`): marketing stoi pod `www.avably.io`, panel pod
 * `app.avably.io` — to dwa osobne origin, więc CTA rejestracji i odnośnik
 * logowania NIE są routingiem wewnętrznym Next.js, tylko zwykłymi linkami
 * wychodzącymi. Prefiks locale w panelu jest zawsze jawny
 * (`localePrefix: "always"`), stąd język strony przenosi się do panelu zamiast
 * startować od nowa na EN.
 *
 * To JEDYNE miejsce, w którym te dwa adresy powstają (ADR-162): `marketingLinks`
 * liczyło je drugi raz u siebie, a dwa źródła jednego adresu to dwa miejsca do
 * pominięcia przy zmianie domeny panelu.
 */
export function registerUrl(locale: Locale): string {
  return `${PANEL_URL}/${locale}/register`;
}

export function loginUrl(locale: Locale): string {
  return `${PANEL_URL}/${locale}/login`;
}
