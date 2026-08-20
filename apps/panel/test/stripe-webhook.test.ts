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

import {
  canAcceptCharges,
  signStripeWebhook,
  type ConnectAccountState,
  type ConnectAccountSync,
  type IntentRead,
} from "@avably/core";
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
  // Czas powstania płatności u dostawcy — w tej suicie bez znaczenia
  // (progu porzucenia pilnuje L11), ale pole jest wymagane od ADR-104.
  createdAtSeconds: Math.floor(Date.now() / 1000),
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
  //
  // Transport maila „płatność zaksięgowana" (ADR-139) jest wstrzykiwany jak
  // każda inna granica sieci: bez tego happy path zależałby od RESEND_API_KEY
  // w env (z kluczem suita wysyłałaby PRAWDZIWE maile, bez klucza rejestr
  // zdarzeń niósłby powód niewysłania zamiast NULL-a). Zachowanie samego
  // maila bada payment-confirmed-email.test.ts — tu ma być deterministyczne.
  const deps = (readIntent: StripeReadIntent, syncAccount?: StripeSyncAccount) => ({
    db: adminClient(),
    readIntent,
    readRefund: async (): Promise<never> => {
      throw new Error("Ta suita nie dotyka gałęzi zwrotów — patrz deposit-refund.test.ts");
    },
    // Gałąź konta (ADR-213): domyślnie RZUCA — przypadki płatności jej nie
    // dotykają, więc jej wywołanie ma być głośnym błędem. Testy konta niżej
    // podstawiają własny odczyt.
    syncAccount:
      syncAccount ??
      (async (): Promise<never> => {
        throw new Error("Ten przypadek nie dotyka gałęzi konta");
      }),
    secret: SECRET,
    paymentEmail: {
      transport: { send: async () => ({ id: "msg_test_z4" }) },
      availability: { available: true },
    },
  });
  type StripeReadIntent = (intentId: string, connectedAccountId: string) => Promise<IntentRead>;
  type StripeSyncAccount = (providerAccountId: string) => Promise<ConnectAccountSync>;

  const alwaysRead = (read: IntentRead): StripeReadIntent => async () => read;

  // Odczyt intentu, którego przypadki KONTA nie dotykają — RZUCA, bo jego
  // wywołanie znaczyłoby, że zdarzenie poszło nie tą gałęzią.
  const noIntent: StripeReadIntent = async () => {
    throw new Error("Przypadek konta nie dotyka gałęzi płatności");
  };

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

  // -------------------------------------------------------------------
  // 5. Cykl życia KONTA — account.updated / deauthorized (ADR-213)
  // -------------------------------------------------------------------

  describe("cykl życia konta — stan odświeża się ze zdarzenia, nie z payloadu", () => {
    interface AccountFixture {
      tenantId: string;
      accountId: string;
    }

    /** Sklep z kontem u dostawcy o zadanej migawce gotowości (bez zamówienia). */
    async function seedAccount(
      snapshot: {
        chargesEnabled?: boolean;
        payoutsEnabled?: boolean;
        detailsSubmitted?: boolean;
      } = {},
    ): Promise<AccountFixture> {
      const { data: tenant, error: tenantError } = await admin
        .from("tenants")
        .insert({
          slug: `z4a-${randomUUID().slice(0, 12)}`,
          name: "Sklep konta",
          status: "active",
          locale: "pl",
        })
        .select("id")
        .single();
      if (tenantError || !tenant) throw new Error(`tenant: ${tenantError?.message}`);
      const tenantId = tenant.id as string;
      createdTenantIds.push(tenantId);

      const accountId = `acct_${randomUUID().slice(0, 16)}`;
      const { error: accountError } = await admin.from("payment_accounts").insert({
        tenant_id: tenantId,
        provider_account_id: accountId,
        charges_enabled: snapshot.chargesEnabled ?? false,
        payouts_enabled: snapshot.payoutsEnabled ?? false,
        details_submitted: snapshot.detailsSubmitted ?? false,
      });
      if (accountError) throw new Error(`payment_accounts: ${accountError.message}`);

      return { tenantId, accountId };
    }

    interface AccountSnapshotRow {
      charges_enabled: boolean;
      payouts_enabled: boolean;
      details_submitted: boolean;
      requirements_due: unknown;
      last_error: string | null;
      last_synced_at: string | null;
      provider_account_id: string;
    }

    async function accountRow(tenantId: string): Promise<AccountSnapshotRow> {
      const { data, error } = await admin
        .from("payment_accounts")
        .select(
          "charges_enabled, payouts_enabled, details_submitted, requirements_due, last_error, last_synced_at, provider_account_id",
        )
        .eq("tenant_id", tenantId)
        .single();
      if (error) throw new Error(`odczyt konta: ${error.message}`);
      return data as AccountSnapshotRow;
    }

    /**
     * Ciało zdarzenia KONTA w kształcie dostawcy. `account` (górnopoziomowe)
     * to identyfikator konta NAJEMCY; `data.object` może opisywać INNY obiekt
     * (przy deautoryzacji — aplikację) i CELOWO niesie stan, którego handler
     * NIE użyje.
     */
    function accountEventBody(input: {
      eventId: string;
      type: string;
      account: string;
      dataObjectId?: string;
      /** Stan W CIELE — celowo sprzeczny z odczytem, ma NIE przejść. */
      bodyChargesEnabled?: boolean;
    }): string {
      return JSON.stringify({
        id: input.eventId,
        type: input.type,
        api_version: "2026-01-01",
        account: input.account,
        data: {
          object: {
            id: input.dataObjectId ?? input.account,
            object: input.type.startsWith("account.application") ? "application" : "account",
            charges_enabled: input.bodyChargesEnabled ?? true,
            payouts_enabled: input.bodyChargesEnabled ?? true,
          },
        },
      });
    }

    /**
     * Ciało zdarzenia KONTA v2 „thin" (Accounts v2, ADR-218) w kształcie
     * dostawcy: BEZ `data.object`, identyfikator konta (`acct_…`) w
     * `related_object.id`. Konta/webhooki na wersjach 2026 emitują właśnie
     * to zamiast v1 `account.updated`. Struktura z dokumentacji Stripe
     * (https://docs.stripe.com/event-destinations#thin-events).
     */
    function accountEventBodyV2(input: {
      eventId: string;
      type?: string;
      /** `acct_…` w `related_object.id` — jedyny nośnik tożsamości konta. */
      relatedId: string;
    }): string {
      return JSON.stringify({
        id: input.eventId,
        object: "v2.core.event",
        type: input.type ?? "v2.core.account.updated",
        livemode: false,
        created: new Date().toISOString(),
        reason: { type: "request", request: { id: "req_test", idempotency_key: "ik_test" } },
        // ŚWIADOMIE bez `data` — thin event go nie ma; identyfikator tylko tu.
        related_object: {
          id: input.relatedId,
          type: "v2.core.account",
          url: `/v2/core/accounts/${input.relatedId}`,
        },
      });
    }

    const state = (overrides: Partial<ConnectAccountState> = {}): ConnectAccountState => ({
      providerAccountId: "acct_x",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      requirementsDue: [],
      disabledReason: null,
      ...overrides,
    });

    const syncOk =
      (result: ConnectAccountState, calls?: string[]) =>
      async (providerAccountId: string): Promise<ConnectAccountSync> => {
        calls?.push(providerAccountId);
        return { ok: true, state: { ...result, providerAccountId }, error: null };
      };

    const syncFail =
      (error: string, calls?: string[]) =>
      async (providerAccountId: string): Promise<ConnectAccountSync> => {
        calls?.push(providerAccountId);
        return { ok: false, state: null, error };
      };

    /**
     * PULL PRAWDY: zdarzenie mówi tylko „odśwież"; gotowość bierze się
     * z ODCZYTU, nie z ciała. Ciało niesie `charges_enabled:false`, a odczyt
     * mówi `true` — do bazy ma trafić prawda z odczytu.
     */
    it("account.updated odświeża migawkę Z ODCZYTU, nie z payloadu", async () => {
      const fixture = await seedAccount({ chargesEnabled: false });
      const eventId = newEventId();
      const calls: string[] = [];

      const response = await handleStripeWebhook(
        signedRequest(
          accountEventBody({
            eventId,
            type: "account.updated",
            account: fixture.accountId,
            bodyChargesEnabled: false,
          }),
        ),
        deps(noIntent, syncOk(state({ requirementsDue: [] }), calls)),
      );

      expect(response.status).toBe(200);
      // Odczyt wykonany na koncie z NASZEJ bazy — bez tego „gotowe" pochodziłoby
      // z ciała zdarzenia.
      expect(calls).toEqual([fixture.accountId]);

      const row = await accountRow(fixture.tenantId);
      expect(row.charges_enabled).toBe(true);
      expect(row.payouts_enabled).toBe(true);
      expect(row.details_submitted).toBe(true);
      expect(row.last_error).toBeNull();
      expect(row.last_synced_at).not.toBeNull();

      const [event] = await eventRows(eventId);
      expect(event?.status).toBe("processed");
      expect(event?.error).toBeNull();
    });

    /**
     * IZOLACJA TENANTÓW (KRYTYCZNE). Zdarzenie konta najemcy A niesie w ciele
     * `data.object.id` konta najemcy B i stan `charges_enabled:true` — próba
     * przemycenia cudzego konta i stanu z payloadu. Tożsamość wychodzi
     * z górnopoziomowego `event.account` (=A) i NASZEJ bazy, więc mutować
     * wolno WYŁĄCZNIE wiersz A; wiersz B zostaje nietknięty.
     */
    it("zdarzenie konta A nie mutuje wiersza konta B — tożsamość z event.account, nie z ciała", async () => {
      const a = await seedAccount({ chargesEnabled: false });
      const b = await seedAccount({ chargesEnabled: false });
      const eventId = newEventId();
      const calls: string[] = [];

      const response = await handleStripeWebhook(
        signedRequest(
          accountEventBody({
            eventId,
            type: "account.updated",
            account: a.accountId,
            // Ciało wskazuje CUDZE konto (B) i niesie stan „gotowe".
            dataObjectId: b.accountId,
            bodyChargesEnabled: true,
          }),
        ),
        deps(noIntent, syncOk(state(), calls)),
      );

      expect(response.status).toBe(200);
      // Odczyt poszedł na konto A (z event.account), nigdy na B z ciała.
      expect(calls).toEqual([a.accountId]);

      const rowA = await accountRow(a.tenantId);
      expect(rowA.charges_enabled).toBe(true);
      expect(rowA.last_synced_at).not.toBeNull();

      const rowB = await accountRow(b.tenantId);
      expect(rowB.charges_enabled, "konto B nietknięte").toBe(false);
      expect(rowB.last_synced_at, "konto B nigdy nie było synchronizowane").toBeNull();
    });

    /**
     * NIEZMIENNOŚĆ POD SERVICE_ROLE. `service_role` ma bypassrls, więc to NIE
     * RLS broni konta — broni go trigger 0028 (BEFORE UPDATE → 23514), który
     * FIRE'uje także dla tej roli. Próba przepisania `provider_account_id`
     * ścieżką webhooka (tym samym klientem) musi odbić się o 23514. To dowód,
     * że bypassrls NIE otwiera furtki na przekierowanie cudzych pieniędzy.
     */
    it("service_role NIE przepisze provider_account_id — trigger 0028 rzuca 23514 mimo bypassrls", async () => {
      const fixture = await seedAccount({ chargesEnabled: true });

      const { error } = await admin
        .from("payment_accounts")
        .update({ provider_account_id: `acct_${randomUUID().slice(0, 16)}` })
        .eq("tenant_id", fixture.tenantId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");

      // Konto wskazuje wciąż na to samo miejsce — pieniądze nie zostały
      // przekierowane.
      const row = await accountRow(fixture.tenantId);
      expect(row.provider_account_id).toBe(fixture.accountId);
    });

    /**
     * FAIL-SAFE. Porażka `GET /v1/accounts` NIE zeruje gotowości: zostaje
     * poprzednia migawka + `last_error`. Awaria po naszej stronie nie ma prawa
     * pokazać „konto przestało przyjmować płatności" ani zamknąć sprzedaży
     * z powodu naszego timeoutu.
     */
    it("porażka odczytu przy account.updated zapisuje SAM last_error, gotowość nietknięta", async () => {
      const fixture = await seedAccount({ chargesEnabled: true, payoutsEnabled: true });
      const eventId = newEventId();

      const response = await handleStripeWebhook(
        signedRequest(
          accountEventBody({ eventId, type: "account.updated", account: fixture.accountId }),
        ),
        deps(noIntent, syncFail("API płatności odpowiedziało 503")),
      );

      expect(response.status).toBe(200);
      const row = await accountRow(fixture.tenantId);
      // Gotowość zostaje TAKA, JAKA BYŁA — awaria odczytu jej nie zeruje.
      expect(row.charges_enabled).toBe(true);
      expect(row.payouts_enabled).toBe(true);
      expect(row.last_error).toContain("503");

      const [event] = await eventRows(eventId);
      expect(event?.status).toBe("processed");
      expect(event?.error).toContain("503");
    });

    /**
     * DEAUTORYZACJA ZAMYKA TOR ONLINE. Najemca odłączył aplikację — konto
     * przestaje być nasze, odczyt i tak by odmówił, więc gotowość zerujemy
     * BEZ odczytu (syncAccount RZUCA — dowód, że nie jest wołany). Skutek:
     * bramka sprzedaży ADR-049 (`canAcceptCharges` na `charges_enabled`)
     * zamyka płatność online.
     */
    it("account.application.deauthorized zeruje charges_enabled i zamyka tor online — bez odczytu", async () => {
      const fixture = await seedAccount({ chargesEnabled: true, payoutsEnabled: true });
      const eventId = newEventId();

      const response = await handleStripeWebhook(
        signedRequest(
          accountEventBody({
            eventId,
            type: "account.application.deauthorized",
            account: fixture.accountId,
            // Obiektem ciała jest APLIKACJA (ca_…), nie konto.
            dataObjectId: "ca_aplikacja_1",
          }),
        ),
        // syncAccount RZUCA: ścieżka deautoryzacji nie pyta dostawcy.
        deps(noIntent),
      );

      expect(response.status).toBe(200);
      const row = await accountRow(fixture.tenantId);
      expect(row.charges_enabled).toBe(false);
      expect(row.payouts_enabled).toBe(false);
      expect(row.last_error).toContain("account.application.deauthorized");

      // Bramka sprzedaży czyta dokładnie tę migawkę: tor online zamknięty.
      expect(
        canAcceptCharges(
          state({ chargesEnabled: row.charges_enabled, payoutsEnabled: row.payouts_enabled }),
        ),
      ).toBe(false);

      const [event] = await eventRows(eventId);
      expect(event?.status).toBe("processed");
    });

    /**
     * IDEMPOTENCJA. To samo `event_id` dostarczone dwa razy → jeden wiersz
     * w rejestrze i JEDEN odczyt u dostawcy (unikat webhook_events + przejęcie
     * przed przetwarzaniem).
     */
    it("dwie dostawy tego samego account.updated → jeden wiersz, jeden odczyt", async () => {
      const fixture = await seedAccount({ chargesEnabled: false });
      const eventId = newEventId();
      const payload = accountEventBody({
        eventId,
        type: "account.updated",
        account: fixture.accountId,
      });
      const calls: string[] = [];

      const first = await handleStripeWebhook(
        signedRequest(payload),
        deps(noIntent, syncOk(state(), calls)),
      );
      const second = await handleStripeWebhook(
        signedRequest(payload),
        deps(noIntent, syncOk(state(), calls)),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await eventRows(eventId)).toHaveLength(1);
      expect(calls, "odczyt u dostawcy wykonany raz").toEqual([fixture.accountId]);
      expect((await accountRow(fixture.tenantId)).charges_enabled).toBe(true);
    });

    // -----------------------------------------------------------------
    // Accounts v2 (thin events) — v2.core.account.updated (ADR-218)
    // -----------------------------------------------------------------
    //
    // Nowe konta Stripe mają webhooki wyłącznie na wersjach 2026: emitują
    // `v2.core.account.updated` (thin: identyfikator w `related_object.id`,
    // BEZ `data.object`) zamiast v1 `account.updated`. Bez obsługi tego typu
    // Faza A nie odświeżałaby ich stanu. Obieg jest IDENTYCZNY jak v1: PULL
    // prawdy (GET /v1/accounts, interop) i przepisanie migawki — różni się
    // tylko kształt zdarzenia, o który dba parser.

    /**
     * v2 → OBSERWOWANE → PULL → MIGAWKA PRZEPISANA. Zdarzenie v2 thin niesie
     * `acct_…` wyłącznie w `related_object.id`; handler musi po nim odczytać
     * wiersz i przepisać gotowość z ODCZYTU. Mutacja parsera „czytaj
     * data.object.id zamiast related_object" → zdarzenie v2 nierozpoznane
     * (400 albo brak PULL) → RED (dowód jednostkowy w core/webhook.test.ts).
     */
    it("v2.core.account.updated (thin) odświeża migawkę Z ODCZYTU — id z related_object.id", async () => {
      const fixture = await seedAccount({ chargesEnabled: false });
      const eventId = newEventId();
      const calls: string[] = [];

      const response = await handleStripeWebhook(
        signedRequest(accountEventBodyV2({ eventId, relatedId: fixture.accountId })),
        deps(noIntent, syncOk(state({ requirementsDue: [] }), calls)),
      );

      expect(response.status).toBe(200);
      // Odczyt poszedł na konto z NASZEJ bazy, odnalezione po related_object.id.
      expect(calls).toEqual([fixture.accountId]);

      const row = await accountRow(fixture.tenantId);
      expect(row.charges_enabled).toBe(true);
      expect(row.payouts_enabled).toBe(true);
      expect(row.details_submitted).toBe(true);
      expect(row.last_error).toBeNull();
      expect(row.last_synced_at).not.toBeNull();

      const [event] = await eventRows(eventId);
      expect(event?.status).toBe("processed");
      expect(event?.event_type).toBe("v2.core.account.updated");
      expect(event?.error).toBeNull();
    });

    /**
     * IZOLACJA (v2). Zdarzenie v2 konta A (related_object.id = A) mutuje
     * WYŁĄCZNIE wiersz A; konto B nietknięte. Tożsamość i odczyt idą po id
     * z NASZEJ bazy, nigdy z pola stanu w ciele (thin event stanu nie niesie).
     */
    it("v2: zdarzenie konta A nie mutuje wiersza konta B — tożsamość z related_object.id", async () => {
      const a = await seedAccount({ chargesEnabled: false });
      const b = await seedAccount({ chargesEnabled: false });
      const eventId = newEventId();
      const calls: string[] = [];

      const response = await handleStripeWebhook(
        signedRequest(accountEventBodyV2({ eventId, relatedId: a.accountId })),
        deps(noIntent, syncOk(state(), calls)),
      );

      expect(response.status).toBe(200);
      expect(calls).toEqual([a.accountId]);

      const rowA = await accountRow(a.tenantId);
      expect(rowA.charges_enabled).toBe(true);
      expect(rowA.last_synced_at).not.toBeNull();

      const rowB = await accountRow(b.tenantId);
      expect(rowB.charges_enabled, "konto B nietknięte").toBe(false);
      expect(rowB.last_synced_at, "konto B nigdy nie było synchronizowane").toBeNull();
    });

    /**
     * FAIL-SAFE (v2, MONEY-ADJACENT). Porażka `GET /v1/accounts` przy zdarzeniu
     * v2 zapisuje SAM `last_error` i ZOSTAWIA gotowość nietkniętą — dokładnie
     * jak w Fazie A. Awaria po naszej stronie nie ma prawa wyglądać jak
     * „konto przestało przyjmować płatności".
     */
    it("v2: porażka odczytu zapisuje SAM last_error, gotowość nietknięta", async () => {
      const fixture = await seedAccount({ chargesEnabled: true, payoutsEnabled: true });
      const eventId = newEventId();

      const response = await handleStripeWebhook(
        signedRequest(accountEventBodyV2({ eventId, relatedId: fixture.accountId })),
        deps(noIntent, syncFail("API płatności odpowiedziało 503")),
      );

      expect(response.status).toBe(200);
      const row = await accountRow(fixture.tenantId);
      expect(row.charges_enabled).toBe(true);
      expect(row.payouts_enabled).toBe(true);
      expect(row.last_error).toContain("503");

      const [event] = await eventRows(eventId);
      expect(event?.status).toBe("processed");
      expect(event?.error).toContain("503");
    });

    /**
     * IDEMPOTENCJA (v2). To samo `event_id` v2 dostarczone dwa razy → jeden
     * wiersz rejestru i JEDEN odczyt (unikat `webhook_events` reużyty — id
     * zdarzenia v2 też jest unikalne).
     */
    it("v2: dwie dostawy tego samego v2.core.account.updated → jeden wiersz, jeden odczyt", async () => {
      const fixture = await seedAccount({ chargesEnabled: false });
      const eventId = newEventId();
      const payload = accountEventBodyV2({ eventId, relatedId: fixture.accountId });
      const calls: string[] = [];

      const first = await handleStripeWebhook(
        signedRequest(payload),
        deps(noIntent, syncOk(state(), calls)),
      );
      const second = await handleStripeWebhook(
        signedRequest(payload),
        deps(noIntent, syncOk(state(), calls)),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await eventRows(eventId)).toHaveLength(1);
      expect(calls, "odczyt u dostawcy wykonany raz").toEqual([fixture.accountId]);
      expect((await accountRow(fixture.tenantId)).charges_enabled).toBe(true);
    });

    /**
     * v1 DALEJ DZIAŁA (regresja obok v2). Ten sam handler obsługuje oba
     * formaty: v1 `account.updated` (identyfikator w górnopoziomowym
     * `event.account`) przechodzi tą samą ścieżką co v2. Reszta osi v1
     * (deauthorized, izolacja, fail-safe) jest pokryta przypadkami wyżej.
     */
    it("v1 account.updated nadal odświeża migawkę obok v2 — jeden handler, dwa formaty", async () => {
      const fixture = await seedAccount({ chargesEnabled: false });
      const eventId = newEventId();
      const calls: string[] = [];

      const response = await handleStripeWebhook(
        signedRequest(
          accountEventBody({ eventId, type: "account.updated", account: fixture.accountId }),
        ),
        deps(noIntent, syncOk(state(), calls)),
      );

      expect(response.status).toBe(200);
      expect(calls).toEqual([fixture.accountId]);
      expect((await accountRow(fixture.tenantId)).charges_enabled).toBe(true);
    });
  });
});
