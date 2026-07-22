/**
 * Kaucja online: pobranie przy płatności i REALNY zwrot (Z5, ADR-069) —
 * na ŻYWYM, lokalnym Supabase.
 *
 * DLACZEGO NA ŻYWEJ BAZIE. Trzy reguły, których to zadanie ma dowieść, są
 * WŁASNOŚCIĄ BAZY, nie kodu: niezmiennik salda rejestru (0011), unikat
 * odnośnika dostawcy (0031) i bramka spójności `deposit_refunded` (0030,
 * reguła B). Atrapa klienta Supabase odpowiadałaby to, co sami byśmy jej
 * kazali — czyli suita przechodziłaby także wtedy, gdyby żadnej z tych
 * bramek nie było. Wstrzykiwany jest WYŁĄCZNIE dostawca płatności, bo tylko
 * on jest po drugiej stronie sieci.
 *
 * KRYTERIUM UKOŃCZENIA ZADANIA rozpisane na osie:
 *   1. pobranie — potwierdzenie płatności webhookiem zakłada wiersz
 *      `collected` z odnośnikiem intentu; ponowna dostawa nie księguje go
 *      drugi raz,
 *   2. „ZWROT W TOKU TO NIE ZWROT" — odpowiedź dostawcy `pending` zostawia
 *      rejestr kaucji PUSTY, saldo nietknięte i stan pośredni widoczny,
 *   3. zwrot potwierdzony — wiersz `refunded` z kwotą Z ODCZYTU, saldo 0,
 *      `payment_status = deposit_refunded` przez bramkę,
 *   4. odmowa dostawcy — ZERO wiersza w rejestrze i powód do przeczytania,
 *   5. zwrot większy niż pobranie — odmowa w OBU warstwach niezależnie:
 *      u dostawcy i w bazie (23514 z 0011),
 *   6. zwrot potwierdzony webhookiem — ta sama droga, inny wyzwalacz.
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* — bez nich strażnik
 * integration-env failuje suitę.
 */
import { randomUUID } from "node:crypto";

import { StripeApiError, signStripeWebhook, type IntentRead, type RefundRead } from "@avably/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requestDepositRefund } from "@/lib/deposit-refund";
import { handleStripeWebhook } from "@/lib/stripe-webhook";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const SECRET = "whsec_test_sekret_webhooka_z5";
const TEST_PASSWORD = "DepositOnlineTest!12345678";

/** Rozbicie kwoty zamówienia — kaucja jedzie w TYM SAMYM intencie (D1/D4). */
const RENTAL_GROSZE = 30_000;
const DEPOSIT_GROSZE = 50_000;
const TOTAL_GROSZE = RENTAL_GROSZE + DEPOSIT_GROSZE;

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

const anonClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];
const createdEventIds: string[] = [];

let orderNumberSeq = 0;
const nextOrderNumber = (): string => String(7000 + (orderNumberSeq += 1));

/** Ciało zdarzenia w kształcie dostawcy — ZE STANEM, którego handler nie użyje. */
function eventBody(input: { eventId: string; type: string; objectId: string }): string {
  return JSON.stringify({
    id: input.eventId,
    type: input.type,
    api_version: "2026-01-01",
    data: {
      object: {
        id: input.objectId,
        // Celowo sprzeczne z odczytem tam, gdzie test tego wymaga — handler
        // nie ma prawa niczego stąd wziąć poza identyfikatorem.
        status: "succeeded",
        amount: TOTAL_GROSZE,
        amount_received: TOTAL_GROSZE,
      },
    },
  });
}

function signedRequest(payload: string): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request("https://panel.test/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "stripe-signature": `t=${timestamp},v1=${signStripeWebhook({ secret: SECRET, timestamp, payload })}`,
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
  ...overrides,
});

const refundRead = (overrides: Partial<RefundRead> = {}): RefundRead => ({
  refundId: "re_x",
  status: "succeeded",
  amountGrosze: DEPOSIT_GROSZE,
  intentId: "pi_x",
  failureReason: null,
  ...overrides,
});

