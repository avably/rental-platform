/**
 * Kanoniczna tożsamość produktu: nazwa, domeny, nadawca e-mail.
 *
 * Jedno źródło prawdy — nazwa produktu i domena nie są przepisywane ręcznie po
 * aplikacjach. Kanonem jest `www.avably.io` (host apex `avably.io` i wariant
 * bez `www` przekierowują na kanon — patrz `normalizeSiteUrl`).
 *
 * `.pl` NIE jest kanonem: pozostaje w portfelu domen jako polski wariant
 * marketingowy i przekierowanie na `.io`. Język polski wybiera locale `/pl`,
 * nie domena.
 */

export const PRODUCT_NAME = "Avably";

/** Domena rejestrowalna kanonu. Storefronty tenantów to jej subdomeny. */
export const ROOT_DOMAIN = "avably.io";

/** Kanoniczny adres strony publicznej. Każdy inny host redirectuje tutaj. */
export const CANONICAL_SITE_URL = `https://www.${ROOT_DOMAIN}`;

/** Panel (backoffice najemców + superadmin). */
export const PANEL_URL = `https://app.${ROOT_DOMAIN}`;

/**
 * Wildcard storefrontów tenantów: `*.avably.io`. Trzyma DNS/cert i routing
 * po hoście w zgodzie z kodem.
 */
export const TENANT_WILDCARD_HOST = `*.${ROOT_DOMAIN}`;

/**
 * Nadawca transakcyjny. Domena musi być zweryfikowana w Resend, inaczej
 * wysyłka jest odrzucana — dlatego wartość nadpisywalna przez
 * `RESEND_FROM_EMAIL` (np. `onboarding@resend.dev` zanim domena przejdzie
 * weryfikację).
 */
export const DEFAULT_FROM_EMAIL = `${PRODUCT_NAME} <noreply@${ROOT_DOMAIN}>`;

/** Subdomeny zarezerwowane — nie mogą zostać slugiem tenanta. */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  "www",
  "app",
  "admin",
  "api",
  "mail",
  "status",
  "docs",
  "blog",
  "help",
  "static",
  "assets",
  "cdn",
];

/** Publiczny adres storefrontu tenanta o danym slugu. */
export function tenantStorefrontUrl(slug: string): string {
  return `https://${slug}.${ROOT_DOMAIN}`;
}

/**
 * Sprowadza adres do kanonu: bez końcowego `/`, apex → `www`. Dzięki temu
 * `NEXT_PUBLIC_SITE_URL=https://avably.io` nie generuje linków poza kanonem
 * (dublet apex/www kosztowałby SEO i psuł cookies).
 */
export function normalizeSiteUrl(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === ROOT_DOMAIN) {
    url.hostname = `www.${ROOT_DOMAIN}`;
  }
  return url.origin;
}

/**
 * Bazowy adres do budowania linków absolutnych (e-maile, redirecty OAuth).
 *
 * Kolejność: jawny `NEXT_PUBLIC_SITE_URL` → kanon (produkcja) → localhost
 * (dev). Fallback dev NIE może być kanonem: link potwierdzający z lokalnego
 * uruchomienia prowadziłby na produkcję.
 */
export function siteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return normalizeSiteUrl(fromEnv);
  return process.env.NODE_ENV === "production" ? CANONICAL_SITE_URL : "http://127.0.0.1:3000";
}
