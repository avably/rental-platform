/**
 * Rdzeń startu Checkoutu abonamentu (J2 faza 2a, ADR-136) — logika W6/K2
 * wyjęta z server action, żeby dała się zawołać z testu z WSTRZYKNIĘTYM
 * klientem rozliczeń i klientem bazy (wzorzec stripe-webhook: trasa/akcja
 * jest cienka, rdzeń testowalny).
 *
 * W6 — jedna subskrypcja na tenanta, trzy warstwy W TEJ KOLEJNOŚCI:
 *   1. projekcja (tani odczyt RLS) — odmowa, gdy zna żywą subskrypcję,
 *   2. prawda źródłowa u dostawcy — projekcja po powrocie z Checkoutu bywa
 *      jeszcze pusta (K3: redirect wraca szybciej niż webhook), więc lista
 *      subskrypcji customera rozstrzyga,
 *   3. wygaszenie otwartych sesji Checkoutu — dwie karty przeglądarki nie
 *      zostawią dwóch płacalnych sesji; po tym kroku żyje najwyżej JEDNA.
 *
 * K2 — Customer: search po metadata.tenant_id, create dopiero po pustym
 * wyniku, klucz idempotencji DETERMINISTYCZNY per tenant. Idempotency-Key
 * sesji budowany z ZAMIARU (tenant|plan|interwał): dwuklik tego samego
 * zamiaru w oknie pamięci dostawcy dostaje TĘ SAMĄ sesję; wyścig dwóch
 * RÓŻNYCH zamiarów rozstrzyga warstwa 3 (starsza sesja wygaszona).
 */
import {
  isLiveSaasSubscriptionStatus,
  saasPriceLookupKey,
  type SaasBillingInterval,
  type SaasPlanId,
} from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Wycinek portu rozliczeń, którego rdzeń potrzebuje (DI dla testów). */
export interface BillingCheckoutClient {
  findCustomerByTenant(tenantId: string): Promise<string | null>;
  createCustomer(input: {
    tenantId: string;
    email?: string | undefined;
    name?: string | undefined;
    idempotencyKey: string;
  }): Promise<string>;
  listSubscriptions(customerId: string): Promise<{ id: string; status: string }[]>;
  listOpenCheckoutSessionIds(customerId: string): Promise<string[]>;
  expireCheckoutSession(sessionId: string): Promise<void>;
  findPriceIdByLookupKey(lookupKey: string): Promise<string>;
  createSubscriptionCheckoutSession(input: {
    customerId: string;
    priceId: string;
    tenantId: string;
    successUrl: string;
    cancelUrl: string;
    locale?: string | undefined;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; url: string }>;
}

export interface StartSaasCheckoutDeps {
  /** Klient SESJI właściciela — odczyt projekcji i nazwy tenanta przez RLS. */
  supabase: SupabaseClient;
  billing: BillingCheckoutClient;
}

export interface StartSaasCheckoutInput {
  tenantId: string;
  userEmail: string | null;
  planId: SaasPlanId;
  interval: SaasBillingInterval;
  locale: string;
  successUrl: string;
  cancelUrl: string;
}

export type StartSaasCheckoutOutcome = { url: string } | { error: string };

const ALREADY_SUBSCRIBED =
  "Organizacja ma już aktywną subskrypcję - zmiana planu to osobna ścieżka.";

export async function startSaasCheckout(
  deps: StartSaasCheckoutDeps,
  input: StartSaasCheckoutInput,
): Promise<StartSaasCheckoutOutcome> {
  // Warstwa 1 (W6): projekcja zna żywą subskrypcję → nie zaczynamy drugiej.
  const projection = await deps.supabase
    .from("subscriptions")
    .select("status")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (projection.error) {
    return { error: `Odczyt stanu subskrypcji nie powiódł się: ${projection.error.message}` };
  }
  const projected = projection.data as { status: string } | null;
  if (projected && isLiveSaasSubscriptionStatus(projected.status)) {
    return { error: ALREADY_SUBSCRIBED };
  }

  // Nazwa organizacji na Customerze (prezentacja w dashboardzie dostawcy).
  const tenantQuery = await deps.supabase
    .from("tenants")
    .select("name")
    .eq("id", input.tenantId)
    .maybeSingle();
  const tenantName = (tenantQuery.data as { name: string } | null)?.name;

  // K2: search → create z kluczem deterministycznym.
  let customerId = await deps.billing.findCustomerByTenant(input.tenantId);
  if (!customerId) {
    customerId = await deps.billing.createCustomer({
      tenantId: input.tenantId,
      email: input.userEmail ?? undefined,
      name: tenantName ?? undefined,
      idempotencyKey: `saas-customer-${input.tenantId}`,
    });
  }

  // Warstwa 2 (W6): prawda źródłowa — subskrypcje customera u dostawcy.
  const subscriptions = await deps.billing.listSubscriptions(customerId);
  if (subscriptions.some((sub) => isLiveSaasSubscriptionStatus(sub.status))) {
    return { error: ALREADY_SUBSCRIBED };
  }

  // Warstwa 3 (W6): najwyżej jedna otwarta sesja Checkoutu per customer.
  const openSessions = await deps.billing.listOpenCheckoutSessionIds(customerId);
  for (const sessionId of openSessions) {
    await deps.billing.expireCheckoutSession(sessionId);
  }

  const priceId = await deps.billing.findPriceIdByLookupKey(
    saasPriceLookupKey(input.planId, input.interval),
  );

  const session = await deps.billing.createSubscriptionCheckoutSession({
    customerId,
    priceId,
    tenantId: input.tenantId,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    locale: input.locale,
    idempotencyKey: `saas-checkout-${input.tenantId}-${input.planId}-${input.interval}`,
  });

  return { url: session.url };
}
