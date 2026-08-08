/**
 * Rate-limit publicznego API v1 (M1, ADR-108) — DWA niezależne wymiary:
 * per KLUCZ (id wiersza klucza, nie hash) i per IP. Oba muszą przepuścić.
 *
 * DLACZEGO DWA WYMIARY: limit per klucz chroni przed najemcą, który
 * (świadomie lub przez błąd wtyczki) zalewa nas własnym kluczem; limit per
 * IP chroni przed hostem, który obraca wieloma kluczami (np. skradzionymi).
 * Wyczerpanie jednego wymiaru NIE resetuje drugiego — klucz zdławiony jest
 * zdławiony z każdego IP i odwrotnie (§6.5).
 *
 * PROGI (decyzja ADR-108): konsument to SERWER obsługujący wielu klientów
 * końcowych najemcy, więc progi są per-integracja, nie per-osoba:
 *   * odczyty (catalog/availability): 120/min per klucz, 300/min per IP —
 *     wtyczka renderująca katalog z cache mieści się z zapasem, skrypt
 *     zgarniający dostępność dzień-po-dniu w pętli dostaje 429,
 *   * rezerwacje: 30/h per klucz, 60/h per IP — ostrzejsze niż odczyty
 *     (mutacja = pieniądze), luźniejsze niż 10/h storefrontu per IP, bo za
 *     jednym kluczem/IP stoi cała populacja klientów najemcy.
 *
 * Okna idą przez współdzielony licznik w Postgresie (ADR-106) z WŁASNYM
 * prefiksem przestrzeni (STOREFRONT_API_RATE_LIMIT_PREFIX) — ruch API nie
 * zjada budżetów formularzy storefrontu.
 */

export interface RateLimitWindow {
  limit: number;
  windowSeconds: number;
}

export const API_READ_LIMIT_PER_KEY: RateLimitWindow = { limit: 120, windowSeconds: 60 };
export const API_READ_LIMIT_PER_IP: RateLimitWindow = { limit: 300, windowSeconds: 60 };
export const API_RESERVATION_LIMIT_PER_KEY: RateLimitWindow = { limit: 30, windowSeconds: 3600 };
export const API_RESERVATION_LIMIT_PER_IP: RateLimitWindow = { limit: 60, windowSeconds: 3600 };

/** Port licznika — produkcyjnie @avably/security/rate-limit z prefiksem API. */
export type CheckRateLimitFn = (
  key: string,
  opts: RateLimitWindow,
) => Promise<{ success: boolean }>;

export type ApiRateLimitKind = "read" | "reservation";

/**
 * Sprawdza OBA wymiary po kolei (klucz → IP). Krótkie spięcie po odmowie
 * pierwszego wymiaru jest świadome: zdławiony klucz nie dokłada zliczeń do
 * kubełka IP (żądanie i tak nie wykona pracy), a odmowa pozostaje odmową
 * niezależnie od stanu drugiego wymiaru.
 */
export async function checkApiRateLimits(
  kind: ApiRateLimitKind,
  keyId: string,
  ip: string,
  checkRateLimit: CheckRateLimitFn,
): Promise<{ success: boolean }> {
  const [perKey, perIp] =
    kind === "read"
      ? [API_READ_LIMIT_PER_KEY, API_READ_LIMIT_PER_IP]
      : [API_RESERVATION_LIMIT_PER_KEY, API_RESERVATION_LIMIT_PER_IP];

  const keyResult = await checkRateLimit(`api:${kind}:key:${keyId}`, perKey);
  if (!keyResult.success) return { success: false };

  const ipResult = await checkRateLimit(`api:${kind}:ip:${ip}`, perIp);
  if (!ipResult.success) return { success: false };

  return { success: true };
}
