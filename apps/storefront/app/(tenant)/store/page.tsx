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
import { HOME_PAGE_SLUG, faqPageJsonLd, pagePathFromSlug } from "@avably/core/site";
import { SiteRenderer } from "@avably/ui";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/storefront/json-ld";
import { SITE_HEADING, StoreChrome } from "@/components/storefront/store-chrome";
import { pageSections } from "@/lib/site/page-sections";
import { buildSiteRenderSeam } from "@/lib/site/render-seam";
import { localBusinessJsonLd } from "@/lib/seo/jsonld";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { heroText, pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { format } from "@/lib/storefront/copy";
import { storeLogo } from "@/lib/site/store-logo";
import { loadStorefrontContext } from "@/lib/storefront/context";
import { storeTermInput } from "@/lib/storefront/term-input";

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
    /*
      KANON Z ADRESU, NIE ZE ŚCIEŻKI PLIKU (Faza 2, ADR-158). Strona główna
      sklepu odpowiada pod `/` (proxy rewrite'uje ją na `/store`), więc kanonem
      jest `/`. Do Fazy 2 każda trasa podawała ścieżkę z ręki i wskazywała
      `/store` — czyli adres WEWNĘTRZNY, pod którym ta sama treść stoi po raz
      drugi. Przy N stronach jedno takie przeoczenie mnoży się przez N.
    */
    pathname: pagePathFromSlug(HOME_PAGE_SLUG),
    locale: ctx.locale,
  });
}

