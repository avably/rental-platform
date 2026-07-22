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
import { routing } from "@/i18n/routing";
import { PUBLIC_PAGES } from "@/lib/marketing/template";
import { getPublicCatalog } from "@/lib/checkout/catalog";
import { resolveHostBranch } from "@/lib/seo/host-branch";
import { marketingOrigin, originFromHost } from "@/lib/seo/origin";
import { renderSitemap, type SitemapEntry } from "@/lib/seo/sitemap";
import { getPublishedSite } from "@/lib/site/published";

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
    // Wyłącznie strony PUBLICZNE (ADR-068): warianty przeglądowe mają noindex
    // i istnieją tylko po to, żeby właściciel wybrał układ.
    const entries: SitemapEntry[] = routing.locales.flatMap((locale) =>
      PUBLIC_PAGES.map((page) => ({
        loc: page === "home" ? `${origin}/${locale}` : `${origin}/${locale}/${page}`,
      })),
    );
    return new Response(renderSitemap(entries), { headers: XML_HEADERS });
  }

  // --- Gałąź tenancka ---------------------------------------------------
  const origin = originFromHost(host, proto);
  if (!origin) return notFound();

  const [catalog, site] = await Promise.all([
    getPublicCatalog(branch.tenantId),
    getPublishedSite(branch.tenantId),
  ]);

  // Brak katalogu = tenant nieosiągalny publicznie (fail-closed jak kontekst
  // renderu). Brak opublikowanej strony = sklep w budowie — nie indeksujemy.
  if (!catalog || !site) return notFound();

  const entries: SitemapEntry[] = [
    { loc: `${origin}/store`, lastmod: site.publishedAt },
    ...catalog.products.map((product) => ({ loc: `${origin}/product/${product.id}` })),
  ];

  return new Response(renderSitemap(entries), { headers: XML_HEADERS });
}
