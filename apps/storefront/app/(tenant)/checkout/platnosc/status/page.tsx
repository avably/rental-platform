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

import {
  DEFAULT_CURRENCY,
  formatMoney,
  isCurrencyCode,
  isIntentSettled,
  readPaymentIntent,
} from "@avably/core";

import { PageShell } from "@/components/storefront/page-shell";
import { PaymentStatusRefresh } from "@/components/storefront/payment-status-refresh";
import { SITE_HEADING } from "@/components/storefront/store-chrome";
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
  currency: string,
): Promise<boolean | undefined> {
  if (!intentId) return undefined;
  try {
    const accountId = await readTenantAccountId(tenantId);
    if (!accountId) return undefined;
    const read = await readPaymentIntent(intentId, { connectedAccountId: accountId });
    // Porównanie z sumą policzoną przez NASZ serwer (kwota z bazy, nie
    // z przeglądarki) i z walutą UTRWALONĄ na zamówieniu (orders.currency,
    // 0049/ADR-103) — z tej pary intent powstał. Sam status `succeeded`
    // nie wystarcza — płatność częściowa też go ma.
    return isIntentSettled(read, amountGrosze, currency);
  } catch {
    return undefined;
  }
}

export default async function TenantPaymentStatusPage() {
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const { catalog, copy, locale, style, tenantId } = ctx;

  const order = await loadCheckoutOrder();
  if (!order) redirect("/store");

  // Waluta ZAMÓWIENIA (orders.currency przez get_public_order_payment,
  // 0049/ADR-103) — nie waluta z kontekstu sklepu: po zmianie ustawienia
  // najemcy ta strona ma dalej mówić walutą, w której zamówienie POWSTAŁO.
  // Zawężenie jak w checkout/emails.ts — kolumna ma CHECK, więc fallback
  // jest higieną granicy typów, nie realną ścieżką.
  const orderCurrency = isCurrencyCode(order.currency) ? order.currency : DEFAULT_CURRENCY;

  const providerSettled = await readProviderSettlement(
    tenantId,
    order.providerPaymentIntentId,
    order.amountGrosze,
    order.currency,
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
    <PageShell style={style} copy={copy} storeName={catalog.tenant.name}>
      <h1 className={`text-2xl tracking-tight ${SITE_HEADING}`}>{copy.payment.statusTitle}</h1>
      <div className="site-card mt-6 p-6" role="status">
        <p className="text-lg leading-7">{headline}</p>

        {/* [F1/ADR-137] Zegar tylko w stanie `checking`: BLIK/P24 domykają
            się webhookiem poza przeglądarką klienta, więc strona prosi
            serwer o świeży render, zamiast kazać klientowi wciskać F5.
            Werdykt dalej powstaje wyłącznie na serwerze (ADR-049). */}
        {view.kind === "checking" ? <PaymentStatusRefresh /> : null}

        {view.kind === "checking" && view.providerSettled ? (
          <p className="site-text-muted mt-3 leading-7">{copy.payment.statusProviderConfirmed}</p>
        ) : null}

        <dl className="site-rule-top mt-6 grid gap-2 pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="site-text-muted">{copy.confirmation.orderNumber}</dt>
            <dd className="tabular-nums">{order.orderNumber}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="site-text-muted">{copy.payment.amountDue}</dt>
            <dd>{formatMoney(order.amountGrosze, orderCurrency, locale)}</dd>
          </div>
        </dl>

        {view.kind === "failed" ? (
          <Link href="/checkout/platnosc" className="site-link mt-6 inline-block font-medium">
            {copy.payment.retry}
          </Link>
        ) : (
          <Link href="/store" className="site-link mt-6 inline-block font-medium">
            {copy.confirmation.backToStore}
          </Link>
        )}
      </div>
    </PageShell>
  );
}
