/**
 * Handler webhooka BILLINGU SaaS (J2 faza 2a, ADR-136) na ŻYWYM lokalnym
 * Supabase — lustro suity stripe-webhook.test.ts, bo trzy z pięciu reguł są
 * własnością BAZY: idempotencja (unikat provider+event_id z 0030/0067),
 * tablica przejść i bramki (funkcja 0067), izolacja identyfikatorów
 * dostawcy (unikaty częściowe). Wstrzykiwane są wyłącznie ODCZYTY u dostawcy
 * i wysyłka maila — rzeczy po drugiej stronie sieci.
 *
 * OSIE (sekcja bezpieczeństwa briefu J2 fazy 2a):
 *   1. podpis: brak / zły sekret / PODMIENIONE CIAŁO → 400 i ZERO zapisu,
 *   2. idempotencja: wielokrotna dostawa (też RÓWNOLEGŁA) = jeden wiersz,
 *      jedna zmiana stanu i JEDEN mail dunningowy,
 *   3. stan Z ODCZYTU: payload krzyczy „active", odczyt mówi „unpaid" →
 *      tenant SUSPENDED (payload nie jest źródłem stanu),
 *   4. dwustopniowy odczyt cs_/in_ → sub_ z ODCZYTU, nie z payloadu (W9),
 *   5. cudzy obiekt: subskrypcja bez naszych metadanych → „unrelated" bez
 *      dotknięcia stanu; subskrypcja zmapowana na tenanta A nie wejdzie
 *      tenantowi B (unikat → deterministyczna odmowa, B nietknięty),
 *   6. 5xx przy awarii odczytu = zwolniona dzierżawa → ponowienie działa.
 */
import { randomUUID } from "node:crypto";

import { signStripeWebhook, type SaasSubscriptionRead } from "@avably/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  BILLING_WEBHOOK_PROVIDER,
  handleStripeBillingWebhook,
  type StripeBillingWebhookDeps,
} from "@/lib/stripe-billing-webhook";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const SECRET = "whsec_test_sekret_billingu_j2";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const adminClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

const createdTenantIds: string[] = [];
const createdEventIds: string[] = [];

/** Ciało zdarzenia w kształcie dostawcy — ze stanem, którego handler NIE użYJE. */
function eventBody(input: {
  eventId: string;
  type?: string;
  objectId: string;
  bodyStatus?: string;
}): string {
  createdEventIds.push(input.eventId);
  return JSON.stringify({
    id: input.eventId,
    object: "event",
    type: input.type ?? "customer.subscription.updated",
    api_version: "2024-06-20",
    data: {
      object: {
        id: input.objectId,
        object: "subscription",
        // Status w CIELE — celowo bywa sprzeczny z odczytem (oś 3).
        status: input.bodyStatus ?? "active",
      },
    },
  });
}

function signedRequest(payload: string, secret = SECRET): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request("https://panel.test/api/webhooks/stripe-billing", {
    method: "POST",
    headers: {
      "stripe-signature": `t=${timestamp},v1=${signStripeWebhook({ secret, timestamp, payload })}`,
      "content-type": "application/json",
    },
    body: payload,
  });
}

