/**
 * Handler webhooka płatności (Z4, ADR-067) na ŻYWYM, lokalnym Supabase.
 *
 * DLACZEGO NA ŻYWEJ BAZIE, A NIE NA ATRAPIE KLIENTA. Trzy z pięciu reguł,
 * których ten handler ma dowodzić, są WŁASNOŚCIĄ BAZY, nie kodu:
 * idempotencja (unikat na `event_id`), odmowa regresu z `paid` (bramka 0027)
 * i granica writera rozliczeń (0030). Atrapa `SupabaseClient` odpowiadałaby
 * to, co sami byśmy jej kazali — czyli test przechodziłby także wtedy, gdyby
 * żadnej z tych bramek nie było. Wstrzykiwany jest wyłącznie ODCZYT U
 * DOSTAWCY, bo tylko on jest po drugiej stronie sieci.
 *
 * KRYTERIUM UKOŃCZENIA ZADANIA jest rozpisane na osie:
 *   1. podpis — brak/zły/PODMIENIONE CIAŁO → 400 i ZERO zapisu (rejestr
 *      i zamówienie nietknięte),
 *   2. idempotencja — pięć dostaw tego samego `event.id` = jeden wiersz
 *      i jedna zmiana statusu; dostawy RÓWNOLEGŁE też,
 *   3. stan Z ODCZYTU — zdarzenie niosące `succeeded` dla intentu, który
 *      u dostawcy jest `requires_payment_method`, NIE ustawia `paid`,
 *   4. odczyt po zapisie — rozjazd zamierzenia ze stanem utrwalonym jest
 *      raportowany jako `failed` z powodem, nigdy jako „przetworzone",
 *   5. 2xx przy odmowie bramki — dostawca nie ponawia w nieskończoność,
 *      ale rejestr mówi ODMOWA, a nie sukces.
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* — bez nich strażnik
 * integration-env failuje suitę.
 */
import { randomUUID } from "node:crypto";

import { signStripeWebhook, type IntentRead } from "@avably/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { handleStripeWebhook } from "@/lib/stripe-webhook";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const SECRET = "whsec_test_sekret_webhooka_z4";
const AMOUNT_GROSZE = 12_345;

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
const nextOrderNumber = (): string => String(2000 + (orderNumberSeq += 1));

/** Ciało zdarzenia w kształcie dostawcy — ze stanem, którego handler NIE użyje. */
function eventBody(input: {
  eventId: string;
  type?: string;
  intentId: string;
  /** Status w CIELE — celowo bywa sprzeczny z odczytem. */
  bodyStatus?: string;
}): string {
  return JSON.stringify({
    id: input.eventId,
    type: input.type ?? "payment_intent.succeeded",
    api_version: "2026-01-01",
    data: {
      object: {
        id: input.intentId,
        object: "payment_intent",
        status: input.bodyStatus ?? "succeeded",
        amount: AMOUNT_GROSZE,
        amount_received: AMOUNT_GROSZE,
      },
    },
  });
}

/** Żądanie podpisane sekretem endpointu — dokładnie jak u dostawcy. */
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
  amountReceivedGrosze: AMOUNT_GROSZE,
  amountGrosze: AMOUNT_GROSZE,
  currency: "pln",
  ...overrides,
});

