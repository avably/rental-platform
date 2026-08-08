/**
 * Egzekwowanie statusu tenanta w guardzie panelu (L3, ADR-107) — testy bez
 * Supabase (job `ci`), klient podstawiony atrapą.
 *
 * Trzy własności rdzenia:
 *   1. `requireMemberWithClient` czyta `tenants.status` KLIENTEM SESJI (RLS
 *      `own_select` ogranicza odczyt do własnego wiersza) i odmawia kodem
 *      `tenant_suspended` dla statusów zamykających panel
 *      (suspended / cancelled / superadmin_locked). `past_due` przepuszcza —
 *      operator musi mieć wejście, żeby uregulować płatność (świadoma różnica
 *      wobec storefrontu, który wpuszcza wyłącznie trialing|active — ADR-107).
 *   2. Odczyt statusu biegnie DOPIERO po walidacji sesji i claimu tenant_id:
 *      anonim dostaje 401, a superadmin bez organizacji swój dotychczasowy kod
 *      `superadmin_without_org` — obie ścieżki bez JEDNEGO zapytania do bazy.
 *   3. Fail-closed: błąd odczytu statusu NIE przepuszcza (rzuca, strona kończy
 *      się 500), a brak wiersza przy poprawnym claimie (anomalia — RLS nie
 *      widzi tenanta z claimu) daje odmowę 403.
 *
 * Asercje blokady mierzą ZDANIE BRAMKI (kod `tenant_suspended`), nie „error
 * truthy" — lekcja z L4, gdzie RLS maskowała bramkę roli.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthError,
  PANEL_CLOSED_STATUSES,
  requireMemberWithClient,
} from "@/lib/auth";

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

const requireMemberMock = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  requireMember: () => requireMemberMock(),
}));

// Import po zamockowaniu supabase-server, żeby member-page dostał atrapę.
const { requireMemberPage } = await import("@/lib/member-page");

interface FakeTenantRead {
  /** Wiersz zwracany przez maybeSingle(); brak pola = brak wiersza (null). */
  status?: string;
  /** Błąd odczytu (PostgrestError w uproszczeniu). */
  error?: { message: string };
}

/**
 * Atrapa klienta Supabase: getClaims zwraca podane claimy, a
 * from("tenants")…maybeSingle() — skonfigurowany wiersz statusu. Każdy odczyt
 * ląduje w `reads`, żeby testy mogły dowieść, że guard NIE pyta bazy na
 * ścieżkach 401/403-przed-statusem (własność 2).
 */
function fakeClient(claims: Record<string, unknown> | null, tenants: FakeTenantRead = {}) {
  const reads: Array<{ table: string; column: string; value: unknown }> = [];
  const client = {
    auth: {
      getClaims: async () => ({ data: claims ? { claims } : null, error: null }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            reads.push({ table, column, value });
            if (tenants.error) return { data: null, error: tenants.error };
            return { data: tenants.status ? { status: tenants.status } : null, error: null };
          },
        }),
      }),
    }),
  };
  return { client: client as never, reads };
}

const memberClaims = (extra: Record<string, unknown> = {}) => ({
  sub: "u1",
  app_metadata: { tenant_id: "t1", role: "owner", ...extra },
});

