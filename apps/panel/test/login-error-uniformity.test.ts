/**
 * SONDA BEZPIECZEŃSTWA ADR-153 (N3): komunikat błędu logowania przestał
 * kłamać, ale NADAL nie ujawnia, czy konto istnieje.
 *
 * To jest kompromis do UTRZYMANIA, nie do zniesienia — i dlatego ma własną
 * bramkę CI. Naprawa dotyczy WYŁĄCZNIE brzmienia: „Nieprawidłowy e-mail lub
 * hasło" było po prostu NIEPRAWDĄ dla człowieka z poprawnym hasłem
 * i niepotwierdzonym adresem (dostawca zwraca wtedy `email_not_confirmed`),
 * więc szedł w reset hasła, który mu nie pomaga.
 *
 * CZEGO NIE WOLNO ZROBIĆ, mimo pokusy: osobnego komunikatu dla
 * `email_not_confirmed`. Ten kod przychodzi DOPIERO po sprawdzeniu hasła,
 * więc własny tekst zdradzałby dwie rzeczy naraz — że konto pod tym adresem
 * ISTNIEJE i że podane hasło było POPRAWNE. Wyrocznia enumeracji kont
 * i weryfikacji haseł w jednym.
 *
 * Mierzone są OBIE STRONY: trzy różne odmowy dostawcy dają identyczny stan
 * CO DO ZNAKU, a poprawne logowanie dalej przechodzi (bramka nie jest
 * zamknięta na głucho). `getTranslations` karmione PRAWDZIWYM pl.json —
 * asercja porównuje tekst, który człowiek naprawdę zobaczy.
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
  getTranslations: async (namespace: string) => (key: string) => {
    const dictionary = (pl as unknown as Record<string, Record<string, string>>)[namespace];
    const value = dictionary?.[key];
    if (!value) throw new Error(`Brak klucza ${namespace}.${key} w messages/pl.json`);
    return value;
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-real-ip", "198.51.100.7"]]),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

// Limity i CAPTCHA mają własne suity — tu zawsze przepuszczają, żeby każdy
// przypadek dochodził do odpowiedzi DOSTAWCY, o którą w tym pliku chodzi.
vi.mock("@avably/security/rate-limit", () => ({
  PANEL_AUTH_RATE_LIMIT_PREFIX: "test",
  checkRateLimit: async () => ({ success: true, remaining: 1 }),
}));
vi.mock("@avably/security/turnstile", () => ({
  verifyTurnstile: async () => ({ ok: true }),
}));

/** Błąd, który zwróci dostawca — sterowany per przypadek. */
let providerError: { code?: string; message: string; status?: number } | null = null;
const signInWithPassword = vi.fn(async () => ({ error: providerError }));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithPassword } }),
}));
vi.mock("@/lib/auth", () => ({ getAuthContext: async () => null }));

const { loginAction } = await import("@/app/[locale]/(auth)/login/actions");

function form(email: string): FormData {
  const data = new FormData();
  data.set("email", email);
  data.set("password", "Haslo!12345678");
  return data;
}

async function run(email: string): Promise<{ error?: string } | "redirected"> {
  try {
    return await loginAction({}, form(email));
  } catch (error) {
    if (error instanceof RedirectSignal) return "redirected";
    throw error;
  }
}

/**
 * Trzy odmowy dostawcy o RÓŻNYM znaczeniu — i to jest sedno: różnica między
 * nimi nie może wyciec na ekran.
 *
 *  • `invalid_credentials` — adres nie istnieje ALBO hasło jest złe (GoTrue
 *    świadomie nie rozróżnia tych dwóch),
 *  • `email_not_confirmed` — konto ISTNIEJE, hasło było POPRAWNE, brakuje
 *    tylko potwierdzenia adresu,
 *  • awaria dostawcy — trzeci, całkiem inny powód.
 */
const PROVIDER_REFUSALS = [
  {
    label: "adres nieistniejący albo złe hasło (invalid_credentials)",
    error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 },
  },
  {
    label: "konto istnieje, hasło poprawne, adres niepotwierdzony (email_not_confirmed)",
    error: { code: "email_not_confirmed", message: "Email not confirmed", status: 400 },
  },
  {
    label: "awaria po stronie dostawcy (unexpected_failure)",
    error: { code: "unexpected_failure", message: "Database error querying schema", status: 500 },
  },
] as const;

beforeEach(() => {
  providerError = null;
  signInWithPassword.mockClear();
});

describe("logowanie: jeden komunikat na wszystkie odmowy (bez enumeracji kont)", () => {
  it("trzy różne odmowy dostawcy dają IDENTYCZNY stan", async () => {
    const states: { label: string; state: unknown }[] = [];
    for (const refusal of PROVIDER_REFUSALS) {
      providerError = { ...refusal.error };
      states.push({ label: refusal.label, state: await run("kto@test.local") });
    }

    const expected = { error: pl.login.signInFailed };
    for (const { label, state } of states) {
      expect(state, `komunikat rozjechał się dla przypadku: ${label}`).toEqual(expected);
    }
  });

  it("treść dostawcy nie trafia na ekran w ŻADNYM z tych przypadków", async () => {
    for (const refusal of PROVIDER_REFUSALS) {
      providerError = { ...refusal.error };
      const state = await run("kto@test.local");

      expect(
        JSON.stringify(state),
        `surowa treść dostawcy wyciekła: ${refusal.error.message}`,
      ).not.toContain(refusal.error.message);
      expect(JSON.stringify(state)).not.toContain(refusal.error.code);
    }
  });

  it("adres w komunikacie się nie pojawia — nawet ten, który wpisano", async () => {
    providerError = { ...PROVIDER_REFUSALS[0].error };
    const state = await run("ktos.konkretny@test.local");

    expect(JSON.stringify(state)).not.toContain("ktos.konkretny@test.local");
  });

  it("komunikat mówi też o potwierdzeniu adresu (przestał kłamać o samym haśle)", async () => {
    providerError = { ...PROVIDER_REFUSALS[1].error };
    const state = await run("kto@test.local");

    // Bez tego zdania człowiek z niepotwierdzonym adresem nie ma jak
    // zgadnąć, czego mu brakuje — a osobnego komunikatu dostać nie może.
    expect((state as { error: string }).error).toContain("potwierdź adres");
  });

  it("kontrola pozytywna: poprawne logowanie dalej przechodzi (bramka nie jest głucha)", async () => {
    providerError = null;

    expect(await run("kto@test.local")).toBe("redirected");
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });
});
