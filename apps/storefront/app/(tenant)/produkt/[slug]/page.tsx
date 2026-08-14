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
 * Adres rozstrzyga się wobec rejestru (`app.get_public_product_slugs`, 0083),
 * a nie zapytaniem po slugu — bo ten sam rejestr niesie od razu historię
 * adresów, więc „a może to stary adres?" nie kosztuje drugiej podróży do bazy
 * (ten sam tor, co ADR-159 dla stron):
 *
 *   • adres BIEŻĄCY → render pozycji,
 *   • adres STARY   → 308 pod adres bieżący,
 *   • adres NIEZNANY → 404.
 *
 * BRAMKA jak katalog: tenant_id z nagłówka (rewrite middleware), inaczej
 * notFound(). Render dynamiczny (CSP nonce).
 */
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { productPathFromSlug, resolveProductSlug } from "@avably/core";

import { productPageMetadata, renderProductPage } from "@/lib/catalog/product-page";
import { loadStorefrontContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const ctx = await loadStorefrontContext();
  if (!ctx) return {};

  const resolved = resolveProductSlug(ctx.productSlugs, slug);
  if (resolved?.kind !== "product") return {};

  const product = ctx.catalog.products.find((item) => item.id === resolved.productId);
  return product ? productPageMetadata(ctx, product) : {};
}

export default async function TenantProductSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const resolved = resolveProductSlug(ctx.productSlugs, slug);
  if (!resolved) notFound();

  /*
    STARY ADRES → 308, nie 404 (ADR-182). Adres, spod którego sprzęt się
    wyprowadził, stoi w indeksie wyszukiwarki i w linkach, które klienci
    najemcy wkleili u siebie. Twarde 404 to utrata ruchu, za który najemca już
    zapłacił. `permanentRedirect` oddaje 308, czyli przekierowanie TRWAŁE
    z zachowaniem metody — a nie 307, które mówi robotowi „wróć tu jutro".
  */
  if (resolved.kind === "redirect") permanentRedirect(productPathFromSlug(resolved.slug));

  /*
    Rejestr obejmuje DOKŁADNIE ten sam zbiór pozycji, co katalog publiczny
    (aktywne, najemca w oknie handlowym), więc wyszukanie nie ma jak spudłować.
    `notFound()` zostaje jako fail-closed: pozycja wyłączona MIĘDZY odczytem
    rejestru a odczytem katalogu ma dać 404, a nie wyjątek renderu.
  */
  const raw = ctx.catalog.products.find((item) => item.id === resolved.productId);
  if (!raw) notFound();

  return renderProductPage({ ctx, raw });
}
