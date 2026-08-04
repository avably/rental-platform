/**
 * Powłoka grupy `(kreator)` — bramka nakładki przeglądu (naprawa pinezki
 * 494d7445, ADR-071 + ADR-083).
 *
 * Przyczyna, dla której widget nie renderował się na `/strona/kreator` i
 * `/strona/podglad`: `(kreator)` nie miała WŁASNEGO layoutu, więc trasa nie
 * dziedziczyła `<ReviewOverlayGate>` z `(panel)` (grupa poza nią, ADR-083).
 * Ten test broni DRZEWA elementów zwróconego przez `KreatorLayout` — nie
 * skanuje źródła — bo string w pliku niczego nie gwarantuje o realnym
 * renderze (ten sam błąd, tylko przesunięty o jeden krok).
 *
 * Cztery warianty potrójnej bramki: brakujący którykolwiek z dwóch warunków
 * serwerowych (env, `ctx.superadmin`) ma dać drzewo BEZ widgetu; oba razem —
 * drzewo Z widgetem. Trzeci warunek (`?review=1`) jest kliencki i żyje
 * wewnątrz samej bramki (`ReviewOverlayGate`) — poza zasięgiem tego testu.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

let claims: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () =>
        claims ? { data: { claims }, error: null } : { data: null, error: null },
    },
  }),
}));

const { ReviewOverlayGate } = await import("@avably/review/overlay");
const KreatorLayout = (await import("@/app/[locale]/(kreator)/layout")).default;

/** Sesja z podanymi claimami app_metadata (kształt hooka 0003_auth.sql). */
function session(appMetadata: Record<string, unknown>): Record<string, unknown> {
  return {
    sub: "00000000-0000-4000-8000-000000000001",
    email: "operator@example.com",
    aal: "aal1",
    app_metadata: appMetadata,
  };
}

/** Czy drzewo elementów zawiera węzeł DANEGO typu (identyczność referencji). */
function containsType(node: unknown, type: unknown): boolean {
  if (Array.isArray(node)) return node.some((child) => containsType(child, type));
  if (!node || typeof node !== "object") return false;
  if ((node as { type?: unknown }).type === type) return true;
  const props = (node as { props?: { children?: unknown } }).props;
  if (!props) return false;
  return containsType(props.children, type);
}

/** Zbiera wszystkie napisy z drzewa — dowód, że `{children}` nadal trafia do wyniku. */
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

const MARKER = "PŁÓTNO_KREATORA_MARKER";

afterEach(() => {
  vi.unstubAllEnvs();
  claims = null;
});

describe("(kreator)/layout — bramka nakładki przeglądu", () => {
  it("REVIEW_MODE=1 + superadmin → widget JEST w drzewie", async () => {
    vi.stubEnv("REVIEW_MODE", "1");
    claims = session({ superadmin: true });

    const tree = await KreatorLayout({ children: MARKER });

    expect(containsType(tree, ReviewOverlayGate)).toBe(true);
    expect(collectStrings(tree)).toContain(MARKER);
  });

  it("REVIEW_MODE wyłączony (superadmin OK) → widgetu NIE MA", async () => {
    vi.stubEnv("REVIEW_MODE", "0");
    claims = session({ superadmin: true });

    const tree = await KreatorLayout({ children: MARKER });

    expect(containsType(tree, ReviewOverlayGate)).toBe(false);
    expect(collectStrings(tree)).toContain(MARKER);
  });

  it("REVIEW_MODE niezdefiniowany (superadmin OK) → widgetu NIE MA", async () => {
    vi.stubEnv("REVIEW_MODE", "");
    claims = session({ superadmin: true });

    const tree = await KreatorLayout({ children: MARKER });

    expect(containsType(tree, ReviewOverlayGate)).toBe(false);
  });

  it("REVIEW_MODE=1, sesja BEZ superadmina → widgetu NIE MA", async () => {
    vi.stubEnv("REVIEW_MODE", "1");
    claims = session({ tenant_id: "00000000-0000-4000-8000-000000000009", role: "owner" });

    const tree = await KreatorLayout({ children: MARKER });

    expect(containsType(tree, ReviewOverlayGate)).toBe(false);
    expect(collectStrings(tree)).toContain(MARKER);
  });

  it("REVIEW_MODE=1, brak sesji (anonim) → widgetu NIE MA", async () => {
    vi.stubEnv("REVIEW_MODE", "1");
    claims = null;

    const tree = await KreatorLayout({ children: MARKER });

    expect(containsType(tree, ReviewOverlayGate)).toBe(false);
  });
});
