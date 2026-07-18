/**
 * Koszyk storefrontu (Zadanie 2.4b). Serwer podaje katalog (do połączenia
 * pozycji koszyka po product_id) i szablon; stan koszyka trzyma klient
 * (localStorage, patrz CartView). Bramka i render dynamiczny jak reszta osi
 * tenanckiej.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CartView } from "@/components/storefront/cart-view";
import { PageShell } from "@/components/storefront/page-shell";
import { StoreHeader } from "@/components/storefront/store-header";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { loadStorefrontContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

/** Strona transakcyjna — `transactional` wymusza noindex (patrz tenantMetadata). */
export async function generateMetadata(): Promise<Metadata> {
  const ctx = await loadStorefrontContext();
  if (!ctx) return {};

  const storeName = ctx.catalog.tenant.name;
  return tenantMetadata({
    title: pageTitle(storeName, ctx.copy.cart.title),
    description: ctx.copy.cart.title,
    storeName,
    published: ctx.site !== null,
    transactional: true,
    origin: await tenantOrigin(),
    pathname: "/cart",
    locale: ctx.locale,
  });
}

export default async function TenantCartPage() {
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const { catalog, copy, locale, currency, template, supabaseUrl } = ctx;

  return (
    <>
      <StoreHeader copy={copy} storeName={catalog.tenant.name} />
      <PageShell template={template}>
        <h1 className="text-2xl font-semibold tracking-tight">{copy.cart.title}</h1>
        <div className="mt-6">
          <CartView
            products={catalog.products}
            supabaseUrl={supabaseUrl}
            currency={currency}
            locale={locale}
            copy={copy}
          />
        </div>
      </PageShell>
    </>
  );
}
