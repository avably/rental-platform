/**
 * Bramka przesłony regulaminu platformy — `readPlatformTermsGate`
 * (lib/platform-terms.ts; 0070, ADR-141).
 *
 * To jest DECYZJA, kto widzi przesłonę zamiast treści panelu, więc każda
 * gałąź ma tu jawny dowód:
 *   - sesja BEZ organizacji → NIGDY (regresja pętli onboardingu, ADR-133:
 *     droga do /organizacja/nowa musi zostać drożna — klient nie jest nawet
 *     odpytywany);
 *   - personel → NIGDY (akceptuje owner w imieniu organizacji, D4);
 *   - brak OBOWIĄZUJĄCEJ wersji → NIGDY (mechanika bez treści od prawnika
 *     niczego nie blokuje — bramka (f) ADR-138 czeka na seed);
 *   - dowód akceptacji istnieje → NIE;
 *   - owner + wersja + brak dowodu → przesłona (dokładnie ta wersja);
 *   - błąd transportu → fail-silent (shell to informacja, nie guard).
 *
 * Strona SQL/RLS tych samych gwarancji (kto w ogóle widzi dowody, kto może
 * akceptować) ma osobne dowody w packages/db/test/platform-terms.test.ts —
 * tu testujemy warstwę panelu z wstrzykniętym klientem, wołaną DOKŁADNIE
 * tak, jak woła ją layout.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { AuthContext } from "@/lib/auth";
import { readCurrentPlatformTerms, readPlatformTermsGate } from "@/lib/platform-terms";

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

interface StubOptions {
  terms?: unknown;
  termsError?: boolean;
  acceptanceRows?: unknown[];
  acceptanceError?: boolean;
}

/** Klient-atrapa z licznikami wywołań — kształt łańcuchów jak w produkcji. */
function stubClient(options: StubOptions = {}) {
  const calls = { rpc: 0, from: 0 };
  const client = {
    schema: (name: string) => {
      expect(name).toBe("app");
      return {
        rpc: async (fn: string) => {
          calls.rpc += 1;
          expect(fn).toBe("get_platform_terms");
          if (options.termsError) return { data: null, error: { message: "boom" } };
          return { data: options.terms ?? null, error: null };
        },
      };
    },
    from: (table: string) => {
      calls.from += 1;
      expect(table).toBe("platform_terms_acceptances");
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: async () =>
          options.acceptanceError
            ? { data: null, error: { message: "boom" } }
            : { data: options.acceptanceRows ?? [], error: null },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function ctx(partial: Partial<AuthContext>): AuthContext {
  return {
    user: { id: "00000000-0000-4000-8000-000000000001", email: "owner@test.local" },
    tenantId: "22222222-2222-4222-8222-222222222222",
    role: "owner",
    superadmin: false,
    aal: "aal1",
    amr: [],
    tenantStatus: null,
    closing: false,
    suspendedAt: null,
    supabase: null as never,
    ...partial,
  };
}

describe("readPlatformTermsGate (0070, ADR-141)", () => {
  it("sesja bez organizacji → null BEZ odpytania klienta (regresja pętli onboardingu)", async () => {
    const { client, calls } = stubClient({ terms: SAMPLE_TERMS });
    expect(await readPlatformTermsGate(client, ctx({ tenantId: null, role: null }))).toBeNull();
    expect(calls.rpc + calls.from, "bramka odpytała bazę dla sesji bez organizacji").toBe(0);
  });

  it("brak sesji w ogóle → null bez odpytania", async () => {
    const { client, calls } = stubClient({ terms: SAMPLE_TERMS });
    expect(await readPlatformTermsGate(client, null)).toBeNull();
    expect(calls.rpc + calls.from).toBe(0);
  });

  it("personel → null bez odpytania (akceptuje owner w imieniu organizacji)", async () => {
    const { client, calls } = stubClient({ terms: SAMPLE_TERMS });
    expect(await readPlatformTermsGate(client, ctx({ role: "staff" }))).toBeNull();
    expect(calls.rpc + calls.from).toBe(0);
  });

  it("żadna wersja nie obowiązuje → null (mechanika bez treści od prawnika NICZEGO nie blokuje)", async () => {
    const { client, calls } = stubClient({ terms: null });
    expect(await readPlatformTermsGate(client, ctx({}))).toBeNull();
    expect(calls.rpc).toBe(1);
    expect(calls.from, "bramka szukała dowodu mimo braku wersji").toBe(0);
  });

  it("dowód akceptacji istnieje → null (przesłona zgaszona)", async () => {
    const { client } = stubClient({ terms: SAMPLE_TERMS, acceptanceRows: [{ id: "x" }] });
    expect(await readPlatformTermsGate(client, ctx({}))).toBeNull();
  });

  it("owner + obowiązująca wersja + brak dowodu → przesłona z DOKŁADNIE tą wersją", async () => {
    const { client } = stubClient({ terms: SAMPLE_TERMS, acceptanceRows: [] });
    const gate = await readPlatformTermsGate(client, ctx({}));
    expect(gate).toEqual({
      versionId: VERSION_ID,
      versionLabel: "v1",
      effectiveFrom: SAMPLE_TERMS.effective_from,
    });
  });

  it("błąd odczytu dowodów → fail-silent null (shell to informacja, nie guard)", async () => {
    const { client } = stubClient({ terms: SAMPLE_TERMS, acceptanceError: true });
    expect(await readPlatformTermsGate(client, ctx({}))).toBeNull();
  });

  it("odpowiedź RPC o nieznanym kształcie → fail-closed null (readCurrentPlatformTerms)", async () => {
    const { client } = stubClient({ terms: { version_id: "nie-uuid" } });
    expect(await readCurrentPlatformTerms(client)).toBeNull();
    expect(await readPlatformTermsGate(client, ctx({}))).toBeNull();
  });
});
