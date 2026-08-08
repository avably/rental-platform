/**
 * Weryfikacja Cloudflare Turnstile — osobny entrypoint (jak ./rate-limit),
 * bo nie potrzebuje Next.js. Jedyna implementacja siteverify w repo (dawna
 * kopia apps/panel/lib/turnstile.ts skonsolidowana tutaj — ADR-032).
 *
 * Semantyka konfiguracji (ADR-032, anty-lockout z ADR-106):
 *
 *  - brak sekretu → dev-skip: przepuszcza, ostrzegając w logu; CAPTCHA jest
 *    wtedy JAWNIE wyłączona (dev/CI bez kluczy, prod PRZED ustawieniem
 *    sekretu przez właściciela — kod z widżetem może wejść pierwszy),
 *  - sekret ustawiony → token wymagany: brak tokenu albo odmowa siteverify
 *    (HTTP 200, success:false) oznaczają odmowę — nigdy przepuszczenie.
 *
 * AWARIA DOSTAWCY jest od ADR-106 sygnalizowana JAWNIE (`providerError`):
 * timeout, błąd transportu, nie-2xx albo niesparsowalna odpowiedź to nie to
 * samo co „token zły". Wołający decyduje, czy przy awarii Cloudflare
 * przepuścić (login panelu — fail-open, żeby awaria nie odcinała operatorów
 * od ich firm; rate-limit dalej stoi) czy odmówić (register/reset i cały
 * storefront — fail-closed, `ok:false` wystarcza). Wynik NIGDY nie jest
 * cache'owany między żądaniami — każdy token przechodzi własne siteverify.
 *
 * Transport (`fetchFn`) jest wstrzykiwany, żeby testy nie biły w sieć.
 */
export const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Limit czasu siteverify — awaria dostawcy nie może wieszać logowania. */
export const TURNSTILE_TIMEOUT_MS = 5000;

export interface TurnstileResult {
  ok: boolean;
  devSkip?: boolean;
  /**
   * Weryfikacja NIE ODBYŁA SIĘ z winy dostawcy/transportu (timeout, nie-2xx,
   * wyjątek fetch). Zawsze w parze z `ok: false` — fail-closed pozostaje
   * zachowaniem domyślnym, fail-open jest świadomą decyzją wołającego.
   */
  providerError?: boolean;
}

export interface TurnstileVerifyOptions {
  /** Sekret siteverify; domyślnie process.env.TURNSTILE_SECRET_KEY. */
  secret?: string | undefined;
  /** Transport do testów; domyślnie globalny fetch. */
  fetchFn?: typeof fetch;
  /** Limit czasu żądania siteverify; domyślnie TURNSTILE_TIMEOUT_MS. */
  timeoutMs?: number;
}

let warnedDevSkip = false;

export async function verifyTurnstile(
  token: string | undefined,
  options: TurnstileVerifyOptions = {},
): Promise<TurnstileResult> {
  // `in` zamiast `??`: jawne `secret: undefined` to decyzja wołającego
  // (test, wymuszony dev-skip) i nie może spaść na env procesu.
  const secret = "secret" in options ? options.secret : process.env.TURNSTILE_SECRET_KEY;
  const fetchFn = options.fetchFn ?? fetch;

  if (!secret) {
    if (!warnedDevSkip) {
      console.warn(
        "[turnstile] TURNSTILE_SECRET_KEY nie ustawiony — tryb dev-skip, CAPTCHA NIE jest weryfikowana.",
      );
      warnedDevSkip = true;
    }
    return { ok: true, devSkip: true };
  }

  // Brak tokenu przy ustawionym sekrecie = odmowa BEZ sieci. To nie jest
  // awaria dostawcy — klient nie rozwiązał wyzwania.
  if (!token) return { ok: false };

  try {
    const response = await fetchFn(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(options.timeoutMs ?? TURNSTILE_TIMEOUT_MS),
    });
    // Nie-2xx to problem dostawcy/konfiguracji (siteverify odpowiada 200
    // także dla złych tokenów — odmowa przychodzi w success:false).
    if (!response.ok) return { ok: false, providerError: true };
    const data = (await response.json()) as { success?: unknown };
    if (typeof data.success !== "boolean") return { ok: false, providerError: true };
    return { ok: data.success };
  } catch {
    return { ok: false, providerError: true };
  }
}
