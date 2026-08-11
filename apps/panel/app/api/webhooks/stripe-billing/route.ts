/**
 * Webhook BILLINGU SaaS (J2 faza 2a, ADR-136) — spięcie trasy z rdzeniem
 * `lib/stripe-billing-webhook.ts` (wzorzec trasy webhooka płatności, ADR-067).
 *
 * OSOBNA TRASA, OSOBNY SEKRET, OSOBNY provider — fizyczna separacja od toru
 * Connect (pieniądze klientów najemców): zdarzenia billingu są account-level
 * konta PLATFORMY, więc odczyty idą `StripeBillingClient`-em bez nagłówka
 * `Stripe-Account` (klient nie ma na niego składni), a podpis weryfikuje
 * WŁASNY sekret `AVABLY_STRIPE_BILLING_WEBHOOK_SECRET`. Endpoint Connect
 * (`/api/webhooks/stripe`) pozostaje nietknięty w ani jednej linii.
 *
 * TRASA PUBLICZNA chroniona podpisem fail-closed; brak KTÓREJKOLWIEK części
 * konfiguracji (sekret podpisu, klucz platformy, service-role) = 500 —
 * dostawca ponowi, a my zobaczymy powód w logach zamiast cicho gubić
 * zdarzenia rozliczeniowe.
 *
 * KLIENT SERVICE-ROLE legalnie: `app/api/webhooks/**` jest w allowliście
 * lint/CI (audit-service-role.sh) — rejestr zdarzeń jest platformowy,
 * a EXECUTE na `app.apply_saas_subscription_state` ma tylko service_role.
 */
import {
  StripeBillingClient,
  emailAvailability,
  requireStripeBillingWebhookSecret,
  resendTransport,
} from "@avably/core";
import { createServiceClient } from "@avably/db/service";

import { sendSaasPaymentFailedEmail } from "@/lib/billing-email";
import { handleStripeBillingWebhook } from "@/lib/stripe-billing-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = requireStripeBillingWebhookSecret();
  } catch (error) {
    console.error(
      `[stripe-billing-webhook] endpoint niedostępny — ${
        error instanceof Error ? error.message : "brak konfiguracji podpisu"
      }`,
    );
    return new Response(
      JSON.stringify({ error: "Webhook billingu nie jest skonfigurowany." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let db;
  let billing: StripeBillingClient;
  try {
    db = createServiceClient();
    billing = new StripeBillingClient();
  } catch (error) {
    console.error(
      `[stripe-billing-webhook] brak konfiguracji — ${
        error instanceof Error ? error.message : "nieznany powód"
      }`,
    );
    return new Response(
      JSON.stringify({ error: "Rejestr zdarzeń lub klient rozliczeń nie jest skonfigurowany." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const serviceDb = db;
  return handleStripeBillingWebhook(request, {
    db: serviceDb,
    // Stan ZAWSZE z odczytu u dostawcy (ADR-049/067) — zdarzenie to budzik.
    readSubscription: (subscriptionId) => billing.readSaasSubscription(subscriptionId),
    // Dwustopniowy odczyt cs_/in_ → sub_ (W9): identyfikator subskrypcji
    // z ODCZYTU sesji/faktury, nigdy z payloadu zdarzenia.
    readCheckoutSessionSubscriptionId: (sessionId) =>
      billing.readCheckoutSessionSubscriptionId(sessionId),
    readInvoiceSubscriptionId: (invoiceId) => billing.readInvoiceSubscriptionId(invoiceId),
    // Mail dunningowy przy invoice.payment_failed — po zapisie stanu,
    // idempotentny przez claim zdarzenia (rdzeń), nigdy nie rzuca.
    sendPaymentFailedEmail: ({ tenantId }) =>
      sendSaasPaymentFailedEmail(
        { db: serviceDb, availability: emailAvailability(), transport: resendTransport() },
        { tenantId },
      ),
    secret,
  });
}
