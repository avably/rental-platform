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
 * KANON CELUJE W CZYSTĄ STRONĘ KATEGORII (`/kategoria/{slug}`) niezależnie od
 * sortu i numeru strony: warianty `?sort=`/`?strona=` konsolidują się do niej,
 * więc nie stają się osobno indeksowanymi adresami tej samej półki. `noindex`
 * dostaje kategoria PUSTA (treść cienka) i sklep bez opublikowanej strony
 * głównej (spójnie z `robots.txt`, jak katalog). BreadcrumbList (JSON-LD)
 * niesie ścieżkę „Sklep > Kategoria".
 */
import type { Metadata } from "next";
import { headers } from "next/headers";

import { HOME_PAGE_SLUG, pagePathFromSlug } from "@avably/core/site";
import { siteStyles } from "@avably/ui";

import { CategoryList } from "@/components/storefront/category-list";
import { CategorySort } from "@/components/storefront/category-sort";
import { JsonLd } from "@/components/storefront/json-ld";
import { SITE_HEADING, StoreChrome } from "@/components/storefront/store-chrome";
import { categoryBasePath } from "@/lib/catalog/category-path";
import { catalogTileContent } from "@/lib/catalog/catalog-tiles";
import { breadcrumbListJsonLd } from "@/lib/seo/jsonld";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { buildSiteRenderSeam } from "@/lib/site/render-seam";
import { siteImageBaseUrl } from "@/lib/site/image-base";
import { storeLogo } from "@/lib/site/store-logo";
import { format } from "@/lib/storefront/copy";
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
      KANON = CZYSTA STRONA KATEGORII. Numer strony i sort idą przez query i NIE
      są indeksowane osobno — kanon konsoliduje je do jednego adresu półki.
    */
    pathname: categoryBasePath(category.slug),
    locale: ctx.locale,
  });
}

export async function renderCategoryPage({ ctx }: { ctx: CategoryPageContext }) {
  const { catalog, category, copy, locale, style, site, sort } = ctx;
  const revealNonce = (await headers()).get("x-nonce") ?? undefined;
  const seam = buildSiteRenderSeam(ctx);
  const styles = siteStyles();

  const bannerUrl = category.image_path
    ? categoryBannerUrl(ctx.supabaseUrl, category.image_path)
    : null;

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
      siteImageBase={seam.siteImageBase}
      revealNonce={revealNonce}
    >
      {breadcrumbLd ? <JsonLd data={breadcrumbLd} /> : null}
      <main className={styles.section}>
        <div className={styles.container}>
          {/*
            OKRUSZKI — widoczna ścieżka nawigacji plus jej odpowiednik w danych
            (BreadcrumbList wyżej). „Sklep" prowadzi na stronę główną, bieżąca
            kategoria jest ostatnia i NIE jest odnośnikiem do samej siebie.
          */}
          <nav data-category-breadcrumbs aria-label={copy.category.breadcrumbHome} className="text-sm">
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

          {bannerUrl ? (
            <img
              data-category-banner
              src={bannerUrl}
              alt={category.name}
              className="mt-4 h-auto w-full rounded-lg object-cover"
            />
          ) : null}

          {/* Strona MUSI mieć dokładnie jeden h1 (WCAG 1.3.1 / 2.4.6). */}
          <h1 className={`mt-4 text-3xl ${SITE_HEADING}`}>{category.name}</h1>
          <p className="site-text-muted mt-2">
            {format(copy.category.total, { total: ctx.total })}
            {ctx.pageCount > 1
              ? ` · ${format(copy.catalog.pageOf, { page: ctx.page, pages: ctx.pageCount })}`
              : ""}
          </p>

          {category.description ? (
            <p data-category-description className="site-text-muted mt-4 max-w-2xl">
              {category.description}
            </p>
          ) : null}

          {/*
            SORT tylko gdy jest co sortować — na pustej kategorii przełącznik
            czterech porządków tej samej pustki jest szumem, nie funkcją.
          */}
          {ctx.total > 0 ? <CategorySort copy={copy} slug={category.slug} active={sort} /> : null}

          <div className="mt-8">
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
      </main>
    </StoreChrome>
  );
}
