/**
 * Checkout storefrontu (Zadanie 2.4b). Serwer podaje katalog (produkty do
 * podglądu, metody dostawy z cennikiem, punkty odbioru), locale/copy tenanta i
 * site key Turnstile; formularz (klient) zbiera dane, bierze pozycje/termin z
 * koszyka i woła submitCheckout (rdzeń 2.4a).
 *
 * Site key Turnstile z NEXT_PUBLIC_TURNSTILE_SITE_KEY (stała build-time; brak =
 * widget i weryfikacja jawnie wyłączone — dev). Ten sam warunek co proxy CSP i
 * waitlist-form.
 */
import { notFound } from "next/navigation";

import { CheckoutForm } from "@/components/storefront/checkout-form";
import { PageShell } from "@/components/storefront/page-shell";
import { StoreHeader } from "@/components/storefront/store-header";
import { loadStorefrontContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

export default async function TenantCheckoutPage() {
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const { catalog, copy, locale, currency, template } = ctx;

  return (
    <>
      <StoreHeader copy={copy} storeName={catalog.tenant.name} />
      <PageShell template={template}>
        <h1 className="text-2xl font-semibold tracking-tight">{copy.checkout.title}</h1>
        <div className="mt-6">
          <CheckoutForm
            products={catalog.products}
            deliveryMethods={catalog.delivery_methods}
            pickupLocations={catalog.pickup_locations}
            currency={currency}
            locale={locale}
            copy={copy}
            turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          />
        </div>
      </PageShell>
    </>
  );
}
