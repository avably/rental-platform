/**
 * Smoke-test middleware'u storefrontu: każde żądanie wychodzi z CSP (nonce,
 * bez 'unsafe-inline') i HSTS. Bramka CI dla nagłówków bezpieczeństwa —
 * usunięcie proxy.ts albo rozjazd polityki robi tu czerwony build.
 *
 * Rozszerzone o rozgałęzienie host→tenant (Zadanie 2.1, ADR-039): routing
 * subdomeny na trasę tenancką, neutralne 404 i bramkę anty-spoofingu.
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy, runProxy, type ProxyDeps } from "../proxy";

/**
 * Hasło całego site'u (proxy.ts) jest sprawdzane PRZED czymkolwiek innym —
 * te testy weryfikują routing/CSP/anty-spoofing, nie samą bramkę hasła (ma
 * własny opisujący blok niżej), więc każde żądanie tutaj niesie poprawne
 * hasło z góry. `req()` zastępuje bezpośrednie `new NextRequest(...)`
 * wszędzie poza blokiem bramki hasła, gdzie musimy kontrolować nagłówek
 * Authorization wprost.
 */
const SITE_PASSWORD_HEADER = `Basic ${btoa(":notavably")}`;

/** Typ inicjalizatora dokładnie ten, jakiego oczekuje konstruktor `NextRequest` — nie globalny DOM `RequestInit` (rozjazd na `signal`). */
type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

