/**
 * Stała konfiguracja API GlobKurier (adresy środowisk, słowniki identyfikatorów).
 *
 * ŚWIADOMIE nie ma tu funkcji wyprowadzającej środowisko z NODE_ENV —
 * środowisko GlobKurier (test/production) jest konfiguracją TENANTA
 * (tenant_settings.globkurier_credentials.environment), bo jeden proces
 * panelu obsługuje wielu najemców naraz.
 */
import type { GlobKurierEnvironment } from "./types";

const GLOBKURIER_URLS: Record<GlobKurierEnvironment, string> = {
  production: "https://api.globkurier.pl/v1",
  test: "https://test.api.globkurier.pl/v1",
};

export function getApiUrl(environment: GlobKurierEnvironment): string {
  return GLOBKURIER_URLS[environment];
}

/** Identyfikatory płatności (GET /order/payments). */
export const PAYMENT_IDS = {
  ONLINE: 2, // płatność online
  BANK_TRANSFER: 1, // przelew bankowy
  DEFERRED: 4, // faktura zbiorcza (odroczony termin) — wymaga umowy
  PREPAID: 9, // konto pre-paid — wymaga doładowanego salda
} as const;

/** Identyfikatory krajów API. */
export const COUNTRY_IDS = {
  POLAND: 1,
} as const;
