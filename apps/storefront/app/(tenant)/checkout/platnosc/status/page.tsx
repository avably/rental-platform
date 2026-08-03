/**
 * Powrót z płatności (Z3, ADR-066) — strona, na którą dostawca przekierowuje
 * przeglądarkę po potwierdzeniu.
 *
 * TU SIĘ ROZSTRZYGA CAŁA REGUŁA NACZELNA FAZY. Adres, z którym klient tu
 * trafia, niesie `?payment_intent=…&redirect_status=succeeded`. Ta strona NIE
 * CZYTA ANI JEDNEGO Z TYCH PARAMETRÓW — dopisze je sobie każdy, kto umie
 * edytować pasek adresu, a uwierzenie im znaczyłoby wydanie sprzętu za darmo.
 *
 * Zamiast tego strona pyta WŁASNY serwer o stan zamówienia z bazy i dodatkowo
 * wykonuje ODCZYT u dostawcy (`readPaymentIntent`). Odczyt służy do
 * powiedzenia klientowi „dostawca potwierdza wpływ, czekamy na zaksięgowanie",
 * a nie do zmiany werdyktu: `paid` może napisać wyłącznie webhook z Z4.
 * W Z3 ta strona mówi więc szczerze „sprawdzamy płatność" — i to jest jej
 * docelowe, poprawne zachowanie, a nie stan przejściowy do naprawienia.
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { formatMoney, isIntentSettled, readPaymentIntent } from "@avably/core";

import { PageShell } from "@/components/storefront/page-shell";
import { StoreHeader } from "@/components/storefront/store-header";
import { readTenantAccountId } from "@/lib/checkout/online-availability";
import { loadCheckoutOrder } from "@/lib/checkout/payment-session";
import { paymentStatusView } from "@/lib/checkout/payment-status-view";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { loadStorefrontContext } from "@/lib/storefront/context";
import Link from "next/link";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await loadStorefrontContext();
  if (!ctx) return {};

  const storeName = ctx.catalog.tenant.name;
  return tenantMetadata({
    title: pageTitle(storeName, ctx.copy.payment.statusTitle),
    description: ctx.copy.payment.statusTitle,
    storeName,
    published: ctx.site !== null,
    transactional: true,
    origin: await tenantOrigin(),
    pathname: "/checkout/platnosc/status",
    locale: ctx.locale,
  });
}

/**
 * Odczyt płatności u dostawcy. Porażka jest tu STANEM NORMALNYM, nie awarią:
 * gdy nie wiemy, co widzi dostawca, mówimy klientowi mniej — a nie mówimy
 * czegoś nieprawdziwego.
 */
async function readProviderSettlement(
  tenantId: string,
  intentId: string | null,
  amountGrosze: number,
): Promise<boolean | undefined> {
  if (!intentId) return undefined;
  try {
    const accountId = await readTenantAccountId(tenantId);
    if (!accountId) return undefined;
    const read = await readPaymentIntent(intentId, { connectedAccountId: accountId });
    // Porównanie z sumą policzoną przez NASZ serwer (kwota z bazy, nie
    // z przeglądarki). Sam status `succeeded` nie wystarcza — płatność
    // częściowa też go ma.
    return isIntentSettled(read, amountGrosze);
  } catch {
    return undefined;
  }
}

export default async function TenantPaymentStatusPage() {
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const { catalog, copy, locale, currency, style, tenantId } = ctx;

  const order = await loadCheckoutOrder();
  if (!order) redirect("/store");

  const providerSettled = await readProviderSettlement(
    tenantId,
    order.providerPaymentIntentId,
    order.amountGrosze,
  );

  const view = paymentStatusView({
    // WERDYKT POCHODZI Z TEJ LINII I TYLKO Z NIEJ: stan zamówienia w naszej
    // bazie. Wszystko poniżej jedynie dobiera słowa.
    paymentStatus: order.paymentStatus,
    paymentProvider: order.paymentProvider,
    providerSettled,
  });

  const headline = {
    paid: copy.payment.statusPaid,
    checking: copy.payment.statusChecking,
    failed: copy.payment.statusFailed,
    offline: copy.payment.statusOffline,
    closed: copy.payment.statusClosed,
  }[view.kind];

  return (
    <>
      <StoreHeader copy={copy} storeName={catalog.tenant.name} />
      <PageShell style={style}>
        <h1 className="text-2xl font-semibold tracking-tight">{copy.payment.statusTitle}</h1>
        <div className="mt-6 rounded-lg border border-border bg-card p-6" role="status">
          <p className="text-lg leading-7">{headline}</p>

          {view.kind === "checking" && view.providerSettled ? (
            <p className="mt-3 leading-7 text-muted-foreground">
              {copy.payment.statusProviderConfirmed}
            </p>
          ) : null}

          <dl className="mt-6 grid gap-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{copy.confirmation.orderNumber}</dt>
              <dd className="tabular-nums">{order.orderNumber}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{copy.payment.amountDue}</dt>
              <dd>{formatMoney(order.amountGrosze, currency, locale)}</dd>
            </div>
          </dl>

          {view.kind === "failed" ? (
            <Link
              href="/checkout/platnosc"
              className="mt-6 inline-block font-medium underline underline-offset-4"
            >
              {copy.payment.retry}
            </Link>
          ) : (
            <Link
              href="/store"
              className="mt-6 inline-block font-medium underline underline-offset-4"
            >
              {copy.confirmation.backToStore}
            </Link>
          )}
        </div>
      </PageShell>
    </>
  );
}
