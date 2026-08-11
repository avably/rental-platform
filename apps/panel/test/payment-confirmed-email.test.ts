/**
 * Mail „płatność zaksięgowana" (ADR-139) na ŻYWYM, lokalnym Supabase.
 *
 * DLACZEGO NA ŻYWEJ BAZIE: idempotencja tej wysyłki NIE jest warunkiem
 * w kodzie — składa się z dzierżawy `webhook_events` (unikat, ADR-024),
 * compare-and-set w `applySettlement` potwierdzonego odczytem po zapisie
 * i bramki reżimu 0027 (regres z `paid` niereprezentowalny). Atrapa klienta
 * bazy odpowiadałaby to, co sami byśmy jej kazali — czyli test przechodziłby
 * także bez którejkolwiek z tych bramek. Wstrzykiwane są wyłącznie granice
 * sieci: odczyt u dostawcy i TRANSPORT poczty.
 *
 * OSIE (lustro sekcji „Testy" briefu ADR-139):
 *   1. przejście w `paid` → DOKŁADNIE jeden mail, z danymi WŁAŚCIWEGO
 *      tenanta i zamówienia (sonda izolacji na cudzy tenant),
 *   2. idempotencja — ponowna dostawa tego samego zdarzenia ORAZ nowe
 *      zdarzenie dla tej samej płatności → bez drugiego maila,
 *   3. odrzucona / w toku → zero maila,
 *   4. KOLEJNOŚĆ — mail nie może wyjść, gdy zapis stanu padł,
 *   5. fail-honest — brak klucza transportu = powód w rejestrze zdarzeń,
 *      stan zamówienia nietknięty,
 *   6. rekoncyliacja (przejście wykryte BEZ zdarzenia) też wysyła — raz,
 *   7. locale: preferencja KLIENTA wygrywa z językiem tenanta (ADR-037).
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* — bez nich strażnik
 * integration-env failuje suitę.
 */
import { randomUUID } from "node:crypto";

import {
  formatMoney,
  signStripeWebhook,
  type IntentRead,
  type OutgoingEmail,
} from "@avably/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { handleStripeWebhook, type StripeWebhookDeps } from "@/lib/stripe-webhook";
import { reconcileOrderPayment } from "@/src/jobs/reconcile-payments";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const SECRET = "whsec_test_sekret_adr139";
/** najem + kaucja + dostawa — kwota, którą klient REALNIE zapłacił. */
const RENTAL_GROSZE = 10_000;
const DEPOSIT_GROSZE = 2_500;
const DELIVERY_GROSZE = 500;
const TOTAL_GROSZE = RENTAL_GROSZE + DEPOSIT_GROSZE + DELIVERY_GROSZE;

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

let orderNumberSeq = 0;
const nextOrderNumber = (): string => `MAIL-2026-${String(3000 + (orderNumberSeq += 1))}`;

function eventBody(input: { eventId: string; type?: string; intentId: string }): string {
  return JSON.stringify({
    id: input.eventId,
    type: input.type ?? "payment_intent.succeeded",
    api_version: "2026-01-01",
    data: {
      object: {
        id: input.intentId,
        object: "payment_intent",
        status: "succeeded",
        amount: TOTAL_GROSZE,
        amount_received: TOTAL_GROSZE,
      },
    },
  });
}

function signedRequest(payload: string, secret = SECRET): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request("https://panel.test/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "stripe-signature": `t=${timestamp},v1=${signStripeWebhook({ secret, timestamp, payload })}`,
      "content-type": "application/json",
    },
    body: payload,
  });
}

const intentRead = (overrides: Partial<IntentRead> = {}): IntentRead => ({
  intentId: "pi_x",
  status: "succeeded",
  amountReceivedGrosze: TOTAL_GROSZE,
  amountGrosze: TOTAL_GROSZE,
  currency: "pln",
  createdAtSeconds: Math.floor(Date.now() / 1000),
  ...overrides,
});

