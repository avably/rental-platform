// @vitest-environment jsdom
/**
 * Kontrakt wzorca 404 storefrontu (L-UX-01, audyt właściciela 17.08, ADR-197)
 * — OBIE osie aplikacji, bo mają OSOBNE rooty i osobne źródła języka:
 *
 *   • SKLEP NAJEMCY (`(tenant)/not-found.tsx`): dokładnie jeden `h1`,
 *     komunikat w JĘZYKU NAJEMCY (`tenants.locale`, nie URL), wyjście do
 *     `/katalog`, render w pełnej powłoce sklepu (PageShell — te same
 *     prymitywy co podstrony). Fallback bez kontekstu: PL, jak `lang`
 *     layoutu tej samej gałęzi.
 *
 *   • OŚ MARKETINGOWA (`[locale]/not-found.tsx`): dokładnie jeden `h1`
 *     z szablonu `marketing/not-found.html`, komunikat w JĘZYKU TRASY,
 *     wyjście na stronę główną `/{locale}`.
 *
 * Mutacje, które ten plik ma palić: podmiana tekstu na drugi język
 * (asercje równości ze słownikiem WŁAŚCIWEGO locale + kontrola nieobecności
 * drugiego), drugi `h1` na ekranie (liczność), zdjęcie odnośnika powrotu.
 *
 * Harness: wzorzec product-template-route.test.tsx — kontekst z PRAWDZIWYM
 * słownikiem (`getStorefrontCopy`) i PRAWDZIWYM stylem (`resolveSiteStyle`),
 * bo atrapa kontraktu o dziesiątkach kluczy mierzy kształt atrapy.
 */
import { resolveSiteStyle } from "@avably/core/site";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";
import pl from "@/messages/pl.json";

const MESSAGES = { pl, en } as const;
type TestLocale = keyof typeof MESSAGES;

const stan = vi.hoisted(() => ({
  locale: "pl" as "pl" | "en",
  /** `null` = wejście spoza gałęzi tenanckiej / katalog nieczytelny. */
  ctx: true,
}));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-nonce": "test-nonce" })),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

/** Kontekst jak w product-template-route: realne copy, realny styl. */
vi.mock("@/lib/storefront/context", () => ({
  loadStorefrontContext: async () => {
    if (!stan.ctx) return null;
    const { getStorefrontCopy } = await import("@/lib/storefront/copy");
    return {
      tenantId: "00000000-0000-4000-8000-000000000001",
      catalog: {
        tenant: { name: "Wypożyczalnia Testowa", locale: stan.locale, currency: "PLN" },
        products: [],
        delivery_methods: [],
        pickup_locations: [],
        custom_fields: [],
      },
      locale: stan.locale,
      currency: "PLN",
      copy: await getStorefrontCopy(stan.locale),
      style: resolveSiteStyle({}, "classic"),
      appearance: { template: "classic", style: {}, logo: null },
      site: null,
      legalDocuments: [],
      productSlugs: { products: [], redirects: [] },
      supabaseUrl: "https://sklep.supabase.co",
    };
  },
}));

// Odczyt bazy w stopce marketingu (link regulaminu) — nie przedmiot testu.
vi.mock("@/lib/legal/platform-terms", () => ({
  getPlatformTerms: async () => null,
}));

const TenantNotFound = (await import("../app/(tenant)/not-found")).default;
const MarketingNotFound = (await import("../app/[locale]/not-found")).default;
const MarketingCatchAll = (await import("../app/[locale]/[...rest]/page")).default;
const TenantStorefrontCatchAll = null; // oś tenancka nie ma catch-alla — middleware odcina kształty (ADR-131)

/** Teksty nagłówków danego poziomu — z HTML, nie ze źródła. */
function headings(html: string, level: number): string[] {
  return [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, "g"))].map(
    (match) => match[1].replace(/<[^>]+>/g, "").trim(),
  );
}

async function renderTenantNotFound(locale: TestLocale, ctx = true): Promise<string> {
  stan.locale = locale;
  stan.ctx = ctx;
  return renderToStaticMarkup(await TenantNotFound());
}

