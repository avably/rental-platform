/**
 * Anti-abuse tras auth panelu (L2, ADR-106) — bramka CI dla trzech reguł:
 *
 *  1. KLUCZ LIMITU NIE Z GOŁEGO x-forwarded-for: akcje przechodzą przez
 *     clientIpFromHeaders (moduł PRAWDZIWY, nie mock) — podrobiony prefiks
 *     XFF nie zmienia klucza, wymiar kontowy jest po znormalizowanym
 *     (lowercase) adresie. Progi i okna są tu przybite na sztywno — zmiana
 *     progu ma być świadomą zmianą testu (i ADR), nie przypadkiem.
 *  2. ODPOWIEDŹ PRZY LIMICIE JEDNOLITA: ten sam komunikat niezależnie od
 *     tego, który wymiar strzelił (IP vs konto) — i żadnego dotknięcia
 *     dostawcy auth po odcięciu (brak sondy istnienia konta).
 *  3. AWARIA DOSTAWCY CAPTCHA (providerError): login fail-open (rate-limit
 *     dalej stoi), register/reset fail-closed — rozstrzygnięcie ADR-106.
 *
 * `getTranslations` karmione PRAWDZIWYMI messages/{pl,en}.json — asercje
 * porównują tekst, który użytkownik naprawdę zobaczy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import pl from "../messages/pl.json";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  permanentRedirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "pl",
  getTranslations: async (namespace: string) => {
    const messages: Record<string, unknown> = pl;
    return (key: string) => {
      const namespaceMessages = messages[namespace];
      const value =
        typeof namespaceMessages === "object" && namespaceMessages !== null
          ? (namespaceMessages as Record<string, unknown>)[key]
          : undefined;
      if (typeof value !== "string") {
        throw new Error(`brak tłumaczenia ${namespace}.${key}`);
      }
      return value;
    };
  },
}));

/** Nagłówki żądania — sterowane per przypadek (podrabianie XFF). */
let currentHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => currentHeaders,
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

/** Rejestr wywołań limitera + sterowanie, który klucz ma być odcięty. */
interface RateLimitCall {
  key: string;
  limit: number;
  windowSeconds: number;
  prefix: string;
}
let rateLimitCalls: RateLimitCall[] = [];
let rateLimitFailFor: string | null = null;

vi.mock("@avably/security/rate-limit", () => ({
  PANEL_AUTH_RATE_LIMIT_PREFIX: "panel-auth-rl",
  checkRateLimit: async (
    key: string,
    opts: { limit: number; windowSeconds: number; prefix: string },
  ) => {
    rateLimitCalls.push({ key, ...opts });
    const success = rateLimitFailFor === null || !key.includes(rateLimitFailFor);
    return { success, remaining: success ? 1 : 0 };
  },
}));

// UWAGA: @avably/security/client-ip celowo BEZ mocka — reguła „ostatni hop,
// nie deklaracja klienta" jest przedmiotem tych testów (dowód mutacyjny M3).

/** Wynik weryfikacji CAPTCHA — sterowany per przypadek. */
let turnstileResult: { ok: boolean; providerError?: boolean } = { ok: true };
vi.mock("@avably/security/turnstile", () => ({
  verifyTurnstile: async () => turnstileResult,
}));

vi.mock("@/lib/post-auth-next", () => ({ setPostAuthNext: () => {} }));

const signInWithPassword = vi.fn(async () => ({ error: null }));
const signUp = vi.fn(async () => ({ error: null }));
const resetPasswordForEmail = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithPassword, signUp, resetPasswordForEmail },
  }),
}));
vi.mock("@/lib/auth", () => ({
  // Brak tenanta i uprawnień — login kończy przekierowaniem na zakładanie
  // organizacji; dla tych testów liczy się samo DOTARCIE do przekierowania.
  getAuthContext: async () => null,
}));

const { loginAction } = await import("@/app/[locale]/(auth)/login/actions");
const { registerAction } = await import("@/app/[locale]/(auth)/register/actions");
const { resetRequestAction } = await import("@/app/[locale]/(auth)/reset/actions");

const TOO_MANY = pl.authError.tooManyRequests;

function authForm(email = "kto@test.local"): FormData {
  const form = new FormData();
  form.set("email", email);
  form.set("password", "Haslo!12345678");
  return form;
}

/** Login połyka RedirectSignal — sukces logowania to przekierowanie. */
async function runLogin(form: FormData): Promise<{ error?: string } | "redirected"> {
  try {
    return await loginAction({}, form);
  } catch (error) {
    if (error instanceof RedirectSignal) return "redirected";
    throw error;
  }
}

beforeEach(() => {
  rateLimitCalls = [];
  rateLimitFailFor = null;
  turnstileResult = { ok: true };
  currentHeaders = new Map([["x-forwarded-for", "203.0.113.7"]]);
  signInWithPassword.mockClear();
  signUp.mockClear();
  resetPasswordForEmail.mockClear();
});

