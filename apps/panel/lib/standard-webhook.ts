/**
 * Weryfikacja podpisu w schemacie Standard Webhooks — używanym przez Supabase
 * Auth Hooks (ADR-048).
 *
 * ŹRÓDŁO KONTRAKTU (nie zgadywane, sprawdzone przed implementacją):
 *  - specyfikacja: https://github.com/standard-webhooks/standard-webhooks
 *    (spec/standard-webhooks.md) — nagłówki `webhook-id`, `webhook-timestamp`,
 *    `webhook-signature`; podpisywana treść to `id.timestamp.body` sklejone
 *    kropkami; HMAC-SHA256 kodowany base64; nagłówek podpisu to lista
 *    rozdzielona SPACJAMI, każdy wpis w postaci `v1,<base64>`; sekret
 *    symetryczny jest base64 z prefiksem `whsec_`,
 *  - Supabase: https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
 *    — sekret hooka wydawany jest w postaci `v1,whsec_<base64>` i przed
 *    użyciem zdejmuje się z niego ten prefiks.
 *
 * ROBIMY TO SAMI, ZAMIAST DOKŁADAĆ ZALEŻNOŚĆ. Referencyjny przykład Supabase
 * ciągnie `standardwebhooks` z esm.sh w Edge Function (Deno). Tu jesteśmy w
 * trasie Next.js: cała operacja to jeden HMAC z `node:crypto`, a wzorzec repo
 * dla integracji zewnętrznych jest właśnie taki (`verifyTurnstile`, port
 * Resend) — jawny kod, wstrzykiwany czas, zero sieci w testach.
 *
 * FAIL-CLOSED BEZ WYJĄTKÓW: każda ścieżka, która nie jest udowodnionym
 * dopasowaniem podpisu, kończy się odmową. Nie ma tu odpowiednika dev-skipu
 * z Turnstile (ADR-032) — ten endpoint stoi otworem na internet i przepuszczenie
 * żądania bez sekretu oznaczałoby, że dowolny obcy może kazać nam wysłać
 * wiadomość z linkiem logującym pod adres, który sam poda.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Tolerancja znacznika czasu. Pięć minut w każdą stronę — wartość domyślna
 * referencyjnych implementacji schematu. Bez niej podpis raz podsłuchany
 * byłby ważny wiecznie (replay).
 */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export type WebhookVerificationFailure =
  | "secret_not_configured"
  | "secret_malformed"
  | "missing_headers"
  | "timestamp_invalid"
  | "timestamp_out_of_tolerance"
  | "signature_mismatch";

export type WebhookVerificationResult =
  | { ok: true }
  | { ok: false; reason: WebhookVerificationFailure; message: string };

/** Nagłówki schematu. Czytane case-insensitive — nagłówki HTTP nie mają wielkości liter. */
export interface StandardWebhookHeaders {
  get(name: string): string | null;
}

export interface VerifyStandardWebhookInput {
  /** Sekret w postaci `v1,whsec_<base64>` (albo samo `whsec_<base64>`/base64). */
  secret: string | undefined;
  headers: StandardWebhookHeaders;
  /** SUROWE ciało żądania. Ponowna serializacja JSON-a zmieniłaby bajty i podpis. */
  payload: string;
  /** Czas do porównania ze znacznikiem; wstrzykiwany, żeby testy nie zależały od zegara. */
  now?: Date;
}

/**
 * Zdejmuje prefiksy i dekoduje sekret do bajtów klucza HMAC.
 * Zwraca `null`, gdy sekret nie jest poprawnym base64 — sekret, którego nie da
 * się zdekodować, jest brakiem sekretu, nie kluczem „prawie dobrym".
 */
function decodeSecret(raw: string): Buffer | null {
  const base64 = raw.trim().replace(/^v1,/, "").replace(/^whsec_/, "");
  if (base64.length === 0) return null;
  const decoded = Buffer.from(base64, "base64");
  // Buffer.from tolerancyjnie zjada śmieci — porównanie w drugą stronę
  // odrzuca wartości, które base64 nie są.
  if (decoded.length === 0) return null;
  return decoded;
}

/** Porównanie odporne na atak czasowy; różne długości zwracają false bez rzucania. */
function equalsConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function signStandardWebhook(input: {
  secret: string;
  id: string;
  timestamp: string;
  payload: string;
}): string {
  const key = decodeSecret(input.secret);
  if (!key) throw new Error("Sekret webhooka nie jest poprawnym base64.");
  return createHmac("sha256", key)
    .update(`${input.id}.${input.timestamp}.${input.payload}`)
    .digest("base64");
}

export function verifyStandardWebhook(
  input: VerifyStandardWebhookInput,
): WebhookVerificationResult {
  // BRAK SEKRETU = ODMOWA, nie „przepuść w dev". Endpoint jest publicznie
  // osiągalny, więc brak konfiguracji to stan, w którym NIE WOLNO działać.
  if (!input.secret) {
    return {
      ok: false,
      reason: "secret_not_configured",
      message: "Hook nie jest skonfigurowany (brak SUPABASE_EMAIL_HOOK_SECRET).",
    };
  }

  const key = decodeSecret(input.secret);
  if (!key) {
    return {
      ok: false,
      reason: "secret_malformed",
      message: "Sekret hooka ma nieprawidłowy format (oczekiwane v1,whsec_<base64>).",
    };
  }

  const id = input.headers.get("webhook-id");
  const timestamp = input.headers.get("webhook-timestamp");
  const signatureHeader = input.headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) {
    return {
      ok: false,
      reason: "missing_headers",
      message: "Brak nagłówków podpisu (webhook-id, webhook-timestamp, webhook-signature).",
    };
  }

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    return {
      ok: false,
      reason: "timestamp_invalid",
      message: "Nagłówek webhook-timestamp nie jest liczbą sekund.",
    };
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - seconds) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    return {
      ok: false,
      reason: "timestamp_out_of_tolerance",
      message: "Znacznik czasu żądania jest poza dopuszczalnym oknem.",
    };
  }

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${input.payload}`)
    .digest("base64");

  // Nagłówek może nieść KILKA podpisów (rotacja sekretu po stronie nadawcy).
  // Wystarczy jeden pasujący, ale każdy musi mieć wersję `v1` — wpis bez
  // rozpoznanej wersji jest ignorowany, nigdy akceptowany „na wszelki wypadek".
  const matched = signatureHeader
    .split(" ")
    .filter((entry) => entry.startsWith("v1,"))
    .some((entry) => equalsConstantTime(entry.slice("v1,".length), expected));

  if (!matched) {
    return {
      ok: false,
      reason: "signature_mismatch",
      message: "Podpis żądania nie zgadza się z sekretem hooka.",
    };
  }

  return { ok: true };
}
