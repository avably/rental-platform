/**
 * Montaż nakładki przeglądu we WSZYSTKICH powłokach panelu (ADR-206).
 *
 * Właściciel komentuje produkt także tam, gdzie nie ma sesji superadmina:
 * na rejestracji/logowaniu (grupa `(auth)` — layout istnieje WYŁĄCZNIE dla
 * nakładki), na onboardingu organizacji (grupa `(panel)`, zwykły user) i na
 * ekranach admina. Ten test broni DRZEWA elementów zwróconego przez każdy
 * layout (wzorzec kreator-layout-review-gate): string w pliku niczego nie
 * gwarantuje o realnym renderze.
 *
 * Dwie strony tej samej monety:
 *  1. REVIEW_MODE=1 → `ReviewOverlayGate` JEST w drzewie bez żadnej sesji
 *     (anonim) i dla zwykłego usera bez organizacji (onboarding).
 *  2. KILL-SWITCH: REVIEW_MODE wyłączony/niezdefiniowany → widgetu NIE MA
 *     w żadnej powłoce — to jedyna bramka serwerowa montażu, więc jej
 *     zdjęcie (montaż bezwarunkowy) MUSI zapalić ten plik.
 *
 * Warunek kliencki (`?review=1`) żyje wewnątrz samej bramki
 * (`ReviewOverlayGate`, dynamiczny import) — poza zasięgiem tego testu.
 * Grupa `(kreator)` ma własny, wcześniejszy plik testowy.
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

vi.mock("@/lib/closing", () => ({
  readTenantBillingState: async () => null,
}));

vi.mock("@/lib/platform-terms", () => ({
  readPlatformTermsGate: async () => null,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "pl",
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

const { ReviewOverlayGate } = await import("@avably/review/overlay");
const AuthLayout = (await import("@/app/[locale]/(auth)/layout")).default;
const PanelLayout = (await import("@/app/[locale]/(panel)/layout")).default;
const SuperadminLayout = (await import("@/app/[locale]/(superadmin)/layout")).default;

const MARKER = "TREŚĆ_POWŁOKI_MARKER";

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

function session(appMetadata: Record<string, unknown>): Record<string, unknown> {
  return {
    sub: "00000000-0000-4000-8000-000000000001",
    email: "user@example.com",
    aal: "aal1",
    app_metadata: appMetadata,
  };
}

const LAYOUTS = [
  ["(auth)", AuthLayout],
  ["(panel)", PanelLayout],
  ["(superadmin)", SuperadminLayout],
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
  claims = null;
});

describe("montaż nakładki przeglądu — wszystkie powłoki (ADR-206)", () => {
  it.each(LAYOUTS)("%s: REVIEW_MODE=1 + ANONIM → widget JEST w drzewie", async (_name, Layout) => {
    vi.stubEnv("REVIEW_MODE", "1");
    claims = null;

    const tree = await Layout({ children: MARKER });

    expect(containsType(tree, ReviewOverlayGate)).toBe(true);
    expect(collectStrings(tree)).toContain(MARKER);
  });

  it("(panel): REVIEW_MODE=1 + zwykły user BEZ organizacji (onboarding) → widget JEST", async () => {
    vi.stubEnv("REVIEW_MODE", "1");
    claims = session({});

    const tree = await PanelLayout({ children: MARKER });

    expect(containsType(tree, ReviewOverlayGate)).toBe(true);
    expect(collectStrings(tree)).toContain(MARKER);
  });

  it.each(LAYOUTS)("%s: REVIEW_MODE=0 → widgetu NIE MA (kill-switch)", async (_name, Layout) => {
    vi.stubEnv("REVIEW_MODE", "0");
    claims = session({ superadmin: true });

    const tree = await Layout({ children: MARKER });

    expect(containsType(tree, ReviewOverlayGate)).toBe(false);
    expect(collectStrings(tree)).toContain(MARKER);
  });

  it.each(LAYOUTS)("%s: REVIEW_MODE pusty → widgetu NIE MA", async (_name, Layout) => {
    vi.stubEnv("REVIEW_MODE", "");
    claims = null;

    const tree = await Layout({ children: MARKER });

    expect(containsType(tree, ReviewOverlayGate)).toBe(false);
  });
});
