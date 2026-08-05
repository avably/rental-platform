/**
 * Bramka CI dla middleware'u panelu (proxy.ts). Odpowiednik bramki RLS, tylko
 * dla warstwy żądania: routing locale, odświeżanie sesji i nonce CSP są dziś
 * poprawne, ale poprawność wisiała na ręcznej weryfikacji — ten plik ma
 * zapłonąć, zanim regresja dojedzie na produkcję.
 *
 * Testy celowo NIE potrzebują Supabase (klient jest zamockowany), więc biegną
 * w jobie `ci`, a nie tylko w `rls` — inaczej byłyby pomijane dokładnie tam,
 * gdzie mają pilnować.
 *
 * Pilnowane własności:
 *   1. prefiks locale nie jest kanałem obejścia matchera (//, /PL/, /xx/,
 *      podwójny prefiks, %2f),
 *   2. sesja odświeża się PRZED next-intl — świeże cookies widzi routing
 *      locale i przeżywają redirect 307,
 *   3. nonce CSP jest unikalny per żądanie i ten sam w nagłówku odpowiedzi
 *      co w nagłówku żądania podanym dalej do renderu.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cookies, które udawany Supabase zapisze przez `setAll` przy najbliższym
 * `getClaims()`. Symuluje odświeżenie tokenu: biblioteka robi dokładnie to
 * samo, gdy access token jest bliski wygaśnięcia.
 */
let cookiesToWrite: { name: string; value: string; options: Record<string, unknown> }[] = [];
const getClaims = vi.fn();

vi.mock("@avably/db", () => ({
  createServerClient: (
    { setAll }: { getAll: () => unknown; setAll: (c: typeof cookiesToWrite) => void },
  ) => ({
    auth: {
      getClaims: async () => {
        // Zapis cookies MUSI nastąpić w trakcie getClaims() — tak zachowuje
        // się @supabase/ssr i na tym stoi test kolejności poniżej.
        if (cookiesToWrite.length > 0) setAll(cookiesToWrite);
        return getClaims();
      },
    },
  }),
}));

const { proxy, config } = await import("../proxy");

beforeEach(() => {
  cookiesToWrite = [];
  getClaims.mockReset();
  getClaims.mockResolvedValue({ data: null, error: null });
});

/** NextRequest ma własny RequestInit (węższy niż globalny) — bierzemy go z konstruktora. */
type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function request(path: string, init?: NextRequestInit): NextRequest {
  return new NextRequest(`https://panel.example${path}`, init);
}

/** Nonce wyłuskany z `script-src 'nonce-…'` w nagłówku CSP odpowiedzi. */
function cspNonce(response: Response): string | null {
  const csp = response.headers.get("Content-Security-Policy") ?? "";
  return /script-src [^;]*'nonce-([^']+)'/.exec(csp)?.[1] ?? null;
}

describe("proxy panelu — nonce CSP", () => {
  it("nonce jest unikalny dla każdego żądania", async () => {
    const first = cspNonce(await proxy(request("/en")));
    const second = cspNonce(await proxy(request("/en")));

    expect(first, "brak nonce w CSP").toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("nonce z CSP odpowiedzi jest tym samym nonce, który dostaje render", async () => {
    const response = await proxy(request("/en"));

    // Kanał, którym Next.js podaje nonce do renderu: nagłówki żądania
    // przepisane przez middleware. Rozjazd tych dwóch wartości = <script>
    // Next.js nie przechodzi własnej polityki.
    const forwarded = response.headers.get("x-middleware-request-x-nonce");
    expect(forwarded, "nonce nie trafił do nagłówków żądania").toBeTruthy();
    expect(cspNonce(response)).toBe(forwarded);
  });

  it("CSP nie dopuszcza 'unsafe-inline' w script-src", async () => {
    const csp = (await proxy(request("/en"))).headers.get("Content-Security-Policy") ?? "";
    expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/);
  });

  /*
   * PANEL NIE OSADZA OBCYCH RAMEK (E5, ADR-096 — delta recenzji PM do PR #186).
   *
   * Sklep dostaje źródło ramki dostawcy map (`maps` w @avably/security), bo bez
   * niego sekcja dojazdu nie pokazałaby mapy. Panel go NIE dostaje świadomie:
   * powierzchnia edycyjna z zalogowaną sesją najemcy nie jest miejscem na obce
   * ramki, a płótno i podgląd rysują tam zdanie zamiast ramki (kreator nie
   * podaje `mapEmbed`).
   *
   * Niezmiennik był udokumentowany w BUILDERZE, ale nie kontraktowany po
   * stronie aplikacji: dopisanie `maps: true` do opcji w proxy.ts przechodziło
   * całą siatkę na zielono. Ten test mierzy politykę, którą panel naprawdę
   * wysyła, więc pali się od takiej zmiany — i od każdej innej, która wpuści
   * tu obcy origin.
   */
  it("frame-src panelu nie wpuszcza dostawcy map ANI żadnego obcego originu", async () => {
    const csp = (await proxy(request("/en"))).headers.get("Content-Security-Policy") ?? "";

    expect(csp, "brak polityki na odpowiedzi panelu").toContain("script-src");
    expect(csp, "panel dostał źródło ramki dostawcy map").not.toContain("https://www.google.com");

    const frameSrc = csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("frame-src "));
    /*
     * Brak dyrektywy jest stanem POPRAWNYM (ramki tnie wtedy `default-src
     * 'self'`), więc sprawdzamy ją tylko wtedy, gdy istnieje — a gdy istnieje,
     * nie wolno jej nieść ani jednego obcego hosta.
     */
    if (frameSrc) {
      expect(frameSrc, `frame-src panelu niesie obcy origin: ${frameSrc}`).not.toMatch(
        /https?:\/\//,
      );
    }
  });
});

