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
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CheckoutForm } from "@/components/storefront/checkout-form";
import { PageShell } from "@/components/storefront/page-shell";
import { StoreHeader } from "@/components/storefront/store-header";
import { readOnlinePaymentAvailability } from "@/lib/checkout/online-availability";
import { availablePaymentMethods } from "@/lib/checkout/payment-options";
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
    title: pageTitle(storeName, ctx.copy.checkout.title),
    description: ctx.copy.checkout.title,
    storeName,
    published: ctx.site !== null,
    transactional: true,
    origin: await tenantOrigin(),
    pathname: "/checkout",
    locale: ctx.locale,
  });
}

export default async function TenantCheckoutPage() {
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const { catalog, copy, locale, currency, style, tenantId } = ctx;

  // Które metody pokazać — liczone TU, na serwerze, ze ŚWIEŻEGO odczytu stanu
  // konta najemcy u dostawcy (ADR-049). Strona jest `force-dynamic`, więc
  // odczyt jest jednorazowy na wejście w checkout, a nie cache'owany między
  // klientami: konto zablokowane godzinę temu ma zniknąć z listy dzisiaj,
  // a nie po następnym wdrożeniu.
  const paymentMethods = availablePaymentMethods(await readOnlinePaymentAvailability(tenantId));

  return (
    <>
      <StoreHeader copy={copy} storeName={catalog.tenant.name} />
      <PageShell style={style}>
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
            paymentMethods={paymentMethods}
          />
        </div>
      </PageShell>
    </>
  );
}
