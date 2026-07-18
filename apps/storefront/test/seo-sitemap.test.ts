/**
 * Serializacja sitemap/robots + rozgałęzienie po hoście dla tras plikowych
 * (Zadanie 2.7, ADR-044).
 *
 * Rozwiązywanie tenanta jest WSTRZYKIWANE, więc granica tenant / marketing /
 * 404 jest testowana bez sieci i bez bazy (wzorzec ProxyDeps).
 */
import { describe, expect, it } from "vitest";

import { resolveHostBranch } from "@/lib/seo/host-branch";
import { escapeXml, renderRobots, renderSitemap } from "@/lib/seo/sitemap";

describe("renderSitemap", () => {
  it("buduje poprawny dokument urlset z lastmod", () => {
    const xml = renderSitemap([
      { loc: "https://acme.avably.io/store", lastmod: "2026-07-18T17:00:12+00:00" },
      { loc: "https://acme.avably.io/product/p1" },
    ]);

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://acme.avably.io/store</loc>");
    expect(xml).toContain("<lastmod>2026-07-18T17:00:12+00:00</lastmod>");
    // Bez lastmod nie zmyślamy daty.
    expect(xml.match(/<lastmod>/g)).toHaveLength(1);
  });

  it("escapuje znaki, które rozerwałyby dokument XML", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
    expect(renderSitemap([{ loc: "https://a.avably.io/p?x=1&y=2" }])).toContain("&amp;y=2");
  });
});

describe("renderRobots", () => {
  it("sklep OPUBLIKOWANY: Allow + zakaz ścieżek transakcyjnych + sitemapa", () => {
    const txt = renderRobots({
      allow: true,
      disallow: ["/cart", "/checkout"],
      sitemapUrl: "https://acme.avably.io/sitemap.xml",
    });

    expect(txt).toContain("User-agent: *");
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("Disallow: /cart");
    expect(txt).toContain("Disallow: /checkout");
    expect(txt).toContain("Sitemap: https://acme.avably.io/sitemap.xml");
  });

  it("sklep BEZ opublikowanej strony: pełny zakaz i BRAK linku do sitemapy", () => {
    const txt = renderRobots({ allow: false, sitemapUrl: "https://acme.avably.io/sitemap.xml" });

    expect(txt).toContain("Disallow: /");
    expect(txt).not.toContain("Allow: /");
    // Nie ma czego indeksować — link do sitemapy byłby zaproszeniem.
    expect(txt).not.toContain("Sitemap:");
  });
});

describe("resolveHostBranch — ta sama granica co middleware, bez nagłówka tenanta", () => {
  const deps = {
    resolveTenant: async (_host: string, slug: string) =>
      slug === "acme" ? { tenantId: "tenant-acme" } : null,
  };

  it("kanon marketingowy → marketing", async () => {
    await expect(resolveHostBranch("www.avably.io", deps)).resolves.toEqual({ kind: "marketing" });
    await expect(resolveHostBranch("localhost:3033", deps)).resolves.toEqual({ kind: "marketing" });
  });

  it("subdomena istniejącego tenanta → tenant z rozwiązanym id", async () => {
    await expect(resolveHostBranch("acme.avably.io", deps)).resolves.toEqual({
      kind: "tenant",
      slug: "acme",
      tenantId: "tenant-acme",
    });
  });

  it("nieznany/nieaktywny tenant → not-found (neutralne 404, ADR-039)", async () => {
    await expect(resolveHostBranch("nieznany.avably.io", deps)).resolves.toEqual({
      kind: "not-found",
    });
  });

  it("slug niepoprawny → not-found BEZ odpytania bazy", async () => {
    let called = false;
    const spyDeps = {
      resolveTenant: async () => {
        called = true;
        return null;
      },
    };
    await expect(resolveHostBranch("a.avably.io", spyDeps)).resolves.toEqual({ kind: "not-found" });
    expect(called).toBe(false);
  });
});
