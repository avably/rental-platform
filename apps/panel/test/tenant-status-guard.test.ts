/**
 * Egzekwowanie statusu tenanta w guardzie panelu (L3, ADR-107) — testy bez
 * Supabase (job `ci`), klient podstawiony atrapą.
 *
 * Od R12b (ADR-127) rdzeń czyta status z JEDNEGO zapytania o żywy wiersz
 * `members` (zagnieżdżony `tenants(status)`) — patrz też
 * membership-revocation-guard.test.ts po scenariusze samego cofnięcia
 * członkostwa i roli z bazy. Tu pilnujemy trzech własności statusu:
 *   1. `requireMemberWithClient` odmawia kodem `tenant_suspended` dla statusów
 *      zamykających panel (suspended / cancelled / superadmin_locked).
 *      `past_due` przepuszcza — operator musi mieć wejście, żeby uregulować
 *      płatność (świadoma różnica wobec storefrontu — ADR-107).
 *   2. Odczyt biegnie DOPIERO po walidacji sesji i claimu tenant_id: anonim
 *      dostaje 401, a superadmin bez organizacji swój `superadmin_without_org` —
 *      obie ścieżki bez JEDNEGO zapytania do bazy.
 *   3. Fail-closed: błąd odczytu NIE przepuszcza (rzuca, strona kończy się 500).
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

interface FakeMemberRead {
  /** Rola w zwróconym wierszu members (domyślnie "owner"). */
  role?: string;
  /** Status zagnieżdżonego tenanta (domyślnie "active"). */
  status?: string;
  /** Zegar okna domykania (ADR-138); brak pola = null (fail-closed). */
  suspendedAt?: string | null;
  /** Brak wiersza members (cofnięte członkostwo). */
  missing?: boolean;
  /** Błąd odczytu (PostgrestError w uproszczeniu). */
  error?: { message: string };
}

/**
 * Atrapa klienta Supabase: getClaims zwraca podane claimy, a
 * from("members")…eq(tenant_id)…eq(user_id)…maybeSingle() — skonfigurowany
 * wiersz `{ role, tenants: { status } }`. Każdy odczyt ląduje w `reads`, żeby
 * testy mogły dowieść, że guard NIE pyta bazy na ścieżkach 401/403-przed-
 * odczytem (własność 2) i że pyta DOKŁADNIE jednym zapytaniem po obu kluczach.
 */
