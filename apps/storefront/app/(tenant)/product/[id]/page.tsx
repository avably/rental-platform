/**
 * Podstrona produktu storefrontu (Zadanie 2.4b). Serwer składa dane (produkt z
 * getPublicCatalog, sformatowane ceny + URL-e zdjęć), a interakcję (wybór
 * terminu, dostępność, dodanie do koszyka) robi klient ProductDetail.
 *
 * BRAMKA jak katalog: tenant_id z nagłówka (rewrite middleware), inaczej
 * notFound(). Produkt spoza katalogu tenanta / nieaktywny → notFound() (katalog
 * publiczny zawiera tylko aktywne). Render dynamiczny (CSP nonce).
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { toProductDetail } from "@/lib/catalog/present";
import { ProductDetail } from "@/components/storefront/product-detail";
import { PageShell } from "@/components/storefront/page-shell";
import { StoreHeader } from "@/components/storefront/store-header";
import { loadStorefrontContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

export default async function TenantProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const { catalog, copy, locale, currency, template, supabaseUrl } = ctx;
  const raw = catalog.products.find((product) => product.id === id);
  if (!raw) notFound();

  const product = toProductDetail(raw, {
    supabaseUrl,
    currency,
    locale,
    words: { from: copy.common.from, perDay: copy.common.perDay },
  });

  return (
    <>
      <StoreHeader copy={copy} storeName={catalog.tenant.name} />
      <PageShell template={template}>
        <Link href="/store" className="text-sm text-muted-foreground underline underline-offset-4">
          {copy.common.backToCatalog}
        </Link>
        <div className="mt-6">
          <ProductDetail product={product} copy={copy} locale={locale} currency={currency} />
        </div>
      </PageShell>
    </>
  );
}
