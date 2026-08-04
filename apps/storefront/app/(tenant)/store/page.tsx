/**
 * Storefront tenanta — KATALOG (Zadanie 2.4b; render sekcyjny 2.3b, ADR-041).
 * Wypełnia seam 2.4 z 2.3b: sekcja `products` renderuje REALNY katalog publiczny
 * (getPublicCatalog, warstwa danych 2.4a), a karty linkują do podstron produktu.
 *
 * BRAMKA (bez zmian): trasa osiągalna WYŁĄCZNIE przez rewrite z middleware, który
 * wstrzykuje `x-tenant-id`. Wejście wprost (bez nagłówka) → notFound(). Odczyt
 * `headers()` czyni render dynamicznym per żądanie (konieczne pod CSP z nonce).
 * Brak opublikowanej strony → neutralna „sklep w budowie” (fail-closed).
 *
 * i18n: język i copy z osi tenanckiej (tenants.locale), nie z URL — patrz
 * lib/storefront/context.ts.
 */
import { SiteRenderer, type SiteRenderLabels } from "@avably/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { toStorefrontProducts } from "@/lib/catalog/present";
import { JsonLd } from "@/components/storefront/json-ld";
import { SITE_HEADING, StoreChrome } from "@/components/storefront/store-chrome";
import { localBusinessJsonLd } from "@/lib/seo/jsonld";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { heroText, pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { format } from "@/lib/storefront/copy";
import { loadStorefrontContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

/**
 * Tytuł = nazwa sklepu, opis = to, co najemca OPUBLIKOWAŁ w hero (podtytuł →
 * nagłówek), a dopiero w ostateczności neutralne zdanie w locale tenanta.
 * Kontekst jest `cache`'owany per żądanie, więc metadane i render dzielą jedno
 * odpytanie katalogu/site'u.
 */
export async function generateMetadata(): Promise<Metadata> {
  const ctx = await loadStorefrontContext();
  if (!ctx) return {};

  const storeName = ctx.catalog.tenant.name;
  const hero = heroText(ctx.site);

  return tenantMetadata({
    title: pageTitle(storeName),
    description:
      hero.subheading ?? hero.heading ?? format(ctx.copy.seo.catalogDescription, { store: storeName }),
    storeName,
    published: ctx.site !== null,
    origin: await tenantOrigin(),
    pathname: "/store",
    locale: ctx.locale,
  });
}

export default async function TenantStorePage() {
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const { catalog, copy, locale, currency, style, site, supabaseUrl } = ctx;
  const origin = await tenantOrigin();

  const labels: SiteRenderLabels = {
    productsEmpty: copy.siteLabels.productsEmpty,
    contactEmail: copy.siteLabels.contactEmail,
    contactPhone: copy.siteLabels.contactPhone,
    contactAddress: copy.siteLabels.contactAddress,
    contactMap: copy.siteLabels.contactMap,
    directionsAddress: copy.siteLabels.directionsAddress,
    directionsHours: copy.siteLabels.directionsHours,
    directionsMap: copy.siteLabels.directionsMap,
  };

  // Prefiks publicznego URL-a zdjęć sekcji (bucket site-images, 0043) — hero
  // i galeria budują z niego adres obrazu, jak katalog buduje URL zdjęć produktów.
  const siteImageBase = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/site-images`;

  const products = toStorefrontProducts(catalog.products, {
    supabaseUrl,
    currency,
    locale,
    words: { from: copy.common.from, perDay: copy.common.perDay },
    hrefBase: "/product/",
  });

  // LocalBusiness: nazwa sklepu + opis z hero + adres PIERWSZEGO punktu odbioru,
  // jeśli tenant go ma. Wszystko z publicznego katalogu / opublikowanej strony.
  const pickup = catalog.pickup_locations[0];
  const hero = heroText(site);
  const businessJsonLd = localBusinessJsonLd({
    name: catalog.tenant.name,
    url: `${origin ?? ""}/store`,
    description: hero.subheading ?? hero.heading ?? null,
    address: pickup
      ? { street: pickup.address_street, zip: pickup.address_zip, city: pickup.address_city }
      : null,
  });

  // Strona MUSI mieć dokładnie jeden h1 (WCAG 1.3.1 / 2.4.6). Sekcja hero go
  // niesie; układ bez hero zostawiłby stronę bez nagłówka pierwszego poziomu,
  // więc dokładamy go dla czytników ekranu (wizualnie bez zmian).
  const hasHero = site?.sections.some((section) => section.type === "hero") ?? false;

  return (
    /*
      KORZEŃ STRONY NAJEMCY WYSTAWIA POWŁOKA, NIE RENDERER (K6, ADR-092).
      Nagłówek sklepu stał do K6 obok korzenia, więc jako jedyny element sklepu
      nie widział zmiennych motywu i brał paletę panelu. Teraz stoi w środku —
      razem z sekcjami i z ekranem „sklep w budowie", który jest tą samą stroną
      tego samego najemcy, tylko bez treści.
    */
    <StoreChrome style={style} copy={copy} storeName={catalog.tenant.name}>
      {origin ? <JsonLd data={businessJsonLd} /> : null}
      {!site || site.sections.length === 0 ? (
        <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className={`text-2xl ${SITE_HEADING}`}>{catalog.tenant.name}</h1>
          <p className="site-text-muted">{copy.siteLabels.productsEmpty}</p>
        </main>
      ) : (
        <main>
          {hasHero ? null : <h1 className="sr-only">{catalog.tenant.name}</h1>}
          {/*
            STYL STRONY jako TOKENY (K5, ADR-090), nie jako kolory na elementach.
            Sklep podaje rozstrzygnięty styl, renderer wystawia z niego zmienne
            CSS na korzeniu, a to, czy element weźmie odcień papierowy, czy
            atramentowy, rozstrzyga arkusz per PAS. Gdyby sklep liczył kolory
            sam, płótno kreatora przestałoby być dowodem na to, co widzi klient
            — a to jest cała stawka wspólnego renderera (ADR-083).
          */}
          {/*
            `asRoot={false}` — korzeń niesie już powłoka wyżej, tym SAMYM stylem.
            Drugi korzeń znaczyłby drugi kontener zapytań `site` i podwójnie
            liczoną szerokość, na której stoi responsywność sekcji (ADR-085).
          */}
          <SiteRenderer
            sections={site.sections}
            style={style}
            asRoot={false}
            products={products}
            labels={labels}
            siteImageBase={siteImageBase}
          />
        </main>
      )}
    </StoreChrome>
  );
}