describe("requireMemberWithClient — statusy zamykające panel", () => {
  it.each(["suspended", "cancelled", "superadmin_locked"] as const)(
    "status %s → 403 tenant_suspended",
    async (status) => {
      const { client } = fakeClient(memberClaims(), { status });
      await expect(requireMemberWithClient(client)).rejects.toMatchObject({
        status: 403,
        code: "tenant_suspended",
      });
    },
  );

  it.each(["trialing", "active", "past_due"] as const)(
    "status %s przepuszcza i trafia do kontekstu",
    async (status) => {
      const { client, reads } = fakeClient(memberClaims(), { status });
      const ctx = await requireMemberWithClient(client);
      expect(ctx.tenantId).toBe("t1");
      expect(ctx.tenantStatus).toBe(status);
      // Dokładnie JEDEN odczyt, po własnym tenancie z claimu (koszt ADR-107).
      expect(reads).toEqual([{ table: "tenants", column: "id", value: "t1" }]);
    },
  );

  it("status zamykający wygrywa z niezgodną rolą — odmowa mówi o zawieszeniu", async () => {
    const { client } = fakeClient(memberClaims({ role: "staff" }), { status: "suspended" });
    await expect(requireMemberWithClient(client, "owner")).rejects.toMatchObject({
      code: "tenant_suspended",
    });
  });

  it("lista statusów zamykających jest spójna z blokadą superadmina (LOCKED_STATUS)", () => {
    expect([...PANEL_CLOSED_STATUSES].sort()).toEqual([
      "cancelled",
      "superadmin_locked",
      "suspended",
    ]);
  });
});

describe("requireMemberWithClient — kolejność bramek (zero odczytów przed statusem)", () => {
  it("anonim → 401 bez odczytu czegokolwiek z bazy", async () => {
    const { client, reads } = fakeClient(null, { status: "active" });
    await expect(requireMemberWithClient(client)).rejects.toMatchObject({ status: 401 });
    expect(reads).toEqual([]);
  });

  it("superadmin bez organizacji → superadmin_without_org, bez odczytu bazy", async () => {
    const { client, reads } = fakeClient(
      { sub: "sa", app_metadata: { superadmin: true } },
      { status: "suspended" },
    );
    await expect(requireMemberWithClient(client)).rejects.toMatchObject({
      status: 403,
      code: "superadmin_without_org",
    });
    expect(reads).toEqual([]);
  });

  it("zwykły user bez organizacji → forbidden, bez odczytu bazy", async () => {
    const { client, reads } = fakeClient({ sub: "u2", app_metadata: {} });
    await expect(requireMemberWithClient(client)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(reads).toEqual([]);
  });
});

describe("requireMemberWithClient — fail-closed na anomaliach odczytu", () => {
  it("błąd odczytu statusu NIE przepuszcza (rzuca, nie AuthError-em)", async () => {
    const { client } = fakeClient(memberClaims(), { error: { message: "connection refused" } });
    const attempt = requireMemberWithClient(client);
    await expect(attempt).rejects.toThrow(/statusu organizacji/);
    await expect(attempt).rejects.not.toBeInstanceOf(AuthError);
  });

  it("brak wiersza przy poprawnym claimie → 403 (anomalia, nie przepustka)", async () => {
    const { client } = fakeClient(memberClaims(), {});
    await expect(requireMemberWithClient(client)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });
});

describe("requireMemberPage — dokąd trafia odmowa tenant_suspended", () => {
  beforeEach(() => {
    currentLocale = "pl";
    requireMemberMock.mockReset();
  });

  it("zawieszona organizacja → /organizacja-zawieszona (przez REALNY rdzeń)", async () => {
    // requireMember deleguje do prawdziwego requireMemberWithClient — mutacja
    // zdejmująca odczyt statusu z rdzenia pali TEN test (tor strony), nie
    // tylko testy jednostkowe rdzenia.
    const { client } = fakeClient(memberClaims(), { status: "suspended" });
    requireMemberMock.mockImplementation(() => requireMemberWithClient(client));

    await expect(requireMemberPage("/zamowienia")).rejects.toMatchObject({
      url: "/pl/organizacja-zawieszona",
    });
  });

  it("organizacja aktywna → strona dostaje kontekst, bez przekierowania", async () => {
    const { client } = fakeClient(memberClaims(), { status: "active" });
    requireMemberMock.mockImplementation(() => requireMemberWithClient(client));

    const ctx = await requireMemberPage("/zamowienia");
    expect(ctx.tenantId).toBe("t1");
    expect(ctx.tenantStatus).toBe("active");
  });
});