function subscriptionRead(
  overrides: Partial<SaasSubscriptionRead> = {},
): SaasSubscriptionRead {
  return {
    subscriptionId: "sub_x",
    // Świeży customer per wywołanie: 0067 ma unikat częściowy na
    // stripe_customer_id — współdzielony literał między testami dawałby
    // 23505 zamiast badanego zachowania (ta sama pułapka co w macierzy RLS).
    customerId: `cus_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    status: "active",
    tenantIdFromMetadata: null,
    priceLookupKey: "saas_standard_monthly",
    currentPeriodStart: new Date(Date.now() - 86_400_000).toISOString(),
    currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000).toISOString(),
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe.skipIf(!hasEnv)("handler webhooka billingu — ADR-136", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdEventIds.length > 0) {
      await admin.from("webhook_events").delete().in("event_id", createdEventIds);
    }
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
  });

  async function seedTenant(): Promise<string> {
    const slug = `bwh${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: "Billing webhook test" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const tenantId = (data as { id: string }).id;
    createdTenantIds.push(tenantId);
    return tenantId;
  }

  async function tenantStatus(tenantId: string): Promise<string> {
    const { data } = await admin.from("tenants").select("status").eq("id", tenantId).single();
    return (data as { status: string }).status;
  }

  function makeDeps(
    read: SaasSubscriptionRead | (() => Promise<SaasSubscriptionRead>),
    overrides: Partial<StripeBillingWebhookDeps> = {},
  ): StripeBillingWebhookDeps & { emailSpy: ReturnType<typeof vi.fn> } {
    const emailSpy = vi.fn(async () => undefined);
    return {
      db: admin,
      readSubscription: typeof read === "function" ? read : async () => read,
      readCheckoutSessionSubscriptionId: async () => null,
      readInvoiceSubscriptionId: async () => null,
      sendPaymentFailedEmail: emailSpy,
      secret: SECRET,
      emailSpy,
      ...overrides,
    };
  }

  it("zły podpis / brak podpisu / podmienione ciało → 400 i ZERO zapisu", async () => {
    const tenantId = await seedTenant();
    const eventId = `evt_sig_${randomUUID().slice(0, 8)}`;
    const payload = eventBody({ eventId, objectId: "sub_sig" });
    const deps = makeDeps(subscriptionRead({ tenantIdFromMetadata: tenantId }));

    // Brak nagłówka.
    const noHeader = await handleStripeBillingWebhook(
      new Request("https://panel.test/api/webhooks/stripe-billing", {
        method: "POST",
        body: payload,
      }),
      deps,
    );
    expect(noHeader.status).toBe(400);

    // Zły sekret.
    const wrongSecret = await handleStripeBillingWebhook(
      signedRequest(payload, "whsec_cudzy_sekret_123"),
      deps,
    );
    expect(wrongSecret.status).toBe(400);

    // Podpis poprawny dla INNEGO ciała.
    const timestamp = String(Math.floor(Date.now() / 1000));
    const foreign = signStripeWebhook({ secret: SECRET, timestamp, payload: "{}" });
    const tampered = await handleStripeBillingWebhook(
      new Request("https://panel.test/api/webhooks/stripe-billing", {
        method: "POST",
        headers: { "stripe-signature": `t=${timestamp},v1=${foreign}` },
        body: payload,
      }),
      deps,
    );
    expect(tampered.status).toBe(400);

    const { data: rows } = await admin
      .from("webhook_events")
      .select("id")
      .eq("provider", BILLING_WEBHOOK_PROVIDER)
      .eq("event_id", eventId);
    expect(rows ?? []).toHaveLength(0);
    expect(await tenantStatus(tenantId)).toBe("trialing");
    expect(deps.emailSpy).not.toHaveBeenCalled();
  });

  it("stan Z ODCZYTU, nie z payloadu: ciało mówi active, odczyt unpaid → suspended", async () => {
    const tenantId = await seedTenant();
    const subId = `sub_read_${randomUUID().slice(0, 8)}`;
    const payload = eventBody({
      eventId: `evt_read_${randomUUID().slice(0, 8)}`,
      objectId: subId,
      bodyStatus: "active",
    });
    const deps = makeDeps(
      subscriptionRead({ subscriptionId: subId, status: "unpaid", tenantIdFromMetadata: tenantId }),
    );

    const response = await handleStripeBillingWebhook(signedRequest(payload), deps);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { tenantStatus: string }).tenantStatus).toBe("suspended");
    expect(await tenantStatus(tenantId)).toBe("suspended");
  });

  it("idempotencja: pięć dostaw (w tym równoległe) = jeden wiersz, jedna zmiana, JEDEN mail", async () => {
    const tenantId = await seedTenant();
    const subId = `sub_idem_${randomUUID().slice(0, 8)}`;
    const eventId = `evt_idem_${randomUUID().slice(0, 8)}`;
    const payload = eventBody({
      eventId,
      type: "invoice.payment_failed",
      objectId: `in_idem_${randomUUID().slice(0, 8)}`,
    });
    const deps = makeDeps(
      subscriptionRead({
        subscriptionId: subId,
        status: "past_due",
        tenantIdFromMetadata: tenantId,
      }),
      {
        readInvoiceSubscriptionId: async () => subId,
      },
    );

    const responses = await Promise.all([
      handleStripeBillingWebhook(signedRequest(payload), deps),
      handleStripeBillingWebhook(signedRequest(payload), deps),
      handleStripeBillingWebhook(signedRequest(payload), deps),
    ]);
    responses.push(await handleStripeBillingWebhook(signedRequest(payload), deps));
    responses.push(await handleStripeBillingWebhook(signedRequest(payload), deps));

    for (const response of responses) expect(response.status).toBe(200);
    const statuses = await Promise.all(
      responses.map(async (r) => ((await r.json()) as { status: string }).status),
    );
    expect(statuses.filter((s) => s === "processed")).toHaveLength(1);
    expect(statuses.filter((s) => s === "duplicate")).toHaveLength(4);

    const { data: rows } = await admin
      .from("webhook_events")
      .select("id, status")
      .eq("provider", BILLING_WEBHOOK_PROVIDER)
      .eq("event_id", eventId);
    expect(rows ?? []).toHaveLength(1);
    expect(await tenantStatus(tenantId)).toBe("past_due");
    // JEDEN mail mimo pięciu dostaw — idempotencja obejmuje skutki uboczne.
    expect(deps.emailSpy).toHaveBeenCalledTimes(1);
  });

  it("dwustopniowy odczyt: cs_ → subskrypcja z ODCZYTU sesji, nie z payloadu (W9)", async () => {
    const tenantId = await seedTenant();
    const subId = `sub_cs_${randomUUID().slice(0, 8)}`;
    const csId = `cs_${randomUUID().slice(0, 8)}`;
    const sessionSpy = vi.fn(async (sessionId: string) => {
      expect(sessionId).toBe(csId);
      return subId;
    });
    const payload = eventBody({
      eventId: `evt_cs_${randomUUID().slice(0, 8)}`,
      type: "checkout.session.completed",
      objectId: csId,
    });
    const deps = makeDeps(
      subscriptionRead({ subscriptionId: subId, status: "active", tenantIdFromMetadata: tenantId }),
      { readCheckoutSessionSubscriptionId: sessionSpy },
    );

    const response = await handleStripeBillingWebhook(signedRequest(payload), deps);
    expect(response.status).toBe(200);
    expect(sessionSpy).toHaveBeenCalledTimes(1);
    expect(await tenantStatus(tenantId)).toBe("active");

    const { data: sub } = await admin
      .from("subscriptions")
      .select("stripe_subscription_id, plan_id, status")
      .eq("tenant_id", tenantId)
      .single();
    expect(sub).toMatchObject({
      stripe_subscription_id: subId,
      plan_id: "standard",
      status: "active",
    });
  });

  it("subskrypcja bez metadata.tenant_id (fixture/cudzy obiekt) → unrelated, zero stanu", async () => {
    const payload = eventBody({
      eventId: `evt_unrel_${randomUUID().slice(0, 8)}`,
      objectId: `sub_unrel_${randomUUID().slice(0, 8)}`,
    });
    const deps = makeDeps(subscriptionRead({ tenantIdFromMetadata: null }));
    const response = await handleStripeBillingWebhook(signedRequest(payload), deps);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe("unrelated");
  });

  it("cudza subskrypcja nie wchodzi drugiemu tenantowi: unikat → odmowa, tenant B nietknięty", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const subId = `sub_cross_${randomUUID().slice(0, 8)}`;

    // Subskrypcja legalnie zmapowana na tenanta A.
    const first = await handleStripeBillingWebhook(
      signedRequest(eventBody({ eventId: `evt_cross_a_${randomUUID().slice(0, 8)}`, objectId: subId })),
      makeDeps(
        subscriptionRead({ subscriptionId: subId, tenantIdFromMetadata: tenantA }),
      ),
    );
    expect(first.status).toBe(200);
    // Jawnie „processed" — samo 200 obejmuje też odmowy (rejected).
    expect(((await first.json()) as { status: string }).status).toBe("processed");

    // Ten sam sub_… z metadanymi wskazującymi tenanta B (skrzyżowane
    // strumienie / próba podszycia) → deterministyczna odmowa.
    const second = await handleStripeBillingWebhook(
      signedRequest(eventBody({ eventId: `evt_cross_b_${randomUUID().slice(0, 8)}`, objectId: subId })),
      makeDeps(
        subscriptionRead({ subscriptionId: subId, tenantIdFromMetadata: tenantB }),
      ),
    );
    expect(second.status).toBe(200);
    expect(((await second.json()) as { status: string }).status).toBe("rejected");
    expect(await tenantStatus(tenantB)).toBe("trialing");
    const { data: subB } = await admin
      .from("subscriptions")
      .select("tenant_id")
      .eq("tenant_id", tenantB);
    expect(subB ?? []).toHaveLength(0);
  });

  it("cena bez klucza saas_* na NASZEJ subskrypcji → failed z powodem (2xx)", async () => {
    const tenantId = await seedTenant();
    const eventId = `evt_price_${randomUUID().slice(0, 8)}`;
    const payload = eventBody({ eventId, objectId: `sub_price_${randomUUID().slice(0, 8)}` });
    const deps = makeDeps(
      subscriptionRead({ tenantIdFromMetadata: tenantId, priceLookupKey: null }),
    );
    const response = await handleStripeBillingWebhook(signedRequest(payload), deps);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe("rejected");
    const { data: row } = await admin
      .from("webhook_events")
      .select("status, error")
      .eq("provider", BILLING_WEBHOOK_PROVIDER)
      .eq("event_id", eventId)
      .single();
    expect((row as { status: string }).status).toBe("failed");
    expect(await tenantStatus(tenantId)).toBe("trialing");
  });

  it("awaria odczytu u dostawcy → 5xx + ZWOLNIONA dzierżawa; ponowienie przechodzi", async () => {
    const tenantId = await seedTenant();
    const subId = `sub_retry_${randomUUID().slice(0, 8)}`;
    const eventId = `evt_retry_${randomUUID().slice(0, 8)}`;
    const payload = eventBody({ eventId, objectId: subId });

    let attempts = 0;
    const deps = makeDeps(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("dostawca niedostępny");
      return subscriptionRead({ subscriptionId: subId, tenantIdFromMetadata: tenantId });
    });

    const failed = await handleStripeBillingWebhook(signedRequest(payload), deps);
    expect(failed.status).toBe(500);
    const { data: afterFail } = await admin
      .from("webhook_events")
      .select("id")
      .eq("provider", BILLING_WEBHOOK_PROVIDER)
      .eq("event_id", eventId);
    expect(afterFail ?? []).toHaveLength(0); // dzierżawa zwolniona

    const retried = await handleStripeBillingWebhook(signedRequest(payload), deps);
    expect(retried.status).toBe(200);
    expect(((await retried.json()) as { status: string }).status).toBe("processed");
    expect(await tenantStatus(tenantId)).toBe("active");
  });

  it("typ spoza listy obserwowanych → ignored z rejestracją (ślad zamiast ciszy)", async () => {
    const eventId = `evt_ign_${randomUUID().slice(0, 8)}`;
    const payload = eventBody({
      eventId,
      type: "customer.updated",
      objectId: `cus_${randomUUID().slice(0, 8)}`,
    });
    const deps = makeDeps(subscriptionRead());
    const response = await handleStripeBillingWebhook(signedRequest(payload), deps);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe("ignored");
    const { data: row } = await admin
      .from("webhook_events")
      .select("status")
      .eq("provider", BILLING_WEBHOOK_PROVIDER)
      .eq("event_id", eventId)
      .single();
    expect((row as { status: string }).status).toBe("processed");
  });

  it("mail dunningowy: TYLKO invoice.payment_failed i TYLKO po zapisie stanu", async () => {
    const tenantId = await seedTenant();
    const subId = `sub_mail_${randomUUID().slice(0, 8)}`;
    // invoice.paid — bez maila.
    const paidDeps = makeDeps(
      subscriptionRead({ subscriptionId: subId, tenantIdFromMetadata: tenantId }),
      { readInvoiceSubscriptionId: async () => subId },
    );
    await handleStripeBillingWebhook(
      signedRequest(
        eventBody({
          eventId: `evt_paid_${randomUUID().slice(0, 8)}`,
          type: "invoice.paid",
          objectId: `in_${randomUUID().slice(0, 8)}`,
        }),
      ),
      paidDeps,
    );
    expect(paidDeps.emailSpy).not.toHaveBeenCalled();

    // invoice.payment_failed — mail z tenantem z ODCZYTU.
    const failedDeps = makeDeps(
      subscriptionRead({
        subscriptionId: subId,
        status: "past_due",
        tenantIdFromMetadata: tenantId,
      }),
      { readInvoiceSubscriptionId: async () => subId },
    );
    await handleStripeBillingWebhook(
      signedRequest(
        eventBody({
          eventId: `evt_fail_${randomUUID().slice(0, 8)}`,
          type: "invoice.payment_failed",
          objectId: `in_${randomUUID().slice(0, 8)}`,
        }),
      ),
      failedDeps,
    );
    expect(failedDeps.emailSpy).toHaveBeenCalledTimes(1);
    expect(failedDeps.emailSpy).toHaveBeenCalledWith({ tenantId });
    expect(await tenantStatus(tenantId)).toBe("past_due");
  });
});
