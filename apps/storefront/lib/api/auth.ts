/**
 * Uwierzytelnienie publicznego API v1 kluczem per najemca (M1, ADR-108).
 *
 * MODEL: `Authorization: Bearer avbl_<64 hex>`. Aplikacja liczy sha256
 * surowego klucza i pyta wąską ścieżkę bazy (app.verify_api_key, 0053)
 * o tenanta. SUROWY KLUCZ NIE OPUSZCZA TEGO MODUŁU: do bazy (i w ogóle
 * w sieć) idzie wyłącznie hash — nawet log transportu PostgREST nie ma
 * czego wyciec.
 *
 * ODPORNOŚĆ CZASOWA: nigdzie nie porównujemy sekretu wprost — surowy klucz
 * przechodzi przez sha256, a dopiero skrót idzie do lookupu po indeksie.
 * Napastnik mierzący czas porównania hashy nie steruje relacją
 * „mój bajt ~ bajt sekretu" (preimage sha256), więc oracle czasowy z
 * porównania nie istnieje. Precedens `timingSafeEqual` (trasy jobów panelu)
 * dotyczy porównania surowych sekretów — tu porównania surowego sekretu
 * NIE MA.
 *
 * ZERO PRACY BEZ KLUCZA (§6.2): bramka formatu odcina żądania bez nagłówka,
 * ze złym schematem i z kluczem-śmieciem ZANIM policzy się hash i ZANIM
 * wywoła się baza — dowodem jest licznik wywołań `verify` w testach, nie kod
 * odpowiedzi.
 */
import { createHash } from "node:crypto";

/** Format surowego klucza: rozpoznawalny prefiks produktowy + 32 bajty hex. */
const RAW_KEY_PATTERN = /^avbl_[0-9a-f]{64}$/;

/** Długość prefiksu identyfikacyjnego pokazywanego w panelu (avbl_ + 8 hex). */
export const API_KEY_PREFIX_LENGTH = 13;

/** Wynik weryfikacji: tenant WYŁĄCZNIE z klucza — nigdy z żądania. */
export interface VerifiedApiKey {
  tenantId: string;
  /** Identyfikator WIERSZA klucza (nie sekret) — wymiar rate-limitu per klucz. */
  keyId: string;
  /** Status tenanta — route rozstrzyga, czy sklep przyjmuje ruch. */
  tenantStatus: string;
}

/** Port weryfikacji hasha (produkcyjnie: RPC app.verify_api_key). */
export type VerifyApiKeyHash = (keyHash: string) => Promise<VerifiedApiKey | null>;

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Uwierzytelnia żądanie po nagłówku Authorization. `null` = jednolita odmowa
 * (401) — wołający NIE dowiaduje się, który warunek nie przeszedł.
 */
export async function authenticateApiRequest(
  authorizationHeader: string | null,
  verify: VerifyApiKeyHash,
): Promise<VerifiedApiKey | null> {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) return null;
  const rawKey = authorizationHeader.slice("Bearer ".length).trim();
  // Bramka formatu PRZED hashem i bazą — klucz-prefiks, klucz obcięty i
  // śmieć odpadają tu, bez żadnej dalszej pracy.
  if (!RAW_KEY_PATTERN.test(rawKey)) return null;
  return verify(hashApiKey(rawKey));
}

/**
 * Statusy tenanta, dla których publiczna powierzchnia przyjmuje ruch —
 * LUSTRO bramek `status in ('trialing','active')` w RPC publicznych (0020).
 * Rozjazd tych zbiorów dawałby klucz działający na katalogu, ale nie na
 * rezerwacji (albo odwrotnie).
 */
export const API_ACTIVE_TENANT_STATUSES: readonly string[] = ["trialing", "active"];
