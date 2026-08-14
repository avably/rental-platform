/**
 * ADRES ZASTANY STRONY SPRZĘTU — `/product/{uuid}` (ADR-182).
 *
 * ==================== DLACZEGO TA TRASA NIE ZNIKA ====================
 *
 * Od 0083 stroną sprzętu jest `/produkt/{slug}` — adres, który da się
 * zaindeksować. Ten stoi w indeksie wyszukiwarki, w mapie strony sprzed
 * wdrożenia i w linkach, które klienci najemcy wkleili na Facebooku i w mailach.
 * Twarde 404 pod nim to utrata ruchu, za który najemca już zapłacił, więc
 * trasa zostaje i oddaje **308** — przekierowanie TRWAŁE, po którym robot
 * przepisuje sobie adres, a nie odwiedza starego w nieskończoność.
 *
 * ==================== DLACZEGO TO NIE JEST SAM `redirect` ====================
 *
 * Trasa umie jeszcze jedno i to jest cały powód, dla którego render mieszka
 * w `lib/catalog/product-page.tsx`, a nie tutaj: gdy rejestru adresów akurat
 * NIE MA (chwilowy błąd odczytu, `ctx.productSlugs === null`), nie ma dokąd
 * przekierować — a wtedy ta trasa musi wyrenderować stronę, dokładnie jak
 * przed ADR-182. Odwrotny wybór (404 albo 308 „w ciemno") zamieniałby jeden
 * nieudany odczyt w katalog samych ślepych linków: bez rejestru kafle katalogu
 * też linkują tu, a nie pod adres, którego nie znają (patrz
 * `lib/catalog/product-path.ts`).
 *
 * BRAMKA jak katalog: tenant_id z nagłówka (rewrite middleware), inaczej
 * notFound(). Pozycja spoza katalogu tenanta / nieaktywna → notFound()
 * (katalog publiczny zawiera tylko aktywne). Render dynamiczny (CSP nonce).
 */
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { productPathFromSlug, productSlugById } from "@avably/core";

import { productPageMetadata, renderProductPage } from "@/lib/catalog/product-page";
import { loadStorefrontContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

/**
 * Metadane liczą się TYLKO dla gałęzi renderującej. Gałąź przekierowania ich
 * nie użyje — Next liczy `generateMetadata` i render równolegle, ale odpowiedź
 * 308 nie niesie dokumentu, więc kanon wyjdzie dopiero spod adresu docelowego.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const ctx = await loadStorefrontContext();
  if (!ctx) return {};

  const product = ctx.catalog.products.find((item) => item.id === id);
  return product ? productPageMetadata(ctx, product) : {};
}

export default async function TenantLegacyProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const raw = ctx.catalog.products.find((product) => product.id === id);
  if (!raw) notFound();

  // ADRES ZNANY → 308. Rzut `permanentRedirect` przerywa render, więc niżej
  // schodzi wyłącznie gałąź „adresu nie znamy".
  const slug = productSlugById(ctx.productSlugs, raw.id);
  if (slug) permanentRedirect(productPathFromSlug(slug));

  return renderProductPage({ ctx, raw });
}
