/**
 * STRONA POJEDYNCZEGO SPRZĘTU — render wspólny dla obu adresów (ADR-178/182).
 *
 * ==================== DLACZEGO RENDER MIESZKA POZA TRASĄ ====================
 *
 * Od ADR-182 strona sprzętu ma adres `/produkt/{slug}`, a adres zastany
 * `/product/{uuid}` zostaje jako źródło 308 — bo stoi w indeksie wyszukiwarki
 * i w linkach, które klienci najemcy wkleili na Facebooku.
 *
 * Dwie trasy, jeden render. Kopia treści w dwóch plikach znaczyłaby, że
 * poprawka widgetu rezerwacji trafia w jeden z nich, a klient najemcy widzi
 * różne strony pod dwoma adresami tej samej pozycji.
 *
 * ==================== DWIE STRONY POD JEDNYM ADRESEM ====================
 *
 * OBIE GAŁĘZIE ZACZYNAJĄ SIĘ TYM SAMYM (ADR-189) — stałym blokiem góry strony
 * (`ProductDetail`: galeria, nazwa, cena, opis, specyfikacja, widget
 * rezerwacji). Granica między gałęziami przebiega po PUBLIKACJI SZABLONU — nie
 * po jego zawartości — i dotyczy tego, co jest POD tym blokiem:
 *
 *   • BRAK opublikowanego szablonu → STRONA WBUDOWANA: stały blok i nic pod
 *     nim. To jest stan KAŻDEGO dzisiejszego najemcy, więc wdrożenie fazy 5 nie
 *     zabiera mu ani jednej funkcji, dopóki operator sam nie zbuduje i nie
 *     opublikuje szablonu.
 *   • OPUBLIKOWANY szablon → stały blok, a POD nim treść z kreatora; także gdy
 *     jest uboga albo pusta. Pusty opublikowany szablon jest świadomą decyzją
 *     operatora; podmienianie go z powrotem na inną stronę byłoby dokładnie tym
 *     kłamstwem interfejsu, które naprawiały ADR-171 i ADR-172
 *     („opublikowałem i widzę co innego"). Dlatego warunkiem jest
 *     `template !== null`, a NIE `template.sections.length > 0`.
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
 * OD FAZY 4a WARUNEK ADR-180 JEST SPEŁNIONY MOCNIEJ, nie słabiej: ta lista ma
 * dokładnie JEDEN element — pozycję spod adresu (`ProductPageContext`,
 * ADR-185). Na stronie sprzętu nie ma już DRUGIEJ listy tych samych danych,
 * z którą cokolwiek mogłoby się rozjechać, bo cały katalog przestał tu
 * przyjeżdżać.
 *
 * ==================== CO BIERZE Z KTÓREJ STRONY ====================
 *
 * TREŚĆ — z szablonu (`getPublishedProductTemplate`).
 * DANE POZYCJI I ADRES — z JEDNEJ koperty wąskiego odczytu
 * (`app.get_public_product`, 0084), nigdy z szablonu. Do fazy 4a były to dwa
 * niezależne odczyty (katalog i rejestr adresów), więc stan „znam pozycję, nie
 * znam jej adresu" był reprezentowalny; od ADR-185 nie jest.
 * ZNAK I WYGLĄD — z wiersza NAJEMCY (`ctx.style`, `storeLogo`, ADR-171).
 * STOPKA — ze strony GŁÓWNEJ (`ctx.site`), bo jest warstwą ponad stronami
 * (faza 0, ADR-154) i jej własnością pozostaje strona główna.
 *
 * ==================== GÓRA STRONY JEST STAŁA I NIEUSUWALNA (ADR-189) ====================
 *
 * Sekcja „above the fold" — galeria, dane sprzętu i część transakcyjna — jest
 * w obu gałęziach TYM SAMYM komponentem (`ProductDetail`) i stoi PIERWSZA.
 * Treść z kreatora renderuje się POD nią.
 *
 * Do ADR-189 gałąź szablonu zaczynała się od treści najemcy, a widget
 * rezerwacji dostawała pod spodem (ADR-180, decyzja 2). Uzasadnienie brzmiało:
 * szablon jest tym, czym najemca sprzedaje, widget tym, czym klient kupuje po
 * decyzji. Było SPRZECZNE z ustaleniem właściciela sprzed fazy 5 — góra strony
 * sprzętu ma być nieusuwalna i wyglądać jak dotąd, czyli galeria, dane i część
 * transakcyjna widoczne bez przewijania. Publikacja szablonu przestawała więc
 * być zmianą wyglądu strony i stawała się zmianą tego, CO klient najemcy widzi
 * jako pierwsze; na produkcji wyszło to jako utrata układu, nie jako nowa
 * funkcja. Wymóg ADR-180 („rezerwacja jest w obu gałęziach") zostaje w mocy
 * i jest po tej zmianie spełniony MOCNIEJ: widget siedzi WEWNĄTRZ bloku,
 * którego gałąź szablonu nie omija.
 *
 * Część transakcyjna (kalendarz z dostępnością, ilość, koszyk) pozostaje JEDNYM
 * nierozmontowywalnym widgetem (`ProductBooking`, faza 5, ADR-180). Miejsce
 * jest STAŁE — przesuwanie widgetu przez najemcę wymagałoby własnego typu
 * sekcji i jest świadomie POZA tym etapem (ADR-189, decyzja właściciela
 * z 2026-08-17 zawężająca rekomendację „przesuwalna jako całość").
 *
 * POWTÓRZENIE TREŚCI JEST DOPUSZCZALNE I ŚWIADOME. Najemca, który pod stałym
 * blokiem zbuduje sekcję z opisem pozycji, zobaczy opis dwa razy. Logiki
 * wygaszającej opis albo specyfikację w stałym bloku „gdy szablon je ma" tu
 * NIE MA: byłaby ukrytym nadpisaniem per instancja, a poza alternatywnym
 * szablonem architektura per-instancji świadomie nie dopuszcza. Najemca
 * projektuje to, co poniżej, i sam decyduje, czy powtarza.
 *
 * METADANE I JSON-LD OPISUJĄ SPRZĘT W OBU GAŁĘZIACH. Szablon jest sposobem
 * pokazania pozycji, a nie osobnym dokumentem: tytuł, opis i `Product` +
 * `Offer` liczą się z katalogu, tak samo jak przed fazą 5. Gdyby szły
 * z szablonu, wszystkie strony sprzętu najemcy miałyby jeden tytuł.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

import { HOME_PAGE_SLUG, pagePathFromSlug } from "@avably/core/site";
import { SiteRenderer } from "@avably/ui";

import { JsonLd } from "@/components/storefront/json-ld";
import { ProductBooking } from "@/components/storefront/product-booking";
import { ProductDetail } from "@/components/storefront/product-detail";
import { PageShell } from "@/components/storefront/page-shell";
import { StoreChrome } from "@/components/storefront/store-chrome";
import { productPath } from "@/lib/catalog/product-path";
import { toProductDetail } from "@/lib/catalog/present";
import type { PublicCatalogProduct } from "@/lib/checkout/contract";
import { productJsonLd } from "@/lib/seo/jsonld";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { pageSections, withDemotedHeadings } from "@/lib/site/page-sections";
import { getPublishedProductTemplate } from "@/lib/site/published";
import { siteImageBaseUrl } from "@/lib/site/image-base";
import { buildSiteRenderSeam } from "@/lib/site/render-seam";
import { storeLogo } from "@/lib/site/store-logo";
import { format } from "@/lib/storefront/copy";
import type { ProductPageContext } from "@/lib/storefront/context";

/**
 * Tytuł = nazwa produktu + nazwa sklepu; opis = opis produktu z katalogu
 * publicznego, a gdy go nie ma — neutralne zdanie w locale tenanta.
 *
 * KANON LICZY SIĘ Z REJESTRU ADRESÓW, nie ze ścieżki, pod którą przyszło
 * żądanie. Bez tego trasa zastana (`/product/{uuid}`) w chwili, w której nie
 * zna sluga, zgłaszałaby siebie jako kanon — czyli dokładnie ten duplikat
 * kanoniczny, przed którym broni `productPath`.
 *
 * SZABLONU TA FUNKCJA NIE CZYTA I NIE MA CZYTAĆ — patrz nagłówek pliku.
 * Odczyt szablonu byłby tu drugą podróżą do bazy po daną, która na tytuł
 * i tak nie ma wpływu.
 */
