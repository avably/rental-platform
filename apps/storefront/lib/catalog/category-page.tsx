/**
 * STRONA KATEGORII — render i metadane trasy `/kategoria/{slug}` (faza C,
 * ADR-247; odczyt z Fazy A, ADR-244/migracja 0101).
 *
 * ==================== CO TA STRONA POKAZUJE ====================
 *
 * JEDNĄ PÓŁKĘ oferty najemcy — pozycje przypisane do kategorii — w tym samym
 * szablonie i tym samym kaflem, co `/katalog`. Nie jest nową powierzchnią
 * projektową: nagłówek z opcjonalnym banerem i opisem, siatka bogatych kart
 * z dostępnością w wybranym terminie (ADR-180), przełącznik sortowania
 * i stronicowanie — wszystko w powłoce sklepu (`StoreChrome`).
 *
 * ==================== TRZY STANY ROZSTRZYGA TRASA, NIE TEN RENDER ====================
 *
 * Ten moduł dostaje kontekst WYŁĄCZNIE dla kategorii istniejącej
 * (`CategoryPageContext` niesie `category` niepuste). „Najemca poza oknem",
 * „slug nieznany" i „numer strony spoza zakresu" to trzy różne 404 rozstrzygane
 * w `loadCategoryPageContext` PRZED tym renderem. Tu zostaje jeden podział:
 * kategoria z pozycjami rysuje siatkę, kategoria pusta — zdanie „nie ma jeszcze
 * produktów" (`CategoryList`), a nie 404.
 *
 * ==================== TREŚĆ KATEGORII IDZIE DO WĘZŁÓW TEKSTOWYCH ====================
 *
 * Nazwa i opis kategorii pochodzą od najemcy i lądują na PUBLICZNEJ stronie,
 * więc renderują się jako dzieci Reacta (eskejpowane), NIGDY przez
 * `dangerouslySetInnerHTML`. Jedyny blok `dangerouslySetInnerHTML` to `JsonLd`,
 * a ten przepuszcza dane przez `serializeJsonLd` (ucieczka `<`,`>`,`&`) — to
 * blok DANYCH schema.org, nie renderowana treść.
 *
 * ==================== SEO ====================
 *
 * KANON JEST SELF-CANONICAL PER STRONA (lustro `/katalog`, ADR-186): strona
 * kategorii wskazuje kanonem SAMĄ SIEBIE (`categoryPagePath(slug, page)`), więc
 * oferta z dalszych stron nie jest chowana przed indeksem. Sort DOMYŚLNY i
 * strona pierwsza nie noszą parametrów, więc `?sort=` i `?strona=1` dalej
 * konsolidują się do adresu czystego — cztery porządki tej samej półki nie
 * stają się czterema adresami. `noindex` dostaje kategoria PUSTA (treść cienka)
 * i sklep bez opublikowanej strony głównej (spójnie z `robots.txt`, jak
 * katalog). BreadcrumbList (JSON-LD) niesie ścieżkę „Sklep > Kategoria".
 */
import type { Metadata } from "next";
import { headers } from "next/headers";

import { HOME_PAGE_SLUG, pagePathFromSlug } from "@avably/core/site";
import { siteStyles } from "@avably/ui";

import { CategoryList } from "@/components/storefront/category-list";
import { CategorySort } from "@/components/storefront/category-sort";
import {
  ListingCategoryColumn,
  ListingCategoryRow,
} from "@/components/storefront/listing-categories";
import { JsonLd } from "@/components/storefront/json-ld";
import { SITE_HEADING, StoreChrome } from "@/components/storefront/store-chrome";
import { categoryBasePath, categoryPagePath } from "@/lib/catalog/category-path";
import { catalogTileContent } from "@/lib/catalog/catalog-tiles";
import { breadcrumbListJsonLd } from "@/lib/seo/jsonld";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { buildSiteRenderSeam } from "@/lib/site/render-seam";
import { siteImageBaseUrl } from "@/lib/site/image-base";
import { storeLogo } from "@/lib/site/store-logo";
import { format, pluralCount } from "@/lib/storefront/copy";
import type { CategoryPageContext } from "@/lib/storefront/context";
import { storeTermInput } from "@/lib/storefront/term-input";

/**
 * Publiczny URL banera kategorii — z bucketa zdjęć sklepu (`site-images`, jak
 * hero/sekcje). `image_path` niesie ścieżkę WEWNĄTRZ bucketa (albo `null` —
 * brak banera). Bucket jest publiczny, więc URL składamy wprost, bez podpisu.
 * Kształt ścieżki ustali maszyneria uploadu banera (panel/Faza D) — ta funkcja
 * jest jedynym miejscem, w którym ścieżka zamienia się w adres.
 */
export function categoryBannerUrl(supabaseUrl: string, imagePath: string): string {
  const path = imagePath.replace(/^\/+/, "");
  return `${siteImageBaseUrl(supabaseUrl)}/${path}`;
}

