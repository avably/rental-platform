/**
 * STRONA KATALOGU — `/katalog` (faza 4b, ADR-186, migracja 0085).
 *
 * ==================== CZEGO NIE BYŁO ====================
 *
 * Pełnej listy katalogu nie było w produkcie. Sekcja `products` pokazuje
 * najwyżej 24 pozycje i odsyłała „do katalogu" pod `/store`, czyli pod
 * WEWNĘTRZNY adres strony głównej — na tę samą stronę, z której klient właśnie
 * kliknął. Przy 200 pozycjach 176 z nich nie miało ani jednego adresu, pod
 * którym da się je przejrzeć: ani dla klienta, ani dla wyszukiwarki.
 *
 * ==================== STRONICOWANIE JEST PO STRONIE SERWERA ====================
 *
 * Trasa pobiera JEDNĄ stronę wyników (`app.get_public_catalog_page`, 0085)
 * i oddaje do dokumentu wyłącznie jej kafle. Dwa odrzucone warianty:
 * pobranie całości i ukrycie reszty arkuszem (treść zostaje w kodzie strony:
 * waga i ryzyko zaindeksowania ukrytej listy) oraz doładowywanie
 * z JavaScriptu (jeden adres na całą listę — czyli katalog niewidoczny dla
 * wyszukiwarki). Adres każdej strony wyników jest pełnoprawnym adresem: da się
 * go wkleić, zaindeksować i wrócić do niego przyciskiem wstecz.
 *
 * ==================== NUMER STRONY SPOZA ZAKRESU TO 404 ====================
 *
 * `?strona=abc`, `?strona=0`, `?strona=01` i `?strona=99` przy dwóch stronach
 * katalogu dostają 404, a nie pierwszą stronę. Tolerancja robiłaby z KAŻDEGO
 * ciągu znaków prawidłowy adres tej samej treści, czyli wytwórnię duplikatów
 * kanonicznych. Jedyny wyjątek jest po drugiej stronie: strona PIERWSZA
 * renderuje się także dla katalogu pustego — „katalog w przygotowaniu" jest
 * treścią, którą trzeba pokazać pod adresem, do którego prowadzą linki najemcy.
 *
 * BRAMKA (jak reszta tras sklepu): `tenant_id` WYŁĄCZNIE z nagłówka
 * wstrzykniętego przez proxy (ADR-039). Brak = wejście spoza gałęzi tenanckiej
 * → notFound(). Odczyt `headers()` czyni render dynamicznym per żądanie
 * (konieczne pod CSP z nonce).
 */
import {
  CATALOG_PAGE_PARAM,
  CATALOG_PATH_SEGMENT,
  catalogPagePath,
  parseCatalogPageParam,
} from "@avably/core";
import { HOME_PAGE_SLUG, pagePathFromSlug } from "@avably/core/site";
import { siteStyles } from "@avably/ui";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { CatalogList } from "@/components/storefront/catalog-list";
import { SITE_HEADING, StoreChrome } from "@/components/storefront/store-chrome";
import { catalogTileContent } from "@/lib/catalog/catalog-tiles";
import { parseCatalogSearchQuery } from "@/lib/catalog/catalog-search";
import { buildSiteRenderSeam } from "@/lib/site/render-seam";
import { storeLogo } from "@/lib/site/store-logo";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { format, pluralCount } from "@/lib/storefront/copy";
import { loadCatalogPageContext } from "@/lib/storefront/context";
import { storeTermInput } from "@/lib/storefront/term-input";

export const dynamic = "force-dynamic";

/**
 * Parametry zapytania przychodzą jako `Promise` (Next 16). Wartość może być
 * tablicą — parametr powtórzony w adresie — i to jest jeden z powodów, dla
 * których rozstrzyga je `parseCatalogPageParam`, a nie `Number(...)` w miejscu
 * odczytu.
 */
