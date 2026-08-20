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
import { CATALOG_PAGE_PARAM, catalogPagePath, parseCatalogPageParam } from "@avably/core";
import { HOME_PAGE_SLUG, pagePathFromSlug } from "@avably/core/site";
import { siteStyles } from "@avably/ui";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { CatalogList } from "@/components/storefront/catalog-list";
import { SITE_HEADING, StoreChrome } from "@/components/storefront/store-chrome";
import { catalogTileContent } from "@/lib/catalog/catalog-tiles";
import { buildSiteRenderSeam } from "@/lib/site/render-seam";
import { storeLogo } from "@/lib/site/store-logo";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { format } from "@/lib/storefront/copy";
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

export async function generateMetadata({ searchParams }: Params): Promise<Metadata> {
  const page = await zadanaStrona(searchParams);
  if (page === null) return { robots: { index: false, follow: false } };

  const resolution = await loadCatalogPageContext(page);
  if (resolution.kind !== "page") return { robots: { index: false, follow: false } };

  const { ctx } = resolution;
  const storeName = ctx.catalog.tenant.name;
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
  const revealNonce = (await headers()).get("x-nonce") ?? undefined;
  if (page === null) notFound();

  const resolution = await loadCatalogPageContext(page);
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
      siteImageBase={seam.siteImageBase}
      revealNonce={revealNonce}
    >
      <main className={styles.section}>
        <div className={styles.container}>
          {/* Strona MUSI mieć dokładnie jeden h1 (WCAG 1.3.1 / 2.4.6). */}
          <h1 className={`text-3xl ${SITE_HEADING}`}>{copy.catalog.heading}</h1>
          <p className="site-text-muted mt-2">
            {format(copy.catalog.total, { total: ctx.total })}
            {ctx.pageCount > 1
              ? ` · ${format(copy.catalog.pageOf, { page: ctx.page, pages: ctx.pageCount })}`
              : ""}
          </p>
          <CatalogList
            products={seam.products}
            content={catalogTileContent(site?.sections)}
            styles={styles}
            labels={seam.labels}
            copy={copy}
            page={ctx.page}
            pageCount={ctx.pageCount}
          />
        </div>
      </main>
    </StoreChrome>
  );
}
