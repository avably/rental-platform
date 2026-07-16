/**
 * Bramka CI dla przekierowań guardów: redirect MUSI zachować locale, na którym
 * stał użytkownik. Regresja tutaj nie wywala builda i nie widać jej w typach —
 * polski użytkownik po prostu cicho ląduje na angielskim logowaniu.
 *
 * Zamockowany jest wyłącznie odczyt locale z kontekstu żądania (`getLocale`)
 * i wynik guarda. Prefiks liczy PRAWDZIWE `getPathname` z konfiguracji
 * routingu, więc test pilnuje realnego składania ścieżki, a nie własnej
 * atrapy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/lib/auth";

let currentLocale = "pl";

vi.mock("next-intl/server", () => ({
  getLocale: async () => currentLocale,
}));

/** Wyjątek zastępujący `redirect()` — niesie cel, żeby dało się go sprawdzić. */
class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}
class NotFoundSignal extends Error {}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  // next-intl owija oba warianty przy tworzeniu nawigacji — brak eksportu
  // wywala import, nawet jeśli test go nie używa.
  permanentRedirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new NotFoundSignal("NOT_FOUND");
  },
}));

const requireSuperadmin = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  requireSuperadmin: () => requireSuperadmin(),
  createSupabaseServerClient: async () => ({}),
}));

const { requireSuperadminPage, SUPERADMIN_HOME } = await import("@/lib/superadmin");
const { localePath } = await import("@/lib/navigation");

/** Uruchamia guarda i zwraca cel przekierowania (albo rzuca dalej). */
async function redirectTargetOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  throw new Error("Guard nie przekierował, a powinien.");
}

beforeEach(() => {
  currentLocale = "pl";
  requireSuperadmin.mockReset();
});

describe("localePath", () => {
  it.each(["pl", "en"])("dokleja prefiks bieżącego locale (%s)", async (locale) => {
    currentLocale = locale;
    expect(await localePath("/login")).toBe(`/${locale}/login`);
  });

  it("koduje parametry zapytania", async () => {
    currentLocale = "pl";
    const path = await localePath("/login", { next: "/admin/tenants" });

    expect(path).toBe("/pl/login?next=%2Fadmin%2Ftenants");
  });
});

describe("requireSuperadminPage — przekierowanie zachowuje locale", () => {
  it.each(["pl", "en"])("anonim na %s trafia na logowanie w SWOIM języku", async (locale) => {
    currentLocale = locale;
    requireSuperadmin.mockRejectedValue(new AuthError(401, "brak sesji"));

    const target = await redirectTargetOf(() => requireSuperadminPage());

    expect(target).toMatch(new RegExp(`^/${locale}/login\\b`));
  });

  it.each(["pl", "en"])("sesja aal1 z czynnikiem TOTP (%s) idzie na wyzwanie MFA w swoim języku", async (locale) => {
    currentLocale = locale;
    requireSuperadmin.mockRejectedValue(new AuthError(403, "mfa", "mfa_required"));

    const target = await redirectTargetOf(() => requireSuperadminPage());

    expect(target).toMatch(new RegExp(`^/${locale}/bezpieczenstwo/wyzwanie\\b`));
  });

  it.each(["pl", "en"])("superadmin bez 2FA (%s) idzie na włączenie 2FA w swoim języku", async (locale) => {
    currentLocale = locale;
    requireSuperadmin.mockRejectedValue(new AuthError(403, "brak 2fa", "mfa_enrollment_required"));

    const target = await redirectTargetOf(() => requireSuperadminPage());

    expect(target).toMatch(new RegExp(`^/${locale}/bezpieczenstwo\\b`));
  });

  it("parametr next zostaje BEZ prefiksu locale (żeby nie podwoić prefiksu po powrocie)", async () => {
    currentLocale = "pl";
    requireSuperadmin.mockRejectedValue(new AuthError(401, "brak sesji"));

    const target = await redirectTargetOf(() => requireSuperadminPage(SUPERADMIN_HOME));
    const next = new URL(target, "https://panel.example").searchParams.get("next");

    expect(next).toBe(SUPERADMIN_HOME);
    expect(next).not.toMatch(/^\/(en|pl)\//);
  });

  it("brak uprawnień superadmina to 404, nie przekierowanie", async () => {
    requireSuperadmin.mockRejectedValue(new AuthError(403, "nie superadmin"));

    await expect(requireSuperadminPage()).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("superadmin z aal2 przechodzi bez przekierowania", async () => {
    const ctx = { user: { id: "u1", email: "a@b.pl" }, superadmin: true, aal: "aal2" };
    requireSuperadmin.mockResolvedValue(ctx);

    await expect(requireSuperadminPage()).resolves.toBe(ctx);
  });
});
