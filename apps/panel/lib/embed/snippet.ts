/**
 * Fragment do wklejenia (M3, ADR-120) — jedyne miejsce, które go składa.
 *
 * Fragment jest CAŁĄ konfiguracją, jaką najemca dostaje, więc jego kształt jest
 * kontraktem: adres skryptu niesie NAJEMCĘ (przez host subdomeny), a atrybuty
 * niosą wyłącznie parametry PREZENTACJI. Ta asymetria jest celowa i opisana w
 * ADR-120 — nie ma tu atrybutu z identyfikatorem najemcy, bo strona gospodarza
 * nie może sterować tym, czyje dane pokazujemy.
 *
 * Nie ma tu też klucza API. Embed go nie używa (patrz lib/embed/* storefrontu),
 * więc nie ma czego wklejać w cudzy HTML — i nie ma jak go stamtąd wynieść.
 */
import { tenantSubdomainHost } from "@avably/core";

/** Ścieżka skryptu osadzającego — lustro EMBED_LOADER_PATH ze storefrontu. */
export const EMBED_LOADER_PATH = "/embed/loader";

export interface EmbedSnippetOptions {
  /** Przypięty produkt (opcjonalnie) — bez niego widget pokazuje wybór z katalogu. */
  productId?: string | null;
  /** Wymuszony język — bez niego widget bierze język sklepu. */
  lang?: string | null;
  theme?: "light" | "dark" | null;
}

export function embedSnippetForSlug(slug: string, options: EmbedSnippetOptions = {}): string {
  const src = `https://${tenantSubdomainHost(slug)}${EMBED_LOADER_PATH}`;
  const attributes = [`src="${src}"`, "async"];

  if (options.productId) attributes.push(`data-avably-product="${options.productId}"`);
  if (options.lang) attributes.push(`data-avably-lang="${options.lang}"`);
  if (options.theme) attributes.push(`data-avably-theme="${options.theme}"`);

  return `<script ${attributes.join(" ")}></script>`;
}

/** Adres podglądu widgetu — ten sam dokument, który zobaczy klient najemcy. */
export function embedPreviewUrlForSlug(slug: string): string {
  return `https://${tenantSubdomainHost(slug)}/embed/widget`;
}
