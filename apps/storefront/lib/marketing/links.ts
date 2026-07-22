import { PANEL_URL, type Locale } from "@avably/core";

/**
 * Adresy panelu wołane ze stron marketingowych.
 *
 * Kanon domen (`brand.ts`): marketing stoi pod `www.avably.io`, panel pod
 * `app.avably.io` — to dwa osobne origin, więc CTA „Załóż sklep” NIE jest
 * routingiem wewnętrznym Next.js, tylko zwykłym linkiem wychodzącym. Prefiks
 * locale w panelu jest zawsze jawny (`localePrefix: "always"`), stąd język
 * strony przenosi się do rejestracji zamiast startować od nowa na EN.
 */
export function registerUrl(locale: Locale): string {
  return `${PANEL_URL}/${locale}/register`;
}

export function loginUrl(locale: Locale): string {
  return `${PANEL_URL}/${locale}/login`;
}