describe.skipIf(!hasEnv)("kaucja online — pobranie i zwrot (Z5)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);

  /** Sesja członka — akcja panelu NIE ma prawa biec na service-role. */
  let member: { client: SupabaseClient; tenantId: string; userId: string };

  beforeAll(async () => {
    if (!hasEnv) return;
    const email = `z5-${randomUUID()}@test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    createdUserIds.push(data.user.id);

    const signIn = async (): Promise<SupabaseClient> => {
      const client = anonClient();
      const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password: TEST_PASSWORD,
      });
      if (signInError) throw new Error(`signIn: ${signInError.message}`);
      return client;
    };

    const bootstrap = await signIn();
    const { data: tenantId, error: tenantError } = await bootstrap
      .schema("app")
      .rpc("create_tenant", {
        p_slug: `z5-${randomUUID()}`.slice(0, 39),
        p_name: "Sklep kaucji online",
      });
    if (tenantError) throw new Error(`create_tenant: ${tenantError.message}`);
    createdTenantIds.push(tenantId as string);

    // Konto najemcy u dostawcy — bez niego zwrotu nie ma na czym wykonać.
    const { error: accountError } = await admin.from("payment_accounts").insert({
      tenant_id: tenantId as string,
      provider_account_id: `acct_${randomUUID().slice(0, 12)}`,
    });
    if (accountError) throw new Error(`payment_accounts: ${accountError.message}`);

    // Świeża sesja PO utworzeniu tenanta — JWT niesie claim tenant_id.
    member = { client: await signIn(), tenantId: tenantId as string, userId: data.user.id };
  }, 90_000);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdEventIds.length > 0) {
      await admin.from("webhook_events").delete().in("event_id", createdEventIds);
    }
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  interface Fixture {
    orderId: string;
    intentId: string;
  }

  /** Zamówienie online z kaucją — dokładnie w kształcie, jaki daje 0029. */
  async function seedOnlineOrder(paymentStatus = "pending"): Promise<Fixture> {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({
        tenant_id: member.tenantId,
        full_name: "Klient",
        email: `k-${randomUUID().slice(0, 8)}@test.local`,
      })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`customer: ${customerError?.message}`);

    const { data: pickup, error: pickupError } = await admin
      .from("pickup_locations")
      .insert({ tenant_id: member.tenantId, name: "Magazyn", address_city: "Warszawa" })
      .select("id")
      .single();
    if (pickupError || !pickup) throw new Error(`pickup: ${pickupError?.message}`);

    const intentId = `pi_${randomUUID().slice(0, 16)}`;
    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        tenant_id: member.tenantId,
        customer_id: customer.id as string,
        order_number: `Z5-2026-${nextOrderNumber()}`,
        start_date: "2026-12-01",
        end_date: "2026-12-03",
        delivery_method: "pickup",
        pickup_location_id: pickup.id as string,
        order_status: "pending",
        payment_status: paymentStatus,
        payment_provider: "stripe",
        payment_method: "online",
        provider_payment_intent_id: intentId,
        total_rental_grosze: RENTAL_GROSZE,
        total_deposit_grosze: DEPOSIT_GROSZE,
        delivery_grosze: 0,
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(`order: ${orderError?.message}`);

    return { orderId: order.id as string, intentId };
  }

  async function depositEventsOf(orderId: string) {
    const { data, error } = await admin
      .from("deposit_events")
      .select("kind, amount_grosze, provider, provider_reference")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`odczyt rejestru kaucji: ${error.message}`);
    return (data ?? []) as {
      kind: string;
      amount_grosze: number;
      provider: string;
      provider_reference: string | null;
    }[];
  }

  async function refundRequestsOf(orderId: string) {
    const { data, error } = await admin
      .from("deposit_refunds")
      .select("id, status, amount_grosze, provider_reference, last_error")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`odczyt rejestru żądań: ${error.message}`);
    return (data ?? []) as {
      id: string;
      status: string;
      amount_grosze: number;
      provider_reference: string | null;
      last_error: string | null;
    }[];
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

  function newEventId(): string {
    const id = `evt_${randomUUID()}`;
    createdEventIds.push(id);
    return id;
  }

  const webhookDeps = (overrides: {
    readIntent?: (intentId: string, account: string) => Promise<IntentRead>;
    readRefund?: (refundId: string, account: string) => Promise<RefundRead>;
  }) => ({
    db: adminClient(),
    readIntent:
      overrides.readIntent ??
      (async (): Promise<never> => {
        throw new Error("Ten test nie dotyka gałęzi płatności");
      }),
    readRefund:
      overrides.readRefund ??
      (async (): Promise<never> => {
        throw new Error("Ten test nie dotyka gałęzi zwrotów");
      }),
    secret: SECRET,
  });

  /**
   * Zamówienie po potwierdzonej płatności: `paid` + kaucja w rejestrze.
   * Idzie DOKŁADNIE tą samą drogą co produkcja — webhookiem, nie INSERT-em
   * przygotowawczym. Skrót przez ręczne wstawienie `collected` dowodziłby
   * tylko tego, że umiemy wstawiać wiersze.
   */
  async function paidOrderWithDeposit(): Promise<Fixture> {
    const fixture = await seedOnlineOrder();
    const eventId = newEventId();
    const response = await handleStripeWebhook(
      signedRequest(
        eventBody({ eventId, type: "payment_intent.succeeded", objectId: fixture.intentId }),
      ),
      webhookDeps({ readIntent: async () => intentRead({ intentId: fixture.intentId }) }),
    );
    expect(response.status).toBe(200);
    return fixture;
  }

  // -------------------------------------------------------------------
  // 1. Pobranie kaucji z POTWIERDZONEGO odczytu płatności
  // -------------------------------------------------------------------

  it("potwierdzona płatność księguje kaucję z odnośnikiem intentu", async () => {
    const fixture = await paidOrderWithDeposit();

    expect(await paymentStatusOf(fixture.orderId)).toBe("paid");
    const events = await depositEventsOf(fixture.orderId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "collected",
      // Kaucja, NIE suma zamówienia: intent niósł najem + kaucję, a do
      // rejestru kaucji wchodzi wyłącznie kaucja.
      amount_grosze: DEPOSIT_GROSZE,
      provider: "stripe",
      provider_reference: fixture.intentId,
    });
  }, 30_000);

  it("ponowna dostawa nie księguje kaucji drugi raz", async () => {
    const fixture = await paidOrderWithDeposit();

    // Inne `event_id`, ta sama płatność — czyli dokładnie to, co robi
    // dostawca po awarii naszego endpointu. Idempotencji broni unikat
    // odnośnika z 0031, nie warunek w kodzie.
    const secondEventId = newEventId();
    const response = await handleStripeWebhook(
      signedRequest(
        eventBody({
          eventId: secondEventId,
          type: "payment_intent.succeeded",
          objectId: fixture.intentId,
        }),
      ),
      webhookDeps({ readIntent: async () => intentRead({ intentId: fixture.intentId }) }),
    );

    expect(response.status).toBe(200);
    expect(await depositEventsOf(fixture.orderId)).toHaveLength(1);
  }, 30_000);

  it("zamówienie bez kaucji nie dostaje wiersza w rejestrze", async () => {
    const { data: customer } = await admin
      .from("customers")
      .insert({ tenant_id: member.tenantId, email: `k-${randomUUID().slice(0, 8)}@test.local` })
      .select("id")
      .single();
    const { data: pickup } = await admin
      .from("pickup_locations")
      .insert({ tenant_id: member.tenantId, name: "Magazyn", address_city: "Warszawa" })
      .select("id")
      .single();
    const intentId = `pi_${randomUUID().slice(0, 16)}`;
    const { data: order } = await admin
      .from("orders")
      .insert({
        tenant_id: member.tenantId,
        customer_id: customer!.id as string,
        order_number: `Z5-2026-${nextOrderNumber()}`,
        start_date: "2026-12-01",
        end_date: "2026-12-03",
        delivery_method: "pickup",
        pickup_location_id: pickup!.id as string,
        order_status: "pending",
        payment_status: "pending",
        payment_provider: "stripe",
        payment_method: "online",
        provider_payment_intent_id: intentId,
        total_rental_grosze: RENTAL_GROSZE,
        total_deposit_grosze: 0,
        delivery_grosze: 0,
      })
      .select("id")
      .single();

    const eventId = newEventId();
    await handleStripeWebhook(
      signedRequest(eventBody({ eventId, type: "payment_intent.succeeded", objectId: intentId })),
      webhookDeps({
        readIntent: async () =>
          intentRead({
            intentId,
            amountGrosze: RENTAL_GROSZE,
            amountReceivedGrosze: RENTAL_GROSZE,
          }),
      }),
    );

    expect(await paymentStatusOf(order!.id as string)).toBe("paid");
    expect(await depositEventsOf(order!.id as string)).toHaveLength(0);
  }, 30_000);

  // -------------------------------------------------------------------
  // 2. „ZWROT W TOKU TO NIE ZWROT" — serce tego zadania
  // -------------------------------------------------------------------

  it("odpowiedź `pending` NIE tworzy wiersza w rejestrze kaucji", async () => {
    const fixture = await paidOrderWithDeposit();

    const outcome = await requestDepositRefund(
      {
        db: member.client,
        // Dostawca przyjął żądanie. Odpowiedź niesie identyfikator —
        // i tylko tyle, bo port nie oddaje stąd statusu.
        createRefund: async () => "re_pending_1",
        readRefund: async () => refundRead({ refundId: "re_pending_1", status: "pending" }),
      },
      {
        tenantId: member.tenantId,
        orderId: fixture.orderId,
        amountGrosze: DEPOSIT_GROSZE,
        actorId: member.userId,
      },
    );

    expect(outcome.status).toBe("pending");

    // REJESTR KAUCJI PUSTY POZA POBRANIEM. To jest cała treść tego testu:
    // panel nie ma prawa twierdzić „oddaliśmy kaucję", zanim klient dostanie
    // pieniądze.
    const events = await depositEventsOf(fixture.orderId);
    expect(events.map((event) => event.kind)).toEqual(["collected"]);

    // Stan pośredni MA reprezentację — i przeżyje odświeżenie strony.
    const requests = await refundRequestsOf(fixture.orderId);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      status: "pending",
      amount_grosze: DEPOSIT_GROSZE,
      provider_reference: "re_pending_1",
    });

    // Saldo nietknięte, zamówienie nadal `paid` — kaucja wciąż jest u nas.
    expect(await paymentStatusOf(fixture.orderId)).toBe("paid");
  }, 30_000);

  it("drugi zwrot przy zwrocie w toku jest odmawiany, zanim wyjdzie żądanie", async () => {
    const fixture = await paidOrderWithDeposit();
    const deps = {
      db: member.client,
      createRefund: async () => `re_${randomUUID().slice(0, 10)}`,
      readRefund: async (refundId: string) => refundRead({ refundId, status: "pending" }),
    };
    const input = {
      tenantId: member.tenantId,
      orderId: fixture.orderId,
      amountGrosze: DEPOSIT_GROSZE,
      actorId: member.userId,
    };

    await requestDepositRefund(deps, input);

    let secondCallReachedProvider = false;
    const outcome = await requestDepositRefund(
      {
        ...deps,
        createRefund: async () => {
          secondCallReachedProvider = true;
          return "re_drugi";
        },
      },
      input,
    );

    expect(outcome.status).toBe("pending");
    // Kaucja oddana dwa razy to strata najemcy, której nie cofa się jednym
    // kliknięciem — bramka stoi PRZED żądaniem, nie po nim.
    expect(secondCallReachedProvider).toBe(false);
    expect(await refundRequestsOf(fixture.orderId)).toHaveLength(1);
  }, 30_000);

  it("dwuklik RÓWNOLEGŁY wysyła tylko JEDEN zwrot do dostawcy (0032, ADR-070)", async () => {
    // Regresja przeglądu Z11: bramka in-flight z 0031 była SELECT-em, więc dwa
    // RÓWNOLEGŁE żądania mijały ją oba i wysyłały DWA refundy z różnymi kluczami
    // idempotencji (świeży UUID per żądanie). Częściowy unikat 0032 serializuje
    // je na bazie: pierwszy INSERT wygrywa, drugi dostaje 23505 i kończy się
    // `pending` PRZED `createRefund`. Dowodem jest LICZBA wyjść do dostawcy — bo
    // to ona, a nie stan rejestru, mówi, ile razy pieniądze naprawdę wyszły.
    const fixture = await paidOrderWithDeposit();

    let providerCalls = 0;
    // Zwycięzca trzyma wiersz w stanie in-flight (`requested`) dopóźnionym
    // wyjściem do dostawcy — okno, w którym przegrany próbuje swojego INSERT-u
    // i odbija się o unikat. Przegrany nie dotyka dostawcy, więc kończy w kilka
    // ms; 300 ms > ta ścieżka z zapasem, a suita i tak ma budżet 30 s.
    const deps = {
      db: member.client,
      createRefund: async () => {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 300));
        return "re_rownolegly_1";
      },
      readRefund: async () => refundRead({ refundId: "re_rownolegly_1", status: "succeeded" }),
    };
    const input = {
      tenantId: member.tenantId,
      orderId: fixture.orderId,
      amountGrosze: DEPOSIT_GROSZE,
      actorId: member.userId,
    };

    const outcomes = await Promise.all([
      requestDepositRefund(deps, input),
      requestDepositRefund(deps, input),
    ]);

    // JEDNO wyjście do dostawcy — kaucja oddana RAZ.
    expect(providerCalls).toBe(1);
    // Jeden zwrot rozliczony, drugi odbity jako „w toku" — bez porażki
    // zapraszającej operatora do ponowienia.
    expect(outcomes.map((o) => o.status).sort()).toEqual(["pending", "settled"]);
    // Baza nie wypuściła drugiego żądania: jeden wiersz, jeden refund w rejestrze.
    expect(await refundRequestsOf(fixture.orderId)).toHaveLength(1);
    const events = await depositEventsOf(fixture.orderId);
    expect(events.map((event) => event.kind)).toEqual(["collected", "refunded"]);
    expect(await paymentStatusOf(fixture.orderId)).toBe("deposit_refunded");
  }, 30_000);

  // -------------------------------------------------------------------
  // 3. Zwrot POTWIERDZONY odczytem
  // -------------------------------------------------------------------

  it("potwierdzony odczyt księguje zwrot, zeruje saldo i rozlicza kaucję", async () => {
    const fixture = await paidOrderWithDeposit();

    const outcome = await requestDepositRefund(
      {
        db: member.client,
        createRefund: async () => "re_ok_1",
        readRefund: async () => refundRead({ refundId: "re_ok_1", status: "succeeded" }),
      },
      {
        tenantId: member.tenantId,
        orderId: fixture.orderId,
        amountGrosze: DEPOSIT_GROSZE,
        actorId: member.userId,
      },
    );

    expect(outcome).toMatchObject({ status: "settled", depositSettled: true });

    const events = await depositEventsOf(fixture.orderId);
    expect(events.map((event) => event.kind)).toEqual(["collected", "refunded"]);
    expect(events[1]).toMatchObject({
      amount_grosze: DEPOSIT_GROSZE,
      provider: "stripe",
      provider_reference: "re_ok_1",
    });

    const requests = await refundRequestsOf(fixture.orderId);
    expect(requests[0]).toMatchObject({ status: "succeeded", last_error: null });

    // Bramka 0030 (reguła B) przepuściła — czyli rejestr BYŁ utrwalony przed
    // zmianą statusu. Odwrotna kolejność kończy się tu odmową 23514.
    expect(await paymentStatusOf(fixture.orderId)).toBe("deposit_refunded");
  }, 30_000);

  it("kwota wchodzi Z ODCZYTU, nie z żądania operatora", async () => {
    const fixture = await paidOrderWithDeposit();

    // Dostawca oddał MNIEJ, niż prosiliśmy. Prawdą jest to, co oddał —
    // rejestr kaucji jest dowodem w sporze z klientem, a nie zapisem
    // naszych intencji.
    const outcome = await requestDepositRefund(
      {
        db: member.client,
        createRefund: async () => "re_mniej",
        readRefund: async () =>
          refundRead({ refundId: "re_mniej", status: "succeeded", amountGrosze: 20_000 }),
      },
      {
        tenantId: member.tenantId,
        orderId: fixture.orderId,
        amountGrosze: DEPOSIT_GROSZE,
        actorId: member.userId,
      },
    );

    expect(outcome).toMatchObject({ status: "settled", amountGrosze: 20_000 });
    const events = await depositEventsOf(fixture.orderId);
    expect(events[1]!.amount_grosze).toBe(20_000);
    // Saldo NIE wróciło do zera — więc rozliczenia nie ma i to jest poprawne.
    expect(await paymentStatusOf(fixture.orderId)).toBe("paid");
  }, 30_000);

  // -------------------------------------------------------------------
  // 4. Odmowa dostawcy — zero wiersza i powód
  // -------------------------------------------------------------------

  it("odmowa dostawcy nie zostawia wiersza w rejestrze, zostawia powód", async () => {
    const fixture = await paidOrderWithDeposit();

    const outcome = await requestDepositRefund(
      {
        db: member.client,
        createRefund: async () => {
          throw new StripeApiError(
            "Nie można zwrócić tej płatności (charge_already_refunded).",
            400,
            "charge_already_refunded",
            "invalid_request_error",
          );
        },
        readRefund: async (): Promise<never> => {
          throw new Error("Odczyt nie powinien się wydarzyć — żądanie nie przeszło");
        },
      },
      {
        tenantId: member.tenantId,
        orderId: fixture.orderId,
        amountGrosze: DEPOSIT_GROSZE,
        actorId: member.userId,
      },
    );

    expect(outcome.status).toBe("failed");
    expect(await depositEventsOf(fixture.orderId)).toHaveLength(1);

    const requests = await refundRequestsOf(fixture.orderId);
    expect(requests[0]!.status).toBe("failed");
    expect(requests[0]!.last_error).toContain("charge_already_refunded");
  }, 30_000);

  it("odczyt `failed` też nie księguje zwrotu", async () => {
    const fixture = await paidOrderWithDeposit();

    const outcome = await requestDepositRefund(
      {
        db: member.client,
        // Dostawca PRZYJĄŁ żądanie — a mimo to zwrot upadł. Bez odczytu
        // wyglądałoby to jak sukces.
        createRefund: async () => "re_upadl",
        readRefund: async () =>
          refundRead({
            refundId: "re_upadl",
            status: "failed",
            failureReason: "expired_or_canceled_card",
          }),
      },
      {
        tenantId: member.tenantId,
        orderId: fixture.orderId,
        amountGrosze: DEPOSIT_GROSZE,
        actorId: member.userId,
      },
    );

    expect(outcome.status).toBe("failed");
    expect(await depositEventsOf(fixture.orderId)).toHaveLength(1);
    expect((await refundRequestsOf(fixture.orderId))[0]).toMatchObject({
      status: "failed",
    });
    expect(await paymentStatusOf(fixture.orderId)).toBe("paid");
  }, 30_000);

  // -------------------------------------------------------------------
  // 5. Zwrot większy niż pobranie — DWIE warstwy, każda samodzielnie
  // -------------------------------------------------------------------

  it("nadmiarowy zwrot odrzuca dostawca (warstwa pierwsza)", async () => {
    const fixture = await paidOrderWithDeposit();

    const outcome = await requestDepositRefund(
      {
        db: member.client,
        createRefund: async () => {
          throw new StripeApiError(
            "Refund amount ... is greater than unrefunded amount on charge.",
            400,
            "amount_too_large",
            "invalid_request_error",
          );
        },
        readRefund: async (): Promise<never> => {
          throw new Error("Odczyt nie powinien się wydarzyć");
        },
      },
      {
        tenantId: member.tenantId,
        orderId: fixture.orderId,
        amountGrosze: DEPOSIT_GROSZE * 2,
        actorId: member.userId,
      },
    );

    expect(outcome.status).toBe("failed");
    expect(await depositEventsOf(fixture.orderId)).toHaveLength(1);
  }, 30_000);

  it("nadmiarowy zwrot odrzuca BAZA, nawet gdy dostawca go przyjmie", async () => {
    const fixture = await paidOrderWithDeposit();

    // Dostawca zgadza się na wszystko — druga warstwa musi bronić sama.
    // To nie jest hipoteza: konto połączone bywa zasilane też spoza tego
    // systemu, a wtedy u dostawcy jest z czego zwracać, choć w NASZYM
    // rejestrze kaucji nie ma.
    const outcome = await requestDepositRefund(
      {
        db: member.client,
        createRefund: async () => "re_za_duzo",
        readRefund: async () =>
          refundRead({
            refundId: "re_za_duzo",
            status: "succeeded",
            amountGrosze: DEPOSIT_GROSZE * 2,
          }),
      },
      {
        tenantId: member.tenantId,
        orderId: fixture.orderId,
        amountGrosze: DEPOSIT_GROSZE * 2,
        actorId: member.userId,
      },
    );

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      // Komunikat bramki 0011 — dowód, że odmówiła BAZA, a nie nasz kod.
      expect(outcome.reason).toContain("Rozliczenie kaucji przekracza pobraną kwotę");
    }
    expect(await depositEventsOf(fixture.orderId)).toHaveLength(1);
    expect((await refundRequestsOf(fixture.orderId))[0]!.status).toBe("failed");
  }, 30_000);

  // -------------------------------------------------------------------
  // 6. Potwierdzenie webhookiem — ta sama droga, inny wyzwalacz
  // -------------------------------------------------------------------

  it("charge.refund.updated domyka zwrot zawieszony w stanie pośrednim", async () => {
    const fixture = await paidOrderWithDeposit();
    const refundId = `re_${randomUUID().slice(0, 12)}`;

    // Krok 1: zwrot zlecony, dostawca odpowiada „w toku".
    await requestDepositRefund(
      {
        db: member.client,
        createRefund: async () => refundId,
        readRefund: async () => refundRead({ refundId, status: "pending" }),
      },
      {
        tenantId: member.tenantId,
        orderId: fixture.orderId,
        amountGrosze: DEPOSIT_GROSZE,
        actorId: member.userId,
      },
    );
    expect(await depositEventsOf(fixture.orderId)).toHaveLength(1);

    // Krok 2: dostawca zgłasza zmianę. Ciało zdarzenia niesie „succeeded",
    // ale to nie ono decyduje — decyduje odczyt.
    const eventId = newEventId();
    const response = await handleStripeWebhook(
      signedRequest(eventBody({ eventId, type: "charge.refund.updated", objectId: refundId })),
      webhookDeps({
        readRefund: async () => refundRead({ refundId, status: "succeeded" }),
      }),
    );

    expect(response.status).toBe(200);
    const events = await depositEventsOf(fixture.orderId);
    expect(events.map((event) => event.kind)).toEqual(["collected", "refunded"]);
    expect(events[1]!.provider_reference).toBe(refundId);
    expect(await paymentStatusOf(fixture.orderId)).toBe("deposit_refunded");
    expect((await refundRequestsOf(fixture.orderId))[0]!.status).toBe("succeeded");
  }, 30_000);

  it("zdarzenie zwrotu wciąż `pending` niczego nie księguje", async () => {
    const fixture = await paidOrderWithDeposit();
    const refundId = `re_${randomUUID().slice(0, 12)}`;

    await requestDepositRefund(
      {
        db: member.client,
        createRefund: async () => refundId,
        readRefund: async () => refundRead({ refundId, status: "pending" }),
      },
      {
        tenantId: member.tenantId,
        orderId: fixture.orderId,
        amountGrosze: DEPOSIT_GROSZE,
        actorId: member.userId,
      },
    );

    const eventId = newEventId();
    await handleStripeWebhook(
      signedRequest(eventBody({ eventId, type: "charge.refund.updated", objectId: refundId })),
      webhookDeps({ readRefund: async () => refundRead({ refundId, status: "pending" }) }),
    );

    expect(await depositEventsOf(fixture.orderId)).toHaveLength(1);
    expect(await paymentStatusOf(fixture.orderId)).toBe("paid");
  }, 30_000);

  it("zwrot potwierdzony DWIEMA drogami księguje się raz", async () => {
    const fixture = await paidOrderWithDeposit();
    const refundId = `re_${randomUUID().slice(0, 12)}`;

    // Panel potwierdził odczytem od razu…
    await requestDepositRefund(
      {
        db: member.client,
        createRefund: async () => refundId,
        readRefund: async () => refundRead({ refundId, status: "succeeded" }),
      },
      {
        tenantId: member.tenantId,
        orderId: fixture.orderId,
        amountGrosze: DEPOSIT_GROSZE,
        actorId: member.userId,
      },
    );

    // …a chwilę później przyszło zdarzenie o tym samym zwrocie. Obie drogi
    // są legalne i dostawca nie gwarantuje kolejności — o jednokrotności
    // księgowania rozstrzyga unikat odnośnika z 0031.
    const eventId = newEventId();
    const response = await handleStripeWebhook(
      signedRequest(eventBody({ eventId, type: "charge.refund.updated", objectId: refundId })),
      webhookDeps({ readRefund: async () => refundRead({ refundId, status: "succeeded" }) }),
    );

    expect(response.status).toBe(200);
    const events = await depositEventsOf(fixture.orderId);
    expect(events.filter((event) => event.kind === "refunded")).toHaveLength(1);

    // I ŻADNA z dróg nie zostawia po sobie „zwrot odrzucony". Ta asercja
    // jest tu z WERYFIKACJI NA ŻYWO: druga droga dostaje z bazy 23514
    // (bramka salda 0011 jest triggerem BEFORE INSERT, więc zapala się
    // ZANIM ograniczenie unikalności zdąży zgłosić 23505), a klasyfikacja
    // po kodzie błędu czytała to jako odmowę. Operator widział „zwrot
    // odrzucony" przy poprawnie zwróconej kaucji.
    expect((await refundRequestsOf(fixture.orderId))[0]).toMatchObject({
      status: "succeeded",
      last_error: null,
    });
    expect(await paymentStatusOf(fixture.orderId)).toBe("deposit_refunded");
  }, 30_000);

  it("potwierdzenie webhookiem PRZED odczytem panelu też kończy się `succeeded`", async () => {
    // Kolejność odwrotna niż wyżej — i to jest ta, która wyszła na żywym
    // Stripie: `refund.updated` przychodzi w ułamku sekundy po POST-cie,
    // więc webhook księguje PIERWSZY, a odczyt panelu trafia na gotowe.
    const fixture = await paidOrderWithDeposit();
    const refundId = `re_${randomUUID().slice(0, 12)}`;

    const outcome = await requestDepositRefund(
      {
        db: member.client,
        createRefund: async () => refundId,
        // Webhook wciska się DOKŁADNIE TAM, gdzie wcisnął się na żywo:
        // po zapisaniu odnośnika (bez niego nie miałby czego odnaleźć),
        // a przed naszym własnym księgowaniem.
        readRefund: async () => {
          const eventId = newEventId();
          await handleStripeWebhook(
            signedRequest(
              eventBody({ eventId, type: "charge.refund.updated", objectId: refundId }),
            ),
            webhookDeps({ readRefund: async () => refundRead({ refundId, status: "succeeded" }) }),
          );
          return refundRead({ refundId, status: "succeeded" });
        },
      },
      {
        tenantId: member.tenantId,
        orderId: fixture.orderId,
        amountGrosze: DEPOSIT_GROSZE,
        actorId: member.userId,
      },
    );

    expect(outcome).toMatchObject({ status: "settled" });
    const events = await depositEventsOf(fixture.orderId);
    expect(events.filter((event) => event.kind === "refunded")).toHaveLength(1);
    expect((await refundRequestsOf(fixture.orderId))[0]).toMatchObject({
      status: "succeeded",
      last_error: null,
    });
    expect(await paymentStatusOf(fixture.orderId)).toBe("deposit_refunded");
  }, 30_000);

  it("zdarzenie zwrotu spoza naszego obiegu jest rejestrowane bez zapisu stanu", async () => {
    const eventId = newEventId();
    const response = await handleStripeWebhook(
      signedRequest(
        eventBody({ eventId, type: "charge.refund.updated", objectId: "re_obcy_zwrot" }),
      ),
      webhookDeps({
        readRefund: async (): Promise<never> => {
          throw new Error("Odczyt nie powinien się wydarzyć — nie znamy tego zwrotu");
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "unrelated" });
  }, 30_000);

  // -------------------------------------------------------------------
  // 7. Obieg ręczny NIETKNIĘTY (ADR-035)
  // -------------------------------------------------------------------

  it("zwrot na zamówieniu offline nie idzie do dostawcy", async () => {
    const { data: customer } = await admin
      .from("customers")
      .insert({ tenant_id: member.tenantId, email: `k-${randomUUID().slice(0, 8)}@test.local` })
      .select("id")
      .single();
    const { data: order } = await admin
      .from("orders")
      .insert({
        tenant_id: member.tenantId,
        customer_id: customer!.id as string,
        order_number: `Z5-2026-${nextOrderNumber()}`,
        start_date: "2026-12-01",
        end_date: "2026-12-03",
        delivery_method: "courier",
        total_deposit_grosze: DEPOSIT_GROSZE,
      })
      .select("id")
      .single();
    const orderId = order!.id as string;

    // Pobranie gotówki — obieg ręczny, wiersz powstaje od razu i BEZ
    // odnośnika dostawcy (CHECK z 0031 tego pilnuje).
    const { error: collectError } = await member.client.from("deposit_events").insert({
      tenant_id: member.tenantId,
      order_id: orderId,
      kind: "collected",
      amount_grosze: DEPOSIT_GROSZE,
      created_by: member.userId,
    });
    expect(collectError).toBeNull();

    const outcome = await requestDepositRefund(
      {
        db: member.client,
        createRefund: async (): Promise<never> => {
          throw new Error("Obieg ręczny nie ma prawa dotknąć dostawcy");
        },
        readRefund: async (): Promise<never> => {
          throw new Error("Obieg ręczny nie ma prawa dotknąć dostawcy");
        },
      },
      {
        tenantId: member.tenantId,
        orderId,
        amountGrosze: DEPOSIT_GROSZE,
        actorId: member.userId,
      },
    );

    // Ta funkcja obsługuje WYŁĄCZNIE obieg online; obieg ręczny zostaje
    // przy swojej akcji (deposit-actions.ts rozgałęzia się przed nią).
    expect(outcome.status).toBe("failed");
    expect(await refundRequestsOf(orderId)).toHaveLength(0);
    expect(await depositEventsOf(orderId)).toHaveLength(1);
  }, 30_000);
});
