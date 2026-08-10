/**
 * Superadmin bez organizacji na trasie tenanckiej (dług #52).
 *
 * Dwie własności, testowane bez Supabase (job `ci`):
 *   1. requireMemberWithClient nadaje odmowie braku organizacji ROZRÓŻNIALNY
 *      kod: `superadmin_without_org` dla sesji z claimem superadmin, `forbidden`
 *      dla zwykłego usera — rdzeń jest czysty, klient podstawiony atrapą.
 *   2. requireMemberPage kieruje ten kod do panelu superadmina (/admin/tenants),
 *      a nie na stronę główną / pusty ekran; pozostałe odmowy bez zmian.
 *
 * Maskowanie /admin (404 dla nie-superadmina) NIE jest tu dotykane: kod
 * `superadmin_without_org` powstaje wyłącznie, gdy ctx.superadmin === true,
 * więc zwykły user nigdy nie dostaje przekierowania na /admin.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError, requireMemberWithClient } from "@/lib/auth";

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

/**
 * Atrapa klienta Supabase: getClaims zwraca podane claimy (albo brak sesji).
 * Od R12b (ADR-127) rdzeń czyta żywy wiersz `members` z zagnieżdżonym
 * `tenants(status)` (dwa filtry .eq: tenant_id, user_id) — atrapa oddaje
 * członkostwo AKTYWNE (rola owner, organizacja działająca); scenariusze
 * cofnięcia i statusów zamykających mieszkają w membership-revocation-guard /
 * tenant-status-guard.test.ts.
 */
function fakeClient(claims: Record<string, unknown> | null) {
  return {
    auth: {
      getClaims: async () => ({ data: claims ? { claims } : null, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { role: "owner", tenants: { status: "active" } },
              error: null,
            }),
          }),
        }),
      }),
    }),
  } as never;
}

describe("requireMemberWithClient — rozróżnialny kod braku organizacji", () => {
  it("superadmin bez tenant_id → superadmin_without_org (403)", async () => {
    await expect(
      requireMemberWithClient(fakeClient({ sub: "u1", app_metadata: { superadmin: true } })),
    ).rejects.toMatchObject({ status: 403, code: "superadmin_without_org" });
  });

  it("zwykły user bez tenant_id → forbidden (bez zmian)", async () => {
    await expect(
      requireMemberWithClient(fakeClient({ sub: "u2", app_metadata: {} })),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("członek z tenant_id → zwraca kontekst (routing bez zmian)", async () => {
    const ctx = await requireMemberWithClient(
      fakeClient({ sub: "u3", app_metadata: { tenant_id: "t1", role: "owner" } }),
    );
    expect(ctx.tenantId).toBe("t1");
    expect(ctx.role).toBe("owner");
  });
});

describe("requireMemberPage — dokąd trafia odmowa", () => {
  beforeEach(() => {
    currentLocale = "pl";
    requireMemberMock.mockReset();
  });

  async function redirectUrlFor(error: unknown): Promise<string> {
    requireMemberMock.mockRejectedValue(error);
    try {
      await requireMemberPage("/zamowienia");
    } catch (e) {
      if (e instanceof RedirectSignal) return e.url;
      throw e;
    }
    throw new Error("requireMemberPage nie przekierowało");
  }

  it("superadmin bez organizacji → /admin/tenants (nie pusty ekran tenancki)", async () => {
    const url = await redirectUrlFor(
      new AuthError(403, "Superadmin bez organizacji.", "superadmin_without_org"),
    );
    expect(url).toBe("/pl/admin/tenants");
  });

  it("zwykły user bez organizacji → strona główna panelu", async () => {
    const url = await redirectUrlFor(new AuthError(403, "Brak przypisanej organizacji.", "forbidden"));
    expect(url).toMatch(/^\/pl\/?$/);
  });

  it("brak sesji → logowanie z next", async () => {
    const url = await redirectUrlFor(new AuthError(401, "Wymagane zalogowanie."));
    expect(url).toContain("/pl/login");
    expect(url).toContain("zamowienia");
  });
});
