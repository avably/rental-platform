/**
 * Bramka statusu TREŚCI pulpitu `/` (ADR-133) — domknięcie rozjazdu
 * ADR-107 vs ADR-109.
 *
 * ADR-107 zostawił `/` świadomie poza guardem jako „placeholder bez JEDNEJ
 * danej tenanta"; ADR-109 (C1) zamienił placeholder w dashboard z prawdziwymi
 * liczbami (przychód, top klienci) — i przesłanka wyjątku przestała istnieć:
 * członek ZAWIESZONEGO tenanta widział metryki, choć każda inna trasa panelu
 * odmawia. Od ADR-133 strona pyta TEN SAM rdzeń co reszta panelu
 * (`requireMemberWithClient` — realny, tu podstawiona jest wyłącznie atrapa
 * klienta Supabase), więc lista statusów zamykających zostaje przypięta w
 * JEDNYM miejscu (`PANEL_CLOSED_STATUSES`), bez nowych literałów.
 *
 * Własności przypięte tu (każda mierzona na DRZEWIE elementów — strona jest
 * Server Component, wzorzec z home-page.test.ts):
 *   1. Status zamykający (suspended/cancelled/superadmin_locked) → w drzewie
 *      NIE MA `DashboardSections` (ani jednej liczby biznesowej), JEST
 *      komunikat o stanie konta. Trasa zostaje — żadnego przekierowania.
 *   2. Kontrola pozytywna: trialing/active/past_due renderują dashboard —
 *      `past_due` to normalna praca (zasada dunningu: presja przez baner,
 *      nie przez blokadę; baner poza zakresem ADR-133).
 *   3. Regresja onboardingu: sesja BEZ organizacji dostaje placeholder bez
 *      JEDNEGO zapytania do bazy i bez przekierowania (pętla przekierowań
 *      `requireMemberPage` na `/` — powód, dla którego gasimy treść, nie trasę).
 *   4. Izolacja: jedyny odczyt idzie o WŁASNY wiersz members (tenant_id
 *      i user_id z claimu sesji) — bramka nie otwiera cudzych danych.
 *   5. Cofnięte członkostwo → /dostep-cofniety (spójnie z member-page);
 *      błąd odczytu → rzut (500), nigdy przepustka ani fałszywy komunikat.
 */
import { describe, expect, it, vi } from "vitest";

import { PANEL_CLOSED_STATUSES } from "@/lib/auth";

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
  // Echo klucza — asercje tekstowe mierzą KTÓRY klucz trafił do drzewa.
  getTranslations: async () => (key: string) => key,
}));

interface FakeMemberRead {
  status?: string;
  /** Zegar okna domykania (ADR-138); brak pola = null (okno zamknięte). */
  suspendedAt?: string | null;
  missing?: boolean;
  error?: { message: string };
}

let memberRead: FakeMemberRead = {};
let currentClaims: Record<string, unknown> | null = null;
let reads: Array<{ table: string; filters: Array<{ column: string; value: unknown }> }> = [];

/**
 * Atrapa klienta Supabase o kształcie używanym przez requireMemberWithClient
 * (wzorzec z tenant-status-guard.test.ts). `schema()` rzuca: dowód, że strona
 * NIE wykonuje żadnego RPC dashboardu podczas renderu (I/O sekcji żyje w
 * elemencie `DashboardSections`, którego bramka ma NIE wyrenderować).
 */
function fakeClient() {
  return {
    auth: {
      getClaims: async () => ({
        data: currentClaims ? { claims: currentClaims } : null,
        error: null,
      }),
    },
    schema: () => {
      throw new Error("Strona główna nie może wołać RPC podczas renderu.");
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
              if (memberRead.error) return { data: null, error: memberRead.error };
              if (memberRead.missing) return { data: null, error: null };
              return {
                data: {
                  role: "owner",
                  tenants: {
                    status: memberRead.status ?? "active",
                    suspended_at: memberRead.suspendedAt ?? null,
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
}

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => fakeClient(),
}));

const { DashboardSections } = await import("@/app/[locale]/(panel)/dashboard-sections");
const Home = (await import("@/app/[locale]/(panel)/page")).default;

function setSession(
  claims: Record<string, unknown> | null,
  member: FakeMemberRead = {},
): void {
  currentClaims = claims;
  memberRead = member;
  reads = [];
}

const memberClaims = {
  sub: "00000000-0000-4000-8000-000000000001",
  email: "operator@example.com",
  aal: "aal1",
  app_metadata: { tenant_id: "00000000-0000-4000-8000-000000000009", role: "owner" },
};

/** Wszystkie typy elementów i liście tekstowe drzewa (bez renderowania I/O). */
function walk(node: unknown, out: { types: unknown[]; texts: string[] }): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return;
  }
  if (typeof node === "string") {
    out.texts.push(node);
    return;
  }
  if (!node || typeof node !== "object") return;
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type !== undefined) out.types.push(el.type);
  if (el.props) walk(el.props.children, out);
}

function analyze(tree: unknown): { types: unknown[]; texts: string[] } {
  const out = { types: [] as unknown[], texts: [] as string[] };
  walk(tree, out);
  return out;
}

