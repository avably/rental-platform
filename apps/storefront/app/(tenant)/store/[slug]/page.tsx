/**
 * STRONA TREŚCIOWA NAJEMCY — `/{slug}` (Faza 2, ADR-158).
 *
 * ==================== DLACZEGO TA TRASA STOI TUTAJ ====================
 *
 * Jej adres publiczny to `/{slug}`, a plik leży w `store/[slug]`. To NIE jest
 * niechlujstwo: trasy `app/(tenant)/[slug]` NIE DA SIĘ dodać obok
 * `app/[locale]` — Next 16 rzuca twardy błąd builda przy dwóch różnych nazwach
 * parametru na tym samym poziomie ścieżki. Cel rewrite'u schodzi więc piętro
 * niżej, pod segment, który i tak jest zarezerwowany (`store`), i nie dokłada
 * ani jednego nowego słowa do listy rezerwacji.
 *
 * Adres wewnętrzny nigdy nie jest adresem publicznym: proxy oddaje neutralne
 * 404 na bezpośrednie wejście w `/store/<cokolwiek>`, a kanon liczy
 * `pagePathFromSlug` — jedno miejsce na cały produkt.
 *
 * ==================== CO BIERZE Z KTÓREJ STRONY ====================
 *
 * TREŚĆ — z własnej strony (`getPublishedPage(tenantId, slug)`).
 * ZNAK I WYGLĄD — z wiersza NAJEMCY (`ctx.appearance`, ADR-171). Styl jest
 * wyglądem SKLEPU, nie dokumentu: dwie podstrony w różnych motywach wyglądałyby
 * jak dwa różne serwisy pod jedną domeną. Do 0079 jechały kopertą strony
 * głównej i znikały razem z nią — najemca z opublikowaną podstroną i szkicem
 * strony głównej dostawał sklep bez znaku i w motywie domyślnym.
 * STOPKA — ze strony GŁÓWNEJ (`ctx.site`), bo jest warstwą ponad stronami
 * (faza 0, ADR-154) i jej własnością pozostaje strona główna.
 */
import { catalogPagePath } from "@avably/core";
import { HOME_PAGE_SLUG, faqPageJsonLd, pagePathFromSlug } from "@avably/core/site";
import { SiteRenderer } from "@avably/ui";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/storefront/json-ld";
import { SITE_HEADING, StoreChrome } from "@/components/storefront/store-chrome";
import { categoryNavItems } from "@/lib/catalog/category-nav";
import { pageSections, withCatalogFallbackAnchors } from "@/lib/site/page-sections";
import { getPublishedPage } from "@/lib/site/published";
import { buildSiteRenderSeam } from "@/lib/site/render-seam";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { heroText, pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { format } from "@/lib/storefront/copy";
import { storeLogo } from "@/lib/site/store-logo";
import { loadStorefrontContext } from "@/lib/storefront/context";
import { storeTermInput } from "@/lib/storefront/term-input";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const ctx = await loadStorefrontContext();
  if (!ctx) return {};

  const { slug } = await params;
  const page = await getPublishedPage(ctx.tenantId, slug);
  if (!page) return { robots: { index: false, follow: false } };

  const storeName = ctx.catalog.tenant.name;
  const hero = heroText(page);

  return tenantMetadata({
    // Tytuł podstrony bierze nagłówek hero TEJ strony — jedyna publiczna nazwa,
    // jaką ma. `sites.name` jest daną wyłącznie szkicową (0048) i do sklepu nie
    // wychodzi, więc nie ma jej czym zastąpić.
    title: pageTitle(storeName, hero.heading),
    description:
      hero.subheading ?? hero.heading ?? format(ctx.copy.seo.catalogDescription, { store: storeName }),
    storeName,
    published: true,
    origin: await tenantOrigin(),
    // KANON Z ROZSTRZYGNIĘTEGO SLUGA, nie z ręcznie wpisanej ścieżki. Trasa
    // fizycznie stoi pod `/store/{slug}`, a jej adres publiczny to `/{slug}` —
    // gdyby kanon szedł z pliku, ta sama treść miałaby dwa adresy.
    pathname: pagePathFromSlug(slug),
    locale: ctx.locale,
  });
}

