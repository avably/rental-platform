/**
 * sitemap.xml PER HOST (Zadanie 2.7, ADR-044).
 *
 * Trasa plikowa NIE przechodzi przez middleware (matcher proxy wyklucza ścieżki
 * z rozszerzeniem), więc rozgałęzia się po hoście sama — `resolveHostBranch`,
 * ta sama klasyfikacja i to samo rozwiązanie slug→tenant_id co ADR-039.
 *
 *   tenant z opublikowaną stroną → katalog + podstrony produktów z katalogu
 *                                  publicznego, adresy na HOŚCIE TENANTA,
 *   tenant bez opublikowanej strony → 404 (nie ma czego indeksować; ta sama
 *                                  decyzja co `noindex` w metadanych),
 *   kanon marketingowy            → strony PUBLICZNE (ADR-068) w OBU locale,
 *   nieznany/nieaktywny host      → neutralne 404 (nieodróżnialne od braku).
 *
 * Koszyk i checkout NIE wchodzą do sitemapy — to strony transakcyjne bez
 * treści (robots.txt wyklucza je jawnie).
 */
import { HOME_PAGE_SLUG, pagePathFromSlug } from "@avably/core/site";

import { routing } from "@/i18n/routing";
import { PUBLIC_PAGES } from "@/lib/marketing/template";
import { productPath } from "@/lib/catalog/product-path";
import { getPublicCatalog, getPublicProductSlugs } from "@/lib/checkout/catalog";
import { getPlatformTerms } from "@/lib/legal/platform-terms";
import { getPublishedLegalDocuments, LEGAL_DOCUMENT_PATHS } from "@/lib/legal/published";
import { resolveHostBranch } from "@/lib/seo/host-branch";
import { marketingOrigin, originFromHost } from "@/lib/seo/origin";
import { renderSitemap, type SitemapEntry } from "@/lib/seo/sitemap";
import { getPublishedSite } from "@/lib/site/published";
import { getCachedTenantPages, lookupTenantPages, resolveTenantPages } from "@/lib/tenant/pages";
import { setCachedTenantPages } from "@/lib/tenant/pages";

export const dynamic = "force-dynamic";

const XML_HEADERS = {
  "content-type": "application/xml; charset=utf-8",
  // Sitemapa zmienia się razem z katalogiem — krótki cache, rewalidacja w tle.
  "cache-control": "public, max-age=300, stale-while-revalidate=600",
};

