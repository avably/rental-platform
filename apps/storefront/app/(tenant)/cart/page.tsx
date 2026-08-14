/**
 * Koszyk storefrontu (Zadanie 2.4b). Serwer podaje katalog (do połączenia
 * pozycji koszyka po product_id) i szablon; stan koszyka trzyma klient
 * (localStorage, patrz CartView). Bramka i render dynamiczny jak reszta osi
 * tenanckiej.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CartView } from "@/components/storefront/cart-view";
import { productPaths } from "@/lib/catalog/product-path";
import { PageShell } from "@/components/storefront/page-shell";
import { SITE_HEADING } from "@/components/storefront/store-chrome";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { siteImageBaseUrl } from "@/lib/site/image-base";
import { storeLogo } from "@/lib/site/store-logo";
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

  const { catalog, copy, locale, currency, style, site, supabaseUrl } = ctx;

  return (
    <PageShell
      style={style}
      copy={copy}
      storeName={catalog.tenant.name}
      site={site}
      logo={storeLogo(ctx)}
      siteImageBase={siteImageBaseUrl(ctx.supabaseUrl)}
      /* Ta trasa SPRZEDAJE — pasek terminu na niej stoi (faza 5, ADR-179). */
      term={{ products: catalog.products, locale }}
    >
      <h1 className={`text-2xl tracking-tight ${SITE_HEADING}`}>{copy.cart.title}</h1>
      <div className="mt-6">
        <CartView
          products={catalog.products}
          /*
            ADRESY POZYCJI liczone NA SERWERZE (ADR-182). Koszyk jest
            komponentem klienckim, więc nie dostanie funkcji przez granicę —
            dostaje gotową mapę `id → ścieżka`, żeby reguła degradacji przy
            braku rejestru adresów została w JEDNYM miejscu.
          */
          productPaths={productPaths(
            ctx.productSlugs,
            catalog.products.map((product) => product.id),
          )}
          supabaseUrl={supabaseUrl}
          currency={currency}
          locale={locale}
          copy={copy}
        />
      </div>
    </PageShell>
  );
}
