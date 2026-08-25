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
 *
 * ==================== CZEGO TEN PLIK NIE MIERZY (F10, ADR-273) ====================
 *
 * Mierzy KOMPONENTY, nie ich OSIĄGALNOŚĆ — woła je wprost, z pominięciem
 * routera. To rozróżnienie nie jest teoretyczne: na ZBUDOWANEJ aplikacji
 * (`next build` + `next start`) treść obu tych ekranów NIE WCHODZI do HTML-a
 * odpowiedzi. Serwer oddaje status 404 i pusty dokument
 * `<html id="__next_error__">`; ekran pojawia się dopiero po HYDRACJI, bo
 * jedzie payloadem RSC. Przeglądarka z JS pokazuje więc właściwy 404 (pomiar:
 * `document.title` i `h1` zgodne z asercjami niżej), a klient bez JS i surowy
 * HTML nie dostają nic.
 *
 * ==================== PRZYCZYNA — SPROSTOWANIE ====================
 *
 * Nota F6 wskazywała DWA ROOTY routera (`app/[locale]` i `app/(tenant)`) i brak
 * korzeniowego `app/not-found.tsx`. To NIEPRAWDA i zostało obalone pomiarem:
 * dołożenie `app/not-found.tsx` (z własnym `<html>/<body>`), dołożenie
 * `not-found.tsx` w segmencie głębszym, `app/global-not-found.tsx` z
 * `experimental.globalNotFound`, a nawet sprowadzenie aplikacji do JEDNEGO root
 * layoutu — nie zmieniają ani jednego bajtu odpowiedzi. Ta sama awaria
 * odtwarza się w WANILIOWEJ aplikacji Next (jeden root layout, gołe
 * `not-found.tsx`) na 16.2.11 i 16.3.3, w `dev` i w buildzie produkcyjnym.
 *
 * PRAWDZIWY MECHANIZM (Next 16, źródła frameworka):
 *   1. bez `loading.tsx` `LoadingBoundary` NIE zakłada `<Suspense>` wokół
 *      `HTTPAccessFallbackBoundary` (`layout-router.js`), więc granica stoi
 *      w shellu Fizza;
 *   2. `NEXT_HTTP_ERROR_FALLBACK;404` wywraca shell, render HTML odrzuca,
 *      a `app-render.js` buduje awaryjny payload, którego seed to dosłownie
 *      `createElement('html', { id: '__next_error__' }, head, body)` — stąd
 *      status 404 przy pustym dokumencie.
 *
 * DLACZEGO NIE `loading.tsx`. Sonda F10 sprawdziła i ten wariant: shell wtedy
 * przeżywa, ale status zmienia się na **200** (miękkie 404 — gorzej dla SEO niż
 * stan dzisiejszy), a w HTML-u i tak nie ma ani `<title>`, ani `<h1>` —
 * React wypisuje sam znacznik błędu granicy
 * (`<template data-dgst="NEXT_HTTP_ERROR_FALLBACK;404">`) i zostawia render
 * klientowi. Odrzucone.
 *
 * STAN PRZYJĘTY (ADR-273): status 404 jest poprawny, ekran renderuje się po
 * hydracji. Konstrukcja dająca 404 RAZEM z treścią w HTML istnieje w Next 16
 * dokładnie jedna (`experimental.cacheComponents`) i kosztuje migrację całej
 * aplikacji — zakolejkowana jako decyzja właścicielska.
 *
 * Asercje niżej opisują więc KONTRAKT TREŚCI obu ekranów — i to jest ich
 * pełna, uczciwa rola. Bramka „czy 404 w ogóle dojeżdża" nie da się postawić
 * w tym pliku: wymaga zbudowanej aplikacji i żywego serwera.
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
  // Nagłówek sklepu czyta ścieżkę pod aria-current koszyka (S-52);
  // poza routerem Nexta hook oddaje null — jak w renderToStaticMarkup.
  usePathname: () => null,
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
        // Menu kategorii powłoki (S-30) liczy pozycje z tych pól — realny
        // PublicCatalog zawsze je niesie, fikstura też musi.
        categories: [],
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