function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto");
  const branch = await resolveHostBranch(host);

  if (branch.kind === "not-found") return notFound();

  if (branch.kind === "marketing") {
    const origin = marketingOrigin(host, proto);
    // Wyłącznie strony PUBLICZNE (ADR-068). Wariantów przeglądowych układu już
    // nie ma — zniknęły z repo przy odsłonięciu LP (ADR-128), więc `PUBLIC_PAGES`
    // i zbiór stron marketingowych to dziś ten sam zbiór — z JEDNYM wyjątkiem:
    // `terms` (0070, ADR-141) wchodzi do sitemapy dopiero, gdy jakaś wersja
    // regulaminu platformy faktycznie OBOWIĄZUJE. Do migracji-seedu z treścią
    // od prawnika trasa odpowiada 404, a sitemapa wskazująca 404 byłaby
    // kłamstwem wobec robotów (ta sama zasada co „strona bez treści nie ma
    // prawa być osiągalna", I-03).
    const platformTerms = await getPlatformTerms();
    const pages = PUBLIC_PAGES.filter((page) => page !== "terms" || platformTerms !== null);
    const entries: SitemapEntry[] = routing.locales.flatMap((locale) =>
      pages.map((page) => ({
        loc: page === "home" ? `${origin}/${locale}` : `${origin}/${locale}/${page}`,
      })),
    );
    return new Response(renderSitemap(entries), { headers: XML_HEADERS });
  }

  // --- Gałąź tenancka ---------------------------------------------------
  const origin = originFromHost(host, proto);
  if (!origin) return notFound();

  const [catalog, site, legalDocuments, pages, productSlugs] = await Promise.all([
    getPublicCatalog(branch.tenantId),
    getPublishedSite(branch.tenantId),
    getPublishedLegalDocuments(branch.tenantId),
    resolveTenantPages(branch.tenantId, {
      getCache: getCachedTenantPages,
      setCache: setCachedTenantPages,
      lookup: lookupTenantPages,
    }),
    getPublicProductSlugs(branch.tenantId),
  ]);

  // Brak katalogu = tenant nieosiągalny publicznie (fail-closed jak kontekst
  // renderu). Brak opublikowanej strony = sklep w budowie — nie indeksujemy.
  if (!catalog || !site) return notFound();

  /*
   * STRONY NAJEMCY (Faza 2, ADR-158) — z REJESTRU ADRESÓW, nie z listy
   * wyliczonej w kodzie. Adres liczy `pagePathFromSlug`, czyli ta sama funkcja,
   * którą liczą kanon i przycisk „zobacz stronę" w panelu: sitemapa wskazująca
   * `/store` zamiast `/` zgłaszałaby wyszukiwarce adres WEWNĘTRZNY, spod
   * którego kanon i tak odsyła gdzie indziej.
   *
   * Strona główna wchodzi ZAWSZE (`site` niżej jest warunkiem wejścia
   * w tę gałąź), a rejestr dokłada resztę. Brak rejestru (awaria odczytu) nie
   * może zdjąć sklepu z indeksu, więc degraduje się do samej strony głównej.
   */
  const pageSlugs =
    pages?.pages && pages.pages.length > 0 ? pages.pages : [HOME_PAGE_SLUG];

  const entries: SitemapEntry[] = [
    ...pageSlugs.map((slug) => ({
      loc: `${origin}${pagePathFromSlug(slug)}`,
      // `lastmod` z publikacji mamy dla strony GŁÓWNEJ; podstrony wchodzą bez
      // niego, bo rejestr celowo nie niesie identyfikatorów ani dat — to jest
      // koperta dla proxy, a nie drugi odczyt strony.
      ...(slug === HOME_PAGE_SLUG ? { lastmod: site.publishedAt } : {}),
    })),
    /*
     * STRONY SPRZĘTU POD ADRESEM KANONICZNYM (ADR-182) — `/produkt/{slug}`,
     * liczonym tą samą funkcją, którą liczy kanon strony i link na kaflu.
     * Sitemapa wskazująca `/product/{uuid}` zgłaszałaby wyszukiwarce adres,
     * spod którego sama trasa odsyła 308 gdzie indziej — czyli prosiłaby
     * o zaindeksowanie przekierowania zamiast strony.
     *
     * Brak rejestru (awaria odczytu) degraduje do adresu ZASTANEGO, a nie do
     * pustej sekcji: sklep bez pozycji w mapie strony jest gorszy niż sklep
     * z adresami, spod których stoi 308.
     */
    ...catalog.products.map((product) => ({
      loc: `${origin}${productPath(productSlugs, product.id)}`,
    })),
    // Dokumenty prawne WARUNKOWO (B4, ADR-129) — tylko te faktycznie
    // opublikowane, z `lastmod` z chwili publikacji. Wpis bezwarunkowy
    // zgłaszałby wyszukiwarce adres, który sam oddaje 404, a najemca bez
    // regulaminu jest po tej migracji stanem NORMALNYM, nie awarią.
    // Permalinki wersji archiwalnych do sitemapy NIE wchodzą: mają służyć
    // konkretnemu klientowi z konkretnym zamówieniem, a nie konkurować
    // w wynikach z wersją obowiązującą (stąd też ich `noindex`).
    ...legalDocuments.map((document) => ({
      loc: `${origin}${LEGAL_DOCUMENT_PATHS[document.kind]}`,
      lastmod: document.published_at,
    })),
  ];

  return new Response(renderSitemap(entries), { headers: XML_HEADERS });
}
