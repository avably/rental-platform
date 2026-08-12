/**
 * getPublishedSite (lib/site/published.ts, ADR-041) — kontrakt warstwy danych
 * dla renderu 2.3b: fail-closed na błędach i złych kształtach, przezroczyste
 * podanie poprawnej odpowiedzi RPC. Zachowanie samego RPC (bramki izolacji)
 * dowodzą testy integracyjne packages/db/test/site-model.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublishedPage, getPublishedSite } from "../lib/site/published";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";

/** Klient-atrapa: zwraca zadany wynik RPC i rejestruje wywołanie. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    schema: (name: string) => {
      if (name !== "app") throw new Error(`nieoczekiwany schemat: ${name}`);
      return {
        rpc: (fn: string, args: unknown) => {
          calls.push({ fn, args });
          return Promise.resolve(result);
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("getPublishedSite", () => {
  it("woła app.get_published_site z id tenanta i zwraca sparsowaną stronę", async () => {
    const { client, calls } = fakeClient({
      data: {
        template: "classic",
        published_at: "2026-07-18T10:00:00+00:00",
        sections: [
          { id: TENANT_ID, type: "hero", position: 0, content: { heading: "Nagłówek" } },
        ],
      },
      error: null,
    });

    const site = await getPublishedSite(TENANT_ID, client);

    // Od Fazy 2 (ADR-158) `getPublishedSite` jest odczytem strony GŁÓWNEJ:
    // woła rdzeń `app.get_published_page` z pustym slugiem. Jedno ciało, jeden
    // kształt koperty — druga kopia rozjechałaby się przy pierwszej zmianie,
    // a koperta jest `.strict()`.
    expect(calls).toEqual([
      { fn: "get_published_page", args: { p_tenant_id: TENANT_ID, p_slug: "" } },
    ]);
    expect(site?.template).toBe("classic");
    expect(site?.sections).toHaveLength(1);
  });

  it("NULL z RPC (nieopublikowana / nieaktywny tenant) → null", async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await getPublishedSite(TENANT_ID, client)).toBeNull();
  });

  it("błąd RPC → null (fail-closed, bez wyjątku do renderu)", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    expect(await getPublishedSite(TENANT_ID, client)).toBeNull();
  });

  it("odpowiedź w nieznanym kształcie → null (fail-closed)", async () => {
    const { client } = fakeClient({ data: { unexpected: true }, error: null });
    expect(await getPublishedSite(TENANT_ID, client)).toBeNull();
  });
});

describe("getPublishedPage", () => {
  it("przekazuje slug do rdzenia odczytu — adres wskazuje STRONĘ, nie najemcę", async () => {
    const { client, calls } = fakeClient({
      data: {
        template: "classic",
        published_at: "2026-08-13T10:00:00+00:00",
        sections: [{ id: TENANT_ID, type: "hero", position: 0, content: { heading: "Kontakt" } }],
      },
      error: null,
    });

    const page = await getPublishedPage(TENANT_ID, "kontakt", client);

    expect(calls).toEqual([
      { fn: "get_published_page", args: { p_tenant_id: TENANT_ID, p_slug: "kontakt" } },
    ]);
    expect(page?.sections[0]?.content).toEqual({ heading: "Kontakt" });
  });

  it("nieznany adres → null (fail-closed, tak samo jak brak strony)", async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await getPublishedPage(TENANT_ID, "nie-ma", client)).toBeNull();
  });
});
