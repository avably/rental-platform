/**
 * Ponowienie e-maila potwierdzającego (L4, ADR-105) — `resendConfirmationAction`.
 *
 * To trasa PUBLICZNA, więc mierzone są tu dwie rzeczy, które łatwo zepsuć
 * dobrą intencją („pokażmy użytkownikowi, co się stało"):
 *
 *   1. ZERO ENUMERACJI KONT — odpowiedź jest identyczna dla adresu, którego
 *      nie ma, adresu niepotwierdzonego i adresu już potwierdzonego. Test
 *      podstawia TRZY różne odpowiedzi dostawcy (w tym limit per adres, który
 *      GoTrue liczy osobno dla każdego e-maila) i porównuje stany co do znaku.
 *   2. LIMIT — po wyczerpaniu okna akcja odmawia, zamiast dalej zlecać wysyłkę.
 *
 * Treść dostawcy nie ma prawa dotrzeć na ekran (ADR-051) — sprawdzane wprost.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import pl from "../messages/pl.json";

const RAW_PROVIDER_MESSAGE = "User already confirmed";

let providerError: { message: string; code?: string; status?: number } | null = null;
let rateLimitAllowed = true;
const resend = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-for", "203.0.113.7"]]),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
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

vi.mock("@avably/security/rate-limit", () => ({
  PANEL_AUTH_RATE_LIMIT_PREFIX: "test",
  checkRateLimit: async () => ({ success: rateLimitAllowed, remaining: 0 }),
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      resend: async (params: { type: string; email: string }) => {
        resend(params);
        return { error: providerError };
      },
    },
  }),
}));

const { resendConfirmationAction } = await import(
  "@/app/[locale]/(auth)/register/sprawdz-skrzynke/actions"
);

function form(email: string): FormData {
  const data = new FormData();
  data.set("email", email);
  return data;
}

describe("resendConfirmationAction — brak enumeracji kont (ADR-105)", () => {
  beforeEach(() => {
    providerError = null;
    rateLimitAllowed = true;
    resend.mockClear();
  });

  it("odpowiedź jest IDENTYCZNA dla adresu nieistniejącego, niepotwierdzonego i potwierdzonego", async () => {
    // Wariant 1: adres bez konta — GoTrue odpowiada sukcesem (sam nie
    // enumeruje), ale nawet gdyby zmienił zachowanie, treść i tak jest jedna.
    providerError = null;
    const unknownAddress = await resendConfirmationAction({}, form("nikt@test.local"));

    // Wariant 2: konto istnieje i czeka na potwierdzenie.
    providerError = null;
    const pendingAccount = await resendConfirmationAction({}, form("czeka@test.local"));

    // Wariant 3: konto już potwierdzone — dostawca zwraca błąd.
    providerError = { message: RAW_PROVIDER_MESSAGE, code: "user_already_confirmed", status: 422 };
    const confirmedAccount = await resendConfirmationAction({}, form("gotowe@test.local"));

    // Wariant 4: limit dostawcy liczony PER ADRES — najostrzejszy wektor
    // enumeracji, bo odpowiada wyłącznie na adresy, które istnieją.
    providerError = { message: "email rate limit exceeded", code: "over_email_send_rate_limit", status: 429 };
    const throttledByProvider = await resendConfirmationAction({}, form("limit@test.local"));

    const expected = { success: pl.checkInbox.resendDone };
    expect(unknownAddress).toEqual(expected);
    expect(pendingAccount).toEqual(expected);
    expect(confirmedAccount).toEqual(expected);
    expect(throttledByProvider).toEqual(expected);
  });

  it("treść dostawcy nie trafia na ekran", async () => {
    providerError = { message: RAW_PROVIDER_MESSAGE, code: "user_already_confirmed", status: 422 };
    const state = await resendConfirmationAction({}, form("gotowe@test.local"));

    expect(JSON.stringify(state)).not.toContain(RAW_PROVIDER_MESSAGE);
    expect(state.error).toBeUndefined();
  });

  it("wysyła ponowienie rejestracji na PODANY adres, znormalizowany", async () => {
    await resendConfirmationAction({}, form("  Ktos@Test.Local  "));
    expect(resend).toHaveBeenCalledWith({ type: "signup", email: "ktos@test.local" });
  });

  it("po wyczerpaniu limitu odmawia i NIE zleca wysyłki", async () => {
    rateLimitAllowed = false;
    const state = await resendConfirmationAction({}, form("czeka@test.local"));

    expect(state.error).toBe(pl.checkInbox.resendThrottled);
    expect(state.success).toBeUndefined();
    expect(resend, "przy odmowie limitu nie wolno wołać dostawcy").not.toHaveBeenCalled();
  });

  it("błędny format adresu odrzuca przed dotknięciem dostawcy", async () => {
    const state = await resendConfirmationAction({}, form("to-nie-jest-adres"));

    expect(state.error).toBeTruthy();
    expect(state.success).toBeUndefined();
    expect(resend).not.toHaveBeenCalled();
  });
});
