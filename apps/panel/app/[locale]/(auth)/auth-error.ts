/**
 * Mapowanie błędów Supabase Auth na NASZE komunikaty (ADR-051).
 *
 * Powód: ekran rejestracji pokazywał surową treść dostawcy — w polskim
 * interfejsie wyświetliło się „email rate limit exceeded" (obserwacja z
 * produkcji). Treść dostawcy jest angielska, żargonowa, nie mówi
 * użytkownikowi co ma zrobić i zmienia się bez uprzedzenia.
 *
 * Rozróżnienie, na którym stoi cały ten moduł:
 *   - błąd z SUPABASE AUTH (angielski, do zmapowania) → przechodzi tędy,
 *   - błąd z NASZEJ bazy / naszego kodu (polski, pisany pod wyświetlenie —
 *     patrz komentarz w app/[locale]/organizacja/nowa/actions.ts) → NIE
 *     przechodzi tędy w ogóle, trafia na ekran taki, jaki jest.
 *
 * Mapujemy po `code`/`status`, nie po treści komunikatu: dostawca
 * przeredaguje zdanie i dopasowanie do tekstu umrze po cichu — komunikat
 * zamieni się w generyczny, testy dalej będą zielone, a nikt się nie dowie.
 * `code` jest częścią kontraktu API GoTrue, treść nie jest.
 */

/** Klucze w namespace `authError` w messages/{en,pl}.json. */
export type AuthErrorKey =
  | "emailRateLimit"
  | "tooManyRequests"
  | "emailTaken"
  | "weakPassword"
  | "linkExpired"
  | "samePassword"
  | "providerUnavailable"
  | "generic";

/**
 * Kształt błędu, na którym pracujemy. Celowo strukturalny, nie `AuthError`
 * z SDK: `instanceof` przez granicę bundlera bywa fałszywie ujemny, a i tak
 * czytamy wyłącznie te trzy pola.
 */
interface ProviderError {
  message?: unknown;
  code?: unknown;
  status?: unknown;
}

function readProviderError(error: unknown): ProviderError {
  return typeof error === "object" && error !== null ? (error as ProviderError) : {};
}

/**
 * Kody GoTrue → nasze klucze. Kilka kodów celowo wpada w jeden komunikat:
 * użytkownik i tak ma zrobić dokładnie to samo, a mnożenie wariantów tekstu
 * to tylko więcej do tłumaczenia.
 */
const CODE_MAP: Record<string, AuthErrorKey> = {
  // Limit wysyłki e-maili — TA obserwacja z produkcji. Limit siedzi po
  // stronie dostawcy i nie znika od odświeżenia strony, więc komunikat MUSI
  // nieść jedyną rzecz, którą użytkownik może zrobić: poczekać.
  over_email_send_rate_limit: "emailRateLimit",
  over_request_rate_limit: "tooManyRequests",

  user_already_exists: "emailTaken",
  email_exists: "emailTaken",
  identity_already_exists: "emailTaken",

  weak_password: "weakPassword",

  // Link z e-maila: wygasły, zużyty albo z innej przeglądarki niż ta, w
  // której zaczęła się rejestracja (PKCE).
  otp_expired: "linkExpired",
  flow_state_expired: "linkExpired",
  flow_state_not_found: "linkExpired",
  bad_code_verifier: "linkExpired",

  same_password: "samePassword",

  // Awaria po stronie dostawcy — łącznie z naszym Send Email Hookiem
  // (ADR-048), którego timeout GoTrue raportuje jako błąd hooka.
  unexpected_failure: "providerUnavailable",
  request_timeout: "providerUnavailable",
  hook_timeout: "providerUnavailable",
  hook_timeout_after_retry: "providerUnavailable",
};

/**
 * Zwraca klucz komunikatu dla błędu dostawcy. Cokolwiek nierozpoznanego →
 * `generic`: NIGDY nie oddajemy treści dostawcy na ekran.
 */
export function authErrorKey(error: unknown): AuthErrorKey {
  const { code, status } = readProviderError(error);

  if (typeof code === "string") {
    const mapped = CODE_MAP[code];
    if (mapped) return mapped;
  }

  // Bez kodu zostaje status. Starsze wydania GoTrue (i błędy powstałe zanim
  // przyjdzie odpowiedź HTTP) `code` nie niosą — wtedy 429 jest jedynym
  // sygnałem, że to limit. Nie da się wówczas odróżnić limitu wysyłki
  // e-maili od limitu żądań, więc idzie ostrożniejszy z dwóch komunikatów:
  // „za chwilę" jest prawdą w obu przypadkach, „za godzinę" tylko w jednym.
  if (typeof status === "number") {
    if (status === 429) return "tooManyRequests";
    if (status >= 500) return "providerUnavailable";
  }

  return "generic";
}

/**
 * Loguje surową treść dostawcy — jedyne miejsce, w którym wolno jej istnieć.
 *
 * Bez adresu użytkownika i bez tokenów: log rejestracji i resetu hasła
 * trafia do wspólnego strumienia platformy, a `scope` w zupełności wystarcza,
 * żeby dojść, z którego ekranu przyszedł błąd.
 */
export function logAuthProviderError(scope: string, error: unknown): void {
  const { message, code, status } = readProviderError(error);
  console.error(
    `[auth:${scope}] błąd dostawcy`,
    JSON.stringify({
      code: typeof code === "string" ? code : null,
      status: typeof status === "number" ? status : null,
      message: typeof message === "string" ? message : null,
    }),
  );
}
