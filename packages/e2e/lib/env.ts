/**
 * Stałe środowiska suity e2e.
 *
 * Porty są CELOWO niestandardowe (43xx zamiast 3000/3001): lokalna maszyna
 * bywa współdzielona między sesjami (podgląd panelu, inne worktree), a test
 * uderzający w cudzy serwer na 3000 weryfikowałby nie ten kod, który buduje.
 * `reuseExistingServer: false` w konfiguracji dodatkowo zamienia kolizję
 * portu w twardy błąd zamiast cichego reużycia.
 */
export const PANEL_PORT = 4300;
export const STOREFRONT_PORT = 4301;
export const STRIPE_STUB_PORT = 4302;

/**
 * Fikcyjne klucze Stripe dla toru stubowanego. Prefiksy `sk_test_`/`pk_test_`
 * przechodzą bramki kształtu `resolveStripeConfig` (obecność, brak zamiany
 * kluczy, zgodny tryb test/test). Sekret webhooka jest współdzielony między
 * procesem panelu (env) a testem (podpisywanie `signStripeWebhook`) — to
 * dokładnie kontrakt produkcyjny: podpis HMAC tym samym sekretem po obu
 * stronach.
 */
export const E2E_STRIPE_SECRET_KEY = "sk_test_e2e_stub_niepodlaczony";
export const E2E_STRIPE_PUBLISHABLE_KEY = "pk_test_e2e_stub_niepodlaczony";
export const E2E_STRIPE_WEBHOOK_SECRET = "whsec_e2e_stub_wspolny_sekret";

export const PANEL_URL = `http://localhost:${PANEL_PORT}`;
export const STRIPE_STUB_URL = `http://127.0.0.1:${STRIPE_STUB_PORT}`;

/**
 * Wspólny sekret relaya uwag przeglądu (ADR-099/ADR-115): storefront
 * uwierzytelnia się nim do ingest panelu. Fikcyjna wartość testowa —
 * kontrakt jak na hostingu: TA SAMA wartość w env obu serwerów, porównanie
 * stałoczasowe po stronie panelu.
 */
export const E2E_REVIEW_INGEST_TOKEN = "rit_e2e_wspolny_sekret_relaya";

/** Adres sklepu tenanta: wzorzec hosta `{slug}.localhost` działa lokalnie —
 * klasyfikacja hosta w proxy storefrontu strippuje port i mapuje subdomenę
 * `.localhost` na slug tenanta. Chromium dostaje dodatkowo twarde
 * `--host-resolver-rules`, żeby rozwiązanie nie zależało od resolvera OS. */
export function storefrontUrl(slug: string): string {
  return `http://${slug}.localhost:${STOREFRONT_PORT}`;
}

/** Zmienna wymagana w środowisku uruchomienia suity; brak = twardy błąd
 * (wzorzec repo: cichy brak środowiska nie może wyglądać jak zielony bieg). */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Brak zmiennej ${name}. Uruchom lokalny Supabase (packages/db: supabase start), ` +
        `potem wyeksportuj SUPABASE_LOCAL_* przez \`supabase status -o env\`.`,
    );
  }
  return value;
}
