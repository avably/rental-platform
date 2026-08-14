/**
 * STRONA POJEDYNCZEGO SPRZĘTU — `/product/{id}` (faza 5, ADR-178).
 *
 * ==================== DWIE STRONY POD JEDNYM ADRESEM ====================
 *
 * Trasa oddaje jedną z dwóch rzeczy, a granica przebiega po PUBLIKACJI
 * SZABLONU — nie po jego zawartości:
 *
 *   • BRAK opublikowanego szablonu → STRONA WBUDOWANA. Dokładnie ta, którą
 *     trasa oddawała od 2.4b: `ProductDetail` z wyborem terminu, dostępnością
 *     i dodaniem do koszyka. To jest stan KAŻDEGO dzisiejszego najemcy, więc
 *     wdrożenie fazy 5 nie zmienia ani jednego piksela, dopóki operator sam
 *     nie zbuduje i nie opublikuje szablonu.
 *   • OPUBLIKOWANY szablon → SZABLON, także gdy jest ubogi albo pusty. Pusty
 *     opublikowany szablon jest świadomą decyzją operatora; podmienianie go
 *     z powrotem na stronę wbudowaną byłoby dokładnie tym kłamstwem
 *     interfejsu, które naprawiały ADR-171 i ADR-172 („opublikowałem i widzę
 *     co innego"). Dlatego warunkiem jest `template !== null`, a NIE
 *     `template.sections.length > 0`.
 *
 * ==================== CO CZYNI SZABLON STRONĄ TEGO SPRZĘTU ====================
 *
 * Szablon jest JEDNĄ listą sekcji na całego najemcę i renderuje się raz na
 * pozycję katalogu. Różnicę między wyświetleniami niesie WYŁĄCZNIE props
 * `record` (faza 3, ADR-163): element związany z `pageProduct` czyta z niego
 * wartość PRZY RENDERZE, a w treści strony zostaje samo wskazanie. Rekord jest
 * brany Z TEJ SAMEJ LISTY, z której sekcja sprzętu rysuje kafle
 * (`seam.products`) — dzięki temu nazwa i cena na stronie sprzętu nie mają jak
 * rozjechać się z kaflem obok, i dzięki temu wiązanie nie ma gdzie sięgnąć po
 * pozycję spoza katalogu publicznego TEGO najemcy.
 *
 * ==================== CO BIERZE Z KTÓREJ STRONY ====================
 *
 * TREŚĆ — z szablonu (`getPublishedProductTemplate`).
 * DANE POZYCJI — z katalogu publicznego (`ctx.catalog`), nigdy z szablonu.
 * ZNAK I WYGLĄD — z wiersza NAJEMCY (`ctx.style`, `storeLogo`, ADR-171).
 * STOPKA — ze strony GŁÓWNEJ (`ctx.site`), bo jest warstwą ponad stronami
 * (faza 0, ADR-154) i jej własnością pozostaje strona główna.
 *
 * METADANE I JSON-LD OPISUJĄ SPRZĘT W OBU GAŁĘZIACH. Szablon jest sposobem
 * pokazania pozycji, a nie osobnym dokumentem: tytuł, opis i `Product` +
 * `Offer` liczą się z katalogu, tak samo jak przed fazą 5. Gdyby szły
 * z szablonu, wszystkie strony sprzętu najemcy miałyby jeden tytuł.
 *
 * BRAMKA jak katalog: tenant_id z nagłówka (rewrite middleware), inaczej
 * notFound(). Produkt spoza katalogu tenanta / nieaktywny → notFound() (katalog
 * publiczny zawiera tylko aktywne). Render dynamiczny (CSP nonce).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { PRODUCTS_CATALOG_HREF } from "@avably/core/site";
import { SiteRenderer } from "@avably/ui";

import { toProductDetail } from "@/lib/catalog/present";
import { JsonLd } from "@/components/storefront/json-ld";
import { ProductDetail } from "@/components/storefront/product-detail";
import { PageShell } from "@/components/storefront/page-shell";
import { StoreChrome } from "@/components/storefront/store-chrome";
import { pageSections } from "@/lib/site/page-sections";
import { getPublishedProductTemplate } from "@/lib/site/published";
import { buildSiteRenderSeam } from "@/lib/site/render-seam";
import { productJsonLd } from "@/lib/seo/jsonld";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { format } from "@/lib/storefront/copy";
import { siteImageBaseUrl } from "@/lib/site/image-base";
import { storeLogo } from "@/lib/site/store-logo";
import { loadStorefrontContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

/**
 * Tytuł = nazwa produktu + nazwa sklepu; opis = opis produktu z katalogu
 * publicznego, a gdy go nie ma — neutralne zdanie w locale tenanta. Produkt
 * spoza katalogu nie dostaje metadanych (strona i tak odda 404).
 *
 * SZABLONU TA FUNKCJA NIE CZYTA I NIE MA CZYTAĆ — patrz nagłówek pliku.
 * Odczyt szablonu byłby tu drugą podróżą do bazy po daną, która na tytuł
 * i tak nie ma wpływu.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const ctx = await loadStorefrontContext();
  if (!ctx) return {};

  const product = ctx.catalog.products.find((item) => item.id === id);
  if (!product) return {};

  const storeName = ctx.catalog.tenant.name;

  return tenantMetadata({
    title: pageTitle(storeName, product.name),
    description:
      product.description ??
      format(ctx.copy.seo.productDescription, { product: product.name, store: storeName }),
    storeName,
    published: ctx.site !== null,
    origin: await tenantOrigin(),
    pathname: `/product/${product.id}`,
    locale: ctx.locale,
  });
}

export default async function TenantProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const { catalog, copy, locale, currency, style, site, supabaseUrl } = ctx;
  const raw = catalog.products.find((product) => product.id === id);
  if (!raw) notFound();

  const product = toProductDetail(raw, {
    supabaseUrl,
    currency,
    locale,
    words: { from: copy.common.from, perDay: copy.common.perDay },
    /*
      SPECYFIKACJA TECHNICZNA (faza 1a, ADR-154). Dane DOCHODZIŁY tu od 0058
      (`custom_fields` w kopercie katalogu) i nikt ich nie rysował — cała
      zmiana na tej trasie to podanie definicji do warstwy prezentacji.
    */
    customFields: catalog.custom_fields,
    fieldLocale: locale,
  });

  // Product + Offer wyłącznie z publicznego katalogu; cena „od” = stawka za
  // dobę (progi cenowe obniżają ją przy dłuższym najmie).
  //
  // LICZONE PRZED ROZGAŁĘZIENIEM I WSPÓLNE DLA OBU GAŁĘZI: opis pozycji dla
  // robota nie zależy od tego, czy operator zbudował sobie szablon. `raw`
  // przechodzi przez ten sam presenter w obu przypadkach, więc adresy zdjęć
  // w JSON-LD są co do znaku te same, co przed fazą 5 — a presenter jest
  // funkcją czystą, więc gałąź szablonu nie płaci za to ani jednym zapytaniem.
  const origin = await tenantOrigin();
  const productLd = origin
    ? productJsonLd({
        name: product.name,
        description: product.description,
        images: product.images.map((image) => image.url),
        url: `${origin}/product/${product.id}`,
        currency,
        basePriceDayGrosze: raw.base_price_day_grosze,
      })
    : null;

  const template = await getPublishedProductTemplate(ctx.tenantId);

  if (template) {
    const revealNonce = (await headers()).get("x-nonce") ?? undefined;
    const seam = buildSiteRenderSeam(ctx);
    const bodySections = pageSections(template);
    /*
      REKORD STRONY — pozycja Z TEJ SAMEJ listy, z której rysują się kafle
      katalogu. Wyszukanie nie ma jak spudłować (`raw` pochodzi z tego samego
      katalogu, a szew mapuje go w całości), ale `undefined` jest tu stanem
      legalnym z punktu widzenia typów i znaczy dla silnika dokładnie to samo,
      co pozycja nieistniejąca: wiązania do rekordu strony wycinają węzły.
      To jest bezpieczny kierunek degradacji — strona pokaże mniej, nigdy
      cudze dane.
    */
    const record = seam.products.find((product) => product.id === raw.id);
    const hasHero = bodySections.some((section) => section.type === "hero");

    return (
      <StoreChrome
        style={style}
        copy={copy}
        storeName={catalog.tenant.name}
        logo={storeLogo(ctx)}
        /* Stopka ze strony GŁÓWNEJ (ADR-154) — patrz nagłówek pliku. */
        site={site}
        siteImageBase={seam.siteImageBase}
        /*
          Kotwice stopki prowadzą na katalog: strona sprzętu nie ma sekcji, do
          których stopka z presetu odsyła, więc czyste `#kontakt` nie robiłoby
          NIC — bez błędu i bez zmiany adresu (faza 0, ADR-154).
        */
        footerAnchorBase={PRODUCTS_CATALOG_HREF}
        revealNonce={revealNonce}
      >
        {productLd ? <JsonLd data={productLd} /> : null}
        <main>
          {/*
            NAGŁÓWEK DOKUMENTU TO NAZWA SPRZĘTU, nie nazwa sklepu: to jest
            strona TEJ pozycji. Widoczny `h1` wnosi hero szablonu (najczęściej
            z wiązaniem do nazwy pozycji); gdy szablon hero nie ma — także gdy
            nie ma NICZEGO, bo operator opublikował go pustym — zostaje sam
            nagłówek dla czytnika ekranu. Zdania „ta strona jest pusta" tu nie
            ma świadomie: byłoby treścią, której operator nie opublikował.
          */}
          {hasHero ? null : <h1 className="sr-only">{raw.name}</h1>}
          <SiteRenderer
            sections={bodySections}
            style={style}
            asRoot={false}
            products={seam.products}
            record={record}
            labels={seam.labels}
            money={{ currency, locale }}
            siteImageBase={seam.siteImageBase}
            contactForm={seam.contactForm}
            mapEmbed
            anchors
          />
        </main>
      </StoreChrome>
    );
  }

  return (
    <PageShell style={style} copy={copy} storeName={catalog.tenant.name} site={site} logo={storeLogo(ctx)} siteImageBase={siteImageBaseUrl(ctx.supabaseUrl)}>
      {productLd ? <JsonLd data={productLd} /> : null}
      <Link href="/store" className="site-link text-sm">
        {copy.common.backToCatalog}
      </Link>
      <div className="mt-6">
        <ProductDetail product={product} copy={copy} locale={locale} currency={currency} />
      </div>
    </PageShell>
  );
}
