/**
 * POLITYKA HASŁA — DOWÓD SERWEROWY (ADR-208).
 *
 * Wymaganie właściciela: min 8 znaków, ≥1 cyfra, ≥1 znak specjalny. Atrybuty
 * pola (`minLength`, `pattern`) są wyłącznie UX-em — dają się ominąć jednym
 * curlem, więc NICZEGO nie dowodzą. Ten plik mierzy bramkę tam, gdzie ona
 * naprawdę stoi:
 *
 *  1. SCHEMAT (`passwordSchema` przez `registerSchema`/`resetConfirmSchema`):
 *     cztery hasła-sondy z briefu właściciela, każde pali inną regułę.
 *  2. AKCJA (`registerAction`): słabe hasło jest odrzucone ZANIM cokolwiek
 *     poleci do dostawcy auth — `signUp` ma zero wywołań. To jest różnica
 *     między „walidacja istnieje" a „walidacja broni".
 *  3. WSPÓLNOŚĆ POLITYKI: reset hasła używa TEGO SAMEGO schematu — polityka
 *     egzekwowana tylko przy rejestracji byłaby fikcją, bo słabe hasło dałoby
 *     się ustawić chwilę później przez reset.
 *
 * Harness akcji jak w auth-anti-abuse.test.ts: limiter i CAPTCHA przepuszczają
 * (nie one są tu przedmiotem), komunikaty z PRAWDZIWEGO messages/pl.json.
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

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-for", "203.0.113.7"]]),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

// Limiter i CAPTCHA PRZEPUSZCZAJĄ — słabe hasło ma odpaść na WALIDACJI,
// a nie w cieniu innej bramki (inaczej test nie mierzyłby polityki hasła).
vi.mock("@avably/security/rate-limit", () => ({
  PANEL_AUTH_RATE_LIMIT_PREFIX: "panel-auth-rl",
  checkRateLimit: async () => ({ success: true, remaining: 1 }),
}));
vi.mock("@avably/security/turnstile", () => ({
  verifyTurnstile: async () => ({ ok: true }),
}));
vi.mock("@/lib/post-auth-next", () => ({ setPostAuthNext: () => {} }));

const signUp = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signUp } }),
}));

const { registerAction } = await import("@/app/[locale]/(auth)/register/actions");
const { passwordSchema, registerSchema, resetConfirmSchema } = await import("@/lib/validation");

/** Sondy z briefu właściciela — każda pali INNĄ regułę polityki. */
const WEAK_PASSWORDS: Array<[label: string, password: string, expectedMessage: string]> = [
  ["bez znaku specjalnego", "haslo123", "Hasło musi zawierać co najmniej jeden znak specjalny."],
  ["bez cyfry", "Haslo!!!", "Hasło musi zawierać co najmniej jedną cyfrę."],
  ["za krótkie", "Ab1!", "Hasło musi mieć co najmniej 8 znaków."],
];
const STRONG_PASSWORD = "Mocne1!x";

function registerForm(password: string): FormData {
  const form = new FormData();
  form.set("email", "kto@test.local");
  form.set("password", password);
  return form;
}

beforeEach(() => {
  signUp.mockClear();
});

describe("schemat hasła: min 8 + cyfra + znak specjalny (ADR-208)", () => {
  it.each(WEAK_PASSWORDS)("odrzuca hasło %s (%s)", (_label, password, expectedMessage) => {
    const parsed = passwordSchema.safeParse(password);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toContain(expectedMessage);
    }
  });

  it("przepuszcza hasło spełniające całą politykę (kontrola pozytywna)", () => {
    expect(passwordSchema.safeParse(STRONG_PASSWORD).success).toBe(true);
  });

  it("polityka stoi w registerSchema I resetConfirmSchema — reset nie jest furtką", () => {
    for (const [_label, password] of WEAK_PASSWORDS) {
      expect(registerSchema.safeParse({ email: "kto@test.local", password }).success).toBe(false);
      expect(resetConfirmSchema.safeParse({ password }).success).toBe(false);
    }
    expect(
      registerSchema.safeParse({ email: "kto@test.local", password: STRONG_PASSWORD }).success,
    ).toBe(true);
    expect(resetConfirmSchema.safeParse({ password: STRONG_PASSWORD }).success).toBe(true);
  });
});

describe("registerAction: bramka jest SERWEROWA, nie atrybutem pola", () => {
  it.each(WEAK_PASSWORDS)(
    "hasło %s: odmowa po polsku i ZERO wywołań dostawcy auth",
    async (_label, password, expectedMessage) => {
      const state = await registerAction({}, registerForm(password));

      expect(state.error).toBe(expectedMessage);
      expect(signUp, "słabe hasło dotarło do dostawcy auth — bramka nie broni").not.toHaveBeenCalled();
    },
  );

  it("hasło zgodne z polityką przechodzi walidację i dociera do dostawcy", async () => {
    // Sukces rejestracji kończy przekierowaniem na „sprawdź skrzynkę" —
    // dla tej kontroli liczy się, że walidacja NIE odcięła przebiegu.
    await registerAction({}, registerForm(STRONG_PASSWORD)).catch((error) => {
      if (!(error instanceof RedirectSignal)) throw error;
    });

    expect(signUp).toHaveBeenCalledTimes(1);
  });
});
