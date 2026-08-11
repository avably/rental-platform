/**
 * NAJWAŻNIEJSZY DOWÓD ZADANIA 2.6 (ADR-046): awaria API domen NIE MOŻE wywrócić
 * zakładania organizacji.
 *
 * Rejestracja hosta u dostawcy hostingu jest wywołaniem sieciowym do usługi
 * TRZECIEJ, doczepionym do onboardingu. Gdyby jej błąd propagował się w górę,
 * pięciominutowy incydent u dostawcy oznaczałby, że nikt nie założy konta.
 *
 * DOWÓD MUTACYJNY: zdejmij `catch` w
 * packages/core/src/vercel/registration.ts (albo zwęź go do VercelDomainsError)
 * i ten plik się PALI — akcja przestaje dojść do redirectu. Restore przywraca
 * zieleń. Ten sam mutant pali testy w registration.test.ts.
 *
 * Testujemy PRAWDZIWĄ ścieżkę: realny `registerDomainSafely` i realny port,
 * z podłożoną awarią transportu. Podmiana `registerDomainSafely` atrapą
 * uczyniłaby ten test bezwartościowym — sprawdzałby atrapę, nie zabezpieczenie.
 */
import {
  RUNNING_PROJECT_ENV,
  STOREFRONT_PROJECT_ENV,
  STOREFRONT_TOKEN_ENV,
} from "@avably/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-4000-8000-0000000000aa";

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

vi.mock("@/lib/navigation", () => ({
  localePath: async (path: string) => `/pl${path}`,
}));

vi.mock("@/lib/auth", () => ({
  getAuthContext: async () => ({ userId: "user-1" }),
  AuthError: class AuthError extends Error {},
}));

/** Zapis stanu domeny, jaki akcja wykonała po próbie rejestracji. */
let domainUpdates: Record<string, unknown>[] = [];
let rpcCalls: { fn: string; args: unknown }[] = [];

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    schema: () => ({
      rpc: async (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        // Od 0070 akcja NAJPIERW rozwiązuje bieżącą wersję regulaminu
        // platformy — NULL = nic nie obowiązuje, czyli droga sprzed 0070.
        // Kontrakt akceptacji ma własny test (organizacja-nowa-terms).
        if (fn === "get_platform_terms") return { data: null, error: null };
        return { data: TENANT_ID, error: null };
      },
    }),
    auth: { refreshSession: async () => ({ data: {}, error: null }) },
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        domainUpdates.push(payload);
        return { eq: async () => ({ data: [], error: null }) };
      },
    }),
  }),
}));

function formData(): FormData {
  const fd = new FormData();
  fd.set("slug", "acme-2-6");
  fd.set("name", "Wypożyczalnia Acme");
  return fd;
}

async function runCreateTenant(): Promise<RedirectSignal> {
  const { createTenantAction } = await import("@/app/[locale]/(panel)/organizacja/nowa/actions");
  try {
    await createTenantAction({}, formData());
  } catch (error) {
    if (error instanceof RedirectSignal) return error;
    throw error;
  }
  throw new Error("Akcja nie doszła do redirectu — organizacja nie została założona.");
}

describe("zakładanie organizacji a rejestracja subdomeny (2.6)", () => {
  beforeEach(() => {
    domainUpdates = [];
    rpcCalls = [];
    // Zmienna SYSTEMOWA dostawcy gaszona JAWNIE — inaczej środowisko, które ją
    // ma (CI na Vercelu), zapalałoby bramkę anty-samorejestrację z 2.6c
    // w testach, które sprawdzają co innego.
    vi.stubEnv(RUNNING_PROJECT_ENV, "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("organizacja powstaje mimo AWARII API domen, a powód trafia do last_error", async () => {
    vi.stubEnv(STOREFRONT_TOKEN_ENV, "tok-testowy");
    vi.stubEnv(STOREFRONT_PROJECT_ENV, "prj-testowy");
    // Awaria transportu u dostawcy — port rzuca, opakowanie ma to pochłonąć.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );

    const redirect = await runCreateTenant();

    expect(
      rpcCalls.map((call) => call.fn),
      "create_tenant nie został zawołany",
    ).toContain("create_tenant");
    expect(redirect.url, "onboarding nie dokończył się mimo awarii dostawcy").toBe("/pl/");

    // Uczciwa CZĘŚCIOWA porażka: powód zapisany, nie połknięty w ciszy.
    expect(domainUpdates).toHaveLength(1);
    expect(domainUpdates[0]?.provider_domain_id).toBeNull();
    expect(String(domainUpdates[0]?.last_error)).toContain("ECONNRESET");
  });

  it("BRAK konfiguracji dostawcy też nie wywraca onboardingu (jawny powód, nie cichy sukces)", async () => {
    vi.stubEnv(STOREFRONT_TOKEN_ENV, "");
    vi.stubEnv(STOREFRONT_PROJECT_ENV, "");

    const redirect = await runCreateTenant();

    expect(redirect.url).toBe("/pl/");
    expect(String(domainUpdates[0]?.last_error)).toContain(STOREFRONT_TOKEN_ENV);
  });

  it("udana rejestracja zapisuje id u dostawcy i CZYŚCI last_error", async () => {
    vi.stubEnv(STOREFRONT_TOKEN_ENV, "tok-testowy");
    vi.stubEnv(STOREFRONT_PROJECT_ENV, "prj-testowy");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ name: "acme-2-6.avably.io", verified: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const redirect = await runCreateTenant();

    expect(redirect.url).toBe("/pl/");
    expect(domainUpdates[0]).toEqual({
      provider_domain_id: "acme-2-6.avably.io",
      last_error: null,
    });
  });

  it("rejestrowany host to subdomena zbudowana ze slugu organizacji", async () => {
    vi.stubEnv(STOREFRONT_TOKEN_ENV, "tok-testowy");
    vi.stubEnv(STOREFRONT_PROJECT_ENV, "prj-testowy");
    const fetchSpy = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(JSON.stringify({ name: "acme-2-6.avably.io", verified: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await runCreateTenant();

    const body = String(fetchSpy.mock.calls[0]?.[1]?.body ?? "");
    expect(JSON.parse(body)).toEqual({ name: "acme-2-6.avably.io" });
  });
});
