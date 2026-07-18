/**
 * Koszyk storefrontu (Zadanie 2.4b). Serwer podaje katalog (do połączenia
 * pozycji koszyka po product_id) i szablon; stan koszyka trzyma klient
 * (localStorage, patrz CartView). Bramka i render dynamiczny jak reszta osi
 * tenanckiej.
 */
import { notFound } from "next/navigation";

import { CartView } from "@/components/storefront/cart-view";
import { PageShell } from "@/components/storefront/page-shell";
import { StoreHeader } from "@/components/storefront/store-header";
import { loadStorefrontContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

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
