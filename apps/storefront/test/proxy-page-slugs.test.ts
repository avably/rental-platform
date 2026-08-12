/**
 * ROZSTRZYGANIE ADRESU STRONY W PROXY (Faza 2, ADR-158).
 *
 * Trasy `app/(tenant)/[slug]` NIE DA SIĘ dodać obok `app/[locale]` (twardy błąd
 * builda Next 16), więc adres strony rozstrzyga proxy — a to znaczy, że
 * rozstrzyga go warstwa POZA RLS. Ten plik pilnuje czterech rzeczy, z których
 * każda psuje się CICHO:
 *
 *   1. Adres z rejestru najemcy trafia na trasę wewnętrzną, a adres spoza
 *      rejestru dostaje neutralne 404 — nie stronę, nie marketing, nie 500.
 *   2. Rejestr jest pytany O TEGO najemcę, którego rozwiązał HOST. Slug
 *      najemcy A na hoście najemcy B nie ma prawa oddać strony A.
 *   3. `<najemca>.avably.io/pl` przestaje renderować landing Avably.
 *   4. Adres WEWNĘTRZNY (`/store/{slug}`) nie jest adresem publicznym.
 *
 * Zero sieci: rozwiązywanie najemcy i rejestr są wstrzykiwane (`ProxyDeps`).
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { runProxy, type ProxyDeps } from "../proxy";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Najemca `alfa` ma stronę główną, `kontakt` i `o-nas`; najemca `beta` ma samą
 * stronę główną. Rejestr jest zawężony ARGUMENTEM — dokładnie jak w produkcji,
 * gdzie `app.get_tenant_pages` jest SECURITY DEFINER i RLS jej nie dotyczy.
 */
const deps: ProxyDeps = {
  resolveTenant: async (_host, slug) =>
    slug === "alfa" ? { tenantId: TENANT_A } : slug === "beta" ? { tenantId: TENANT_B } : null,
  resolveTenantByDomain: async () => null,
  resolveTenantPages: async (tenantId) =>
    tenantId === TENANT_A
      ? { pages: ["", "kontakt", "o-nas"], redirects: [] }
      : { pages: [""], redirects: [] },
};

function request(url: string): NextRequest {
  return new NextRequest(url, { headers: { host: new URL(url).host } });
}

/** Ścieżka, na którą proxy przepisało żądanie (albo null, gdy nie przepisało). */
function rewrittenTo(response: Response): string | null {
  const target = response.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
}

