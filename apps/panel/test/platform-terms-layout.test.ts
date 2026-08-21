/**
 * Layout `(panel)` — przesłona regulaminu ZAMIAST treści (0070, ADR-141).
 *
 * Test broni DRZEWA elementów zwróconego przez `PanelLayout` (wzorzec
 * kreator-layout-review-gate): gdy bramka `readPlatformTermsGate` mówi
 * „brak akceptacji", w drzewie stoi `PlatformTermsOverlay` a `children` NIE
 * wchodzą do wyniku; gdy bramka milczy — children przechodzą, a przesłony
 * nie ma. To dokładnie kontrakt „gasimy TREŚĆ, nie trasę" (ADR-133): shell
 * (sidebar, topbar, baner rozliczeń) renderuje się w OBU stanach, redirectu
 * nie ma nigdzie, więc pętla onboardingu nie ma jak powstać.
 *
 * Sama DECYZJA bramki (owner/personel/brak wersji/dowód) ma osobne dowody
 * behawioralne w platform-terms-gate.test.ts — tu jest wyłącznie okablowanie
 * layoutu, bo string w pliku niczego nie gwarantuje o realnym renderze.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlatformTermsGate } from "@/lib/platform-terms";

let claims: Record<string, unknown> | null = null;
let gate: PlatformTermsGate | null = null;
const gateCalls: unknown[] = [];

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () =>
        claims ? { data: { claims }, error: null } : { data: null, error: null },
    },
  }),
}));

vi.mock("@/lib/closing", () => ({
  readTenantBillingState: async () => null,
}));

vi.mock("@/lib/platform-terms", () => ({
  readPlatformTermsGate: async (_supabase: unknown, ctx: unknown) => {
    gateCalls.push(ctx);
    return gate;
  },
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "pl",
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  // Layout czyta ciasteczko zwinięcia paska przewodnika (ADR-229); tu tenant
  // ma pełny dostęp bez tego stanu, więc mock oddaje puste ciasteczka.
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

const { PlatformTermsOverlay } = await import("@/components/shell/platform-terms-overlay");
const PanelLayout = (await import("@/app/[locale]/(panel)/layout")).default;

const MARKER = "TREŚĆ_PANELU_MARKER";

const SAMPLE_GATE: PlatformTermsGate = {
  versionId: "11111111-1111-4111-8111-111111111111",
  versionLabel: "v1",
  effectiveFrom: "2026-09-01T00:00:00.000Z",
};

function session(appMetadata: Record<string, unknown>): Record<string, unknown> {
  return {
    sub: "00000000-0000-4000-8000-000000000001",
    email: "owner@example.com",
    aal: "aal1",
    app_metadata: appMetadata,
  };
}

/** Czy drzewo elementów zawiera węzeł danego typu (identyczność referencji). */
function containsType(node: unknown, type: unknown): boolean {
  if (Array.isArray(node)) return node.some((child) => containsType(child, type));
  if (!node || typeof node !== "object") return false;
  if ((node as { type?: unknown }).type === type) return true;
  const props = (node as { props?: { children?: unknown } }).props;
  if (!props) return false;
  return containsType(props.children, type);
}

/** Zbiera wszystkie napisy z drzewa — dowód, że `{children}` (nie) trafia do wyniku. */
function collectStrings(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, found);
    return found;
  }
  if (typeof node === "string") {
    found.push(node);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  const props = (node as { props?: { children?: unknown } }).props;
  if (!props) return found;
  collectStrings(props.children, found);
  return found;
}

afterEach(() => {
  claims = null;
  gate = null;
  gateCalls.length = 0;
});

describe("(panel)/layout — przesłona regulaminu platformy", () => {
  it("bramka zapalona → w drzewie stoi PlatformTermsOverlay, a children NIE wchodzą do wyniku", async () => {
    claims = session({ tenant_id: "22222222-2222-4222-8222-222222222222", role: "owner" });
    gate = SAMPLE_GATE;

    const tree = await PanelLayout({ children: MARKER });

    expect(containsType(tree, PlatformTermsOverlay), "brak przesłony w drzewie").toBe(true);
    expect(collectStrings(tree), "treść panelu przecieka obok przesłony").not.toContain(MARKER);
  });

  it("bramka zgaszona → children przechodzą, przesłony nie ma (stan każdej sesji przed seedem treści)", async () => {
    claims = session({ tenant_id: "22222222-2222-4222-8222-222222222222", role: "owner" });
    gate = null;

    const tree = await PanelLayout({ children: MARKER });

    expect(containsType(tree, PlatformTermsOverlay)).toBe(false);
    expect(collectStrings(tree)).toContain(MARKER);
  });

  it("layout woła bramkę z kontekstem sesji (nie decyduje sam) — także dla sesji bez organizacji", async () => {
    claims = session({});
    gate = null;

    const tree = await PanelLayout({ children: MARKER });

    // Decyzja „sesja bez organizacji nigdy nie dostaje przesłony" żyje w
    // readPlatformTermsGate (dowód behawioralny w platform-terms-gate.test.ts);
    // layout ma jej nie obchodzić bokiem — przekazuje ctx i renderuje children.
    expect(gateCalls).toHaveLength(1);
    expect((gateCalls[0] as { tenantId: string | null }).tenantId).toBeNull();
    expect(collectStrings(tree)).toContain(MARKER);
    expect(containsType(tree, PlatformTermsOverlay)).toBe(false);
  });

  it("przesłona dostaje DOKŁADNIE wersję z bramki (dowód wskazuje to, co widzi user)", async () => {
    claims = session({ tenant_id: "22222222-2222-4222-8222-222222222222", role: "owner" });
    gate = SAMPLE_GATE;

    const tree = await PanelLayout({ children: MARKER });

    const overlayProps = (function find(node: unknown): Record<string, unknown> | null {
      if (Array.isArray(node)) {
        for (const child of node) {
          const hit = find(child);
          if (hit) return hit;
        }
        return null;
      }
      if (!node || typeof node !== "object") return null;
      const typed = node as { type?: unknown; props?: Record<string, unknown> };
      if (typed.type === PlatformTermsOverlay) return typed.props ?? null;
      return find((typed.props as { children?: unknown } | undefined)?.children);
    })(tree);

    expect(overlayProps).not.toBeNull();
    expect(overlayProps).toMatchObject({
      versionId: SAMPLE_GATE.versionId,
      versionLabel: SAMPLE_GATE.versionLabel,
      effectiveFrom: SAMPLE_GATE.effectiveFrom,
    });
  });
});