function fakeClient(claims: Record<string, unknown> | null, member: FakeMemberRead = {}) {
  const reads: Array<{ table: string; filters: Array<{ column: string; value: unknown }> }> = [];
  const client = {
    auth: {
      getClaims: async () => ({ data: claims ? { claims } : null, error: null }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: (c1: string, v1: unknown) => ({
          eq: (c2: string, v2: unknown) => ({
            maybeSingle: async () => {
              reads.push({
                table,
                filters: [
                  { column: c1, value: v1 },
                  { column: c2, value: v2 },
                ],
              });
              if (member.error) return { data: null, error: member.error };
              if (member.missing) return { data: null, error: null };
              return {
                data: {
                  role: member.role ?? "owner",
                  tenants: {
                    status: member.status ?? "active",
                    suspended_at: member.suspendedAt ?? null,
                  },
                },
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

const memberClaims = (extra: Record<string, unknown> = {}) => ({
  sub: "u1",
  app_metadata: { tenant_id: "t1", role: "owner", ...extra },
});

describe("requireMemberWithClient — statusy zamykające panel (kody rozdzielone, ADR-138)", () => {
  it.each([
    // suspended BEZ zegara (sprzed 0067 / anomalia) — fail-closed, okno zamknięte.
    ["suspended", "tenant_suspended"],
    ["cancelled", "tenant_cancelled"],
    ["superadmin_locked", "tenant_locked"],
  ] as const)("status %s → 403 %s", async (status, code) => {
    const { client } = fakeClient(memberClaims(), { status });
    await expect(requireMemberWithClient(client)).rejects.toMatchObject({
      status: 403,
      code,
    });
  });

  it.each(["trialing", "active", "past_due"] as const)(
    "status %s przepuszcza i trafia do kontekstu",
    async (status) => {
      const { client, reads } = fakeClient(memberClaims(), { status });
      const ctx = await requireMemberWithClient(client);
      expect(ctx.tenantId).toBe("t1");
      expect(ctx.tenantStatus).toBe(status);
      // Dokładnie JEDEN odczyt: wiersz members po (tenant_id, user_id) z claimu.
      expect(reads).toEqual([
        {
          table: "members",
          filters: [
            { column: "tenant_id", value: "t1" },
            { column: "user_id", value: "u1" },
          ],
        },
      ]);
    },
  );

  it("status zamykający wygrywa z niezgodną rolą — odmowa mówi o zawieszeniu", async () => {
    const { client } = fakeClient(memberClaims({ role: "staff" }), { role: "staff", status: "suspended" });
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

describe("requireMemberWithClient — kolejność bramek (zero odczytów przed członkostwem)", () => {
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
  it("błąd odczytu członkostwa NIE przepuszcza (rzuca, nie AuthError-em)", async () => {
    const { client } = fakeClient(memberClaims(), { error: { message: "connection refused" } });
    const attempt = requireMemberWithClient(client);
    await expect(attempt).rejects.toThrow(/członkostwa w organizacji/);
    await expect(attempt).rejects.not.toBeInstanceOf(AuthError);
  });

  it("brak wiersza przy poprawnym claimie → membership_revoked (nie forbidden, nie przepustka)", async () => {
    const { client } = fakeClient(memberClaims(), { missing: true });
    await expect(requireMemberWithClient(client)).rejects.toMatchObject({
      status: 403,
      code: "membership_revoked",
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

/**
 * OKNO DOMYKANIA (Zasada 8, ADR-138) — zegar graniczny po OBU stronach progu
 * i macierz opt-in. Arytmetykę zegara dowodzi closing-window.test.ts w core;
 * tu pilnujemy, że GUARD faktycznie od niej zależy (mutacja zdejmująca
 * warunek okna z rdzenia pali graniczne testy niżej).
 */
describe("requireMemberWithClient — okno domykania (ADR-138)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  /** suspended_at N dni (i epsilon) temu, względem realnego zegara guardu. */
  const suspendedAgo = (ms: number) => new Date(Date.now() - ms).toISOString();
  const INSIDE_WINDOW = () => suspendedAgo(29 * DAY_MS); // dzień zapasu
  const EDGE_STILL_OPEN = () => suspendedAgo(30 * DAY_MS - 60_000); // minuta przed progiem
  const EDGE_CLOSED = () => suspendedAgo(30 * DAY_MS + 60_000); // minuta po progu

  it("suspended w oknie + opt-in { closing: true } → PRZEPUSZCZA z ctx.closing i zegarem", async () => {
    const suspendedAt = INSIDE_WINDOW();
    const { client } = fakeClient(memberClaims(), { status: "suspended", suspendedAt });
    const ctx = await requireMemberWithClient(client, undefined, { closing: true });
    expect(ctx.closing).toBe(true);
    expect(ctx.tenantStatus).toBe("suspended");
    expect(ctx.suspendedAt).toBe(suspendedAt);
  });

  it("suspended w oknie BEZ opt-in → 403 tenant_suspended_closing (odmowa domyślna)", async () => {
    const { client } = fakeClient(memberClaims(), {
      status: "suspended",
      suspendedAt: INSIDE_WINDOW(),
    });
    await expect(requireMemberWithClient(client)).rejects.toMatchObject({
      status: 403,
      code: "tenant_suspended_closing",
    });
  });

  it("ZEGAR GRANICZNY: minutę PRZED progiem okno otwarte (opt-in przechodzi)", async () => {
    const { client } = fakeClient(memberClaims(), {
      status: "suspended",
      suspendedAt: EDGE_STILL_OPEN(),
    });
    const ctx = await requireMemberWithClient(client, undefined, { closing: true });
    expect(ctx.closing).toBe(true);
  });

  it("ZEGAR GRANICZNY: minutę PO progu odmowa KAŻDEJ akcji, także z opt-in → tenant_suspended", async () => {
    const { client } = fakeClient(memberClaims(), {
      status: "suspended",
      suspendedAt: EDGE_CLOSED(),
    });
    await expect(
      requireMemberWithClient(client, undefined, { closing: true }),
    ).rejects.toMatchObject({ status: 403, code: "tenant_suspended" });
  });

  it("suspended BEZ zegara (null) + opt-in → tenant_suspended (fail-closed)", async () => {
    const { client } = fakeClient(memberClaims(), { status: "suspended", suspendedAt: null });
    await expect(
      requireMemberWithClient(client, undefined, { closing: true }),
    ).rejects.toMatchObject({ code: "tenant_suspended" });
  });

  it.each([
    ["cancelled", "tenant_cancelled"],
    ["superadmin_locked", "tenant_locked"],
  ] as const)("opt-in NIE otwiera statusu %s (świeży zegar bez znaczenia) → %s", async (status, code) => {
    const { client } = fakeClient(memberClaims(), { status, suspendedAt: INSIDE_WINDOW() });
    await expect(
      requireMemberWithClient(client, undefined, { closing: true }),
    ).rejects.toMatchObject({ status: 403, code });
  });

  it("poza suspended ctx.closing zostaje false i suspendedAt null — opt-in bez skutku", async () => {
    const { client } = fakeClient(memberClaims(), { status: "active" });
    const ctx = await requireMemberWithClient(client, undefined, { closing: true });
    expect(ctx.closing).toBe(false);
    expect(ctx.suspendedAt).toBeNull();
  });
});

describe("requireMemberPage — okno domykania: dokąd trafiają odmowy (przez REALNY rdzeń)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    currentLocale = "pl";
    requireMemberMock.mockReset();
  });

  it("strona POZA allowlistą przy otwartym oknie → /zamowienia (hub domykania), nie ekran zamknięcia", async () => {
    const { client } = fakeClient(memberClaims(), {
      status: "suspended",
      suspendedAt: new Date(Date.now() - DAY_MS).toISOString(),
    });
    requireMemberMock.mockImplementation(() => requireMemberWithClient(client));

    await expect(requireMemberPage("/katalog")).rejects.toMatchObject({
      url: "/pl/zamowienia",
    });
  });

  it("po zamknięciu okna KAŻDA strona → /organizacja-zawieszona (jak dotąd)", async () => {
    const { client } = fakeClient(memberClaims(), {
      status: "suspended",
      suspendedAt: new Date(Date.now() - 31 * DAY_MS).toISOString(),
    });
    requireMemberMock.mockImplementation(() => requireMemberWithClient(client));

    await expect(requireMemberPage("/zamowienia")).rejects.toMatchObject({
      url: "/pl/organizacja-zawieszona",
    });
  });

  it.each(["cancelled", "superadmin_locked"] as const)(
    "status %s → /organizacja-zawieszona (rozdzielone kody nie zgubiły przekierowania)",
    async (status) => {
      const { client } = fakeClient(memberClaims(), { status });
      requireMemberMock.mockImplementation(() => requireMemberWithClient(client));

      await expect(requireMemberPage("/zamowienia")).rejects.toMatchObject({
        url: "/pl/organizacja-zawieszona",
      });
    },
  );
});
