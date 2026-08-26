/**
 * `createTenantAction` — PRZEKAZANIE DANYCH FIRMOWYCH WPISANYCH RĘCZNIE
 * (ADR-276, 0114).
 *
 * ══ CO TU JEST BRONIONE ══
 *
 * Formularz od ADR-276 renderuje pola `legalName`/`regon` WYŁĄCZNIE po
 * odmowie rejestru. Akcja musi z tego zrobić dwa różne wywołania RPC —
 * i nie ma tu miejsca na „prawie": nadmiarowe `p_legal_name: null` przy
 * ścieżce rejestrowej byłoby nieszkodliwe dziś i mylące jutro (sugerowałoby,
 * że wołający ma wpływ na dane, których RPC od niego nie bierze).
 *
 * Trzy zdania, które psują się osobno:
 *   1. ŚCIEŻKA REJESTROWA (pól nie ma w żądaniu) → payload BEZ p_legal_name
 *      i p_regon, czyli dokładnie taki, jak przed ADR-276.
 *   2. ŚCIEŻKA RĘCZNA → payload NIESIE oba parametry, znormalizowane
 *      (przycięta nazwa, REGON bez separatorów, puste → null).
 *   3. ZŁY KSZTAŁT danych ręcznych kończy się BEZ dotknięcia RPC — pierwsza
 *      linia jest w Zodzie, ostatnia w bazie (dowód bazy:
 *      packages/db/test/manual-company-identity.test.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getLocale: async () => "pl",
  getTranslations: async () => (key: string) => key,
}));

const rpcLog: { fn: string; args: unknown }[] = [];

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
    schema: (name: string) => ({
      rpc: async (fn: string, args?: unknown) => {
        rpcLog.push({ fn, args });
        expect(name).toBe("app");
        if (fn === "get_platform_terms") return { data: null, error: null };
        if (fn === "create_tenant") {
          // Zatrzymanie na granicy RPC — dalsze kroki (odświeżenie sesji,
          // rejestracja subdomeny) wołają świat zewnętrzny i mają własne testy.
          return { data: null, error: { message: "STOP-NA-GRANICY-RPC" } };
        }
        throw new Error(`nieoczekiwane RPC: ${fn}`);
      },
    }),
  }),
}));

const { createTenantAction } = await import("@/app/[locale]/(panel)/organizacja/nowa/actions");

function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function createTenantCalls(): { fn: string; args: unknown }[] {
  return rpcLog.filter((call) => call.fn === "create_tenant");
}

const BASE = { slug: "moja-firma", name: "Moja firma", nip: "7740001454" };

afterEach(() => {
  rpcLog.length = 0;
});

describe("createTenantAction — dane firmowe ręczne (ADR-276)", () => {
  it("ścieżka REJESTROWA (bez pól ręcznych): payload jak przed ADR-276", async () => {
    await createTenantAction({}, formData(BASE));

    expect(createTenantCalls()).toHaveLength(1);
    expect(createTenantCalls()[0]!.args).toEqual({
      p_slug: "moja-firma",
      p_name: "Moja firma",
      p_nip: "7740001454",
    });
  });

  it("ścieżka RĘCZNA: payload niesie p_legal_name i p_regon", async () => {
    await createTenantAction(
      {},
      formData({ ...BASE, legalName: "  JAN KOWALSKI USŁUGI  ", regon: "123-456-785" }),
    );

    expect(createTenantCalls()).toHaveLength(1);
    expect(createTenantCalls()[0]!.args).toEqual({
      p_slug: "moja-firma",
      p_name: "Moja firma",
      p_nip: "7740001454",
      // Przycięta — inaczej do bazy poszłaby nazwa z wiodącymi spacjami,
      // która trafia potem na umowy najmu.
      p_legal_name: "JAN KOWALSKI USŁUGI",
      // Separatory zdjęte: CHECK kolumny (0096) zna WYŁĄCZNIE cyfry.
      p_regon: "123456785",
    });
  });

  it("ścieżka RĘCZNA bez REGON-u: puste pole idzie jako null, nie jako pusty string", async () => {
    await createTenantAction({}, formData({ ...BASE, legalName: "FIRMA BEZ REGON", regon: "" }));

    expect(createTenantCalls()[0]!.args).toMatchObject({
      p_legal_name: "FIRMA BEZ REGON",
      p_regon: null,
    });
  });

  it("REGON o złym kształcie → błąd walidacji BEZ dotknięcia RPC", async () => {
    const state = await createTenantAction(
      {},
      formData({ ...BASE, legalName: "FIRMA", regon: "12345" }),
    );

    expect(state.error).toContain("REGON");
    expect(rpcLog).toEqual([]);
  });

  it("nazwa rejestrowa dłuższa niż 200 znaków → błąd walidacji BEZ dotknięcia RPC", async () => {
    const state = await createTenantAction(
      {},
      formData({ ...BASE, legalName: "X".repeat(201) }),
    );

    expect(state.error).toContain("za długa");
    expect(rpcLog).toEqual([]);
  });

  it("zła suma kontrolna NIP dalej odrzucana przed RPC, mimo kompletu danych ręcznych", async () => {
    // Wariant ręczny dotyczy POTWIERDZENIA firmy, nie formalnej poprawności
    // NIP-u — ta bramka zostaje nietknięta (lustro tego samego warunku w 0114).
    const state = await createTenantAction(
      {},
      formData({ ...BASE, nip: "7740001450", legalName: "FIRMA", regon: "123456785" }),
    );

    expect(state.error).toBe("Nieprawidłowy NIP.");
    expect(rpcLog).toEqual([]);
  });
});
