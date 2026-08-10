/**
 * Cofnięcie członkostwa/superadmina a guard panelu (R12b/H-01, ADR-127) —
 * warstwa APLIKACJI, testy bez Supabase (job `ci`), klient podstawiony atrapą.
 *
 * Twardą izolacją danych po cofnięciu jest RLS z predykatami live (R12a); tu
 * dowodzimy trzech rzeczy, za które odpowiada guard:
 *   1. Rdzeń czyta członkostwo/superadmina NA ŻYWO z bazy, nie z claimu JWT:
 *      brak wiersza → `membership_revoked`, a nie cichy przepust ani gołe 403.
 *   2. Rola bierze się z BAZY, nie z claimu — zdegradowany owner (owner→staff)
 *      nie przejdzie bramki roli „owner", mimo że claim wciąż mówi „owner".
 *   3. Guardy STRON kierują `membership_revoked` na /dostep-cofniety
 *      (wylogowanie + /login), nigdy na 404 (/admin) ani w pętlę odmowy
 *      (trasy tenanckie, w tym najostrzejszy przypadek usera wielotenantowego).
 *
 * Rozróżnienie „brak wiersza = odmowa" vs „błąd bazy = 500" jest testowane
 * wprost: czkawka odczytu NIE wylogowuje, tylko rzuca (fail-closed).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthError,
  requireMemberWithClient,
  requireSuperadminWithClient,
} from "@/lib/auth";

let currentLocale = "pl";

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
  permanentRedirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new NotFoundSignal("NOT_FOUND");
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => currentLocale,
}));

const requireMemberMock = vi.fn();
const requireSuperadminMock = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  requireMember: () => requireMemberMock(),
  requireSuperadmin: () => requireSuperadminMock(),
}));

// Import po zamockowaniu supabase-server, żeby routing dostał atrapy.
const { requireMemberPage } = await import("@/lib/member-page");
const { requireSuperadminPage } = await import("@/lib/superadmin");

// -----------------------------------------------------------------------
// Atrapy klientów
// -----------------------------------------------------------------------

interface FakeMemberRead {
  role?: string;
  status?: string;
  missing?: boolean;
  error?: { message: string };
}

function fakeMemberClient(claims: Record<string, unknown> | null, member: FakeMemberRead = {}) {
  const reads: Array<{ table: string; filters: Array<{ column: string; value: unknown }> }> = [];
  const client = {
    auth: { getClaims: async () => ({ data: claims ? { claims } : null, error: null }) },
    from: (table: string) => ({
      select: () => ({
        eq: (c1: string, v1: unknown) => ({
          eq: (c2: string, v2: unknown) => ({
            maybeSingle: async () => {
              reads.push({ table, filters: [{ column: c1, value: v1 }, { column: c2, value: v2 }] });
              if (member.error) return { data: null, error: member.error };
              if (member.missing) return { data: null, error: null };
              return {
                data: { role: member.role ?? "owner", tenants: { status: member.status ?? "active" } },
                error: null,
              };
            },
          }),
        }),
      }),
    }),
  };
  return { client: client as never, reads };
}

interface FakeSuperadminRead {
  missing?: boolean;
  error?: { message: string };
  /** currentLevel z getAuthenticatorAssuranceLevel (gdy claim aal !== aal2). */
  nextLevel?: string;
}

function fakeSuperadminClient(claims: Record<string, unknown> | null, sa: FakeSuperadminRead = {}) {
  const reads: Array<{ schema: string; table: string }> = [];
  const client = {
    auth: {
      getClaims: async () => ({ data: claims ? { claims } : null, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: "aal1", nextLevel: sa.nextLevel ?? "aal2" },
        }),
      },
    },
    schema: (schema: string) => ({
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              reads.push({ schema, table });
              if (sa.error) return { data: null, error: sa.error };
              if (sa.missing) return { data: null, error: null };
              return { data: { user_id: (claims?.sub as string) ?? "sa" }, error: null };
            },
          }),
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
const superadminClaims = (extra: Record<string, unknown> = {}) => ({
  sub: "sa1",
  aal: "aal2",
  app_metadata: { superadmin: true, ...extra },
});

// -----------------------------------------------------------------------
// 1. Rdzeń członka — żywe członkostwo i rola z bazy
// -----------------------------------------------------------------------

describe("requireMemberWithClient — cofnięte członkostwo", () => {
  it("brak wiersza members (cofnięte) → membership_revoked, mimo ważnego claimu tenant_id", async () => {
    const { client, reads } = fakeMemberClient(memberClaims(), { missing: true });
    await expect(requireMemberWithClient(client)).rejects.toMatchObject({
      status: 403,
      code: "membership_revoked",
    });
    // Odczyt biegł po (tenant_id, user_id) z claimu — jeden round-trip.
    expect(reads).toEqual([
      { table: "members", filters: [{ column: "tenant_id", value: "t1" }, { column: "user_id", value: "u1" }] },
    ]);
  });

  it("błąd odczytu członkostwa → rzut (500), NIE membership_revoked (czkawka bazy nie wylogowuje)", async () => {
    const { client } = fakeMemberClient(memberClaims(), { error: { message: "connection refused" } });
    const attempt = requireMemberWithClient(client);
    await expect(attempt).rejects.toThrow(/członkostwa w organizacji/);
    await expect(attempt).rejects.not.toBeInstanceOf(AuthError);
  });
});

