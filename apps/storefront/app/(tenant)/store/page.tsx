/**
 * Storefront tenanta — KATALOG (Zadanie 2.4b; render sekcyjny 2.3b, ADR-041).
 * Wypełnia seam 2.4 z 2.3b: sekcja `products` renderuje REALNY katalog publiczny
 * (getPublicCatalog, warstwa danych 2.4a), a karty linkują do podstron produktu.
 *
 * BRAMKA (bez zmian): trasa osiągalna WYŁĄCZNIE przez rewrite z middleware, który
 * wstrzykuje `x-tenant-id`. Wejście wprost (bez nagłówka) → notFound(). Odczyt
 * `headers()` czyni render dynamicznym per żądanie (konieczne pod CSP z nonce).
 * Brak opublikowanej strony → neutralna „sklep w budowie” (fail-closed).
 *
 * i18n: język i copy z osi tenanckiej (tenants.locale), nie z URL — patrz
 * lib/storefront/context.ts.
 */
import { SiteRenderer, type SiteRenderLabels } from "@avably/ui";
import { notFound } from "next/navigation";

import { toStorefrontProducts } from "@/lib/catalog/present";
import { StoreHeader } from "@/components/storefront/store-header";
import { loadStorefrontContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

export default async function TenantStorePage() {
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const { catalog, copy, locale, currency, template, site, supabaseUrl } = ctx;

  const labels: SiteRenderLabels = {
    productsEmpty: copy.siteLabels.productsEmpty,
    contactEmail: copy.siteLabels.contactEmail,
    contactPhone: copy.siteLabels.contactPhone,
    contactAddress: copy.siteLabels.contactAddress,
    contactMap: copy.siteLabels.contactMap,
  };

  const products = toStorefrontProducts(catalog.products, {
    supabaseUrl,
    currency,
    locale,
    words: { from: copy.common.from, perDay: copy.common.perDay },
    hrefBase: "/product/",
  });

  return (
    <>
      <StoreHeader copy={copy} storeName={catalog.tenant.name} />
      {!site || site.sections.length === 0 ? (
        <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-2xl font-semibold">{catalog.tenant.name}</h1>
          <p className="text-muted-foreground">{copy.siteLabels.productsEmpty}</p>
        </main>
      ) : (
        <SiteRenderer sections={site.sections} template={template} products={products} labels={labels} />
      )}
    </>
  );
}