describe.skipIf(!hasEnv)("handler webhooka płatności — Z4", () => {
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
    orderId: string;
    intentId: string;
  }

  /** Sklep z kontem u dostawcy + zamówienie online związane z płatnością. */
  async function seedOrder(paymentStatus = "pending"): Promise<Fixture> {
    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .insert({
        slug: `z4h-${randomUUID().slice(0, 12)}`,
        name: "Sklep Z4",
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

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({
        tenant_id: tenantId,
        full_name: "Klient",
        email: `k-${randomUUID().slice(0, 8)}@test.local`,
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
    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customer.id as string,
        order_number: `Z4H-2026-${nextOrderNumber()}`,
        start_date: "2026-11-01",
        end_date: "2026-11-03",
        delivery_method: "pickup",
        pickup_location_id: pickup.id as string,
        order_status: "pending",
        payment_status: paymentStatus,
        payment_provider: "stripe",
        payment_method: "online",
        provider_payment_intent_id: intentId,
        total_rental_grosze: AMOUNT_GROSZE,
        total_deposit_grosze: 0,
        delivery_grosze: 0,
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(`order: ${orderError?.message}`);

    return { tenantId, orderId: order.id as string, intentId };
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

  async function eventRows(eventId: string) {
    const { data, error } = await admin
      .from("webhook_events")
      .select("id, status, error, event_type, processed_at")
      .eq("event_id", eventId);
    if (error) throw new Error(`odczyt rejestru: ${error.message}`);
    return (data ?? []) as {
      id: string;
      status: string;
      error: string | null;
      event_type: string;
      processed_at: string | null;
    }[];
  }

  function newEventId(): string {
    const id = `evt_${randomUUID()}`;
    createdEventIds.push(id);
    return id;
  }

  // Odczyt zwrotu (Z5) RZUCA: ta suita dotyczy wyłącznie gałęzi płatności,
  // a atrapa oddająca cokolwiek udawałaby, że gałąź zwrotów jest tu badana.
  // Jej wywołanie ma być głośnym błędem, nie cichym zerem.
  const deps = (readIntent: StripeReadIntent) => ({
    db: adminClient(),
    readIntent,
    readRefund: async (): Promise<never> => {
      throw new Error("Ta suita nie dotyka gałęzi zwrotów — patrz deposit-refund.test.ts");
    },
    secret: SECRET,
  });
  type StripeReadIntent = (intentId: string, connectedAccountId: string) => Promise<IntentRead>;

  const alwaysRead = (read: IntentRead): StripeReadIntent => async () => read;

  // -------------------------------------------------------------------
  // 1. Podpis — 400 i ZERO zapisu
  // -------------------------------------------------------------------

  describe("podpis bramkuje wszystko, także rejestr", () => {
    it("żądanie BEZ podpisu → 400, zero wierszy w rejestrze, zamówienie nietknięte", async () => {
      const fixture = await seedOrder();
      const eventId = newEventId();
      const payload = eventBody({ eventId, intentId: fixture.intentId });

      const response = await handleStripeWebhook(
        new Request("https://panel.test/api/webhooks/stripe", { method: "POST", body: payload }),
        deps(alwaysRead(intentRead())),
      );

      expect(response.status).toBe(400);
      expect(await eventRows(eventId)).toHaveLength(0);
      expect(await paymentStatusOf(fixture.orderId)).toBe("pending");
    });

    it("ZŁY podpis (cudzy sekret) → 400, zero zapisu", async () => {
      const fixture = await seedOrder();
      const eventId = newEventId();
      const payload = eventBody({ eventId, intentId: fixture.intentId });

      const response = await handleStripeWebhook(
        signedRequest(payload, "whsec_cudzy"),
        deps(alwaysRead(intentRead())),
      );

      expect(response.status).toBe(400);
      expect(await eventRows(eventId)).toHaveLength(0);
      expect(await paymentStatusOf(fixture.orderId)).toBe("pending");
    });

    /**
     * SEDNO OSI: podpis jest ważny dla ORYGINALNEGO ciała, a przychodzi
     * ciało PODMIENIONE — dokładnie tak wygląda próba wstrzyknięcia cudzego
     * zamówienia w przechwycone żądanie.
     */
    it("PODMIENIONE CIAŁO przy zachowanym podpisie → 400, zero zapisu", async () => {
      const ofiara = await seedOrder();
      const napastnik = await seedOrder();
      const eventId = newEventId();

      const original = eventBody({ eventId, intentId: napastnik.intentId });
      const request = signedRequest(original);

      // To samo żądanie (te same nagłówki), inne ciało: wskazuje CUDZE
      // zamówienie i inne zdarzenie.
      const tamperedEventId = newEventId();
      const tampered = eventBody({ eventId: tamperedEventId, intentId: ofiara.intentId });
      const attack = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: tampered,
      });

      const response = await handleStripeWebhook(attack, deps(alwaysRead(intentRead())));

      expect(response.status).toBe(400);
      expect(await eventRows(eventId)).toHaveLength(0);
      expect(await eventRows(tamperedEventId)).toHaveLength(0);
      expect(await paymentStatusOf(ofiara.orderId)).toBe("pending");
      expect(await paymentStatusOf(napastnik.orderId)).toBe("pending");
    });
  });

  // -------------------------------------------------------------------
  // 2. Ścieżka szczęśliwa + idempotencja
  // -------------------------------------------------------------------

  describe("zapis stanu i idempotencja", () => {
    it("zdarzenie succeeded przenosi zamówienie w paid — Z ODCZYTU", async () => {
      const fixture = await seedOrder();
      const eventId = newEventId();
      const readCalls: string[] = [];

      const response = await handleStripeWebhook(
        signedRequest(eventBody({ eventId, intentId: fixture.intentId })),
        deps(async (intentId) => {
          readCalls.push(intentId);
          return intentRead({ intentId });
        }),
      );

      expect(response.status).toBe(200);
      // Handler ZAPYTAŁ dostawcę — bez tego „paid" pochodziłoby z ciała.
      expect(readCalls).toEqual([fixture.intentId]);
      expect(await paymentStatusOf(fixture.orderId)).toBe("paid");

      const [row] = await eventRows(eventId);
      expect(row?.status).toBe("processed");
      expect(row?.error).toBeNull();
      expect(row?.processed_at).not.toBeNull();
    });

    /**
     * KRYTERIUM UKOŃCZENIA: pięć dostaw = jeden wiersz i JEDEN przepis stanu.
     * Liczba wywołań odczytu jest tu równie ważna jak liczba wierszy: gdyby
     * idempotencja stała po zapisie zamiast przed nim, dostawca dostałby
     * pięć zapytań o ten sam intent.
     */
    it("PIĘĆ dostaw tego samego event.id → jeden wiersz, jedna zmiana statusu", async () => {
      const fixture = await seedOrder();
      const eventId = newEventId();
      const payload = eventBody({ eventId, intentId: fixture.intentId });
      let reads = 0;

      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const response = await handleStripeWebhook(
          signedRequest(payload),
          deps(async () => {
            reads += 1;
            return intentRead({ intentId: fixture.intentId });
          }),
        );
        statuses.push(response.status);
      }

      expect(statuses).toEqual([200, 200, 200, 200, 200]);
      expect(await eventRows(eventId)).toHaveLength(1);
      expect(reads, "odczyt u dostawcy wykonany raz").toBe(1);
      expect(await paymentStatusOf(fixture.orderId)).toBe("paid");
    });

    /**
     * WYŚCIG, NIE SEKWENCJA (ADR-024). Dostawy sekwencyjne przechodziłyby
     * także przy `select`-potem-`insert`, bo drugi SELECT widziałby już
     * wstawiony wiersz. Dopiero dostawy równoległe rozstrzygają, czy
     * idempotencja jest ograniczeniem bazy, czy warunkiem w kodzie.
     */
    it("SZEŚĆ RÓWNOLEGŁYCH dostaw tego samego event.id → jeden wiersz, jeden odczyt", async () => {
      const fixture = await seedOrder();
      const eventId = newEventId();
      const payload = eventBody({ eventId, intentId: fixture.intentId });
      let reads = 0;

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          handleStripeWebhook(
            signedRequest(payload),
            deps(async () => {
              reads += 1;
              return intentRead({ intentId: fixture.intentId });
            }),
          ),
        ),
      );

      for (const response of responses) expect(response.status).toBe(200);
      expect(await eventRows(eventId)).toHaveLength(1);
      expect(reads, "tylko właściciel zdarzenia pyta dostawcę").toBe(1);
      expect(await paymentStatusOf(fixture.orderId)).toBe("paid");
    });
  });

  // -------------------------------------------------------------------
  // 3. Stan pochodzi z odczytu, nie z ciała
  // -------------------------------------------------------------------

  describe("stan pochodzi z ODCZYTU, nie z ciała zdarzenia", () => {
    /**
     * MUTACJA „zapisz status z event.data.object.status": ciało niesie
     * `succeeded`, a dostawca na odczycie mówi `requires_payment_method`.
     * Wiara ciału ustawiłaby `paid` na zamówieniu, za które nikt nie
     * zapłacił — to jest sedno reguły ADR-049 przełożonej na pieniądze.
     */
    it("ciało mówi succeeded, dostawca mówi requires_payment_method → NIE paid", async () => {
      const fixture = await seedOrder();
      const eventId = newEventId();

      const response = await handleStripeWebhook(
        signedRequest(
          eventBody({ eventId, intentId: fixture.intentId, bodyStatus: "succeeded" }),
        ),
        deps(
          alwaysRead(
            intentRead({
              intentId: fixture.intentId,
              status: "requires_payment_method",
              amountReceivedGrosze: 0,
            }),
          ),
        ),
      );

      expect(response.status).toBe(200);
      const status = await paymentStatusOf(fixture.orderId);
      expect(status).not.toBe("paid");
      expect(status).toBe("payment_failed");
    });

    it("ciało z zawyżoną kwotą nie ma wpływu — liczy się amount_received z odczytu", async () => {
      const fixture = await seedOrder();
      const eventId = newEventId();

      const response = await handleStripeWebhook(
        signedRequest(eventBody({ eventId, intentId: fixture.intentId })),
        deps(
          alwaysRead(
            intentRead({ intentId: fixture.intentId, amountReceivedGrosze: AMOUNT_GROSZE - 1 }),
          ),
        ),
      );

      expect(response.status).toBe(200);
      expect(await paymentStatusOf(fixture.orderId)).toBe("pending");
      const [row] = await eventRows(eventId);
      expect(row?.status).toBe("processed");
      expect(row?.error).toContain("12344");
    });

    /**
     * WALUTA JEST CZĘŚCIĄ KWOTY (K3, ADR-103): zamówienie utrwala walutę
     * przy narodzinach (orders.currency, 0049 — seed tego pliku rodzi się
     * w PLN z triggera), a intent powstał z tej pary. Odczyt succeeded
     * z PEŁNĄ liczbą, ale w INNEJ walucie, to nie jest opłacenie — 12 345
     * centów EUR to nie 12 345 groszy. Stan dla człowieka: `pending`
     * zostaje, powód w rejestrze.
     */
    it("succeeded w OBCEJ walucie nie ustawia paid — werdykt porównuje walutę zamówienia", async () => {
      const fixture = await seedOrder();
      const eventId = newEventId();

      const response = await handleStripeWebhook(
        signedRequest(eventBody({ eventId, intentId: fixture.intentId })),
        deps(alwaysRead(intentRead({ intentId: fixture.intentId, currency: "eur" }))),
      );

      expect(response.status).toBe(200);
      expect(await paymentStatusOf(fixture.orderId)).toBe("pending");
      const [row] = await eventRows(eventId);
      expect(row?.status).toBe("processed");
      expect(row?.error?.toUpperCase()).toContain("EUR");
      expect(row?.error?.toUpperCase()).toContain("PLN");
    });
  });

  // -------------------------------------------------------------------
  // 4. Spóźnione zdarzenia nie cofają zamówienia z paid
  // -------------------------------------------------------------------

  describe("spóźnione zdarzenie nie cofa zamówienia z paid", () => {
    /**
     * PIERWSZA LINIA OBRONY — ODCZYT. `payment_intent.processing`
     * dostarczone PO `succeeded` opisuje stan sprzed chwili, ale odczyt
     * pokazuje stan BIEŻĄCY. Do bramki bazy sprawa w ogóle nie dociera,
     * bo handler nie ma z czego wyprowadzić regresu.
     */
    it("processing po succeeded: odczyt pokazuje prawdę, zamówienie zostaje paid", async () => {
      const fixture = await seedOrder("paid");
      const eventId = newEventId();

      const response = await handleStripeWebhook(
        signedRequest(
          eventBody({
            eventId,
            intentId: fixture.intentId,
            type: "payment_intent.processing",
            bodyStatus: "processing",
          }),
        ),
        deps(alwaysRead(intentRead({ intentId: fixture.intentId, status: "succeeded" }))),
      );

      expect(response.status).toBe(200);
      expect(await paymentStatusOf(fixture.orderId)).toBe("paid");
      const [row] = await eventRows(eventId);
      expect(row?.status).toBe("processed");
    });

    /**
     * DRUGA LINIA OBRONY — BRAMKA BAZY (0027). Gdyby odczyt ZAWIÓDŁ (tu:
     * dostawca zgłasza `canceled` dla płatności, którą już zaksięgowaliśmy),
     * handler wyprowadziłby `payment_failed` z `paid` — a to w reżimie
     * stripe jest zabronione. Baza odmawia 23514, handler NIE raportuje
     * przetworzenia i oddaje 2xx, bo ponowienie niczego nie zmieni.
     */
    it("odczyt każący cofnąć paid: baza odmawia, rejestr mówi FAILED, dostawca dostaje 2xx", async () => {
      const fixture = await seedOrder("paid");
      const eventId = newEventId();

      const response = await handleStripeWebhook(
        signedRequest(
          eventBody({ eventId, intentId: fixture.intentId, type: "payment_intent.canceled" }),
        ),
        deps(alwaysRead(intentRead({ intentId: fixture.intentId, status: "canceled" }))),
      );

      // 2xx: retry nic nie naprawi.
      expect(response.status).toBe(200);
      // …ale to NIE JEST sukces i rejestr tak właśnie mówi.
      const [row] = await eventRows(eventId);
      expect(row?.status).toBe("failed");
      expect(row?.error).toContain("payment_failed");
      expect(row?.error).toContain("paid");
      expect(await paymentStatusOf(fixture.orderId)).toBe("paid");
    });
  });

  // -------------------------------------------------------------------
  // 5. Odczyt po zapisie
  // -------------------------------------------------------------------

  describe("odczyt po zapisie rozstrzyga o werdykcie", () => {
    /**
     * MUTACJA „usuń odczyt-po-zapisie": tu UPDATE kończy się BEZ BŁĘDU
     * (PostgREST odpowiada 204), a mimo to nie zmienia stanu — bo filtr
     * compare-and-set nie trafia już w żaden wiersz. Równoległa dostawa
     * przestawiła zamówienie między naszym SELECT-em a naszym UPDATE-em.
     *
     * Kod ufający odpowiedzi na UPDATE zapisałby tu „przetworzone" — czyli
     * ogłosił opłacenie zamówienia, które jest `payment_failed`. Jedyne, co
     * to wyłapuje, to ODCZYT WIERSZA po zapisie.
     */
    it("zapis bez błędu, który NIE zmienił stanu, jest raportowany jako failed", async () => {
      const fixture = await seedOrder("pending");
      const eventId = newEventId();

      const response = await handleStripeWebhook(
        signedRequest(eventBody({ eventId, intentId: fixture.intentId })),
        deps(async () => {
          // Wyprzedzenie przez równoległą dostawę — dokładnie w oknie
          // między odczytem zamówienia a zapisem.
          const { error } = await admin
            .from("orders")
            .update({ payment_status: "payment_failed" })
            .eq("id", fixture.orderId);
          if (error) throw new Error(`wyprzedzenie: ${error.message}`);
          return intentRead({ intentId: fixture.intentId });
        }),
      );

      expect(response.status).toBe(200);
      expect(await paymentStatusOf(fixture.orderId)).toBe("payment_failed");

      const [row] = await eventRows(eventId);
      expect(row?.status, "rozjazd zamierzenia ze stanem = failed").toBe("failed");
      expect(row?.error).toContain("paid");
      expect(row?.error).toContain("payment_failed");
    });
  });

  // -------------------------------------------------------------------
  // 6. Zdarzenia, których nie ma jak przetworzyć
  // -------------------------------------------------------------------

  describe("zdarzenia bez zapisu stanu zostawiają ślad", () => {
    it("intent bez naszego zamówienia (sfabrykowany) → zarejestrowany, zero zapisu", async () => {
      const eventId = newEventId();
      let reads = 0;

      const response = await handleStripeWebhook(
        signedRequest(eventBody({ eventId, intentId: `pi_obcy_${randomUUID().slice(0, 8)}` })),
        deps(async () => {
          reads += 1;
          return intentRead();
        }),
      );

      expect(response.status).toBe(200);
      // Nie pytamy dostawcy o płatność, której nie umiemy przypisać —
      // odczyt bez konta najemcy nie miałby na czym się wykonać.
      expect(reads).toBe(0);

      const [row] = await eventRows(eventId);
      expect(row?.status).toBe("processed");
      expect(row?.error).toContain("Żadne zamówienie");
    });

    it("typ spoza cyklu płatności → zarejestrowany bez odczytu i bez zapisu", async () => {
      const fixture = await seedOrder();
      const eventId = newEventId();
      let reads = 0;

      const response = await handleStripeWebhook(
        signedRequest(
          eventBody({ eventId, intentId: fixture.intentId, type: "customer.subscription.updated" }),
        ),
        deps(async () => {
          reads += 1;
          return intentRead();
        }),
      );

      expect(response.status).toBe(200);
      expect(reads).toBe(0);
      expect(await paymentStatusOf(fixture.orderId)).toBe("pending");

      const [row] = await eventRows(eventId);
      expect(row?.status).toBe("processed");
      expect(row?.event_type).toBe("customer.subscription.updated");
      expect(row?.error).toContain("nie jest obsługiwany");
    });

    /**
     * AWARIA DOSTAWCY JEST PRZEJŚCIOWA — więc 5xx (dostawca ponowi)
     * I ZWOLNIENIE DZIERŻAWY. Bez zwolnienia ponowna dostawa trafiłaby na
     * istniejący `event_id`, zostałaby uznana za duplikat i płatność
     * zawisłaby na zawsze: dostawca ponawia, my odpowiadamy „już mam",
     * a zamówienie nigdy nie dostaje statusu.
     */
    it("awaria odczytu u dostawcy → 5xx, dzierżawa zwolniona, ponowna dostawa przechodzi", async () => {
      const fixture = await seedOrder();
      const eventId = newEventId();
      const payload = eventBody({ eventId, intentId: fixture.intentId });

      const failed = await handleStripeWebhook(
        signedRequest(payload),
        deps(async () => {
          throw new Error("503 od dostawcy");
        }),
      );
      expect(failed.status).toBe(500);
      expect(await eventRows(eventId), "dzierżawa zwolniona").toHaveLength(0);
      expect(await paymentStatusOf(fixture.orderId)).toBe("pending");

      const retried = await handleStripeWebhook(
        signedRequest(payload),
        deps(alwaysRead(intentRead({ intentId: fixture.intentId }))),
      );
      expect(retried.status).toBe(200);
      expect(await eventRows(eventId)).toHaveLength(1);
      expect(await paymentStatusOf(fixture.orderId)).toBe("paid");
    });
  });
});
