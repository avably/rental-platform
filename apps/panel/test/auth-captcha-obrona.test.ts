/**
 * CAPTCHA DALEJ BRONI — TAM, GDZIE MA BRONIĆ (ADR-156, zakres z ADR-164).
 *
 * Restyling przestawił widżet CAPTCHY w nowe miejsce w drzewie (slot
 * centrujący). Zmiana była wyłącznie wizualna, ale dotykała DOKŁADNIE tego
 * fragmentu, który niesie token do akcji — a najgorszy możliwy skutek takiej
 * pomyłki jest cichy: formularz wygląda tak samo, widżet stoi na ekranie,
 * a do serwera nie jedzie nic i bramka przepuszcza wszystko.
 *
 * Test bije w AKCJE SERWEROWE (prawdziwe, nie atrapy) na obu krańcach:
 *   • żądanie BEZ ważnego tokenu → odmowa i ZERO dotknięcia dostawcy auth,
 *   • żądanie z ważnym tokenem → przejście (bramka nie jest zamknięta na
 *     głucho, więc pierwsza połowa czegoś dowodzi).
 *
 * ZAKRES PO ADR-164: bramka dotyczy REJESTRACJI i RESETU. Logowanie CAPTCHY
 * nie ma i nie pyta o nią dostawcy — to też jest tu mierzone (niżej), bo
 * „usunięte" i „usunięte tylko z formularza" wyglądają na ekranie identycznie,
 * a różnią się tym, czy da się je po cichu odwrócić.
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
    const state = await registerAction({}, form(CREDENTIALS));

    expect(state.error).toBe(pl.register.captchaFailed);
    expect(providerCalls).toEqual([]);
  });
});

/**
 * LOGOWANIE JEST POZA TĄ BRAMKĄ — I MA BYĆ (ADR-164).
 *
 * Mierzone jest mocniejsze zdanie niż „nie odmawia": logowanie NIE PYTA
 * weryfikatora w ogóle. Różnica jest istotna, bo `verifyTurnstile`
 * przepuszcza przy `providerError`, więc akcja z fail-openem wyglądałaby
 * dokładnie tak samo jak akcja bez CAPTCHY — aż do dnia, w którym dostawca
 * odpowie „nie" zamiast paść. Pusta lista wywołań weryfikatora nie da się
 * pomylić z fail-openem.
 */
describe("logowanie nie konsultuje CAPTCHY (ADR-164)", () => {
  it("weryfikator NIE jest wołany, a logowanie dochodzi do dostawcy auth", async () => {
    // Weryfikator ustawiony na ODMOWĘ (turnstileOk = false z beforeEach):
    // gdyby akcja go pytała, żądanie zostałoby odrzucone.
    await expect(loginAction({}, form(CREDENTIALS))).rejects.toBeInstanceOf(RedirectSignal);

    expect(verifyCalls, "logowanie pyta dostawcę CAPTCHY, choć CAPTCHY nie ma").toEqual([]);
    expect(providerCalls).toContain("signInWithPassword");
  });

  it("podrzucony `turnstileToken` niczego nie zmienia — pola po prostu nie ma", async () => {
    // Ktoś mógłby zostawić weryfikację, a usunąć tylko widżet. Wtedy
    // formularz wyglądałby jak teraz, a żądanie z ręcznie dorzuconym polem
    // zachowywałoby się inaczej niż bez niego.
    await expect(
      loginAction({}, form({ ...CREDENTIALS, turnstileToken: "cokolwiek" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(verifyCalls).toEqual([]);
  });

  it("KONTROLA POZYTYWNA: ten sam weryfikator JEST wołany przez rejestrację", async () => {
    // Bez tego obie asercje wyżej byłyby zielone także wtedy, gdyby mock
    // weryfikatora przestał być podpięty — czyli dowodziłyby zera.
    await registerAction({}, form({ ...CREDENTIALS, turnstileToken: "jakis-token" }));

    expect(verifyCalls).toEqual(["jakis-token"]);
  });
});

describe("KONTROLA POZYTYWNA: z ważnym tokenem bramka przepuszcza", () => {
  it("rejestracja z ważnym tokenem dochodzi do dostawcy auth", async () => {
    turnstileOk = true;

    await expect(
      registerAction({}, form({ ...CREDENTIALS, turnstileToken: "ok-token" })),
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(providerCalls, "bramka jest zamknięta na głucho").toContain("signUp");
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