export async function productPageMetadata(
  ctx: ProductPageContext,
  product: PublicCatalogProduct,
): Promise<Metadata> {
  const storeName = ctx.catalog.tenant.name;

  return tenantMetadata({
    title: pageTitle(storeName, product.name),
    description:
      product.description ??
      format(ctx.copy.seo.productDescription, { product: product.name, store: storeName }),
    storeName,
    published: ctx.site !== null,
    origin: await tenantOrigin(),
    pathname: productPath(ctx.productSlugs, product.id),
    locale: ctx.locale,
  });
}

/**
 * Render strony sprzętu — wspólny dla `/produkt/{slug}` i `/product/{uuid}`.
 *
 * FUNKCJA WOŁANA PRZEZ TRASĘ, nie komponent wstawiany w jej drzewo. Różnica
 * jest widoczna dopiero na krawędzi: element `<ProductPageView …/>` byłby
 * ASYNCHRONICZNYM komponentem w środku drzewa, więc trasa oddawałaby drzewo
 * jeszcze nierozwiązane. W produkcji Next by je dokończył, ale każdy render
 * synchroniczny (i tak mierzą ten ekran testy) zawiesiłby się na
 * „component suspended while responding to synchronous input". Wołanie
 * z `await` zostawia kontrakt trasy takim, jaki był przed wydzieleniem:
 * trasa oddaje drzewo GOTOWE.
 */