describe("requireMemberWithClient — rola z BAZY zamyka cichy downgrade", () => {
  it("claim mówi owner, baza mówi staff → bramka roli owner ODMAWIA (403 forbidden)", async () => {
    // Zdegradowany owner: claim (żywy do exp) wciąż niesie „owner", baza już „staff".
    const { client } = fakeMemberClient(memberClaims({ role: "owner" }), { role: "staff", status: "active" });
    await expect(requireMemberWithClient(client, "owner")).rejects.toMatchObject({ status: 403 });
  });

  it("rola z bazy trafia do kontekstu (nadpisuje claim)", async () => {
    const { client } = fakeMemberClient(memberClaims({ role: "owner" }), { role: "staff", status: "active" });
    const ctx = await requireMemberWithClient(client);
    expect(ctx.role).toBe("staff");
  });

  it("owner w bazie przechodzi bramkę roli owner", async () => {
    const { client } = fakeMemberClient(memberClaims(), { role: "owner", status: "active" });
    const ctx = await requireMemberWithClient(client, "owner");
    expect(ctx.role).toBe("owner");
  });
});

// -----------------------------------------------------------------------
// 2. Rdzeń superadmina — żywy odczyt app.superadmins
// -----------------------------------------------------------------------

describe("requireSuperadminWithClient — cofnięty superadmin", () => {
  it("claim superadmin=true, ale brak wiersza app.superadmins → membership_revoked", async () => {
    const { client, reads } = fakeSuperadminClient(superadminClaims(), { missing: true });
    await expect(requireSuperadminWithClient(client)).rejects.toMatchObject({
      status: 403,
      code: "membership_revoked",
    });
    expect(reads).toEqual([{ schema: "app", table: "superadmins" }]);
  });

  it("żywy odczyt PRZED aal2: cofnięty superadmin na aal1 z TOTP dostaje membership_revoked, NIE mfa_required", async () => {
    const claims = { sub: "sa1", aal: "aal1", app_metadata: { superadmin: true } };
    const { client } = fakeSuperadminClient(claims, { missing: true, nextLevel: "aal2" });
    await expect(requireSuperadminWithClient(client)).rejects.toMatchObject({
      code: "membership_revoked",
    });
  });

  it("błąd odczytu app.superadmins → rzut (500), NIE membership_revoked", async () => {
    const { client } = fakeSuperadminClient(superadminClaims(), { error: { message: "connection refused" } });
    const attempt = requireSuperadminWithClient(client);
    await expect(attempt).rejects.toThrow(/uprawnień superadmina/);
    await expect(attempt).rejects.not.toBeInstanceOf(AuthError);
  });

  it("żywy wiersz obecny + aal2 → przechodzi", async () => {
    const { client } = fakeSuperadminClient(superadminClaims());
    const ctx = await requireSuperadminWithClient(client);
    expect(ctx.superadmin).toBe(true);
    expect(ctx.aal).toBe("aal2");
  });
});

// -----------------------------------------------------------------------
// 3. Routing stron — membership_revoked → /dostep-cofniety
// -----------------------------------------------------------------------

async function redirectUrl(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
  throw new Error("guard nie przekierował");
}

describe("requireMemberPage — cofnięte członkostwo kieruje na /dostep-cofniety", () => {
  beforeEach(() => {
    currentLocale = "pl";
    requireMemberMock.mockReset();
  });

  it("membership_revoked → /pl/dostep-cofniety (nie goły 403, nie pętla)", async () => {
    requireMemberMock.mockRejectedValue(
      new AuthError(403, "Członkostwo w organizacji zostało cofnięte.", "membership_revoked"),
    );
    expect(await redirectUrl(() => requireMemberPage("/zamowienia"))).toBe("/pl/dostep-cofniety");
  });

  it("MULTI-TENANT: usunięty z pierwszej org (claim wciąż A) → /dostep-cofniety, żeby przelogowanie przeliczyło claim", async () => {
    // Guard nie widzi drugiej org (claim niesie A); poprawne wyjście to
    // wylogowanie + /login, gdzie hook wskaże wciąż ważną org B — a nie 403,
    // który zapętliłby odmowę mimo ważnego drugiego członkostwa.
    const { client } = fakeMemberClient(memberClaims(), { missing: true });
    requireMemberMock.mockImplementation(() => requireMemberWithClient(client));
    expect(await redirectUrl(() => requireMemberPage("/zamowienia"))).toBe("/pl/dostep-cofniety");
  });
});

describe("requireSuperadminPage — cofnięty superadmin kieruje na /dostep-cofniety", () => {
  beforeEach(() => {
    currentLocale = "pl";
    requireSuperadminMock.mockReset();
  });

  it("membership_revoked → /pl/dostep-cofniety (NIE 404 maskujące /admin)", async () => {
    requireSuperadminMock.mockRejectedValue(
      new AuthError(403, "Uprawnienia superadmina zostały cofnięte.", "membership_revoked"),
    );
    expect(await redirectUrl(() => requireSuperadminPage())).toBe("/pl/dostep-cofniety");
  });

  it("zwykły forbidden nadal → 404 (maskowanie /admin nietknięte)", async () => {
    requireSuperadminMock.mockRejectedValue(new AuthError(403, "Wymagane uprawnienia superadmina."));
    await expect(requireSuperadminPage()).rejects.toBeInstanceOf(NotFoundSignal);
  });
});