export default async function TenantContentPage({ params }: Params) {
  const ctx = await loadStorefrontContext();
  const revealNonce = (await headers()).get("x-nonce") ?? undefined;
  if (!ctx) notFound();

  const { slug } = await params;
  const page = await getPublishedPage(ctx.tenantId, slug);
  // Proxy wpuszcza tu wyłącznie adresy z rejestru, ale rejestr jest CACHE'owany
  // — strona zdjęta przed wygaśnięciem wpisu dochodzi tutaj i musi dostać 404,
  // a nie pustą ramkę z powłoką.
  if (!page) notFound();

  const { catalog, copy, currency, locale, style, site } = ctx;
  const seam = buildSiteRenderSeam(ctx);
  /* Kotwica bez celu → katalog (S-10) — jak na stronie głównej. */
  const bodySections = withCatalogFallbackAnchors(pageSections(page), catalogPagePath());
  const hasHero = bodySections.some((section) => section.type === "hero");
  const faqJsonLd = faqPageJsonLd(page.sections);

  return (
    <StoreChrome
      style={style}
      copy={copy}
      storeName={catalog.tenant.name}
      logo={storeLogo(ctx)}
      /*
        STOPKA ZE STRONY GŁÓWNEJ, a jej kotwice przepisane na adres tej strony:
        `#kontakt` w stopce prowadzi do sekcji, która stoi na stronie głównej,
        więc na podstronie musi być adresem bezwzględnym. Bez tego klient klika
        i nie dzieje się NIC — bez błędu, bez zmiany adresu (faza 0, ADR-154).

        `null` (strona główna nieopublikowana) znaczy odtąd „nie ma stopki",
        a NIE „nie ma powłoki": znak i motyw jadą torem najemcy (ADR-171).
      */
      site={site}
      /*
        TERMIN NAJMU W POWŁOCE (faza 5, ADR-179) — ta trasa SPRZEDAJE, więc
        pasek terminu na niej stoi, chyba że najemca wyłączył pigułkę
        (ADR-203): regułę trzyma `storeTermInput`, wspólny dla wszystkich
        tras handlowych. Katalog idzie do panelu konfliktu po nazwy
        pozycji: lista „nie zmieści się w tym terminie" ma mówić o sprzęcie,
        a nie o identyfikatorach.
      */
      term={storeTermInput(ctx.storeFlags, catalog.products, locale)}
      /* Prefiks zdjęć także dla stopki powłoki (ADR-172) — patrz `/store`. */
      siteImageBase={seam.siteImageBase}
      /*
        Cel kotwic poprawiony w ADR-186: `#kontakt` w stopce ma prowadzić na
        stronę GŁÓWNĄ, gdzie ta sekcja stoi. Do fazy 4b stała adresu katalogu
        wskazywała `/store`, czyli wewnętrzny adres strony głównej, więc oba
        znaczenia mieściły się w jednej wartości przypadkiem.
      */
      footerAnchorBase={pagePathFromSlug(HOME_PAGE_SLUG)}
      /*
        MENU KATEGORII (S-30 audytu 2026-08-25): strona treściowa („o nas",
        „kontakt") bywa wejściem z linku zewnętrznego — bez menu nagłówek nie
        prowadził do oferty niczym poza logo. Pozycje z pełnego katalogu,
        jak na stronie głównej.
      */
      categoryNav={categoryNavItems(catalog)}
      /* Self-linki stopki (S-52): ta strona MA publiczny adres ze sluga. */
      currentPath={pagePathFromSlug(slug)}
      revealNonce={revealNonce}
    >
      {faqJsonLd ? <JsonLd data={faqJsonLd} /> : null}
      {bodySections.length === 0 ? (
        <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className={`text-2xl ${SITE_HEADING}`}>{catalog.tenant.name}</h1>
          <p className="site-text-muted">{copy.siteLabels.productsEmpty}</p>
        </main>
      ) : (
        <main>
          {hasHero ? null : <h1 className="sr-only">{catalog.tenant.name}</h1>}
          <SiteRenderer
            sections={bodySections}
            style={style}
            asRoot={false}
            products={seam.products}
            categories={seam.categories}
            labels={seam.labels}
            money={{ currency, locale }}
            siteImageBase={seam.siteImageBase}
            contactForm={seam.contactForm}
            mapEmbed
            anchors
          />
        </main>
      )}
    </StoreChrome>
  );
}
