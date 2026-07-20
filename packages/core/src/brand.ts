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
 * Subdomena, z której wychodzi poczta transakcyjna. To ONA jest zweryfikowana
 * u dostawcy (DKIM/SPF/DMARC), a apex `avably.io` świadomie NIE JEST —
 * uzasadnienie w ADR-047. Stała, bo host wysyłkowy należy do tożsamości
 * produktu tak samo jak kanon strony czy adres panelu.
 */
export const SENDING_SUBDOMAIN = "send";

/** Pełny host wysyłkowy: `send.avably.io`. */
export const SENDING_DOMAIN = `${SENDING_SUBDOMAIN}.${ROOT_DOMAIN}`;

/**
 * Nadawca transakcyjny — domyślny adres platformy.
 *
 * CELUJE W DOMENĘ WYSYŁKOWĄ, NIE W APEX (ADR-047). Wcześniejsza wartość
 * (`noreply@avably.io`) wskazywała domenę, której u dostawcy nikt nie
 * weryfikował: pierwsza realna wiadomość na produkcji padła błędem 403
 * („the avably.io domain is not verified"), a ratunkiem było ręczne ustawienie
 * `RESEND_FROM_EMAIL`. Domyślna wartość gwarantująca odmowę dostawcy jest
 * pułapką czekającą na każde świeże wdrożenie — a tu nie ma czego zgadywać,
 * bo host wysyłkowy jest naszą stałą, nie sekretem (inaczej niż klucz API,
 * którego brak MUSI dawać jawną niedostępność — ADR-033).
 *
 * Nadpisanie przez `RESEND_FROM_EMAIL` zostaje: pozwala przejść na inny adres
 * (np. `onboarding@resend.dev` na świeżym koncie) bez wydawania wersji kodu.
 */
export const DEFAULT_FROM_EMAIL = `${PRODUCT_NAME} <noreply@${SENDING_DOMAIN}>`;

/**
 * Subdomeny zarezerwowane — nie mogą zostać slugiem tenanta.
 *
 * DWIE BRAMKI CZYTAJĄ TĘ LISTĘ i muszą pozostać zgodne:
 *   1. routing storefrontu (`classifyHost`, ADR-039) — host zarezerwowany
 *      trafia w gałąź marketingową, nigdy w sklep najemcy,
 *   2. `app.reserved_subdomains()` w bazie (migracja 0023) — `app.create_tenant`
 *      odrzuca taki slug już przy ZAKŁADANIU organizacji.
 * Rozjazd obu zbiorów pali `packages/db/test/reserved-slugs.test.ts`. Dopisując
 * wpis tutaj, dopisz go także w migracji (i odwrotnie).
 */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  "www",
  "app",
  "admin",
  "api",
  "mail",
  // Host poczty transakcyjnej (SENDING_SUBDOMAIN): slug `send` dałby najemcy
  // storefront pod hostem trzymającym rekordy DKIM/SPF platformy.
  SENDING_SUBDOMAIN,
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
 * Sam HOST subdomeny tenanta (bez schematu) — postać, w jakiej trafia do
 * `public.domains.domain` i do rejestracji u dostawcy hostingu (Zadanie 2.6).
 * Lustro wyrażenia w app.create_tenant (0022): tam ta sama wartość powstaje
 * w SQL-u, bo wiersz musi być w tej samej transakcji co tenant — hardcode
 * roota po tamtej stronie jest ŚWIADOMY (parametr pozwoliłby zarejestrować
 * dowolny host jako od razu zweryfikowany, patrz komentarz w 0022).
 */
export function tenantSubdomainHost(slug: string): string {
  return `${slug.toLowerCase()}.${ROOT_DOMAIN}`;
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