describe("404 sklepu najemcy — pełna powłoka, język najemcy, wyjście do katalogu", () => {
  it.each(["pl", "en"] as const)(
    "locale %s: jeden h1 ze słownika najemcy i odnośnik do /katalog",
    async (locale) => {
      const html = await renderTenantNotFound(locale);

      const h1 = headings(html, 1);
      expect(h1, "404 sklepu musi nieść dokładnie jeden h1").toHaveLength(1);
      expect(h1[0]).toBe(MESSAGES[locale].storefront.notFound.title);
      expect(html).toContain(MESSAGES[locale].storefront.notFound.description);
      expect(html).toMatch(
        new RegExp(`<a\\b[^>]*href="/katalog"[^>]*>\\s*${MESSAGES[locale].storefront.common.backToCatalog}`),
      );
      // Powłoka sklepu naprawdę stoi wokół treści (nagłówek sklepu z koszykiem).
      expect(html).toContain(MESSAGES[locale].storefront.nav.cart);
    },
  );

  it("komunikat nie miesza języków: pl bez tytułu en i odwrotnie", async () => {
    expect(pl.storefront.notFound.title).not.toBe(en.storefront.notFound.title);
    expect((await renderTenantNotFound("pl")).includes(en.storefront.notFound.title)).toBe(false);
    expect((await renderTenantNotFound("en")).includes(pl.storefront.notFound.title)).toBe(false);
  });

  it("bez kontekstu: fallback PL (jak lang layoutu) z jednym h1 i wyjściem do katalogu", async () => {
    const html = await renderTenantNotFound("en", false);

    expect(headings(html, 1)).toEqual([pl.storefront.notFound.title]);
    expect(html).toContain('href="/katalog"');
  });
});

async function renderMarketingNotFound(locale: TestLocale): Promise<string> {
  stan.locale = locale;
  // `getLocale`/`getMessages` — atrapa next-intl/server nad realnymi słownikami.
  const element = await MarketingNotFound();
  const view = await (element.type as (props: unknown) => Promise<React.ReactNode>)(
    element.props,
  );
  return renderToStaticMarkup(view);
}

vi.mock("next-intl/server", () => ({
  getLocale: async () => stan.locale,
  getMessages: async () => MESSAGES[stan.locale],
}));

describe("404 osi marketingowej — szablon, język trasy, wyjście na stronę główną", () => {
  it.each(["pl", "en"] as const)(
    "locale %s: jeden h1 z szablonu i CTA na stronę główną tego locale",
    async (locale) => {
      const html = await renderMarketingNotFound(locale);

      const h1 = headings(html, 1);
      expect(h1, "404 marketingu musi nieść dokładnie jeden h1").toHaveLength(1);
      expect(h1[0]).toBe(MESSAGES[locale].marketing.notFoundPage.title);
      expect(html).toContain(MESSAGES[locale].marketing.notFoundPage.description);
      expect(html).toMatch(new RegExp(`<a\\b[^>]*href="/${locale}"`));
      expect(html).toContain(MESSAGES[locale].marketing.notFoundPage.cta);
      // Nawigacja i stopka szablonu naprawdę stoją wokół treści.
      expect(html).toContain(MESSAGES[locale].marketing.footer.copyright);
    },
  );

  it("komunikat nie miesza języków: pl bez tytułu en i odwrotnie", async () => {
    expect(pl.marketing.notFoundPage.title).not.toBe(en.marketing.notFoundPage.title);
    expect((await renderMarketingNotFound("pl")).includes(en.marketing.notFoundPage.title)).toBe(
      false,
    );
    expect((await renderMarketingNotFound("en")).includes(pl.marketing.notFoundPage.title)).toBe(
      false,
    );
  });

  it("catch-all rzuca notFound() — głębsze niedopasowane adresy kończą się ekranem 404", () => {
    expect(TenantStorefrontCatchAll).toBeNull();
    expect(() => MarketingCatchAll()).toThrowError("NEXT_NOT_FOUND");
  });
});