export async function categoryPageMetadata(ctx: CategoryPageContext): Promise<Metadata> {
  const storeName = ctx.catalog.tenant.name;
  const { category } = ctx;

  const title =
    ctx.page > 1
      ? pageTitle(
          storeName,
          `${category.name} - ${format(ctx.copy.catalog.pageOf, {
            page: ctx.page,
            pages: ctx.pageCount,
          })}`,
        )
      : pageTitle(storeName, category.name);

  return tenantMetadata({
    title,
    description:
      category.description ??
      format(ctx.copy.seo.categoryDescription, { category: category.name, store: storeName }),
    storeName,
    /*
      KATEGORIA PUSTA i SKLEP BEZ OPUBLIKOWANEJ STRONY GŁÓWNEJ zostają poza
      indeksem — te same dwa warunki, co na `/katalog` (ADR-186): pusta półka to
      treść cienka, a `index` u najemcy z `robots.txt` = `Disallow: /` byłby
      obietnicą bez pokrycia.
    */
    published: ctx.site !== null && ctx.total > 0,
    origin: await tenantOrigin(),
    /*
      KANON = SAMA TA STRONA WYNIKÓW (self-canonical per strona), lustro
      `/katalog` (`catalogPagePath(ctx.page)`, ADR-186). Strona pierwsza nie nosi
      parametru, więc `?strona=1` i czysty adres schodzą się w jednym kanonie;
      strona 2+ jest kanonem samej siebie, żeby oferty z dalszych stron nie
      chować przed indeksem. Sort DOMYŚLNY też nie nosi parametru
      (`categoryPagePath`), więc `?sort=` dalej konsoliduje się do adresu bez
      sortu — cztery porządki tej samej półki nie stają się czterema adresami.
    */
    pathname: categoryPagePath(category.slug, ctx.page),
    locale: ctx.locale,
  });
}