/**
 * Tytuły dokumentu — obie osie pytają o TREŚĆ elementu, nie o jego obecność:
 * sam `<title>` z pustym wnętrzem albo z drugim językiem przechodziłby test
 * „ma tytuł". Liczność łapie drugi tytuł, który wygrałby albo przegrał losowo.
 */
function documentTitles(html: string): string[] {
  return [...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g)].map((match) =>
    match[1].replace(/<[^>]+>/g, "").trim(),
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

  /* ---------------------------------------------------------------------
   * TYTUŁ DOKUMENTU (S-57 audytu 2026-08-25)
   * ------------------------------------------------------------------ */

  /**
   * CO MUSIAŁOBY SIĘ ZEPSUĆ: ten ekran nie miał `<title>` w ogóle, bo
   * `generateMetadata` trasy oddaje `{}` przy `notFound()`, a konwencja
   * `not-found.tsx` własnych metadanych nie wystawia. Karta przeglądarki,
   * historia i zakładka pokazywały goły adres (WCAG 2.4.2).
   *
   * Asercja pyta o TREŚĆ elementu, nie o jego obecność (patrz `documentTitles`).
   */
  it.each(["pl", "en"] as const)("locale %s: dokument ma tytuł z nazwą sklepu", async (locale) => {
    const html = await renderTenantNotFound(locale);
    const titles = documentTitles(html);

    expect(titles, "404 sklepu bez <title> (WCAG 2.4.2) albo z dwoma tytułami").toHaveLength(1);
    expect(titles[0]).toContain(MESSAGES[locale].storefront.notFound.title);
    expect(titles[0], "tytuł nie mówi, czyj sklep odmówił").toContain("Wypożyczalnia Testowa");
  });

  it("bez kontekstu tytuł też jest — i jest w PL, jak reszta tego ekranu", async () => {
    const titles = documentTitles(await renderTenantNotFound("en", false));

    expect(titles).toEqual([pl.storefront.notFound.title]);
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

  /* ---------------------------------------------------------------------
   * TYTUŁ DOKUMENTU (ADR-273)
   * ------------------------------------------------------------------ */

  /**
   * CO SIĘ ZEPSUŁO: oś tenancka dostała tytuł przy S-57, marketingowa została
   * pominięta — pomiar w przeglądarce na zbudowanej aplikacji dał na
   * `/pl/nie-ma` `document.title === ""`. Braku nie łata `generateMetadata`
   * trasy: `[page]` woła `notFound()` już w metadanych (przez `resolvePage`),
   * a `[...rest]` metadanych nie ma wcale.
   *
   * Szablon jest TEN SAM co na pozostałych stronach osi (`[page]/page.tsx`),
   * więc asercja porównuje z literałem `- Avably`, a nie z samym tytułem: 404
   * bez sufiksu wyglądałby w karcie przeglądarki jak strona z innego serwisu.
   */
  it.each(["pl", "en"] as const)(
    "locale %s: dokument ma tytuł w szablonie osi marketingowej",
    async (locale) => {
      const titles = documentTitles(await renderMarketingNotFound(locale));

      expect(titles, "404 marketingu bez <title> (WCAG 2.4.2) albo z dwoma tytułami").toHaveLength(
        1,
      );
      expect(titles[0]).toBe(`${MESSAGES[locale].marketing.notFoundPage.title} - Avably`);
    },
  );

  it("tytuł nie miesza języków: pl bez tytułu en i odwrotnie", async () => {
    expect(documentTitles(await renderMarketingNotFound("pl"))[0]).not.toContain(
      en.marketing.notFoundPage.title,
    );
    expect(documentTitles(await renderMarketingNotFound("en"))[0]).not.toContain(
      pl.marketing.notFoundPage.title,
    );
  });
});
