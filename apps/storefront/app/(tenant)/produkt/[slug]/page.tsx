/**
 * STRONA SPRZĘTU POD ADRESEM CZYTELNYM — `/produkt/{slug}` (ADR-182).
 *
 * ==================== PO CO TA TRASA ISTNIEJE ====================
 *
 * Do 0083 strona sprzętu stała pod `/product/{uuid}`. Identyfikator nie niesie
 * ani jednego słowa, po którym ktokolwiek szuka sprzętu, a jest tym fragmentem
 * strony, który wyszukiwarka czyta jako pierwszy. To jest cel tej trasy —
 * nie kosmetyka adresu.
 *
 * SEGMENT `produkt` MUSI BYĆ ZAREZERWOWANY (RESERVED_CATEGORY_SLUGS →
 * RESERVED_PAGE_SLUGS + `app.reserved_page_slugs()`), i to z DWÓCH powodów
 * naraz. Pierwszy jest oczywisty: strona treściowa najemcy o adresie `produkt`
 * przegrałaby ze statyczną trasą Next i nie wyświetliła się nigdy, bez błędu.
 * Drugi łatwo przeoczyć: proxy przepuszcza ścieżkę wielosegmentową WYŁĄCZNIE
 * pod korzeniem zarezerwowanym (`proxy.ts`, krok 4) — bez wpisu `/produkt/rower`
 * dostawałoby neutralne 404, zanim Next w ogóle zobaczyłby tę trasę.
 *
 * ==================== TRZY ODPOWIEDZI ====================
 *
 *   • adres BIEŻĄCY → render pozycji,
 *   • adres STARY   → 308 pod adres bieżący,
 *   • adres NIEZNANY → 404.
 *
 * Do fazy 4a rozstrzygał to REJESTR adresów całego najemcy
 * (`app.get_public_product_slugs`, 0083) — jedną podróżą, ale w rozmiarze
 * O(N): 15 037 bajtów przy 200 pozycjach, na każdą odsłonę. Od ADR-184 te same
 * trzy odpowiedzi (razem z historią adresów, więc dalej BEZ drugiej podróży)
 * niesie wąski odczyt `app.get_public_product` — w rozmiarze O(1). Rejestru ta
 * trasa nie czyta już wcale, tak samo jak katalogu.
 *
 * BRAMKA jak katalog: tenant_id z nagłówka (rewrite middleware), inaczej
 * notFound(). Render dynamiczny (CSP nonce).
 */
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { productPathFromSlug } from "@avably/core";

import { productPageMetadata, renderProductPage } from "@/lib/catalog/product-page";
import { loadProductPageContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await loadProductPageContext({ slug });
  if (resolved.kind !== "product") return {};

  return productPageMetadata(resolved.ctx, resolved.ctx.catalog.products[0]);
}

export default async function TenantProductSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resolved = await loadProductPageContext({ slug });

  /*
    STARY ADRES → 308, nie 404 (ADR-182). Adres, spod którego sprzęt się
    wyprowadził, stoi w indeksie wyszukiwarki i w linkach, które klienci
    najemcy wkleili u siebie. Twarde 404 to utrata ruchu, za który najemca już
    zapłacił. `permanentRedirect` oddaje 308, czyli przekierowanie TRWAŁE
    z zachowaniem metody — a nie 307, które mówi robotowi „wróć tu jutro".
  */
  if (resolved.kind === "redirect") permanentRedirect(productPathFromSlug(resolved.slug));
  if (resolved.kind !== "product") notFound();

  return renderProductPage({ ctx: resolved.ctx, raw: resolved.ctx.catalog.products[0] });
}