function req(url: string, init: NextRequestInit = {}): NextRequest {
  return new NextRequest(url, {
    ...init,
    headers: {
      authorization: SITE_PASSWORD_HEADER,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

const ACME_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const CUSTOM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * Hasło całego site'u (TYMCZASOWE, do ściągnięcia — patrz nagłówek proxy.ts).
 * Testy tutaj kontrolują nagłówek Authorization WPROST (bez `req()`), bo to
 * jest dokładnie to, co sprawdzają.
 *
 * DOWÓD MUTACYJNY: usunięcie bloku `if (!siteAuthorized(...))` w proxy.ts
 * sprawia, że żądanie bez hasła (pierwszy test niżej) przechodzi na 307
 * zamiast 401 — ten test wtedy się pali.
 */
describe("proxy storefrontu — hasło całego site'u (tymczasowe)", () => {
  it("bez nagłówka Authorization → 401 z WWW-Authenticate, ale wciąż z CSP/HSTS", async () => {
    const response = await proxy(new NextRequest("https://www.avably.io/"));

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
    expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
  });

  it("złe hasło → 401", async () => {
    const response = await proxy(
      new NextRequest("https://www.avably.io/", {
        headers: { authorization: `Basic ${btoa(":zle-haslo")}` },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("dobre hasło (dowolny użytkownik) → przechodzi do routingu marketingowego", async () => {
    const response = await proxy(
      new NextRequest("https://www.avably.io/", {
        headers: { authorization: `Basic ${btoa("ktokolwiek:notavably")}` },
      }),
    );

    expect(response.status).not.toBe(401);
  });

  it("bramka obejmuje TAKŻE gałąź tenancką — subdomena bez hasła też 401, bez odpytania bazy", async () => {
    const lookupSpy = vi.fn(async () => ({ tenantId: ACME_ID }));
    const response = await runProxy(new NextRequest("https://acme.avably.io/"), {
      ...fakeDeps,
      resolveTenant: lookupSpy,
    });

    expect(response.status).toBe(401);
    expect(lookupSpy, "bramka hasła musi zadziałać PRZED zapytaniem o tenanta").not.toHaveBeenCalled();
  });

});

/**
 * Rozwiązywacz-atrapa. Subdomena: 'acme' aktywny, reszta nieznana. Własna
 * domena: rozwiązuje się WYŁĄCZNIE `sklep.najemca.example`. Atrapa udaje tu
 * bramki bazy (verified=true + tenant trialing|active) — w produkcji siedzą one
 * w app.resolve_tenant_by_domain (0022) i mają własne dowody mutacyjne
 * w packages/db/test/domain-resolve.test.ts. Zero sieci.
 */
const fakeDeps: ProxyDeps = {
  resolveTenant: async (_host, slug) => (slug === "acme" ? { tenantId: ACME_ID } : null),
  resolveTenantByDomain: async (host) =>
    host === "sklep.najemca.example" ? { tenantId: CUSTOM_ID } : null,
};

describe("proxy storefrontu — nagłówki bezpieczeństwa", () => {
  for (const route of ["page.tsx", "privacy/page.tsx"]) {
    it(`renderuje ${route} dynamicznie, żeby Next nadał nonce własnym skryptom`, () => {
      const page = readFileSync(new URL(`../app/[locale]/${route}`, import.meta.url), "utf8");

      expect(page).toContain('export const dynamic = "force-dynamic"');
    });
  }

  it("odpowiedź ma CSP z nonce i HSTS", async () => {
    const response = await proxy(req("https://www.avably.io/"));

    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp, "brak nagłówka CSP").not.toBe("");
    expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);
    expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/);

    expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(response.headers.get("Strict-Transport-Security")).toContain("preload");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
  });

  /**
   * UWAGA na czytanie tych testów: `NEXT_PUBLIC_*` jest w produkcji stałą
   * WBUDOWANĄ W BUILD (Next.js podmienia odwołanie w bundlu middleware'u),
   * więc realnie o dyrektywach decyduje env w chwili `next build`, a nie
   * restart z inną zmienną. Te testy pilnują samego okablowania — że proxy
   * podaje `turnstile: Boolean(klucz)` do buildCsp — bo vitest nie inline'uje
   * env. Zachowanie buildu zweryfikowane osobno, przez przebudowę bez klucza
   * (CSP bez Cloudflare, widget się nie renderuje) — patrz ADR-032.
   */
  describe("Turnstile w CSP", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("z NEXT_PUBLIC_TURNSTILE_SITE_KEY CSP dopuszcza challenges.cloudflare.com", async () => {
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
      const csp =
        (await proxy(req("https://www.avably.io/"))).headers.get(
          "Content-Security-Policy",
        ) ?? "";

      expect(csp).toMatch(/script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
      expect(csp).toMatch(/connect-src [^;]*https:\/\/challenges\.cloudflare\.com/);
      expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    });

    it("bez klucza CSP nie zna Cloudflare (dyrektywy nie otwierają się na zawsze)", async () => {
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
      const csp =
        (await proxy(req("https://www.avably.io/"))).headers.get(
          "Content-Security-Policy",
        ) ?? "";

      expect(csp).not.toContain("challenges.cloudflare.com");
    });
  });
});

describe("proxy storefrontu — route handlery /api (ADR-071)", () => {
  it("/api/review NIE dostaje prefiksu locale (przechodzi do handlera) i zachowuje CSP", async () => {
    const response = await proxy(req("https://www.avably.io/api/review/comments"));

    // Redirect na /en/api/... zepsułby route handler — gałąź /api omija i18n.
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
  });

  it("/api bez hasła site'u wciąż odbija się na 401 — bramka stoi PRZED gałęzią api", async () => {
    const response = await proxy(new NextRequest("https://www.avably.io/api/review/comments"));

    expect(response.status).toBe(401);
  });
});

/**
 * Publiczne API maszynowe /api/v1 (M1, ADR-108): wycinka z bramki
 * SITE_PASSWORD jest WĄSKA (dosłowny prefiks /api/v1/) i nie znosi
 * anty-spoofingu.
 *
 * DOWODY MUTACYJNE M4 (obie strony bramki przypięte):
 *   * usunięcie wycinki w proxy.ts → pierwszy test niżej pali się (401
 *     zamiast przejścia do handlera),
 *   * poszerzenie wycinki (np. na całe /api albo cały storefront) → palą
 *     się „/api bez hasła → 401" (blok wyżej) i „bez nagłówka Authorization
 *     → 401" (blok bramki hasła).
 */
describe("proxy storefrontu — publiczne API /api/v1 (M1, ADR-108)", () => {
  it("/api/v1/* jest osiągalne BEZ hasła site'u (konsument maszynowy), z CSP", async () => {
    const response = await proxy(new NextRequest("https://www.avably.io/api/v1/catalog"));

    // Brak Basic Auth nie kończy się 401 z bramki hasła — żądanie przechodzi
    // do route handlera (to ON odmawia 401 przy braku klucza API).
    expect(response.status).toBe(200);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
  });

  it("wycinka obejmuje też subdomeny/hosty tenanckie (ta sama gałąź, przed rozwiązaniem hosta)", async () => {
    const response = await runProxy(
      new NextRequest("https://acme.avably.io/api/v1/reservations", { method: "POST" }),
      fakeDeps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("goły /api/v1 (bez końcowego ukośnika) NIE wchodzi w wycinkę — zostaje za hasłem", async () => {
    const response = await proxy(new NextRequest("https://www.avably.io/api/v1"));

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("przychodzący x-tenant-id NIE przeżywa na gałęzi /api/v1 (anty-spoofing przed wycinką)", async () => {
    const request = new NextRequest("https://www.avably.io/api/v1/catalog", {
      headers: { "x-tenant-id": "11111111-1111-4111-8111-111111111111" },
    });

    await runProxy(request, fakeDeps);

    expect(request.headers.get("x-tenant-id"), "podrobiony x-tenant-id przeżył middleware").toBeNull();
  });
});

describe("proxy storefrontu — routing locale (gałąź marketingowa)", () => {
  it("goły / przekierowuje na prefiks locale", async () => {
    const response = await proxy(req("https://www.avably.io/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/en");
  });

  it("Accept-Language wybiera locale", async () => {
    const response = await proxy(
      req("https://www.avably.io/", {
        headers: { "Accept-Language": "pl" },
      }),
    );

    expect(response.headers.get("location")).toContain("/pl");
  });

  it("strona pod prefiksem wychodzi z hreflang i zachowuje CSP", async () => {
    const response = await proxy(req("https://www.avably.io/en"));

    // Nagłówek Link z alternatywnymi wersjami — bez niego wyszukiwarki nie
    // wiedzą, że /en i /pl to ta sama strona w dwóch językach.
    const link = response.headers.get("Link") ?? "";
    expect(link).toContain('hreflang="en"');
    expect(link).toContain('hreflang="pl"');

    // Nagłówki bezpieczeństwa muszą przeżyć złożenie z routingiem locale.
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
  });
});

describe("proxy storefrontu — routing host→tenant (Zadanie 2.1)", () => {
  it("aktywna subdomena → rewrite na /store z rozwiązanym tenant_id", async () => {
    const request = req("https://acme.avably.io/");
    const response = await runProxy(request, fakeDeps);

    // Rewrite na trasę tenancką (Next koduje cel w x-middleware-rewrite).
    const rewrite = response.headers.get("x-middleware-rewrite") ?? "";
    expect(rewrite, "brak rewrite na trasę tenancką").toContain("/store");

    // Rozwiązany tenant wstrzyknięty w nagłówki żądania (czyta je strona echo).
    expect(request.headers.get("x-tenant-id")).toBe(ACME_ID);
    expect(request.headers.get("x-tenant-slug")).toBe("acme");

    // Nagłówki bezpieczeństwa i na tej gałęzi.
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
  });

  it("podstrony sklepu zachowują ścieżkę (produkt/koszyk/checkout) z tenant_id", async () => {
    for (const path of ["/product/abc", "/cart", "/checkout"]) {
      const request = req(`https://acme.avably.io${path}`);
      const response = await runProxy(request, fakeDeps);

      const rewrite = response.headers.get("x-middleware-rewrite") ?? "";
      expect(rewrite, `podstrona ${path} nie zachowała ścieżki`).toContain(path);
      // Podstrona też dostaje rozwiązany tenant (czyta go z nagłówka).
      expect(request.headers.get("x-tenant-id")).toBe(ACME_ID);
    }
  });

  it("goły / na subdomenie tenanta rewrite'uje na /store (nie na /)", async () => {
    const request = req("https://acme.avably.io/");
    const response = await runProxy(request, fakeDeps);
    expect(response.headers.get("x-middleware-rewrite") ?? "").toContain("/store");
  });

  it("nieznana/nieaktywna subdomena → neutralne 404", async () => {
    const response = await runProxy(req("https://ghost.avably.io/"), fakeDeps);

    expect(response.status).toBe(404);
    // Nagłówki bezpieczeństwa również na 404.
    expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
  });

  it("subdomena o niepoprawnym slugu → 404 BEZ odpytania bazy", async () => {
    const lookupSpy = vi.fn(async () => null);
    const response = await runProxy(req("https://bad_slug.avably.io/"), {
      ...fakeDeps,
      resolveTenant: lookupSpy,
    });

    expect(response.status).toBe(404);
    expect(lookupSpy, "malformed slug nie może dotknąć bazy").not.toHaveBeenCalled();
  });
});

describe("proxy storefrontu — własne domeny najemców (Zadanie 2.6, ADR-046)", () => {
  it("rozwiązana własna domena → rewrite na /store z tenant_id z bazy", async () => {
    const request = req("https://sklep.najemca.example/");
    const response = await runProxy(request, fakeDeps);

    expect(response.headers.get("x-middleware-rewrite") ?? "").toContain("/store");
    expect(request.headers.get("x-tenant-id")).toBe(CUSTOM_ID);
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
  });

  it("podstrony sklepu na własnej domenie zachowują ścieżkę", async () => {
    for (const path of ["/product/abc", "/cart", "/checkout"]) {
      const request = req(`https://sklep.najemca.example${path}`);
      const response = await runProxy(request, fakeDeps);

      expect(response.headers.get("x-middleware-rewrite") ?? "").toContain(path);
      expect(request.headers.get("x-tenant-id")).toBe(CUSTOM_ID);
    }
  });

  // Rozwiązanie po domenie zwraca SAM uuid (0022) — slugu nie znamy i nie
  // zgadujemy. Nagłówek ma po prostu nie powstać.
  it("własna domena nie wstrzykuje x-tenant-slug (rozwiązanie zwraca sam uuid)", async () => {
    const request = req("https://sklep.najemca.example/");
    await runProxy(request, fakeDeps);

    expect(request.headers.get("x-tenant-id")).toBe(CUSTOM_ID);
    expect(request.headers.get("x-tenant-slug")).toBeNull();
  });

  // ZACHOWANIE Z 2.1 NIETKNIĘTE: nierozwiązany obcy host to nadal marketing,
  // nie 404 (zmiana na 404 zepsułaby hosty operacyjne wskazane na deployment).
  it("nierozwiązany obcy host → gałąź marketingowa, nie 404", async () => {
    const response = await runProxy(req("https://obcy.example/"), fakeDeps);

    expect(response.status, "obcy host nierozwiązany nie może dawać 404").not.toBe(404);
    expect(response.headers.get("x-middleware-rewrite") ?? "").not.toContain("/store");
  });

  // Bramka wydajności: kanon, dev i preview NIE MOGĄ trafiać do rozwiązywania
  // po domenie — inaczej każde żądanie na LP i na deployment podglądowy
  // generowałoby zapytanie do bazy o host, który nigdy nie będzie niczyją domeną.
  it.each(["https://www.avably.io/en", "https://avably.io/en", "https://x-preview.vercel.app/en"])(
    "host platformy (%s) NIE odpytuje bazy o domenę",
    async (url) => {
      const domainSpy = vi.fn(async () => null);
      await runProxy(req(url), { ...fakeDeps, resolveTenantByDomain: domainSpy });

      expect(domainSpy, "host platformy poszedł do rozwiązywania po domenie").not.toHaveBeenCalled();
    },
  );

  it("subdomena tenanta NIE idzie ścieżką własnej domeny (osie się nie mieszają)", async () => {
    const domainSpy = vi.fn(async () => null);
    await runProxy(req("https://acme.avably.io/"), {
      ...fakeDeps,
      resolveTenantByDomain: domainSpy,
    });

    expect(domainSpy).not.toHaveBeenCalled();
  });
});

describe("proxy storefrontu — anty-spoofing tenanta (bramka izolacji)", () => {
  // DOWÓD MUTACYJNY: usunięcie stripInboundTenantHeaders w proxy sprawia, że
  // podany przez klienta x-tenant-id przetrwa na gałęzi marketingowej (która
  // nie ustawia własnego) — ten test wtedy się pali.
  it("usuwa przychodzący x-tenant-id na gałęzi marketingowej", async () => {
    const request = req("https://www.avably.io/en", {
      headers: {
        "x-tenant-id": "11111111-1111-4111-8111-111111111111",
        "x-tenant-slug": "attacker",
      },
    });

    await runProxy(request, fakeDeps);

    expect(request.headers.get("x-tenant-id"), "podrobiony x-tenant-id przeżył middleware").toBeNull();
    expect(request.headers.get("x-tenant-slug")).toBeNull();
  });

  it("na subdomenie tenanta nadpisuje podany przez klienta id rozwiązaniem server-side", async () => {
    const request = req("https://acme.avably.io/", {
      headers: { "x-tenant-id": "deadbeef-dead-4bee-8bee-deadbeefdead" },
    });

    await runProxy(request, fakeDeps);

    expect(request.headers.get("x-tenant-id"), "klient narzucił własny tenant_id").toBe(ACME_ID);
  });

  // Gałąź 2.6: nowa oś hostów nie może być furtką obok bramki z 2.1.
  it("na własnej domenie nadpisuje podany przez klienta id rozwiązaniem server-side", async () => {
    const request = req("https://sklep.najemca.example/", {
      headers: {
        "x-tenant-id": "deadbeef-dead-4bee-8bee-deadbeefdead",
        "x-tenant-slug": "attacker",
      },
    });

    await runProxy(request, fakeDeps);

    expect(request.headers.get("x-tenant-id"), "klient narzucił własny tenant_id").toBe(CUSTOM_ID);
    expect(request.headers.get("x-tenant-slug"), "podrobiony slug przeżył middleware").toBeNull();
  });

  it("na NIEROZWIĄZANYM obcym hoście podrobiony x-tenant-id też nie przeżywa", async () => {
    const request = req("https://obcy.example/", {
      headers: { "x-tenant-id": "11111111-1111-4111-8111-111111111111" },
    });

    await runProxy(request, fakeDeps);

    expect(request.headers.get("x-tenant-id")).toBeNull();
  });
});

/**
 * EMBED REZERWACJI (M3, ADR-120). Bramka ma DWIE strony i obie muszą być
 * przypięte, dokładnie jak przy wycince /api/v1/ z M1: usunięcie wycinki
 * zabija embed u każdego najemcy, a jej poszerzenie otwiera site przed
 * premierą. Do tego dochodzi polityka ramkowania, która dla embedu MUSI być
 * inna niż dla reszty site'u — i tylko dla niego.
 */
describe("proxy storefrontu — embed rezerwacji (M3, ADR-120)", () => {
  const embedPaths = [
    "https://acme.avably.io/embed/loader",
    "https://acme.avably.io/embed/widget",
    "https://acme.avably.io/embed/api/month?product=x&month=2026-09",
    "https://acme.avably.io/embed/api/reservations",
  ];

  for (const url of embedPaths) {
    it(`${new URL(url).pathname} jest osiągalne BEZ hasła site'u`, async () => {
      const response = await runProxy(new NextRequest(url), fakeDeps);

      expect(response.status).not.toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBeNull();
    });
  }

  it("embed nadal przechodzi przez rozwiązanie tenanta (nagłówek wstrzyknięty)", async () => {
    const request = new NextRequest("https://acme.avably.io/embed/widget");
    await runProxy(request, fakeDeps);

    expect(request.headers.get("x-tenant-id")).toBe(ACME_ID);
  });

  it("embed NIE omija anty-spoofingu — podrobiony x-tenant-id nie przeżywa", async () => {
    const request = new NextRequest("https://acme.avably.io/embed/widget", {
      headers: { "x-tenant-id": "99999999-9999-4999-8999-999999999999" },
    });

    await runProxy(request, fakeDeps);

    expect(request.headers.get("x-tenant-id")).toBe(ACME_ID);
  });

  it("na nieznanej subdomenie embed dostaje neutralne 404, nie cudzy sklep", async () => {
    const response = await runProxy(
      new NextRequest("https://nieznany.avably.io/embed/widget"),
      fakeDeps,
    );

    expect(response.status).toBe(404);
  });

  it("WYCINKA JEST WĄSKA — /embed bez ukośnika zostaje za hasłem", async () => {
    const response = await runProxy(new NextRequest("https://acme.avably.io/embed"), fakeDeps);

    expect(response.status).toBe(401);
  });

  it("WYCINKA JEST WĄSKA — reszta sklepu dalej za hasłem", async () => {
    for (const url of [
      "https://acme.avably.io/",
      "https://acme.avably.io/cart",
      "https://acme.avably.io/checkout",
      "https://www.avably.io/",
    ]) {
      const response = await runProxy(new NextRequest(url), fakeDeps);
      expect(response.status, `${url} wyszło zza bramki hasła`).toBe(401);
    }
  });

  it("embed WOLNO ramkować: frame-ancestors bez 'none' i BEZ X-Frame-Options", async () => {
    const response = await runProxy(
      new NextRequest("https://acme.avably.io/embed/widget"),
      fakeDeps,
    );
    const csp = response.headers.get("Content-Security-Policy") ?? "";

    expect(csp).toMatch(/frame-ancestors [^;]*'self'/);
    expect(csp).toMatch(/frame-ancestors [^;]*https:/);
    expect(csp).not.toMatch(/frame-ancestors [^;]*'none'/);
    // X-Frame-Options nie zna list — zostawiony obok CSP zablokowałby ramkę,
    // którą polityka właśnie wpuściła (cicha awaria u najemcy).
    expect(response.headers.get("X-Frame-Options")).toBeNull();
    // Gwiazdka jest szersza niż potrzeba i nie wchodzi nawet tutaj.
    expect(csp).not.toMatch(/frame-ancestors [^;]*\*/);
  });

  it("POZA embedem polityka ramkowania jest NIETKNIĘTA (nadal 'none' + DENY)", async () => {
    for (const url of ["https://www.avably.io/", "https://acme.avably.io/", "https://acme.avably.io/api/v1/catalog"]) {
      const response = await runProxy(req(url), fakeDeps);
      const csp = response.headers.get("Content-Security-Policy") ?? "";

      expect(csp, `${url} rozluźnił ramkowanie`).toMatch(/frame-ancestors 'none'/);
      expect(response.headers.get("X-Frame-Options"), url).toBe("DENY");
    }
  });

  it("embed nie traci reszty nagłówków bezpieczeństwa", async () => {
    const response = await runProxy(
      new NextRequest("https://acme.avably.io/embed/widget"),
      fakeDeps,
    );

    expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toMatch(/script-src [^;]*'nonce-/);
  });
});
