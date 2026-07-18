/**
 * robots.txt PER HOST (Zadanie 2.7, ADR-044). Rozgałęzienie jak w sitemapie —
 * trasa plikowa omija middleware, więc host rozstrzyga sama.
 *
 *   tenant z opublikowaną stroną  → Allow: / + zakaz /cart i /checkout,
 *                                   link do sitemapy na hoście tenanta,
 *   tenant bez opublikowanej strony → Disallow: / („sklep w budowie”, ta sama
 *                                   decyzja co `noindex` w metadanych — patrz
 *                                   lib/seo/tenant-metadata.ts),
 *   kanon marketingowy            → Allow: / + sitemapa kanonu,
 *   nieznany/nieaktywny host      → neutralne 404 (spójnie z ADR-039).
 */
import { getPublicCatalog } from "@/lib/checkout/catalog";
import { resolveHostBranch } from "@/lib/seo/host-branch";
import { marketingOrigin, originFromHost } from "@/lib/seo/origin";
import { renderRobots } from "@/lib/seo/sitemap";
import { getPublishedSite } from "@/lib/site/published";

export const dynamic = "force-dynamic";

/** Ścieżki transakcyjne — bez treści do zaindeksowania. */
const TRANSACTIONAL_PATHS = ["/cart", "/checkout"];

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
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
    return new Response(
      renderRobots({ allow: true, sitemapUrl: `${origin}/sitemap.xml` }),
      { headers: TEXT_HEADERS },
    );
  }

  // --- Gałąź tenancka ---------------------------------------------------
  const origin = originFromHost(host, proto);
  if (!origin) return notFound();

  const [catalog, site] = await Promise.all([
    getPublicCatalog(branch.tenantId),
    getPublishedSite(branch.tenantId),
  ]);

  // Sklep bez opublikowanej strony (albo nieosiągalny publicznie) — pełny zakaz.
  if (!catalog || !site) {
    return new Response(renderRobots({ allow: false }), { headers: TEXT_HEADERS });
  }

  return new Response(
    renderRobots({
      allow: true,
      disallow: TRANSACTIONAL_PATHS,
      sitemapUrl: `${origin}/sitemap.xml`,
    }),
    { headers: TEXT_HEADERS },
  );
}
