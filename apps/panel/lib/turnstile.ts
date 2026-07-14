/**
 * Weryfikacja Cloudflare Turnstile na register/login/reset. Bez skonfigurowanego
 * `TURNSTILE_SECRET_KEY` działa w trybie dev-skip (przepuszcza, ostrzegając w
 * logu) — patrz scripts/audit-public-env.sh, który dopuszcza wyłącznie
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` jako publiczny klucz strony.
 *
 * TODO(Task 3 infra): dodać TURNSTILE_SECRET_KEY + NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * po stronie hostingu, usunąć/ukryć widżet Turnstile w UI dopóki
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY nie jest ustawiony (żeby nie renderować
 * pustego/martwego widżetu w dev).
 */
let warnedDevSkip = false;

export interface TurnstileResult {
  ok: boolean;
  devSkip?: boolean;
}

export async function verifyTurnstile(token: string | undefined): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (!warnedDevSkip) {
      console.warn(
        "[turnstile] TURNSTILE_SECRET_KEY nie ustawiony — tryb dev-skip, CAPTCHA NIE jest weryfikowana. " +
          "Ustaw klucz przed produkcją (patrz TODO w lib/turnstile.ts).",
      );
      warnedDevSkip = true;
    }
    return { ok: true, devSkip: true };
  }

  if (!token) return { ok: false };

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, response: token }),
  });
  const data = (await response.json()) as { success: boolean };
  return { ok: data.success };
}