/** Transport-atrapa NA GRANICY SIECI: łapie wiadomości zamiast je wysyłać. */
function captureTransport() {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    transport: {
      async send(email: OutgoingEmail) {
        sent.push(email);
        return { id: `msg_${randomUUID().slice(0, 8)}` };
      },
    },
  };
}

describe.skipIf(!hasEnv)("mail „płatność zaksięgowana” — ADR-139", () => {
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

  interface Fixture {
    tenantId: string;
    tenantName: string;
    orderId: string;
    orderNumber: string;
    intentId: string;
    customerEmail: string;
  }

  /** Sklep z kontem u dostawcy + zamówienie online + klient z adresem. */
  async function seedOrder(
    options: { paymentStatus?: string; customerLocale?: string | null } = {},
  ): Promise<Fixture> {
    const tenantName = `Sklep ADR139 ${randomUUID().slice(0, 6)}`;
    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .insert({
        slug: `a139-${randomUUID().slice(0, 12)}`,
        name: tenantName,
        status: "active",
        locale: "pl",
      })
      .select("id")
      .single();
    if (tenantError || !tenant) throw new Error(`tenant: ${tenantError?.message}`);
    const tenantId = tenant.id as string;
    createdTenantIds.push(tenantId);

    const { error: accountError } = await admin.from("payment_accounts").insert({
      tenant_id: tenantId,
      provider_account_id: `acct_${randomUUID().slice(0, 12)}`,
    });
    if (accountError) throw new Error(`payment_accounts: ${accountError.message}`);

    const customerEmail = `klient-${randomUUID().slice(0, 8)}@test.local`;
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({
        tenant_id: tenantId,
        full_name: "Klient Testowy",
        email: customerEmail,
        ...(options.customerLocale !== undefined ? { locale: options.customerLocale } : {}),
      })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`customer: ${customerError?.message}`);

    const { data: pickup, error: pickupError } = await admin
      .from("pickup_locations")
      .insert({ tenant_id: tenantId, name: "Magazyn", address_city: "Warszawa" })
      .select("id")
      .single();
    if (pickupError || !pickup) throw new Error(`pickup: ${pickupError?.message}`);

    const intentId = `pi_${randomUUID().slice(0, 16)}`;
    const orderNumber = nextOrderNumber();
    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customer.id as string,
        order_number: orderNumber,
        start_date: "2026-11-01",
        end_date: "2026-11-03",
        delivery_method: "pickup",
        pickup_location_id: pickup.id as string,
        order_status: "pending",
        payment_status: options.paymentStatus ?? "pending",
        payment_provider: "stripe",
        payment_method: "online",
        provider_payment_intent_id: intentId,
        total_rental_grosze: RENTAL_GROSZE,
        total_deposit_grosze: DEPOSIT_GROSZE,
        delivery_grosze: DELIVERY_GROSZE,
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(`order: ${orderError?.message}`);

    return {
      tenantId,
      tenantName,
      orderId: order.id as string,
      orderNumber,
      intentId,
      customerEmail,
    };
  }

  async function paymentStatusOf(orderId: string): Promise<string> {
    const { data, error } = await admin
      .from("orders")
      .select("payment_status")
      .eq("id", orderId)
      .single();
    if (error) throw new Error(`odczyt zamówienia: ${error.message}`);
    return (data as { payment_status: string }).payment_status;
  }

  async function emailLogRows(tenantId: string) {
    const { data, error } = await admin
      .from("email_logs")
      .select("id, kind, order_id, recipient, subject, status, body")
      .eq("tenant_id", tenantId)
      .eq("kind", "payment_confirmed");
    if (error) throw new Error(`odczyt email_logs: ${error.message}`);
    return (data ?? []) as {
      id: string;
      kind: string;
      order_id: string | null;
      recipient: string;
      subject: string;
      status: string;
      body: string | null;
    }[];
  }

  async function webhookEventRow(eventId: string) {
    const { data, error } = await admin
      .from("webhook_events")
      .select("status, error")
      .eq("event_id", eventId)
      .maybeSingle();
    if (error) throw new Error(`odczyt rejestru: ${error.message}`);
    return data as { status: string; error: string | null } | null;
  }

  function newEventId(): string {
    const id = `evt_${randomUUID()}`;
    createdEventIds.push(id);
    return id;
  }

  type ReadIntentFn = (intentId: string, connectedAccountId: string) => Promise<IntentRead>;

  const deps = (
    readIntent: ReadIntentFn,
    paymentEmail: StripeWebhookDeps["paymentEmail"],
  ): StripeWebhookDeps => ({
    db: adminClient(),
    readIntent,
    readRefund: async (): Promise<never> => {
      throw new Error("Ta suita nie dotyka gałęzi zwrotów.");
    },
    secret: SECRET,
    ...(paymentEmail ? { paymentEmail } : {}),
  });

  const alwaysRead =
    (read: IntentRead): ReadIntentFn =>
    async () =>
      read;

  // -------------------------------------------------------------------
  // 1. Jeden mail, właściwy tenant — sonda izolacji
  // -------------------------------------------------------------------

  it("przejście w paid → DOKŁADNIE jeden mail z danymi WŁAŚCIWEGO tenanta; cudzy tenant bez śladu", async () => {
    const a = await seedOrder();
    const b = await seedOrder(); // sonda: sąsiad, którego NIC nie powinno dotknąć
    const eventId = newEventId();
    const { transport, sent } = captureTransport();

    const response = await handleStripeWebhook(
      signedRequest(eventBody({ eventId, intentId: a.intentId })),
      deps(alwaysRead(intentRead({ intentId: a.intentId })), {
        transport,
        availability: { available: true },
      }),
    );

    expect(response.status).toBe(200);
    expect(await paymentStatusOf(a.orderId)).toBe("paid");

    // Jeden mail, do klienta tenanta A, z JEGO numerem zamówienia i PEŁNĄ
    // kwotą (najem + kaucja + dostawa) w PLN i locale pl.
    expect(sent).toHaveLength(1);
    const email = sent[0]!;
    expect(email.to).toBe(a.customerEmail);
    expect(email.subject).toBe("Płatność zaksięgowana");
    expect(email.from).toContain(a.tenantName);
    expect(email.html).toContain(a.orderNumber);
    expect(email.html).toContain(formatMoney(TOTAL_GROSZE, "PLN", "pl"));
    expect(email.html).not.toContain(b.orderNumber);
    expect(email.html).not.toContain(b.tenantName);

    // Rejestr: wpis `sent` z treścią TEJ próby, przypięty do zamówienia A.
    const logsA = await emailLogRows(a.tenantId);
    expect(logsA).toHaveLength(1);
    expect(logsA[0]!.status).toBe("sent");
    expect(logsA[0]!.order_id).toBe(a.orderId);
    expect(logsA[0]!.recipient).toBe(a.customerEmail);
    expect(logsA[0]!.body).toContain(a.orderNumber);

    // Sonda izolacji: u sąsiada zero wpisów, zero zmiany stanu, zero maili.
    expect(await emailLogRows(b.tenantId)).toHaveLength(0);
    expect(await paymentStatusOf(b.orderId)).toBe("pending");
    expect(sent.every((message) => message.to === a.customerEmail)).toBe(true);
  });

  // -------------------------------------------------------------------
  // 2. Idempotencja: ta sama dostawa i nowe zdarzenie bez przejścia
  // -------------------------------------------------------------------

  it("ponowna dostawa TEGO SAMEGO zdarzenia → duplikat, bez drugiego maila", async () => {
    const fixture = await seedOrder();
    const eventId = newEventId();
    const payload = eventBody({ eventId, intentId: fixture.intentId });
    const { transport, sent } = captureTransport();
    const webhookDeps = deps(alwaysRead(intentRead({ intentId: fixture.intentId })), {
      transport,
      availability: { available: true },
    });

    const first = await handleStripeWebhook(signedRequest(payload), webhookDeps);
    const second = await handleStripeWebhook(signedRequest(payload), webhookDeps);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { status: string }).status).toBe("duplicate");
    expect(sent).toHaveLength(1);
    expect(await emailLogRows(fixture.tenantId)).toHaveLength(1);
  });

  it("NOWE zdarzenie dla płatności już zaksięgowanej (changed:false) → bez drugiego maila", async () => {
    const fixture = await seedOrder();
    const { transport, sent } = captureTransport();
    const webhookDeps = deps(alwaysRead(intentRead({ intentId: fixture.intentId })), {
      transport,
      availability: { available: true },
    });

    const first = await handleStripeWebhook(
      signedRequest(eventBody({ eventId: newEventId(), intentId: fixture.intentId })),
      webhookDeps,
    );
    // Dostawca potrafi wysłać drugie zdarzenie o tej samej płatności (inny
    // event.id — dzierżawa NIE łapie). Jedyną zaporą jest `changed: true`.
    const second = await handleStripeWebhook(
      signedRequest(eventBody({ eventId: newEventId(), intentId: fixture.intentId })),
      webhookDeps,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { status: string }).status).toBe("noop");
    expect(await paymentStatusOf(fixture.orderId)).toBe("paid");
    expect(sent, "drugie zdarzenie bez przejścia nie wysyła maila").toHaveLength(1);
    expect(await emailLogRows(fixture.tenantId)).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // 3. Odrzucona / w toku → zero maila
  // -------------------------------------------------------------------

  it("płatność odrzucona (requires_payment_method → payment_failed) → ZERO maila", async () => {
    const fixture = await seedOrder();
    const { transport, sent } = captureTransport();

    const response = await handleStripeWebhook(
      signedRequest(eventBody({ eventId: newEventId(), intentId: fixture.intentId })),
      deps(
        alwaysRead(
          intentRead({
            intentId: fixture.intentId,
            status: "requires_payment_method",
            amountReceivedGrosze: 0,
          }),
        ),
        { transport, availability: { available: true } },
      ),
    );

    expect(response.status).toBe(200);
    // Przejście BYŁO (pending → payment_failed) — ale nie w `paid`,
    // więc potwierdzenia nie ma.
    expect(await paymentStatusOf(fixture.orderId)).toBe("payment_failed");
    expect(sent).toHaveLength(0);
    expect(await emailLogRows(fixture.tenantId)).toHaveLength(0);
  });

  it("płatność w toku (processing) → noop i ZERO maila", async () => {
    const fixture = await seedOrder();
    const { transport, sent } = captureTransport();

    const response = await handleStripeWebhook(
      signedRequest(eventBody({ eventId: newEventId(), intentId: fixture.intentId })),
      deps(
        alwaysRead(
          intentRead({ intentId: fixture.intentId, status: "processing", amountReceivedGrosze: 0 }),
        ),
        { transport, availability: { available: true } },
      ),
    );

    expect(response.status).toBe(200);
    expect(await paymentStatusOf(fixture.orderId)).toBe("pending");
    expect(sent).toHaveLength(0);
    expect(await emailLogRows(fixture.tenantId)).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // 4. Kolejność: zapis stanu padł → mail NIE MA PRAWA wyjść
  // -------------------------------------------------------------------

  it("zapis stanu nie doszedł do skutku → ZERO maila (mail dopiero PO utrwalonym przejściu)", async () => {
    const fixture = await seedOrder();
    const eventId = newEventId();
    const { transport, sent } = captureTransport();

    const response = await handleStripeWebhook(
      signedRequest(eventBody({ eventId, intentId: fixture.intentId })),
      deps(
        async () => {
          // Wyprzedzenie przez równoległą ścieżkę dokładnie w oknie między
          // odczytem zamówienia a zapisem — compare-and-set nie trafi,
          // odczyt po zapisie pokaże rozjazd, wiersz skończy jako `failed`.
          const { error } = await admin
            .from("orders")
            .update({ payment_status: "payment_failed" })
            .eq("id", fixture.orderId);
          if (error) throw new Error(`wyprzedzenie: ${error.message}`);
          return intentRead({ intentId: fixture.intentId });
        },
        { transport, availability: { available: true } },
      ),
    );

    expect(response.status).toBe(200);
    expect(await paymentStatusOf(fixture.orderId)).toBe("payment_failed");
    expect((await webhookEventRow(eventId))?.status).toBe("failed");
    // SEDNO OSI: żadna wiadomość nie wyszła i żaden wpis nie powstał —
    // potwierdzenie płatności, której nie zaksięgowaliśmy, byłoby kłamstwem.
    expect(sent).toHaveLength(0);
    expect(await emailLogRows(fixture.tenantId)).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // 5. Fail-honest: brak klucza transportu
  // -------------------------------------------------------------------

  it("brak klucza transportu → stan ZAPISANY, powód w rejestrze zdarzeń, zero wpisu wysyłki", async () => {
    const fixture = await seedOrder();
    const eventId = newEventId();
    const { transport, sent } = captureTransport();

    const response = await handleStripeWebhook(
      signedRequest(eventBody({ eventId, intentId: fixture.intentId })),
      deps(alwaysRead(intentRead({ intentId: fixture.intentId })), {
        transport,
        availability: {
          available: false,
          reason: "Wysyłka e-maili nie jest skonfigurowana (brak klucza transportu).",
        },
      }),
    );

    expect(response.status).toBe(200);
    // Wzorzec 8b: poczta NIE cofa i NIE blokuje przejścia…
    expect(await paymentStatusOf(fixture.orderId)).toBe("paid");
    // …a powód niewysłania jest ZAREJESTROWANY, nie przemilczany.
    const row = await webhookEventRow(eventId);
    expect(row?.status).toBe("processed");
    expect(row?.error).toContain("Potwierdzenie płatności nie zostało wysłane");
    expect(row?.error).toContain("brak klucza transportu");
    expect(sent).toHaveLength(0);
    expect(await emailLogRows(fixture.tenantId)).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // 6. Rekoncyliacja: przejście wykryte BEZ zdarzenia też wysyła — raz
  // -------------------------------------------------------------------

  it("rekoncyliacja bez zdarzenia → mail wychodzi; ponowne sprawdzenie → bez drugiego", async () => {
    const fixture = await seedOrder();
    const { transport, sent } = captureTransport();
    const reconcileDeps = {
      db: admin,
      readIntent: async () => intentRead({ intentId: fixture.intentId }),
      cancelIntent: async (): Promise<never> => {
        throw new Error("Succeeded nie podlega wygaszeniu — ta suita go nie woła.");
      },
      paymentEmail: { transport, availability: { available: true } },
    };

    // Ta sama ścieżka co przycisk operatora „Sprawdź status płatności".
    const first = await reconcileOrderPayment({
      tenantId: fixture.tenantId,
      orderId: fixture.orderId,
      ...reconcileDeps,
    });
    expect(first.outcome).toBe("settled");
    expect(first.paymentStatus).toBe("paid");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(fixture.customerEmail);
    expect(await emailLogRows(fixture.tenantId)).toHaveLength(1);

    // Drugie kliknięcie: `paid` jest poza CHECKABLE — bez odczytu, bez maila.
    const second = await reconcileOrderPayment({
      tenantId: fixture.tenantId,
      orderId: fixture.orderId,
      ...reconcileDeps,
    });
    expect(second.outcome).toBe("skipped");
    expect(sent).toHaveLength(1);
    expect(await emailLogRows(fixture.tenantId)).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // 7. Locale: preferencja klienta wygrywa z językiem tenanta (ADR-037)
  // -------------------------------------------------------------------

  it("klient z locale=en dostaje wiadomość po angielsku mimo tenanta pl", async () => {
    const fixture = await seedOrder({ customerLocale: "en" });
    const { transport, sent } = captureTransport();

    const response = await handleStripeWebhook(
      signedRequest(eventBody({ eventId: newEventId(), intentId: fixture.intentId })),
      deps(alwaysRead(intentRead({ intentId: fixture.intentId })), {
        transport,
        availability: { available: true },
      }),
    );

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Payment confirmed");
    expect(sent[0]!.html).toContain('lang="en"');
    expect(sent[0]!.html).toContain(fixture.orderNumber);
  });
});
