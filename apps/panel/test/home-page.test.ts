/**
 * Strona główna panelu (`/[locale]`) — dwie odrębne gwarancje.
 *
 * 1. ANONIM NIE WIDZI PANELU. Do 1.5.7 strona była świadomie bez guarda
 *    (kontekst przez `getAuthContext`, które nie rzuca), więc niezalogowany
 *    dostawał listę linków nawigacyjnych zamiast ekranu logowania. To nie był
 *    wyciek (zero danych, link superadmina i tak zależy od claimu), ale zła
 *    powierzchnia: pierwszy ekran produkcyjnego panelu wygląda jak menu, do
 *    którego nikt nie ma dostępu. Teraz `ctx === null` kończy się
 *    przekierowaniem na `/{locale}/login` — z prefiksem locale, bo gołe
 *    `redirect("/login")` gubi język (pułapka udokumentowana w ADR-034
 *    i lib/navigation.ts).
 *
 * 2. MASKOWANIE /admin ZOSTAJE SZCZELNE. Link „Panel superadmina" widzi
 *    WYŁĄCZNIE sesja z claimem `superadmin` — dla każdej innej nie ma go
 *    w drzewie, więc nic nie ujawnia istnienia panelu (ADR-010/011, ADR-034).
 *    Zmiana z punktu 1 nie ma prawa tego rozluźnić, dlatego oba przypadki
 *    (z claimem i bez) są tu jawnie przypięte.
 *
 * Asercja na DRZEWIE elementów, nie na markupie: strona główna jest Server
 * Component, a `renderToStaticMarkup` wymagałby kontekstu routera App Routera
 * dla `next/link`. Drzewo niesie dokładnie ten sam dowód — link albo w nim
 * jest, albo go nie ma — bez atrapy całego środowiska renderowania.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let currentLocale = "pl";
let claims: Record<string, unknown> | null = null;

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
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => (claims ? { data: { claims }, error: null } : { data: null, error: null }),
    },
  }),
}));

const { SUPERADMIN_HOME } = await import("@/lib/superadmin");
const Home = (await import("@/app/[locale]/(panel)/page")).default;

/** Sesja z podanymi claimami app_metadata (kształt hooka 0003_auth.sql). */
function session(appMetadata: Record<string, unknown>): Record<string, unknown> {
  return {
    sub: "00000000-0000-4000-8000-000000000001",
    email: "operator@example.com",
    aal: "aal1",
    app_metadata: appMetadata,
  };
}

/** Zbiera wszystkie `href` z drzewa elementów zwróconego przez stronę. */
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

beforeEach(() => {
  currentLocale = "pl";
  claims = null;
});

describe.each(["pl", "en"])("strona główna panelu — locale %s", (locale) => {
  beforeEach(() => {
    currentLocale = locale;
  });

  it("anonim jest odsyłany na logowanie w swoim języku", async () => {
    claims = null;

    let target: string | null = null;
    try {
      await Home();
    } catch (error) {
      if (error instanceof RedirectSignal) target = error.url;
      else throw error;
    }

    expect(target, "anonim zobaczył stronę główną zamiast logowania").not.toBeNull();
    expect(target).toBe(`/${locale}/login`);
  });

  it("członek organizacji widzi stronę (bez przekierowania)", async () => {
    claims = session({ tenant_id: "00000000-0000-4000-8000-000000000009", role: "owner" });

    const tree = await Home();

    expect(tree).toBeTruthy();
    expect(collectHrefs(tree)).toContain("/zamowienia");
  });
});

describe("widoczność wejścia do panelu superadmina", () => {
  it("sesja z claimem superadmin dostaje link do /admin", async () => {
    claims = session({ superadmin: true });

    const hrefs = collectHrefs(await Home());

    expect(hrefs).toContain(SUPERADMIN_HOME);
  });

  it("sesja BEZ claimu superadmin nie ma linku do /admin w drzewie", async () => {
    claims = session({ tenant_id: "00000000-0000-4000-8000-000000000009", role: "staff" });

    const hrefs = collectHrefs(await Home());

    expect(hrefs).not.toContain(SUPERADMIN_HOME);
    expect(hrefs.some((href) => href.startsWith("/admin"))).toBe(false);
  });
});
