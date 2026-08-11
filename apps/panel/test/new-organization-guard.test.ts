/**
 * Guard onboardingu `/organizacja/nowa` (C1 UI-only, UX1/ADR-140).
 *
 * Hook tokenów wybiera NAJSTARSZE członkostwo, więc druga organizacja po
 * utworzeniu byłaby nieosiągalna (audyt IA-4) — ekran zakładania jest więc
 * WYŁĄCZNIE dla sesji bez organizacji:
 *   1. sesja Z organizacją → redirect na `/` (lustro guardu logowania:
 *      bez tenanta → tutaj, z tenantem → pulpit);
 *   2. sesja BEZ organizacji → formularz (onboarding działa jak dotąd);
 *   3. anonim → logowanie (z prefiksem locale);
 *   4. deklaracji limitu („maks. 2 organizacje") nie ma w treści — wejście
 *      i obietnica limitu schowane do czasu przełącznika organizacji.
 */
import { describe, expect, it, vi } from "vitest";

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
  getTranslations: async () => (key: string) => key,
}));

let claims: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () =>
        claims ? { data: { claims }, error: null } : { data: null, error: null },
    },
    // Od 0070 ekran rozwiązuje bieżącą wersję regulaminu platformy
    // (readCurrentPlatformTerms). NULL = nic nie obowiązuje — formularz ma
    // wyglądać jak przed 0070; kontrakt checkboxa ma własny test
    // (organizacja-nowa-terms.test.tsx).
    schema: () => ({ rpc: async () => ({ data: null, error: null }) }),
  }),
}));

const NewTenantPage = (await import("@/app/[locale]/(panel)/organizacja/nowa/page"))
  .default;

async function redirectTarget(): Promise<string | null> {
  try {
    await NewTenantPage();
    return null;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
}

describe("guard /organizacja/nowa (C1 UI-only)", () => {
  it("sesja Z organizacją jest odsyłana na `/` — druga organizacja byłaby nieosiągalna", async () => {
    claims = {
      sub: "00000000-0000-4000-8000-000000000001",
      email: "operator@example.com",
      aal: "aal1",
      app_metadata: { tenant_id: "00000000-0000-4000-8000-000000000009", role: "owner" },
    };

    expect(await redirectTarget()).toBe("/pl");
  });

  it("sesja BEZ organizacji dostaje formularz zakładania (onboarding bez zmian)", async () => {
    claims = { sub: "u-bez-org", email: "nowy@example.com", aal: "aal1", app_metadata: {} };

    const tree = await NewTenantPage();
    expect(tree).toBeTruthy();
    // Deklaracja limitu zniknęła z treści (C1: chowamy wejście i obietnicę).
    expect(JSON.stringify(tree)).not.toContain("maks. 2");
  });

  it("anonim idzie na logowanie w swoim języku", async () => {
    claims = null;
    expect(await redirectTarget()).toBe("/pl/login");
  });
});
