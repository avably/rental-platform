/**
 * Serializacja sitemap.xml i robots.txt (Zadanie 2.7, ADR-044) — CZYSTE
 * funkcje. Rozgałęzienie po hoście i pobranie danych robią trasy
 * (`app/sitemap.xml`, `app/robots.txt`); tu zostaje sam format.
 */

/** Escapowanie XML — adresy niosą id produktów i host, ale `&` w query psuje dokument. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface SitemapEntry {
  loc: string;
  /** ISO 8601; pomijane, gdy nieznane — lepiej brak niż zmyślona data. */
  lastmod?: string | undefined;
}

export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const lastmod = entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : "";
      return `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export interface RobotsInput {
  /** `false` → pełny zakaz indeksowania (sklep bez opublikowanej strony). */
  allow: boolean;
  /** Absolutny adres sitemapy; pomijany, gdy nie ma czego indeksować. */
  sitemapUrl?: string | undefined;
  /** Ścieżki wyłączone mimo `allow` (koszyk/checkout — patrz trasa robots). */
  disallow?: string[];
}

export function renderRobots(input: RobotsInput): string {
  const lines = ["User-agent: *"];
  if (!input.allow) {
    lines.push("Disallow: /");
    return `${lines.join("\n")}\n`;
  }
  lines.push("Allow: /");
  for (const path of input.disallow ?? []) lines.push(`Disallow: ${path}`);
  if (input.sitemapUrl) lines.push("", `Sitemap: ${input.sitemapUrl}`);
  return `${lines.join("\n")}\n`;
}
