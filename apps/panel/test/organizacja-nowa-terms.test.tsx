/**
 * Onboarding organizacji — kontrakt akceptacji regulaminu (0070, ADR-141).
 *
 * Dwie warstwy tego samego kontraktu:
 *   1. FORMULARZ: checkbox (domyślnie NIEZAZNACZONY, `required`) + link do
 *      /{locale}/terms + ukryta wersja renderują się WYŁĄCZNIE, gdy jakaś
 *      wersja regulaminu obowiązuje; bez niej formularz wygląda jak przed
 *      0070 (mechanika bez treści od prawnika niczego nie zmienia).
 *   2. AKCJA: przy obowiązującej wersji żądanie bez akceptacji kończy się
 *      błędem BEZ wywołania `create_tenant` (atrybut `required` przeglądarki
 *      to uprzejmość, nie bramka); z akceptacją akcja przekazuje bazie
 *      DOKŁADNIE wersję z ukrytego pola (to, co user WIDZIAŁ), a bez
 *      obowiązującej wersji woła RPC bez parametru wersji.
 *
 * Twarde wymuszenie samego RPC (P0003/22023, atomowość dowodu) ma osobne
 * dowody w packages/db/test/platform-terms.test.ts.
 */
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import pl from "@/messages/pl.json";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";

const SAMPLE_TERMS = {
  version_id: VERSION_ID,
  version_no: 1,
  version_label: "v1",
  title_pl: "Regulamin świadczenia usługi Avably",
  body_pl: "Treść PL",
  title_en: "Avably Terms of Service",
  body_en: "Body EN",
  sha256_pl: "a".repeat(64),
  sha256_en: "b".repeat(64),
  published_at: "2026-08-11T10:00:00.000Z",
  effective_from: "2026-09-01T00:00:00.000Z",
};

// Od ADR-153 akcja tłumaczy komunikaty błędów zakładania organizacji
// (klasyfikacja po kodzie zamiast surowej treści bazy), więc potrzebuje
// serwerowego `getTranslations`. Ten plik pilnuje akceptacji regulaminu,
// nie brzmienia komunikatów — echo klucza w zupełności wystarcza.
vi.mock("next-intl/server", () => ({
  getLocale: async () => "pl",
  getTranslations: async () => (key: string) => key,
}));

// --- atrapa klienta dla akcji -------------------------------------------

let currentTerms: unknown = null;
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
        if (fn === "get_platform_terms") return { data: currentTerms, error: null };
        if (fn === "create_tenant") {
          // Zatrzymujemy akcję na granicy RPC — dalsze kroki (refresh sesji,
          // rejestracja subdomeny) mają własne testy i wołają świat zewnętrzny.
          return { data: null, error: { message: "STOP-NA-GRANICY-RPC" } };
        }
        throw new Error(`nieoczekiwane RPC: ${fn}`);
      },
    }),
  }),
}));

const { CreateTenantForm } = await import("@/app/[locale]/(panel)/organizacja/nowa/form");
const { createTenantAction } = await import("@/app/[locale]/(panel)/organizacja/nowa/actions");

afterEach(() => {
  currentTerms = null;
  rpcLog.length = 0;
});

function renderForm(terms: { versionId: string; versionLabel: string } | null): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={pl}>
      <CreateTenantForm terms={terms} />
    </NextIntlClientProvider>,
  );
}

function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

describe("formularz organizacji — checkbox akceptacji (0070)", () => {
  it("z obowiązującą wersją renderuje NIEZAZNACZONY checkbox required, ukrytą wersję i link do /pl/terms", () => {
    const html = renderForm({ versionId: VERSION_ID, versionLabel: "v1" });

    const checkboxTag = html.match(/<input[^>]*name="termsAccepted"[^>]*\/?>/)?.[0];
    expect(checkboxTag, "brak checkboxa akceptacji").toBeTruthy();
    expect(checkboxTag).toContain('type="checkbox"');
    expect(checkboxTag).toContain("required");
    expect(checkboxTag).not.toContain("checked");
    expect(html).toContain(`name="termsVersionId" value="${VERSION_ID}"`);
    expect(html).toContain("https://www.avably.io/pl/terms");
    expect(html).toContain("Regulamin świadczenia usługi Avably (v1)");
  });

  it("bez obowiązującej wersji formularz wygląda jak przed 0070 (zero pól regulaminu)", () => {
    const html = renderForm(null);

    expect(html).not.toContain("termsAccepted");
    expect(html).not.toContain("termsVersionId");
    expect(html).not.toContain("avably.io");
  });
});

describe("createTenantAction — walidacja serwerowa akceptacji (0070)", () => {
  it("obowiązująca wersja + brak checkboxa → błąd BEZ wywołania create_tenant", async () => {
    currentTerms = SAMPLE_TERMS;

    const state = await createTenantAction(
      {},
      formData({ slug: "moja-firma", name: "Moja firma", nip: "7740001454" }),
    );

    expect(state.error).toBe("Do założenia organizacji wymagana jest akceptacja regulaminu.");
    expect(
      rpcLog.filter((c) => c.fn === "create_tenant"),
      "akcja zawołała create_tenant mimo braku akceptacji",
    ).toEqual([]);
  });

  it("obowiązująca wersja + checkbox → create_tenant dostaje wersję z UKRYTEGO POLA (to, co widział user)", async () => {
    currentTerms = SAMPLE_TERMS;

    await createTenantAction(
      {},
      formData({
        slug: "moja-firma",
        name: "Moja firma",
        nip: "7740001454",
        termsAccepted: "on",
        termsVersionId: VERSION_ID,
      }),
    );

    const calls = rpcLog.filter((c) => c.fn === "create_tenant");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual({
      p_slug: "moja-firma",
      p_name: "Moja firma",
      p_terms_version_id: VERSION_ID,
      p_nip: "7740001454",
    });
  });

  it("bez obowiązującej wersji → create_tenant wołany BEZ parametru wersji, ale Z p_nip (zachowanie sprzed 0070 + ADR-234)", async () => {
    currentTerms = null;

    await createTenantAction(
      {},
      formData({ slug: "moja-firma", name: "Moja firma", nip: "7740001454" }),
    );

    const calls = rpcLog.filter((c) => c.fn === "create_tenant");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual({ p_slug: "moja-firma", p_name: "Moja firma", p_nip: "7740001454" });
  });

  it("payload z niepoprawnym uuid wersji → błąd walidacji bez dotykania RPC", async () => {
    currentTerms = SAMPLE_TERMS;

    const state = await createTenantAction(
      {},
      formData({
        slug: "moja-firma",
        name: "Moja firma",
        nip: "7740001454",
        termsAccepted: "on",
        termsVersionId: "nie-uuid",
      }),
    );

    expect(state.error).toContain("wersji regulaminu");
    expect(rpcLog).toEqual([]);
  });
});
