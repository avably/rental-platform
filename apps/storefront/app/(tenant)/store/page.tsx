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
import { faqPageJsonLd } from "@avably/core/site";
import { SiteRenderer, type SiteRenderLabels } from "@avably/ui";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { submitContactMessage } from "@/lib/actions/contact";
import { toStorefrontProducts } from "@/lib/catalog/present";
import { issueContactTicket } from "@/lib/contact/ticket";
import { ContactCaptchaField } from "@/components/storefront/contact-captcha";
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
  /*
   * NONCE POD SKRYPT UZBRAJAJĄCY WEJŚCIE SEKCJI (ADR-097). Ten sam nagłówek,
   * którym oś marketingowa uruchamia bootstrap szablonu — CSP nie ma
   * `unsafe-inline`, więc inline bez nonce'a po prostu się nie wykona.
   */
  const revealNonce = (await headers()).get("x-nonce") ?? undefined;
  if (!ctx) notFound();

  const { catalog, copy, locale, currency, style, site, supabaseUrl } = ctx;
  const origin = await tenantOrigin();

  const labels: SiteRenderLabels = {
    productsEmpty: copy.siteLabels.productsEmpty,
    // Sprzęt strukturalny (E7): odnośnik pod sekcją mówi, że widać WYCINEK
    // oferty — a zdanie o tym jest CHROME renderu, nie tekstem najemcy.
    productsCatalog: copy.siteLabels.productsCatalog,
    contactEmail: copy.siteLabels.contactEmail,
    contactPhone: copy.siteLabels.contactPhone,
    contactAddress: copy.siteLabels.contactAddress,
    contactMap: copy.siteLabels.contactMap,
    directionsAddress: copy.siteLabels.directionsAddress,
    directionsHours: copy.siteLabels.directionsHours,
    directionsMap: copy.siteLabels.directionsMap,
    // Dojazd strukturalny (E5): przycisk „Pokaż mapę", wybór punktu i tytuł
    // ramki są CHROME renderu — mówią językiem sklepu, a nie językiem, w którym
    // akurat stoi kod. Notka o ładowaniu mapy z serwisu zewnętrznego jest tu
    // z tego samego powodu: to informacja dla odwiedzającego, nie tekst najemcy.
    directionsRoute: copy.siteLabels.directionsRoute,
    directionsChoose: copy.siteLabels.directionsChoose,
    directionsShowMap: copy.siteLabels.directionsShowMap,
    directionsMapNotice: copy.siteLabels.directionsMapNotice,
    directionsMapTitle: copy.siteLabels.directionsMapTitle,
    directionsMapPreview: copy.siteLabels.directionsMapPreview,
    // Galeria strukturalna (E3): przyciski powiększenia i pasa karuzeli mają
    // w środku sam znak graficzny, więc ich dostępna nazwa jest jedynym, co
    // słyszy czytnik ekranu — musi przyjść z języka strony.
    galleryZoom: copy.siteLabels.galleryZoom,
    galleryClose: copy.siteLabels.galleryClose,
    galleryPrev: copy.siteLabels.galleryPrev,
    galleryNext: copy.siteLabels.galleryNext,
    galleryPosition: copy.siteLabels.galleryPosition,
    // Kontakt strukturalny (E4): godziny otwarcia to nowy rodzaj wpisu, a cały
    // formularz jest CHROME renderu — jego etykiety mówią językiem sklepu,
    // a nie językiem, w którym akurat stoi kod.
    contactHours: copy.siteLabels.contactHours,
    contactForm: copy.siteLabels.contactForm,
    // Cennik i opinie strukturalne (E6): przedrostek „od", nazwy jednostek
    // rozliczeniowych, odnośnik do katalogu i strzałki pasa opinii mówią
    // językiem SKLEPU. Jednostka jest tu szczególnie istotna: najemca wybiera
    // ją ze słownika, więc sklep po angielsku nie ma prawa pokazać „doba".
    pricingFrom: copy.siteLabels.pricingFrom,
    pricingUnits: copy.siteLabels.pricingUnits,
    pricingCatalog: copy.siteLabels.pricingCatalog,
    testimonialsPrev: copy.siteLabels.testimonialsPrev,
    testimonialsNext: copy.siteLabels.testimonialsNext,
  };

  /*
   * SZEW FORMULARZA KONTAKTU (E4, ADR-095). Trzy rzeczy, których pakiet UI mieć
   * nie może: akcja serwerowa, BILET z chwili renderu (podpisany znacznik
   * czasu — warstwa „minimalnego czasu od renderu") i widget CAPTCHY.
   *
   * Bilet powstaje TU, przy renderze strony, bo to jest moment, w którym
   * odwiedzający zobaczył formularz. Trasa jest `force-dynamic`, więc każde
   * wyświetlenie dostaje własny, świeży bilet.
   *
   * Klucz publiczny CAPTCHY jest zmienną `NEXT_PUBLIC_*` (wchodzi do bundla —
   * i tak ma być). SEKRET nie pojawia się w tym pliku ani w żadnym innym
   * pliku panelu: weryfikacja stoi w akcji serwerowej storefrontu.
   */
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const contactForm = {
    ticket: issueContactTicket(),
    submit: submitContactMessage,
    ...(turnstileSiteKey
      ? { captcha: <ContactCaptchaField siteKey={turnstileSiteKey} locale={locale} /> }
      : {}),
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
    <StoreChrome
      style={style}
      copy={copy}
      storeName={catalog.tenant.name}
      revealNonce={revealNonce}
    >
      {origin ? <JsonLd data={businessJsonLd} /> : null}
      {faqJsonLd ? <JsonLd data={faqJsonLd} /> : null}
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
            money={{ currency, locale }}
            siteImageBase={siteImageBase}
            contactForm={contactForm}
            /*
              ZGODA NA OSADZENIE MAPY (E5, ADR-096) — podaje ją WYŁĄCZNIE sklep,
              bo tylko jego polityka CSP wpuszcza źródło ramki dostawcy map
              (`maps` w proxy.ts). Panel tej flagi nie podaje i dostaje ten sam
              kafel w trybie podglądu. Zgoda dotyczy PRAWA do osadzenia; samo
              osadzenie robi dopiero kliknięcie odwiedzającego.
            */
            mapEmbed
          />
        </main>
      )}
    </StoreChrome>
  );
}
