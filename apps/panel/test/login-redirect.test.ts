/**
 * Bramka CI dla decyzji „dokąd po zalogowaniu".
 *
 * Regresja tutaj nie wywala builda ani typów — po prostu KTOŚ ląduje nie tam,
 * gdzie powinien. Tak było z founderem: warunek patrzył wyłącznie na
 * `tenant_id`, więc superadmin (który organizacji nie ma i mieć nie musi)
 * dostawał po zalogowaniu ekran „Załóż organizację" zamiast panelu
 * superadmina.
 *
 * Zamockowane są wyłącznie: locale, wynik logowania i claimy JWT. Kolejność
 * warunków w akcji liczy się NAPRAWDĘ — dlatego jest tu przypadek superadmina
 * Z organizacją (ma iść do panelu, nie do /admin).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let currentLocale = "pl";

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
  getLocale: async () => currentLocale,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-for", "127.0.0.1"]]),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

// Limity i CAPTCHA nie są przedmiotem tego testu — przepuszczamy.
vi.mock("@avably/security/rate-limit", () => ({
  PANEL_AUTH_RATE_LIMIT_PREFIX: "test",
  checkRateLimit: async () => ({ success: true }),
}));
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: async () => ({ ok: true }),
}));

/** Claimy, które zwróci `getClaims()` — sterują tożsamością w teście. */
let claims: Record<string, unknown> | null = null;
const signInWithPassword = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword,
      getClaims: async () => (claims ? { data: { claims }, error: null } : { data: null, error: null }),
    },
  }),
}));

const { loginAction } = await import("@/app/[locale]/(auth)/login/actions");
const { SUPERADMIN_HOME } = await import("@/lib/superadmin");

/** Uruchamia logowanie i zwraca cel przekierowania. */
async function loginRedirect(): Promise<string> {
  const form = new FormData();
  form.set("email", "kto@test.local");
  form.set("password", "Haslo!12345678");

  try {
    await loginAction({}, form);
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  throw new Error("Logowanie nie przekierowało, a powinno.");
}

function claimsFor({ tenantId, superadmin }: { tenantId?: string | null; superadmin?: boolean }) {
  return {
    sub: "user-1",
    email: "kto@test.local",
    aal: "aal1",
    app_metadata: { tenant_id: tenantId ?? null, superadmin: superadmin ?? false },
  };
}

beforeEach(() => {
  currentLocale = "pl";
  claims = null;
  signInWithPassword.mockClear();
});

describe("loginAction — dokąd po zalogowaniu", () => {
  it("członek organizacji ląduje w panelu", async () => {
    claims = claimsFor({ tenantId: "t-1" });

    expect(await loginRedirect()).toBe("/pl");
  });

  it("user bez organizacji idzie zakładać organizację", async () => {
    claims = claimsFor({ tenantId: null });

    expect(await loginRedirect()).toBe("/pl/organizacja/nowa");
  });

  it("superadmin BEZ organizacji idzie do panelu superadmina, nie na „Załóż organizację”", async () => {
    claims = claimsFor({ tenantId: null, superadmin: true });

    expect(await loginRedirect()).toBe(`/pl${SUPERADMIN_HOME}`);
  });

  it("superadmin Z organizacją ląduje w panelu (pracuje jako członek)", async () => {
    claims = claimsFor({ tenantId: "t-1", superadmin: true });

    expect(await loginRedirect()).toBe("/pl");
  });

  it.each(["pl", "en"])("cel niesie locale logowania (%s)", async (locale) => {
    currentLocale = locale;
    claims = claimsFor({ tenantId: null, superadmin: true });

    expect(await loginRedirect()).toBe(`/${locale}${SUPERADMIN_HOME}`);
  });
});