describe("proxy panelu — odświeżanie sesji względem next-intl", () => {
  it("odświeżone cookies przeżywają redirect 307 na prefiks locale", async () => {
    cookiesToWrite = [{ name: "sb-access-token", value: "swiezy", options: { path: "/" } }];

    const response = await proxy(request("/"));

    expect(response.status).toBe(307);
    // Gdyby cookies dokładano tylko na odpowiedzi rewrite, odświeżony token
    // przepadałby przy tym redirekcie i user wracałby do logowania.
    expect(response.cookies.get("sb-access-token")?.value).toBe("swiezy");
  });

  it("next-intl widzi cookies zapisane przez odświeżenie sesji (kolejność)", async () => {
    // NEXT_LOCALE jest czytane przez next-intl przy rozstrzyganiu locale dla
    // gołego "/". Jeśli routing locale zobaczy to cookie, znaczy że sesja
    // odświeżyła się ZANIM next-intl zbudował odpowiedź. Odwrócenie kolejności
    // w proxy.ts robi tu czerwono.
    cookiesToWrite = [{ name: "NEXT_LOCALE", value: "pl", options: { path: "/" } }];

    const response = await proxy(request("/", { headers: { "Accept-Language": "en" } }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/pl");
  });

  it("sesja jest odświeżana także dla tras nielokalizowanych (/auth, /api)", async () => {
    await proxy(request("/auth/confirm"));
    expect(getClaims).toHaveBeenCalledTimes(1);
  });
});

describe("proxy panelu — routing locale", () => {
  it("goły / przekierowuje na locale z Accept-Language", async () => {
    const response = await proxy(request("/", { headers: { "Accept-Language": "pl" } }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/pl");
  });

  it("strona pod prefiksem wychodzi z hreflang i zachowuje CSP", async () => {
    const response = await proxy(request("/pl"));

    const link = response.headers.get("Link") ?? "";
    expect(link).toContain('hreflang="en"');
    expect(link).toContain('hreflang="pl"');
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
  });

  it("trasy nielokalizowane nie dostają prefiksu locale, ale dostają nagłówki", async () => {
    const response = await proxy(request("/auth/confirm"));

    // Prefiks locale zepsułby route handler (nie ma wersji językowych).
    expect(response.status).not.toBe(307);
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
    expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
  });
});

describe("proxy panelu — matcher nie zostawia dziur", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it.each([
    ["/", true],
    ["/pl", true],
    ["/pl/admin/tenants", true],
    ["/bezpieczenstwo", true],
    ["/auth/confirm", true],
    // Podwójny ukośnik i zakodowany separator NIE mogą wypaść poza matcher —
    // trasa bez middleware to trasa bez nagłówków bezpieczeństwa.
    ["//pl/admin/tenants", true],
    ["/pl/%2fadmin", true],
    ["/PL/admin/tenants", true],
    ["/xx/admin/tenants", true],
    ["/pl/en/admin", true],
    // Statyki i pliki są wyłączone świadomie.
    ["/_next/static/chunk.js", false],
    ["/_next/image", false],
    ["/favicon.ico", false],
    ["/logo.svg", false],
  ])("matcher(%s) === %s", (path, expected) => {
    expect(matcher.test(path)).toBe(expected);
  });
});

describe("proxy panelu — prefiks locale nie jest kanałem obejścia", () => {
  it.each([
    ["/PL/admin/tenants", "wielkie litery w prefiksie"],
    ["/xx/admin/tenants", "nieznane locale"],
    ["/pl/en/admin/tenants", "podwójny prefiks"],
  ])("%s (%s) nie trafia do renderu jako poprawna trasa locale", async (path) => {
    const response = await proxy(request(path));

    // Każda taka ścieżka musi skończyć się przekierowaniem na poprawny
    // prefiks albo trafić do renderu, gdzie layout [locale] robi notFound().
    // Czego NIE wolno: żeby przeszła jako /admin/tenants bez prefiksu i
    // ominęła warstwę locale.
    const rewritten = response.headers.get("x-middleware-rewrite");
    const location = response.headers.get("location");
    const target = rewritten ?? location;

    if (target) {
      const { pathname } = new URL(target, "https://panel.example");
      expect(pathname).toMatch(/^\/(en|pl)(\/|$)/);
    }

    // Nagłówki bezpieczeństwa obowiązują niezależnie od kształtu ścieżki.
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
  });
});