interface Params {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Numer strony z adresu albo `null` — `null` znaczy „taki adres nie istnieje". */
async function zadanaStrona(searchParams: Params["searchParams"]): Promise<number | null> {
  const params = await searchParams;
  return parseCatalogPageParam(params[CATALOG_PAGE_PARAM]);
}

/** Znormalizowane zapytanie z `?q=` albo pusty łańcuch, gdy wyszukiwania nie ma (ADR-263). */
async function zadaneZapytanie(searchParams: Params["searchParams"]): Promise<string> {
  const params = await searchParams;
  return parseCatalogSearchQuery(params.q);
}

export async function generateMetadata({ searchParams }: Params): Promise<Metadata> {
  const page = await zadanaStrona(searchParams);
  if (page === null) return { robots: { index: false, follow: false } };

  const query = await zadaneZapytanie(searchParams);
  const resolution = await loadCatalogPageContext(page, query);
  if (resolution.kind !== "page") return { robots: { index: false, follow: false } };

  const { ctx } = resolution;
  const storeName = ctx.catalog.tenant.name;

  /*
    WIDOK WYNIKÓW WYSZUKIWANIA = NOINDEX (ADR-263). `?q=` to widok FILTROWANY —
    jak `?strona=` spoza zakresu i strony transakcyjne, nie ma go po co
    indeksować (nieograniczony zbiór zapytań = nieograniczony zbiór adresów
    cienkiej treści). Tytuł niesie frazę, żeby karta przeglądarki i historia
    rozróżniały wyniki; kanonu świadomie brak — strona noindex go nie potrzebuje,
    a wystawienie indeksowalnego alternatu przeczyłoby noindex.
  */
  if (ctx.query.length > 0) {
    return {
      title: pageTitle(storeName, format(ctx.copy.catalog.searchTitle, { query: ctx.query })),
      robots: { index: false, follow: false },
    };
  }

  const opis = format(ctx.copy.catalog.description, { store: storeName });

  return tenantMetadata({
    /*
      TYTUŁ NIESIE NUMER STRONY OD DRUGIEJ W GÓRĘ. Wszystkie strony wyników
      pod jednym tytułem to dla wyszukiwarki N wyników o tej samej nazwie —
      a dla klienta w zakładkach przeglądarki N nierozróżnialnych kart.
    */
    title:
      ctx.page > 1
        ? pageTitle(storeName, `${ctx.copy.catalog.title} - ${format(ctx.copy.catalog.pageOf, { page: ctx.page, pages: ctx.pageCount })}`)
        : pageTitle(storeName, ctx.copy.catalog.title),
    description: opis,
    storeName,
    /*
      DWA WARUNKI, OBA KONIECZNE — i drugi jest tu po to, żeby metadane nie
      obiecywały czegoś, czemu zaprzecza `robots.txt` TEGO SAMEGO hosta.

      (a) KATALOG PUSTY nie ma treści do zaindeksowania: „katalog
          w przygotowaniu" jest identyczne u każdego najemcy, czyli dokładnie ta
          treść cienka i zdublowana, przed którą broni ADR-044.
      (b) SKLEP BEZ OPUBLIKOWANEJ STRONY GŁÓWNEJ jest dla robota zamknięty
          W CAŁOŚCI: `app/robots.txt` oddaje wtedy `Disallow: /`, a mapa strony
          — 404. `index` w metadanych byłby w tym stanie obietnicą bez pokrycia,
          a rozjazd między dwiema deklaracjami tej samej rzeczy to defekt, który
          się później ściga.
    */
    published: ctx.site !== null && ctx.total > 0,
    origin: await tenantOrigin(),
    /*
      KANON WSKAZUJE TĘ SAMĄ STRONĘ WYNIKÓW, a nie `/katalog`. Kanon strony 2
      wskazujący na stronę 1 mówi wyszukiwarce, że pozycji ze strony 2 nie ma
      po co indeksować — czyli chowa ofertę, którą ta trasa właśnie odsłania.
      Strona pierwsza nie nosi parametru (`catalogPagePath`), więc
      `?strona=1` i `/katalog` schodzą się w jednym adresie kanonicznym.
    */
    pathname: catalogPagePath(ctx.page),
    locale: ctx.locale,
  });
}

export default async function TenantCatalogPage({ searchParams }: Params) {
  const page = await zadanaStrona(searchParams);
  const query = await zadaneZapytanie(searchParams);
  const revealNonce = (await headers()).get("x-nonce") ?? undefined;
  if (page === null) notFound();

  const resolution = await loadCatalogPageContext(page, query);
  if (resolution.kind !== "page") notFound();

  const { ctx } = resolution;
  const { catalog, copy, locale, style, site } = ctx;
  const seam = buildSiteRenderSeam(ctx);
  // Odstęp sekcji i kontener czytelności BIORĄ SIĘ Z SZABLONU, nie z klas
  // wpisanych tutaj: katalog ma stać w tym samym rytmie, co sekcje strony
  // najemcy, także po zmianie szablonu (K5, ADR-090).
  const styles = siteStyles();

  return (
    <StoreChrome
      style={style}
      copy={copy}
      storeName={catalog.tenant.name}
      logo={storeLogo(ctx)}
      /*
        STOPKA ZE STRONY GŁÓWNEJ, a jej kotwice przepisane na adres strony
        głównej: `#kontakt` w stopce prowadzi do sekcji, która stoi TAM, więc
        na katalogu musi być adresem bezwzględnym. Bez tego klient klika
        i nie dzieje się NIC (faza 0, ADR-154).
      */
      site={site}
      footerAnchorBase={pagePathFromSlug(HOME_PAGE_SLUG)}
      /*
        TERMIN NAJMU W POWŁOCE (faza 5, ADR-179) — ta trasa SPRZEDAJE, więc
        pasek terminu na niej stoi, chyba że najemca wyłączył pigułkę
        (ADR-203: regułę trzyma `storeTermInput`), a kafle dostają liczbę wolnych sztuk z tej
        samej, JEDNEJ odpowiedzi o dostępność (ADR-180). Panel konfliktu nazywa
        po imieniu pozycje TEJ strony wyników — cena przyjęta świadomie, ta sama
        co na stronie sprzętu (ADR-185).
      */
      term={storeTermInput(ctx.storeFlags, catalog.products, locale)}
      /*
        MENU KATEGORII (ADR-247/266) — te same wejścia, co na stronie głównej,
        żeby nawigacja między półkami nie znikała, gdy klient zaczyna przeglądać
        katalog. Liczone po PEŁNYM katalogu (nie po tej stronie wyników) i
        z guardem pustych — patrz `loadCategoryNav`.
      */
      categoryNav={ctx.categoryNav}
      /* Trasa KATALOGOWA (F7): pełne pole szukania, listwa + chipsy mobilne. */
      headerMode="catalog"
      searchQuery={ctx.query}
      /* Bieżąca strona (S-52/F7): „Cały katalog" w listwie dostaje aria-current. */
      currentPath={`/${CATALOG_PATH_SEGMENT}`}
      siteImageBase={seam.siteImageBase}
      revealNonce={revealNonce}
    >
      {/*
        RYTM LISTINGU ≠ RYTM SEKCJI (F9b/F7, uwaga właściciela 2026-08-25:
        „przestrzeń między menu a produktami — tragiczna"). `styles.section`
        (py-16/20) jest skalą SEKCJI MARKETINGOWYCH strony najemcy; listing to
        narzędzie — pod przyklejoną belką z listwą kategorii (F7) tytuł ma
        stać tuż pod chrome, nie za ekranem pustki. Lustro strony kategorii
        (tam pomiar i wzorzec — patrz `category-page.tsx`).
      */}
      <main className="pt-5 pb-16 @min-[40rem]/site:pt-6 @min-[40rem]/site:pb-20">
        <div className={styles.container}>
          {/*
            NAGŁÓWEK KOMPAKTOWY (F9) — licznik pozycji w JEDNYM wierszu z h1
            (lustro strony kategorii), zamiast osobnego akapitu między polem
            szukania a siatką. Przy aktywnym wyszukiwaniu wiersz niesie liczbę
            wyników z frazą; przy PUSTYM wyniku licznika nie ma wcale, bo tę
            samą informację mówi pełnym zdaniem komunikat pod toolbarem.
          */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {/* Strona MUSI mieć dokładnie jeden h1 (WCAG 1.3.1 / 2.4.6). */}
            <h1 className={`text-2xl @min-[40rem]/site:text-3xl ${SITE_HEADING}`}>
              {copy.catalog.heading}
            </h1>
            {ctx.query.length > 0 && ctx.total === 0 ? null : (
              <p data-catalog-count className="site-text-muted text-sm">
                {"· "}
                {ctx.query.length > 0 ? (
                  <>
                    {format(copy.catalog.searchResults, { total: ctx.total, query: ctx.query })}
                    {" · "}
                    <a data-catalog-search-clear href={`/${CATALOG_PATH_SEGMENT}`} className="site-link underline">
                      {copy.catalog.searchClear}
                    </a>
                  </>
                ) : (
                  pluralCount(ctx.total, locale, {
                      one: copy.catalog.countOne,
                      few: copy.catalog.countFew,
                      many: copy.catalog.countMany,
                    })
                )}
                {ctx.pageCount > 1
                  ? ` · ${format(copy.catalog.pageOf, { page: ctx.page, pages: ctx.pageCount })}`
                  : ""}
              </p>
            )}
          </div>

          {/*
            BEZ TOOLBARA WYSZUKIWANIA (F9c): od F7 pole wyszukiwania stoi
            w BELCE na każdej trasie i na `/katalog` dostaje bieżącą frazę
            (`searchQuery` wyżej) — drugie pole pod tytułem było czystym
            dublem. Katalog nie ma też przełącznika sortowania, bo
            `get_public_catalog_page` nie przyjmuje porządku — select bez
            skutku byłby kontrolką-atrapą (stan odnotowany w F9). „Wyczyść"
            mieszka przy liczniku wyników i w stanie pustym.
          */}

          {ctx.query.length > 0 && ctx.total === 0 ? (
            /*
              STAN PUSTY WYSZUKIWANIA — inny komunikat niż katalog pusty: tu
              oferta ISTNIEJE, tylko nic nie pasuje do frazy. Pole wyżej zostaje,
              żeby klient mógł zawęzić inaczej albo wyczyścić.
            */
            <p data-catalog-search-empty className="site-text-muted mt-6">
              {format(copy.catalog.searchEmpty, { query: ctx.query })}{" "}
              <a data-catalog-search-clear href={`/${CATALOG_PATH_SEGMENT}`} className="site-link underline">
                {copy.catalog.searchClear}
              </a>
            </p>
          ) : (
            <>
              {/* `mt-6` — zwarty rytm listingu (F9b), lustro strony kategorii. */}
              <div className="mt-6">
                <CatalogList
                  products={seam.products}
                  content={catalogTileContent(site?.sections)}
                  styles={styles}
                  labels={seam.labels}
                  copy={copy}
                  page={ctx.page}
                  pageCount={ctx.pageCount}
                  searchQuery={ctx.query}
                />
              </div>
            </>
          )}
        </div>
      </main>
    </StoreChrome>
  );
}