describe("adres strony → trasa wewnętrzna", () => {
  it("korzeń hosta najemcy prowadzi na stronę GŁÓWNĄ", async () => {
    const response = await runProxy(request("https://alfa.avably.io/"), deps);
    expect(rewrittenTo(response)).toBe("/store");
  });

  it("adres z rejestru przechodzi na trasę wewnętrzną `/store/{slug}`", async () => {
    const response = await runProxy(request("https://alfa.avably.io/kontakt"), deps);
    expect(response.status).toBe(200);
    expect(rewrittenTo(response)).toBe("/store/kontakt");
  });

  it("adres SPOZA rejestru dostaje neutralne 404, nie stronę i nie marketing", async () => {
    const response = await runProxy(request("https://alfa.avably.io/cennik"), deps);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  it("adres o niepoprawnym kształcie nie rusza bazy ani razu", async () => {
    let pytan = 0;
    const spy: ProxyDeps = {
      ...deps,
      resolveTenantPages: async (tenantId) => {
        pytan += 1;
        return deps.resolveTenantPages(tenantId);
      },
    };
    const response = await runProxy(request("https://alfa.avably.io/Kontakt"), spy);
    expect(response.status).toBe(404);
    expect(pytan, "kształt odrzucany po podróży do bazy").toBe(0);
  });

  it("ścieżka wielosegmentowa pod nieznanym korzeniem → 404 (strony są jednopoziomowe)", async () => {
    const response = await runProxy(request("https://alfa.avably.io/kontakt/mapa"), deps);
    expect(response.status).toBe(404);
  });

  it("trasy sklepu zachowują ścieżkę — rozstrzyganie adresu ich nie dotyka", async () => {
    for (const path of ["/cart", "/checkout/platnosc", "/product/abc", "/regulamin/w/2", "/embed/widget"]) {
      const response = await runProxy(request(`https://alfa.avably.io${path}`), deps);
      expect(response.status, `trasa ${path} przestała działać`).toBe(200);
      expect(rewrittenTo(response), `trasa ${path} została przepisana`).toBe(path);
    }
  });
});

describe("izolacja: adres najemcy A na hoście najemcy B", () => {
  it("NIE oddaje strony A — rejestr jest pytany o najemcę rozwiązanego z HOSTA", async () => {
    // Rozstrzyganie adresu dzieje się POZA RLS, więc gdyby rejestr był pytany
    // bez tożsamości najemcy (albo trafiony cudzym wpisem cache'u), `/kontakt`
    // najemcy A wyświetliłby się pod hostem najemcy B.
    const response = await runProxy(request("https://beta.avably.io/kontakt"), deps);
    expect(response.status).toBe(404);
    expect(rewrittenTo(response), "adres cudzej strony został przepisany").toBeNull();
  });

  it("KONTROLA POZYTYWNA: ten sam adres na WŁAŚCIWYM hoście przechodzi", async () => {
    const response = await runProxy(request("https://alfa.avably.io/kontakt"), deps);
    expect(rewrittenTo(response)).toBe("/store/kontakt");
  });

  it("rejestr dostaje identyfikator najemcy z rozwiązania HOSTA, nie ze ścieżki", async () => {
    const pytania: string[] = [];
    const spy: ProxyDeps = {
      ...deps,
      resolveTenantPages: async (tenantId) => {
        pytania.push(tenantId);
        return deps.resolveTenantPages(tenantId);
      },
    };
    await runProxy(request("https://beta.avably.io/kontakt"), spy);
    expect(pytania).toEqual([TENANT_B]);
  });
});

describe("oś marketingowa nie należy do hosta najemcy", () => {
  it.each(["/pl", "/en"])(
    "`%s` na hoście najemcy dostaje neutralne 404, a nie landing Avably",
    async (path) => {
      // Do Fazy 2 segment locale nie miał odpowiednika w grupie (tenant), więc
      // dopasowywał się dynamiczny `app/[locale]` — czyli pod adresem, który
      // klienci najemcy znają jako sklep, stała oferta naszego SaaS-u.
      const response = await runProxy(request(`https://alfa.avably.io${path}`), deps);
      expect(response.status).toBe(404);
      expect(rewrittenTo(response)).toBeNull();
    },
  );

  it("KONTROLA POZYTYWNA: ten sam segment na hoście PLATFORMY dalej jest marketingiem", async () => {
    const response = await runProxy(request("https://www.avably.io/pl"), deps);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toBe("Not Found");
  });
});

describe("adres wewnętrzny nie jest adresem publicznym", () => {
  it("wejście wprost w `/store/{slug}` dostaje 404 — inaczej ta sama treść ma dwa adresy", async () => {
    const response = await runProxy(request("https://alfa.avably.io/store/kontakt"), deps);
    expect(response.status).toBe(404);
  });

  it("`/store` i `/store/og` zostają osiągalne", async () => {
    for (const path of ["/store", "/store/og"]) {
      const response = await runProxy(request(`https://alfa.avably.io${path}`), deps);
      expect(response.status, `trasa ${path} przestała działać`).toBe(200);
    }
  });
});

describe("przekierowania z historii adresów (koperta 0074, wypełnia 0075)", () => {
  it("stary adres oddaje 308 na adres bieżący, Z PARAMETRAMI zapytania", async () => {
    const zHistoria: ProxyDeps = {
      ...deps,
      resolveTenantPages: async () => ({
        pages: ["", "kontakt"],
        redirects: [{ from: "kontakt-stary", to: "kontakt" }],
      }),
    };
    const response = await runProxy(
      request("https://alfa.avably.io/kontakt-stary?fbclid=xyz"),
      zHistoria,
    );
    expect(response.status).toBe(308);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/kontakt");
    // Adres z linku na Facebooku najemcy niesie `?fbclid=…`; 308 bez parametrów
    // gubiłby atrybucję kampanii.
    expect(location.searchParams.get("fbclid")).toBe("xyz");
  });
});
