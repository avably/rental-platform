/**
 * KLASYFIKACJA BŁĘDÓW ZAKŁADANIA ORGANIZACJI (ADR-153, N5a).
 *
 * Stan zastany: akcja zwracała `error.message` WPROST, z komentarzem, że
 * komunikaty `app.create_tenant` są nasze i po polsku. To było prawdą tylko
 * dla błędów, które funkcja RZUCA jawnie (P0001/P0002/P0003/22023). Kolizja
 * sluga nie jest rzucana — powstaje na UNIQUE tabeli `tenants` (23505) i
 * wracała surowym angielskim „duplicate key value violates unique
 * constraint …". Jedyne miejsce w panelu, gdzie człowiek dostawał wnętrzności
 * Postgresa — akurat przy nazwach oczywistych, więc trafiane często.
 *
 * Mierzone są OBIE STRONY:
 *   • błędy z NASZĄ treścią idą na ekran nietknięte (naprawa nie może
 *     zamienić dobrych komunikatów w jeden generyk),
 *   • wszystko inne dostaje nasz tekst, a treść dostawcy ląduje w logu.
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

/** Błąd RPC — sterowany per przypadek (kształt odpowiedzi PostgREST). */
let rpcError: { code?: string; message: string } | null = null;

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: {
          claims: {
            sub: "00000000-0000-4000-8000-000000000001",
            email: "owner@test.local",
            aal: "aal1",
            app_metadata: {},
          },
        },
        error: null,
      }),
      refreshSession: async () => ({ data: {}, error: null }),
    },
    schema: () => ({ rpc: async () => ({ data: null, error: rpcError }) }),
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  }),
}));

// Wersja regulaminu nie jest przedmiotem tego pliku (ma własną suitę).
vi.mock("@/lib/platform-terms", () => ({ readCurrentPlatformTerms: async () => null }));
// Rejestracja subdomeny u dostawcy — poza zakresem, własna suita.
vi.mock("@avably/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@avably/core")>()),
  registerDomainSafely: async () => ({ providerDomainId: null, error: null }),
}));

const { createTenantAction } = await import(
  "@/app/[locale]/(panel)/organizacja/nowa/actions"
);

function form(): FormData {
  const data = new FormData();
  data.set("slug", "moja-wypozyczalnia");
  data.set("name", "Moja wypożyczalnia");
  // ADR-234: NIP wymagany od walidacji Zod — RPC jest tu w pełni zamockowane
  // (rpcError sterowany per przypadek), więc suma kontrolna wystarcza, żeby
  // dojść do wywołania RPC (realną weryfikację w cache'u ma własna suita:
  // packages/db/test/nip-lookup-cache.test.ts).
  data.set("nip", "7740001454");
  return data;
}

async function run(): Promise<{ error?: string } | { url: string }> {
  try {
    return await createTenantAction({}, form());
  } catch (error) {
    if (error instanceof RedirectSignal) return { url: error.url };
    throw error;
  }
}

const RAW_UNIQUE_VIOLATION =
  'duplicate key value violates unique constraint "tenants_slug_key"';

beforeEach(() => {
  rpcError = null;
});

describe("zajęty adres sklepu (23505) — komunikat po ludzku, nie po Postgresowemu", () => {
  it("kolizja unikatu daje NASZ komunikat, a treść bazy nie trafia na ekran", async () => {
    rpcError = { code: "23505", message: RAW_UNIQUE_VIOLATION };

    const state = await run();

    expect(state).toEqual({ error: pl.newOrganization.errorSlugTaken });
    expect(
      JSON.stringify(state),
      "surowy komunikat Postgresa wyciekł na ekran zakładania organizacji",
    ).not.toContain("duplicate key");
    expect(JSON.stringify(state)).not.toContain("tenants_slug_key");
  });

  it("komunikat mówi, co zrobić — a nie tylko, że się nie udało", async () => {
    rpcError = { code: "23505", message: RAW_UNIQUE_VIOLATION };

    const state = await run();

    expect((state as { error: string }).error).toContain("zajęty");
    expect((state as { error: string }).error).toContain("Wybierz inny");
  });
});

describe("błędy z WŁASNĄ treścią przechodzą nietknięte (kontrola pozytywna)", () => {
  it.each([
    ["P0001", "Adres e-mail nie został zweryfikowany."],
    ["P0002", "Limit 2 organizacji na użytkownika został osiągnięty."],
    ["P0003", "Do założenia organizacji wymagana jest akceptacja regulaminu."],
    ["22023", 'Adres „wypozyczalnia" jest zarezerwowany — wybierz inny.'],
  ])("kod %s zachowuje komunikat funkcji bazodanowej", async (code, message) => {
    rpcError = { code, message };

    expect(await run()).toEqual({ error: message });
  });
});

describe("kod nieznany — nasz tekst na ekran, treść dostawcy do logu", () => {
  it("nieznany kod nie oddaje treści bazy i zostawia ślad w logu", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcError = { code: "42501", message: "permission denied for table tenants" };

    const state = await run();

    expect(state).toEqual({ error: pl.newOrganization.errorGeneric });
    expect(JSON.stringify(state)).not.toContain("permission denied");
    expect(error, "nieznany błąd zniknął bez śladu w logu").toHaveBeenCalledWith(
      expect.stringContaining("nieznany błąd create_tenant"),
      expect.stringContaining("42501"),
    );
    error.mockRestore();
  });

  it("błąd BEZ kodu też nie oddaje treści dostawcy", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcError = { message: "FetchError: network unreachable" };

    const state = await run();

    expect(state).toEqual({ error: pl.newOrganization.errorGeneric });
    expect(JSON.stringify(state)).not.toContain("network unreachable");
    error.mockRestore();
  });
});

describe("sukces prowadzi na ekran potwierdzenia (N5c)", () => {
  it("bez błędu akcja kończy przekierowaniem na /organizacja/nowa/gotowe", async () => {
    rpcError = null;

    expect(await run()).toEqual({ url: "/pl/organizacja/nowa/gotowe" });
  });
});
