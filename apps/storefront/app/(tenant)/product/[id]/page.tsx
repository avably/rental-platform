/**
 * Podstrona produktu storefrontu (Zadanie 2.4b). Serwer składa dane (produkt z
 * getPublicCatalog, sformatowane ceny + URL-e zdjęć), a interakcję (wybór
 * terminu, dostępność, dodanie do koszyka) robi klient ProductDetail.
 *
 * BRAMKA jak katalog: tenant_id z nagłówka (rewrite middleware), inaczej
 * notFound(). Produkt spoza katalogu tenanta / nieaktywny → notFound() (katalog
 * publiczny zawiera tylko aktywne). Render dynamiczny (CSP nonce).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { toProductDetail } from "@/lib/catalog/present";
import { JsonLd } from "@/components/storefront/json-ld";
import { ProductDetail } from "@/components/storefront/product-detail";
import { PageShell } from "@/components/storefront/page-shell";
import { StoreHeader } from "@/components/storefront/store-header";
import { productJsonLd } from "@/lib/seo/jsonld";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { format } from "@/lib/storefront/copy";
import { loadStorefrontContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

/**
 * Tytuł = nazwa produktu + nazwa sklepu; opis = opis produktu z katalogu
 * publicznego, a gdy go nie ma — neutralne zdanie w locale tenanta. Produkt
 * spoza katalogu nie dostaje metadanych (strona i tak odda 404).
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
  if (!product) return {};

  const storeName = ctx.catalog.tenant.name;

  return tenantMetadata({
    title: pageTitle(storeName, product.name),
    description:
      product.description ??
      format(ctx.copy.seo.productDescription, { product: product.name, store: storeName }),
    storeName,
    published: ctx.site !== null,
    origin: await tenantOrigin(),
    pathname: `/product/${product.id}`,
    locale: ctx.locale,
  });
}

export default async function TenantProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const { catalog, copy, locale, currency, style, supabaseUrl } = ctx;
  const raw = catalog.products.find((product) => product.id === id);
  if (!raw) notFound();

  const product = toProductDetail(raw, {
    supabaseUrl,
    currency,
    locale,
    words: { from: copy.common.from, perDay: copy.common.perDay },
  });

  // Product + Offer wyłącznie z publicznego katalogu; cena „od” = stawka za
  // dobę (progi cenowe obniżają ją przy dłuższym najmie).
  const origin = await tenantOrigin();
  const productLd = origin
    ? productJsonLd({
        name: product.name,
        description: product.description,
        images: product.images.map((image) => image.url),
        url: `${origin}/product/${product.id}`,
        currency,
        basePriceDayGrosze: raw.base_price_day_grosze,
      })
    : null;

  return (
    <>
      <StoreHeader copy={copy} storeName={catalog.tenant.name} />
      {productLd ? <JsonLd data={productLd} /> : null}
      <PageShell style={style}>
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