/** Wszystkie `href` z drzewa — dowód, DOKĄD ekran prowadzi (wzorzec home-page). */
function collectHrefs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectHrefs(child, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return found;
  if (typeof props.href === "string") found.push(props.href);
  collectHrefs(props.children, found);
  return found;
}

describe("pulpit `/` — statusy zamykające gaszą TREŚĆ, nie trasę (ADR-133)", () => {
  it.each([...PANEL_CLOSED_STATUSES])(
    "status %s → zero metryk (brak DashboardSections), komunikat o stanie konta",
    async (status) => {
      setSession(memberClaims, { status });

      const { types, texts } = analyze(await Home());

      expect(types, "treść pulpitu ma zgasnąć dla statusu zamykającego").not.toContain(
        DashboardSections,
      );
      expect(texts).toContain("suspendedTitle");
      expect(texts).toContain("suspendedBody");
      // Sekcje metryk nie mają prawa być w drzewie nawet „na zapas".
      expect(texts).not.toContain("dashboardIntro");
    },
  );

  it.each(["trialing", "active", "past_due"] as const)(
    "kontrola pozytywna: status %s renderuje dashboard (past_due = normalna praca)",
    async (status) => {
      setSession(memberClaims, { status });

      const { types, texts } = analyze(await Home());

      expect(types).toContain(DashboardSections);
      expect(texts).not.toContain("suspendedTitle");
    },
  );

  it("OKNO DOMYKANIA (ADR-138): suspended w oknie → dalej ZERO liczb, ale wejście do huba domykania", async () => {
    // Spec (e)8: członek zawieszonego tenanta nie dostaje na `/` ani jednej
    // liczby biznesowej — TAKŻE gdy okno domykania jest otwarte. Zmienia się
    // wyłącznie copy: zamiast ślepej ściany operator widzi CTA do /zamowienia.
    setSession(memberClaims, {
      status: "suspended",
      suspendedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    const { types, texts } = analyze(await Home());

    expect(types).not.toContain(DashboardSections);
    expect(texts).not.toContain("dashboardIntro");
    expect(texts).toContain("suspendedTitle");
    expect(texts).toContain("closingBody");
    expect(texts).toContain("closingOrdersCta");
  });

  it("izolacja: jedyny odczyt bramki idzie o WŁASNY wiersz members (klucze z claimu)", async () => {
    setSession(memberClaims, { status: "suspended" });

    await Home();

    expect(reads).toEqual([
      {
        table: "members",
        filters: [
          { column: "tenant_id", value: "00000000-0000-4000-8000-000000000009" },
          { column: "user_id", value: "00000000-0000-4000-8000-000000000001" },
        ],
      },
    ]);
  });
});

describe("pulpit `/` — regresja onboardingu i anomalie (ADR-133)", () => {
  it("sesja bez organizacji: ekran onboardingu, zero zapytań do bazy, zero przekierowań", async () => {
    setSession({ sub: "u-bez-org", app_metadata: {} });

    const { types, texts } = analyze(await Home());

    expect(texts).toContain("onboardingTitle");
    expect(types).not.toContain(DashboardSections);
    expect(texts).not.toContain("suspendedTitle");
    expect(reads).toEqual([]);
  });

  /**
   * KONIEC PĘTLI (ADR-153, N4). Pulpit odsyłał konto bez organizacji „do
   * zamówień", a `requireMemberPage` odsyłało je z zamówień z powrotem tutaj.
   * Ekran musi prowadzić do JEDYNEJ czynności, którą takie konto może
   * wykonać — i do niczego innego.
   */
  it("sesja bez organizacji: CTA prowadzi na /organizacja/nowa, a NIE na /zamowienia", async () => {
    setSession({ sub: "u-bez-org", app_metadata: {} });

    const hrefs = collectHrefs(await Home());

    expect(hrefs, "ekran onboardingu nie prowadzi do zakładania organizacji").toContain(
      "/organizacja/nowa",
    );
    expect(hrefs, "pętla pulpit ↔ zamówienia wciąż żyje").not.toContain("/zamowienia");
  });

  it("kontrola pozytywna: sesja Z organizacją NIE dostaje CTA onboardingu", async () => {
    setSession(memberClaims, { status: "active" });

    const hrefs = collectHrefs(await Home());

    expect(hrefs).toContain("/zamowienia");
    expect(hrefs).not.toContain("/organizacja/nowa");
  });

  it("superadmin bez organizacji: placeholder z wejściem do /admin, zero zapytań", async () => {
    setSession({ sub: "sa", app_metadata: { superadmin: true } });

    const { texts } = analyze(await Home());

    expect(texts).toContain("onboardingTitle");
    expect(reads).toEqual([]);
  });

  it("cofnięte członkostwo → /dostep-cofniety (spójnie z member-page)", async () => {
    setSession(memberClaims, { missing: true });

    await expect(Home()).rejects.toMatchObject({ url: "/pl/dostep-cofniety" });
  });

  it("błąd odczytu statusu → rzut (500), nie przepustka i nie fałszywy komunikat", async () => {
    setSession(memberClaims, { error: { message: "connection refused" } });

    await expect(Home()).rejects.toThrow(/członkostwa w organizacji/);
  });
});
