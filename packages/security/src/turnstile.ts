/**
 * Weryfikacja Cloudflare Turnstile — osobny entrypoint (jak ./rate-limit),
 * bo nie potrzebuje Next.js. Semantyka konfiguracji jest LUSTREM
 * apps/panel/lib/turnstile.ts (docelowo panel przechodzi na ten moduł —
 * dług odnotowany w ADR-032):
 *
 *  - brak sekretu → dev-skip: przepuszcza, ostrzegając w logu; CAPTCHA jest
 *    wtedy JAWNIE wyłączona (dev/CI bez kluczy),
 *  - sekret ustawiony → fail-closed: brak tokenu, odmowa siteverify albo
 *    błąd HTTP oznaczają odmowę — nigdy przepuszczenie. Dotyczy to także
 *    awarii po stronie Cloudflare: CAPTCHA chwilowo blokująca zapisy jest
 *    tańsza niż okno, w którym boty wchodzą bez weryfikacji.
 *
 * Transport (`fetchFn`) jest wstrzykiwany, żeby testy nie biły w sieć.
 */
export const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  ok: boolean;
  devSkip?: boolean;
}

export interface TurnstileVerifyOptions {
  /** Sekret siteverify; domyślnie process.env.TURNSTILE_SECRET_KEY. */
  secret?: string | undefined;
  /** Transport do testów; domyślnie globalny fetch. */
  fetchFn?: typeof fetch;
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

  if (!token) return { ok: false };

  const response = await fetchFn(TURNSTILE_SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, response: token }),
  });
  if (!response.ok) return { ok: false };
  const data = (await response.json()) as { success: boolean };
  return { ok: data.success };
}