export async function renderProductPage({
  ctx,
  raw,
}: {
  ctx: ProductPageContext;
  raw: PublicCatalogProduct;
}) {
  const { catalog, copy, locale, currency, style, site, supabaseUrl } = ctx;

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
  //
  // ADRES W JSON-LD TO ADRES KANONICZNY (ADR-182): robot dostaje ten sam URL,
  // który stoi w `<link rel="canonical">` i w sitemapie. Adres zastany trafiłby
  // tu tylko wtedy, gdy rejestru nie znamy — i wtedy jest jedynym prawdziwym.
  const origin = await tenantOrigin();
  const productLd = origin
    ? productJsonLd({
        name: product.name,
        description: product.description,
        images: product.images.map((image) => image.url),
        url: `${origin}${productPath(ctx.productSlugs, raw.id)}`,
        currency,
        basePriceDayGrosze: raw.base_price_day_grosze,
      })
    : null;

  /*
    WIDGET REZERWACJI — JEDEN, DLA OBU GAŁĘZI (faza 5, ADR-180).

    Liczony PRZED rozgałęzieniem i przekazywany w dół, a nie wołany dwa razy
    w dwóch miejscach: „strona sprzętu ma czym rezerwować" ma być zdaniem
    o RENDERZE. Dwa wywołania obok siebie znaczyłyby, że gałąź szablonu może
    kiedyś dostać inne parametry niż wbudowana — albo nie dostać żadnych, bo
    ktoś dodał trzecią gałąź i nie zauważył.
  */
  const booking = (
    <ProductBooking
      productId={product.id}
      priceParams={product.priceParams}
      copy={copy}
      locale={locale}
      currency={currency}
    />
  );

  /*
    ROZSTRZYGANIE SZABLONU JEST W BAZIE (faza 6A, ADR-199): identyfikator
    pozycji spod adresu jedzie do funkcji odczytu, a ta oddaje żywy WYJĄTEK
    tego produktu, gdy istnieje — inaczej szablon-matkę. `null` dalej znaczy
    „strona wbudowana": trzeci szczebel drabiny zostaje tutaj, w rozgałęzieniu
    poniżej, i żaden wynik nie zdejmuje stałego bloku góry strony (ADR-189),
    bo ten stoi PRZED rozgałęzieniem.
  */
  const template = await getPublishedProductTemplate(ctx.tenantId, raw.id);

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
    const record = seam.products.find((item) => item.id === raw.id);

    return (
      <StoreChrome
        style={style}
        copy={copy}
        storeName={catalog.tenant.name}
        logo={storeLogo(ctx)}
        /* Stopka ze strony GŁÓWNEJ (ADR-154) — patrz nagłówek pliku. */
        site={site}
        siteImageBase={seam.siteImageBase}
        /* Ta trasa SPRZEDAJE — pasek terminu na niej stoi (faza 5, ADR-179). */
        term={{ products: catalog.products, locale }}
        /*
          Kotwice stopki prowadzą na stronę GŁÓWNĄ: strona sprzętu nie ma sekcji,
          do których stopka z presetu odsyła, więc czyste `#kontakt` nie robiłoby
          NIC — bez błędu i bez zmiany adresu (faza 0, ADR-154). Cel poprawiony
          w ADR-186: kotwica ma wskazywać stronę, na której sekcja NAPRAWDĘ stoi,
          a nie stałą adresu katalogu, która od fazy 4b prowadzi gdzie indziej.
        */
        footerAnchorBase={pagePathFromSlug(HOME_PAGE_SLUG)}
        revealNonce={revealNonce}
      >
        {productLd ? <JsonLd data={productLd} /> : null}
        <main>
          {/*
            STAŁY BLOK GÓRY STRONY — PIERWSZY W DOKUMENCIE (ADR-189).

            Ten sam komponent i ta sama szerokość kontenera, co na stronie
            wbudowanej (`PageShell` owija treść dokładnie tymi klasami), więc
            „jak poprzednio" znaczy dosłownie: ten sam blok w tym samym miejscu,
            niezależnie od tego, czy najemca opublikował szablon.

            NAGŁÓWEK DOKUMENTU JEST W TYM BLOKU. Widoczny `h1` z nazwą pozycji
            wnosi `ProductDetail`, więc atrapa dla czytnika ekranu
            (`<h1 className="sr-only">`), którą gałąź szablonu wystawiała, gdy
            szablon nie miał hero, straciła sens i ZNIKA — dokument ma tytuł
            zawsze, także przy szablonie opublikowanym pustym.
          */}
          <div className="mx-auto w-full max-w-5xl px-6 py-10">
            <ProductDetail product={product} copy={copy} booking={booking} />
          </div>
          {/*
            TREŚĆ Z KREATORA — POD stałym blokiem (ADR-189).

            `withDemotedHeadings` zdejmuje nagłówkom szablonu pierwszy poziom:
            tytuł dokumentu jest już wydany wyżej, a dwa `h1` na jednym ekranie
            to dwa konkurujące tytuły (zgłoszenie L-UX-01 z audytu właściciela).
            Przekształcenie jest CZYSTE i dotyczy WYŁĄCZNIE tej trasy — na
            stronie treściowej ta sama lista sekcji jest całym dokumentem i `h1`
            jest tam poprawny.
          */}
          <SiteRenderer
            sections={withDemotedHeadings(bodySections)}
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
    <PageShell
      style={style}
      copy={copy}
      storeName={catalog.tenant.name}
      site={site}
      logo={storeLogo(ctx)}
      siteImageBase={siteImageBaseUrl(ctx.supabaseUrl)}
      /* Ta trasa SPRZEDAJE — pasek terminu na niej stoi (faza 5, ADR-179). */
      term={{ products: catalog.products, locale }}
    >
      {productLd ? <JsonLd data={productLd} /> : null}
      <Link href="/store" className="site-link text-sm">
        {copy.common.backToCatalog}
      </Link>
      <div className="mt-6">
        <ProductDetail product={product} copy={copy} booking={booking} />
      </div>
    </PageShell>
  );
}