export default async function TenantStorePage() {
  const ctx = await loadStorefrontContext();
  /*
   * NONCE POD SKRYPT UZBRAJAJĄCY WEJŚCIE SEKCJI (ADR-097). Ten sam nagłówek,
   * którym oś marketingowa uruchamia bootstrap szablonu — CSP nie ma
   * `unsafe-inline`, więc inline bez nonce'a po prostu się nie wykona.
   */
  const revealNonce = (await headers()).get("x-nonce") ?? undefined;
  if (!ctx) notFound();

  const { catalog, copy, locale, currency, style, site } = ctx;
  const origin = await tenantOrigin();

  /*
    SZEW RENDERU — etykiety chrome'u, kafle produktów, bilet formularza kontaktu
    i prefiks zdjęć sekcji. Od Fazy 2 sekcje rysuje więcej niż jedna trasa, więc
    szew stoi w jednym module (lib/site/render-seam) — rozkopiowany po trasach
    rozjechałby się CICHO przy pierwszej zmianie etykiety.
  */
  const seam = buildSiteRenderSeam(ctx);

  // LocalBusiness: nazwa sklepu + opis z hero + adres PIERWSZEGO punktu odbioru,
  // jeśli tenant go ma. Wszystko z publicznego katalogu / opublikowanej strony.
  const pickup = catalog.pickup_locations[0];
  const hero = heroText(site);
  const businessJsonLd = localBusinessJsonLd({
    name: catalog.tenant.name,
    url: `${origin ?? ""}${pagePathFromSlug(HOME_PAGE_SLUG)}`,
    description: hero.subheading ?? hero.heading ?? null,
    address: pickup
      ? { street: pickup.address_street, zip: pickup.address_zip, city: pickup.address_city }
      : null,
  });

  /*
   * FAQPage (schema.org) dla strukturalnych sekcji FAQ (E1, ADR-094).
   *
   * NIESZKODLIWY DODATEK, nie funkcja sprzedażowa: wyszukiwarka wycofała bogate
   * wyniki FAQ dla większości stron (2026-05-07), więc bloku nie ma w panelu,
   * nie ma o nim narracji w produkcie i nikomu niczego nie obiecuje. Zostaje,
   * bo poprawnie opisane pytania i odpowiedzi kosztują kilkanaście linii,
   * a przydają się czytnikom i asystentom.
   *
   * `null` (brak sekcji strukturalnej FAQ) = brak bloku. Pusty `FAQPage` byłby
   * gorszy niż jego brak.
   */
  const faqJsonLd = site ? faqPageJsonLd(site.sections) : null;

  /*
   * SEKCJE STRONY — bez przypiętych do końca dokumentu (faza 0, ADR-154).
   * Stopkę rysuje POWŁOKA, więc lista tutaj jest o nią krótsza. To zmienia też
   * odpowiedź na pytanie „czy strona jest pusta": strona z samą stopką nie ma
   * do pokazania NIC i ma dostać ekran „sklep w budowie", a nie pusty `<main>`.
   */
  const bodySections = pageSections(site);

  // Strona MUSI mieć dokładnie jeden h1 (WCAG 1.3.1 / 2.4.6). Sekcja hero go
  // niesie; układ bez hero zostawiłby stronę bez nagłówka pierwszego poziomu,
  // więc dokładamy go dla czytników ekranu (wizualnie bez zmian).
  const hasHero = bodySections.some((section) => section.type === "hero");

  return (
    /*
      KORZEŃ STRONY NAJEMCY WYSTAWIA POWŁOKA, NIE RENDERER (K6, ADR-092).
      Nagłówek sklepu stał do K6 obok korzenia, więc jako jedyny element sklepu
      nie widział zmiennych motywu i brał paletę panelu. Teraz stoi w środku —
      razem z sekcjami i z ekranem „sklep w budowie", który jest tą samą stroną
      tego samego najemcy, tylko bez treści.
    */
    <StoreChrome
      style={style}
      copy={copy}
      storeName={catalog.tenant.name}
      logo={storeLogo(ctx)}
      /*
        STOPKA JEST WŁASNOŚCIĄ POWŁOKI, NIE STRONY (faza 0, ADR-154). Trasa
        rysuje niżej WYŁĄCZNIE sekcje strony (`pageSections`), a sekcje
        przypięte dokłada powłoka — tym samym rendererem, tą samą treścią, na
        każdej trasie sklepu. Bez `footerAnchorBase`: cele kotwic stopki
        (`#kontakt`, `#produkty`) stoją właśnie na tej stronie.
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
      /*
        PREFIKS ZDJĘĆ TAKŻE DLA POWŁOKI (ADR-172). Ten sam szew, którym niżej
        jadą zdjęcia sekcji strony — bo stopkę rysuje ten sam renderer, a jego
        element obrazu bez prefiksu daje szary kafel zastępczy.
      */
      siteImageBase={seam.siteImageBase}
      revealNonce={revealNonce}
    >
      {origin ? <JsonLd data={businessJsonLd} /> : null}
      {faqJsonLd ? <JsonLd data={faqJsonLd} /> : null}
      {bodySections.length === 0 ? (
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
            sections={bodySections}
            style={style}
            asRoot={false}
            products={seam.products}
            labels={seam.labels}
            money={{ currency, locale }}
            siteImageBase={seam.siteImageBase}
            contactForm={seam.contactForm}
            /*
              ZGODA NA OSADZENIE MAPY (E5, ADR-096) — podaje ją WYŁĄCZNIE sklep,
              bo tylko jego polityka CSP wpuszcza źródło ramki dostawcy map
              (`maps` w proxy.ts). Panel tej flagi nie podaje i dostaje ten sam
              kafel w trybie podglądu. Zgoda dotyczy PRAWA do osadzenia; samo
              osadzenie robi dopiero kliknięcie odwiedzającego.
            */
            mapEmbed
            /*
              KOTWICE SEKCJI — `id` na owijce PIERWSZEJ sekcji każdego typu
              (rejestr `SECTION_ANCHORS` w @avably/core/site). Flagę podaje
              POWIERZCHNIA, bo tylko ona wie, że jest w dokumencie jedna:
              galeria szablonów w panelu montuje sześć stron obok siebie i te
              same `id` byłyby tam duplikatem. Bez niej przyciski, które presety
              i szablony od zawsze kierują na `#produkty` i `#kontakt`, nie
              robią NIC — kotwicy o takiej nazwie po prostu nie ma w dokumencie.
            */
            anchors
          />
        </main>
      )}
    </StoreChrome>
  );
}
