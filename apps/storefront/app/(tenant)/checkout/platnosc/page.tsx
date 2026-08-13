/**
 * Krok płatności online (Z3, ADR-066).
 *
 * Serwer robi tu WSZYSTKO, co dotyczy pieniędzy: odczytuje zamówienie
 * z własnej bazy, odczytuje u dostawcy, czy konto najemcy przyjmuje
 * płatności, tworzy płatność (idempotentnie po `orders.id`) i wiąże ją
 * z zamówieniem. Przeglądarka dostaje wyłącznie to, co musi mieć, żeby
 * pokazać pola karty: poświadczenie do JEDNEJ płatności, klucz publikowalny
 * i identyfikator konta najemcy.
 *
 * KLUCZ PUBLIKOWALNY IDZIE Z SERWERA, NIE ZE STAŁEJ `NEXT_PUBLIC_*`
 * (decyzja ADR-066). Stała build-time zamarza w artefakcie: po rotacji klucza
 * albo przełączeniu trybu test↔live przeglądarka potwierdzałaby płatność
 * kluczem z innego trybu niż ten, którym serwer ją utworzył — awaria niema,
 * w kształcie 2.6c. Klucz podany stąd przechodzi w dodatku przez bramki
 * `resolveStripeConfig` (zamiana kluczy, rozjazd trybów).
 *
 * ODŚWIEŻENIE TEJ STRONY NIE ZAKŁADA DRUGIEJ PŁATNOŚCI: klucz idempotencji
 * to identyfikator zamówienia, więc dostawca oddaje tę samą płatność.
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  DEFAULT_CURRENCY,
  canAcceptCharges,
  createPaymentIntent,
  isCurrencyCode,
  readConnectAccount,
} from "@avably/core";

import { PageShell } from "@/components/storefront/page-shell";
import { SITE_HEADING } from "@/components/storefront/store-chrome";
import { PaymentStep } from "@/components/storefront/payment-step";
import { attachPaymentIntent } from "@/lib/checkout/attach-intent";
import {
  readPublishableKey,
  readTenantAccountId,
} from "@/lib/checkout/online-availability";
import { preparePayment } from "@/lib/checkout/online-payment";
import { loadCheckoutOrder } from "@/lib/checkout/payment-session";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { storeLogo } from "@/lib/site/store-logo";
import { loadStorefrontContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await loadStorefrontContext();
  if (!ctx) return {};

  const storeName = ctx.catalog.tenant.name;
  return tenantMetadata({
    title: pageTitle(storeName, ctx.copy.payment.title),
    description: ctx.copy.payment.title,
    storeName,
    published: ctx.site !== null,
    // Strona transakcyjna — noindex. Nie ma czego indeksować i nie ma po co:
    // bez ciasteczka nie pokazuje nic poza przekierowaniem.
    transactional: true,
    origin: await tenantOrigin(),
    pathname: "/checkout/platnosc",
    locale: ctx.locale,
  });
}

export default async function TenantPaymentPage() {
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const { catalog, copy, locale, style, site, tenantId } = ctx;

  const order = await loadCheckoutOrder();
  // Brak uchwytu to stan NORMALNY (wygasłe ciasteczko, wejście z zakładki),
  // a nie awaria — wracamy do sklepu bez straszenia klienta komunikatem.
  if (!order) redirect("/store");
  // Zamówienie przelewowe nie ma tu czego szukać; jego ścieżka skończyła się
  // na ekranie potwierdzenia.
  if (order.paymentProvider !== "stripe") redirect("/checkout/platnosc/status");

  // Waluta ZAMÓWIENIA (orders.currency przez get_public_order_payment,
  // 0049/ADR-103): to ta sama wartość, która za chwilę idzie do intentu
  // w `preparePayment` (`order.currency`) — napis na ekranie i obciążenie
  // nie mają prawa mówić dwiema walutami. Zawężenie jak w checkout/emails.ts.
  const orderCurrency = isCurrencyCode(order.currency) ? order.currency : DEFAULT_CURRENCY;

  const publishableKey = readPublishableKey();

  const preparation = await preparePayment(order, {
    readAccountId: () => readTenantAccountId(tenantId),
    readAccountState: async (accountId) => ({
      chargesEnabled: canAcceptCharges(await readConnectAccount(accountId)),
    }),
    createIntent: (params) => createPaymentIntent(params),
    attachIntent: (input) =>
      attachPaymentIntent({
        tenantId,
        orderId: input.orderId,
        token: order.token,
        intentId: input.intentId,
        applicationFeeGrosze: input.applicationFeeGrosze,
      }),
    publishableKey: publishableKey ?? "",
  });

  return (
    <PageShell style={style} copy={copy} storeName={catalog.tenant.name} site={site} logo={storeLogo(ctx)}>
      <h1 className={`text-2xl tracking-tight ${SITE_HEADING}`}>{copy.payment.title}</h1>
      <div className="mt-6">
        <PaymentStep
          preparation={preparation}
          orderNumber={order.orderNumber}
          amountGrosze={order.amountGrosze}
          currency={orderCurrency}
          locale={locale}
          copy={copy}
        />
      </div>
    </PageShell>
  );
}