describe("klucz limitu: zaufane IP, nie deklaracja klienta", () => {
  it("login: podrobiony prefiks XFF nie zmienia klucza IP (liczy się ostatni hop)", async () => {
    currentHeaders = new Map([["x-forwarded-for", "6.6.6.6, 198.51.100.7"]]);
    await runLogin(authForm());

    const ipCall = rateLimitCalls.find((call) => call.key.startsWith("login:ip:"));
    expect(ipCall?.key, "klucz limitu wziął deklarację klienta zamiast hopu proxy").toBe(
      "login:ip:198.51.100.7",
    );
  });

  it("login: x-real-ip (nagłówek platformy) wygrywa z x-forwarded-for", async () => {
    currentHeaders = new Map([
      ["x-real-ip", "198.51.100.9"],
      ["x-forwarded-for", "6.6.6.6"],
    ]);
    await runLogin(authForm());

    expect(rateLimitCalls.find((call) => call.key.startsWith("login:ip:"))?.key).toBe(
      "login:ip:198.51.100.9",
    );
  });

  it("login: wymiar kontowy po znormalizowanym (lowercase) adresie", async () => {
    await runLogin(authForm("Ktos@Test.LOCAL"));

    expect(rateLimitCalls.find((call) => call.key.startsWith("login:email:"))?.key).toBe(
      "login:email:ktos@test.local",
    );
  });

  it("progi i okna zgodne z ADR-106 (login 10/min/IP + 5/min/konto, register 5/h/IP, reset 3/h/IP + 3/h/adres)", async () => {
    await runLogin(authForm());
    // Sukces rejestracji kończy przekierowaniem — tu liczą się wywołania limitera.
    await registerAction({}, authForm()).catch((error) => {
      if (!(error instanceof RedirectSignal)) throw error;
    });
    await resetRequestAction({}, authForm());

    const byKey = Object.fromEntries(
      rateLimitCalls.map((call) => [
        call.key.split(":").slice(0, 2).join(":"),
        { limit: call.limit, windowSeconds: call.windowSeconds, prefix: call.prefix },
      ]),
    );
    expect(byKey).toEqual({
      "login:ip": { limit: 10, windowSeconds: 60, prefix: "panel-auth-rl" },
      "login:email": { limit: 5, windowSeconds: 60, prefix: "panel-auth-rl" },
      "register:ip": { limit: 5, windowSeconds: 3600, prefix: "panel-auth-rl" },
      "reset:ip": { limit: 3, windowSeconds: 3600, prefix: "panel-auth-rl" },
      "reset:email": { limit: 3, windowSeconds: 3600, prefix: "panel-auth-rl" },
    });
  });
});

describe("odpowiedź przy limicie: jednolita i bez sondy konta", () => {
  it("login: ten sam komunikat niezależnie od wymiaru (IP vs konto)", async () => {
    rateLimitFailFor = "login:ip:";
    const byIp = await runLogin(authForm());
    rateLimitFailFor = "login:email:";
    const byEmail = await runLogin(authForm());

    expect(byIp).toEqual({ error: TOO_MANY });
    expect(byEmail, "komunikat zdradza, który wymiar limitu strzelił").toEqual(byIp);
  });

  it("login: po odcięciu limiter NIE dotyka dostawcy auth (zero sondy istnienia konta)", async () => {
    rateLimitFailFor = "login:email:";
    await runLogin(authForm());
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("register i reset przy limicie mówią tym samym komunikatem co login", async () => {
    rateLimitFailFor = "register:ip:";
    expect(await registerAction({}, authForm())).toEqual({ error: TOO_MANY });
    expect(signUp).not.toHaveBeenCalled();

    rateLimitFailFor = "reset:email:";
    expect(await resetRequestAction({}, authForm())).toEqual({ error: TOO_MANY });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("awaria dostawcy CAPTCHA (providerError) — ADR-106", () => {
  it("login: fail-open — logowanie przechodzi (rate-limit dalej stoi)", async () => {
    turnstileResult = { ok: false, providerError: true };
    expect(await runLogin(authForm())).toBe("redirected");
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("login: zwykła odmowa CAPTCHA (bez providerError) blokuje normalnie", async () => {
    turnstileResult = { ok: false };
    expect(await runLogin(authForm())).toEqual({ error: pl.login.captchaFailed });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("register: fail-closed — odmowa i zero wywołań dostawcy auth", async () => {
    turnstileResult = { ok: false, providerError: true };
    expect(await registerAction({}, authForm())).toEqual({ error: pl.register.captchaFailed });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("reset: fail-closed — odmowa i zero wysłanych maili", async () => {
    turnstileResult = { ok: false, providerError: true };
    expect(await resetRequestAction({}, authForm())).toEqual({
      error: pl.resetRequest.captchaFailed,
    });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
