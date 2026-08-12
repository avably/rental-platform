/**
 * CAPTCHA DALEJ BRONI — sonda bezpieczeństwa restylingu (ADR-156).
 *
 * Restyling przestawił widżet CAPTCHY w nowe miejsce w drzewie (slot
 * centrujący). Zmiana jest wyłącznie wizualna, ale dotyka DOKŁADNIE tego
 * fragmentu, który niesie token do akcji — a najgorszy możliwy skutek takiej
 * pomyłki jest cichy: formularz wygląda tak samo, widżet stoi na ekranie,
 * a do serwera nie jedzie nic i bramka przepuszcza wszystko.
 *
 * Test bije w AKCJE SERWEROWE (prawdziwe, nie atrapy) na obu krańcach:
 *   • żądanie BEZ ważnego tokenu → odmowa i ZERO dotknięcia dostawcy auth,
 *   • żądanie z ważnym tokenem → przejście (bramka nie jest zamknięta na
 *     głucho, więc pierwsza połowa czegoś dowodzi).
 *
 * Zamockowana jest granica sieci: weryfikator CAPTCHY, limiter i klient
 * Supabase. Sama logika akcji jest prawdziwa.
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
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "pl",
  getTranslations: async (namespace: string) => {
    const messages = pl as Record<string, unknown>;
    return (key: string) => {
      const block = messages[namespace];
      const value =
        typeof block === "object" && block !== null
          ? (block as Record<string, unknown>)[key]
          : undefined;
      if (typeof value !== "string") throw new Error(`brak tłumaczenia ${namespace}.${key}`);
      return value;
    };
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-real-ip", "203.0.113.7"]]),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

vi.mock("@avably/security/rate-limit", () => ({
  PANEL_AUTH_RATE_LIMIT_PREFIX: "panel-auth-rl",
  checkRateLimit: async () => ({ success: true }),
}));

/** Werdykt weryfikatora CAPTCHY — sterowany per przypadek. */
let turnstileOk = false;
const verifyCalls: Array<string | undefined> = [];
vi.mock("@avably/security/turnstile", () => ({
  verifyTurnstile: async (token?: string) => {
    verifyCalls.push(token);
    return { ok: turnstileOk, providerError: false };
  },
}));

/** Wywołania dostawcy auth — dowód, że po odmowie NIC do niego nie idzie. */
const providerCalls: string[] = [];
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword: async () => {
        providerCalls.push("signInWithPassword");
        return { error: null };
      },
      signUp: async () => {
        providerCalls.push("signUp");
        return { error: null };
      },
      resetPasswordForEmail: async () => {
        providerCalls.push("resetPasswordForEmail");
        return { error: null };
      },
      getClaims: async () => ({ data: { claims: { sub: "u1" } }, error: null }),
    },
  }),
}));

vi.mock("@/lib/auth", () => ({
  getAuthContext: async () => ({ tenantId: "t1", superadmin: false, amr: [] }),
}));

vi.mock("@/lib/navigation", () => ({ localePath: async (path: string) => `/pl${path}` }));
vi.mock("@/lib/post-auth-next", () => ({ setPostAuthNext: async () => {} }));

const { loginAction } = await import("@/app/[locale]/(auth)/login/actions");
const { registerAction } = await import("@/app/[locale]/(auth)/register/actions");
const { resetRequestAction } = await import("@/app/[locale]/(auth)/reset/actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const CREDENTIALS = { email: "kto@test.local", password: "Haslo!12345678" };

beforeEach(() => {
  providerCalls.length = 0;
  verifyCalls.length = 0;
  turnstileOk = false;
});

describe("bez ważnego tokenu CAPTCHY akcje odmawiają", () => {
  it("logowanie odmawia i nie pyta dostawcy auth o nic", async () => {
    const state = await loginAction({}, form({ ...CREDENTIALS, turnstileToken: "" }));

    expect(state.error, "logowanie przeszło bez CAPTCHY").toBe(pl.login.captchaFailed);
    expect(providerCalls, "po odmowie CAPTCHY poszła sonda do dostawcy auth").toEqual([]);
  });

  it("rejestracja odmawia i nie zakłada konta", async () => {
    const state = await registerAction({}, form({ ...CREDENTIALS, turnstileToken: "" }));

    expect(state.error).toBe(pl.register.captchaFailed);
    expect(providerCalls).toEqual([]);
  });

  it("reset hasła odmawia i nie wysyła maila", async () => {
    const state = await resetRequestAction({}, form({ email: CREDENTIALS.email, turnstileToken: "" }));

    expect(state.error).toBe(pl.resetRequest.captchaFailed);
    expect(providerCalls).toEqual([]);
  });

  it("token W OGÓLE nieprzysłany (brak pola) też jest odmawiany", async () => {
    // Regresja, którą łatwo wprowadzić restylingiem: slot bez zawartości.
    // Formularz wygląda normalnie, a pole `turnstileToken` nie istnieje.
    const state = await loginAction({}, form(CREDENTIALS));

    expect(state.error).toBe(pl.login.captchaFailed);
    expect(providerCalls).toEqual([]);
  });
});

describe("KONTROLA POZYTYWNA: z ważnym tokenem bramka przepuszcza", () => {
  it("logowanie z ważnym tokenem dochodzi do dostawcy auth", async () => {
    turnstileOk = true;

    await expect(
      loginAction({}, form({ ...CREDENTIALS, turnstileToken: "ok-token" })),
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(providerCalls, "bramka jest zamknięta na głucho").toContain("signInWithPassword");
    expect(verifyCalls, "token z formularza nie dotarł do weryfikatora").toContain("ok-token");
  });

  it("reset z ważnym tokenem wysyła i zwraca odpowiedź NEUTRALNĄ", async () => {
    turnstileOk = true;

    const state = await resetRequestAction(
      {},
      form({ email: CREDENTIALS.email, turnstileToken: "ok-token" }),
    );

    expect(providerCalls).toContain("resetPasswordForEmail");
    // Odpowiedź nie zdradza, czy konto istnieje — ADR-153 zostaje nietknięte.
    expect(state.success).toBe(pl.resetRequest.successNeutral);
  });
});