export async function renderCategoryPage({ ctx }: { ctx: CategoryPageContext }) {
  const { catalog, category, copy, locale, style, site, sort } = ctx;
  const revealNonce = (await headers()).get("x-nonce") ?? undefined;
  const seam = buildSiteRenderSeam(ctx);
  const styles = siteStyles();

  // BreadcrumbList: „Sklep > Kategoria" — absolutny adres wymaga origin hosta
  // najemcy; bez niego (stan nieznanego hosta) po prostu nie ma bloku danych,
  // tak jak Product JSON-LD na stronie sprzętu.
  const origin = await tenantOrigin();
  const breadcrumbLd = origin
    ? breadcrumbListJsonLd([
        { name: copy.category.breadcrumbHome, url: `${origin}${pagePathFromSlug(HOME_PAGE_SLUG)}` },
        { name: category.name, url: `${origin}${categoryBasePath(category.slug)}` },
      ])
    : null;

  return (
    <StoreChrome
      style={style}
      copy={copy}
      storeName={catalog.tenant.name}
      logo={storeLogo(ctx)}
      site={site}
      // Kotwice stopki prowadzą na stronę GŁÓWNĄ — strona kategorii nie ma
      // sekcji, do których stopka presetu odsyła (jak katalog/strona sprzętu).
      footerAnchorBase={pagePathFromSlug(HOME_PAGE_SLUG)}
      // Ta trasa SPRZEDAJE (ADR-179): pasek terminu stoi, chyba że najemca
      // wyłączył pigułkę (ADR-203) — regułę trzyma `storeTermInput`. Kafle
      // dostają liczbę wolnych sztuk z tej samej, JEDNEJ odpowiedzi (ADR-180).
      term={storeTermInput(ctx.storeFlags, catalog.products, locale)}
      /*
        MENU KATEGORII (ADR-247/266) — te same wejścia, co na stronie głównej
        i katalogu; klient przeglądający JEDNĄ półkę nie traci drogi do
        pozostałych. Liczone po PEŁNYM katalogu, z guardem pustych — patrz
        `loadCategoryNav`.
      */
      categoryNav={ctx.categoryNav}
      /* Bieżąca półka (S-52/F7b): jej pozycja w rozwijanej liście belki
         i w kolumnie kategorii listingu dostaje aria-current. */
      currentPath={categoryBasePath(category.slug)}
      siteImageBase={seam.siteImageBase}
      revealNonce={revealNonce}
    >
      {breadcrumbLd ? <JsonLd data={breadcrumbLd} /> : null}
      {/*
        RYTM LISTINGU ≠ RYTM SEKCJI (F9b, uwaga właściciela 2026-08-25:
        „przestrzeń między menu a produktami — tragiczna"). `styles.section`
        (py-16/20) jest skalą SEKCJI MARKETINGOWYCH strony najemcy; listing to
        narzędzie — klient ma widzieć ofertę bez ekranu pustki. Zmierzony stan
        przed: 80 px luki pod nagłówkiem, 46 px do tytułu, 50 px do toolbara.
        Wzorzec benchmarku: okruszki tuż pod belką, tytuł i toolbar zwarte.
      */}
      <main className="pt-5 pb-16 @min-[40rem]/site:pt-6 @min-[40rem]/site:pb-20">
        <div className={styles.container}>
          {/*
            OKRUSZKI — widoczna ścieżka nawigacji plus jej odpowiednik w danych
            (BreadcrumbList wyżej). „Sklep" prowadzi na stronę główną, bieżąca
            kategoria jest ostatnia i NIE jest odnośnikiem do samej siebie.
          */}
          <nav data-category-breadcrumbs aria-label={copy.category.breadcrumbLabel} className="text-sm">
            <ol className="site-text-muted flex list-none flex-wrap items-center gap-2 p-0">
              <li>
                <a href={pagePathFromSlug(HOME_PAGE_SLUG)} className="site-link underline">
                  {copy.category.breadcrumbHome}
                </a>
              </li>
              <li aria-hidden="true">›</li>
              <li aria-current="page" className="site-text-accent">
                {category.name}
              </li>
            </ol>
          </nav>

          {/*
            SIATKA LISTINGU (F7b): kolumna kategorii + treść. Poniżej 64 rem
            kontenera kolumna znika, a jej rolę przejmuje przewijany rząd
            pastylek nad toolbarem — patrz `listing-categories.tsx`.
            `minmax(0,1fr)` na kolumnie treści: bez tego siatka wyników
            z długim tytułem rozpycha kolumnę ponad pas strony.
          */}
          <div className="mt-4 grid gap-x-8 gap-y-4 @min-[64rem]/site:grid-cols-[15rem_minmax(0,1fr)]">
            <ListingCategoryColumn
              items={ctx.categoryNav}
              heading={copy.nav.categories}
              allCategoriesLabel={copy.nav.allCategories}
              currentPath={categoryBasePath(category.slug)}
            />
            <div className="min-w-0">
              {/*
                NAGŁÓWEK KOMPAKTOWY (F9 + F9b). Licznik pozycji stoi w JEDNYM
                wierszu z h1 (wzorzec listingu elektromarketów: „Nazwa · N
                pozycji"), zamiast osobnego akapitu — nagłówek kończy się przed
                ofertą po ~3 wierszach, nie po ekranie.

                BEZ MINIATURY BANERA (F9b, uwaga właściciela 2026-08-25):
                miniatura 88 px po prawej stała ~660 px od tytułu i czytała się
                jak sierota, nie jak część nagłówka; benchmark nie kładzie
                w nagłówku kategorii ŻADNEJ grafiki. Baner z kreatora żyje na
                KAFLACH kategorii — tam pracuje, tu przeszkadzał.
              */}
              <header data-category-header>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    {/* Strona MUSI mieć dokładnie jeden h1 (WCAG 1.3.1 / 2.4.6). */}
                    <h1 className={`text-2xl @min-[40rem]/site:text-3xl ${SITE_HEADING}`}>
                      {category.name}
                    </h1>
                    <p data-category-count className="site-text-muted text-sm">
                      {"· "}
                      {pluralCount(ctx.total, locale, {
                        one: copy.catalog.countOne,
                        few: copy.catalog.countFew,
                        many: copy.catalog.countMany,
                      })}
                      {ctx.pageCount > 1
                        ? ` · ${format(copy.catalog.pageOf, { page: ctx.page, pages: ctx.pageCount })}`
                        : ""}
                    </p>
                  </div>
                  {category.description ? (
                    <p data-category-description className="site-text-muted mt-2 max-w-prose text-sm">
                      {category.description}
                    </p>
                  ) : null}
                </div>
              </header>

              {/*
                RZĄD KATEGORII NA WĄSKIM KONTENERZE (F7b) — nad toolbarem, bo
                wybór półki poprzedza wybór porządku. Powyżej 64 rem znika:
                tam tę samą listę niesie kolumna po lewej.
              */}
              <div className="mt-4">
                <ListingCategoryRow
                  items={ctx.categoryNav}
                  heading={copy.nav.categories}
                  allCategoriesLabel={copy.nav.allCategories}
                  currentPath={categoryBasePath(category.slug)}
                />
              </div>

              {/*
                TOOLBAR = SAM SORT (F9c): od F7 wyszukiwanie stoi w BELCE na
                każdej trasie — drugie pole pod tytułem kategorii było dublem
                (obserwacja wykonawcy F7, decyzja PM). SORT tylko gdy jest co
                sortować — na pustej kategorii toolbar nie renderuje się wcale.
              */}
              {ctx.total > 0 ? (
                <div data-listing-toolbar className="mt-4 flex justify-end">
                  <CategorySort copy={copy} slug={category.slug} active={sort} />
                </div>
              ) : null}

              <div className="mt-6">
                <CategoryList
                  products={seam.products}
                  labels={seam.labels}
                  content={catalogTileContent(site?.sections)}
                  styles={styles}
                  copy={copy}
                  slug={category.slug}
                  page={ctx.page}
                  pageCount={ctx.pageCount}
                  sort={sort}
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    </StoreChrome>
  );
}
