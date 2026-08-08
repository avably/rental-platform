/**
 * Handler webhooka płatności — JEDYNE miejsce w systemie, które przenosi
 * zamówienie w `paid` (Z4, ADR-067).
 *
 * Rdzeń mieszka tutaj, a nie w `route.ts`, z tego samego powodu co przy
 * hooku e-maili kont (ADR-048): plik trasy może eksportować wyłącznie
 * handlery HTTP, a ta ścieżka musi dać się zawołać z testu z WSTRZYKNIĘTYM
 * klientem bazy, WSTRZYKNIĘTYM odczytem u dostawcy i WSTRZYKNIĘTYM zegarem.
 *
 * ================== PIĘĆ REGUŁ, NA KTÓRYCH TO STOI ==================
 *
 * 1. PODPIS DOWODZI AUTORSTWA, NIE AKTUALNOŚCI — i dlatego z ciała bierzemy
 *    wyłącznie identyfikatory (patrz `@avably/core` → stripe/webhook.ts).
 *    Ten plik nie ma ani jednej linijki, która czyta stan z payloadu.
 *
 * 2. STAN PISZEMY Z ODCZYTU. `readIntent` → `settlementVerdict` → UPDATE.
 *    Zdarzenie mówi tylko, KIEDY zapytać i O CO.
 *
 * 3. IDEMPOTENCJA JEST OGRANICZENIEM BAZY, NIE WARUNKIEM W KODZIE.
 *    `insert ... on conflict do nothing` + liczba wstawionych wierszy.
 *    `select`-potem-`insert` przeszedłby oba SELECT-y przy równoległej
 *    dostawie tego samego zdarzenia i wykonał zapis dwa razy (ADR-024).
 *
 * 4. SUKCES ZAPISU TEŻ JEST DEKLARACJĄ. PostgREST na UPDATE odpowiada 204
 *    także wtedy, gdy nie trafił w żaden wiersz (zmiana wyprzedzona przez
 *    równoległą dostawę, filtr, który przestał pasować, polityka RLS
 *    odfiltrowująca wiersz — pułapka opisana w nagłówku
 *    `rls-isolation.test.ts`, gdzie dodatkowo `RETURNING` potrafi zamaskować
 *    mutację). Dlatego o wyniku NIE decyduje odpowiedź na UPDATE, tylko
 *    ODCZYT WIERSZA po zapisie: `payment_status` musi być tym, co zamierzaliśmy
 *    ustawić. Rozjazd = `webhook_events.status='failed'` z powodem — nigdy
 *    ciche „przetworzone".
 *
 * 5. 2xx DLA DOSTAWCY ≠ SUKCES BIZNESOWY. Odmowa bramki statusów (spóźnione
 *    zdarzenie, które cofałoby zamówienie z `paid`) kończy się 2xx, bo
 *    ponowienie niczego nie naprawi — ale w rejestrze ląduje jako ODMOWA
 *    z powodem, nie jako przetworzenie. Wiersz `webhook_events` jest zapisem
 *    tego, co się REALNIE stało, a nie echem naszej własnej odpowiedzi HTTP.
 *
 * ================== KIEDY ODDAJEMY 5xx ==================
 *
 * 5xx wyłącznie tam, gdzie PONOWIENIE MA SZANSĘ POMÓC: awaria odczytu
 * u dostawcy, awaria naszej bazy. W takim wypadku ZWALNIAMY DZIERŻAWĘ —
 * kasujemy wiersz `webhook_events`, który przed chwilą przejęliśmy. Bez tego
 * ponowna dostawa trafiłaby na istniejący `event_id`, zostałaby uznana za
 * duplikat i płatność zawisłaby na zawsze: dostawca ponawia, my grzecznie
 * odpowiadamy „już mam", a zamówienie nigdy nie dostaje statusu. Wiersz jest
 * DZIERŻAWĄ na czas przetwarzania, nie pomnikiem faktu, że coś przyszło.
 */
import {
  STRIPE_SIGNATURE_HEADER,
  isObservedIntentEvent,
  isObservedRefundEvent,
  parseStripeEvent,
  refundVerdict,
  settlementVerdict,
  verifyStripeSignature,
  type IntentRead,
  type RefundRead,
  type StripeEventEnvelope,
} from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import { bookDepositEvent, settleDepositIfComplete } from "./deposit-booking";
import { applySettlement, type SettlementOrder } from "./payment-settlement";

/** Nazwa dostawcy w rejestrze zdarzeń — lustro CHECK-a z migracji 0030. */
export const WEBHOOK_PROVIDER = "stripe";

export interface StripeWebhookDeps {
  /**
   * Klient bazy. W produkcji SERVICE-ROLE i to jest jedyne miejsce w repo,
   * które takiego potrzebuje: rejestr zdarzeń jest platformowy (zero polityk
   * dla `authenticated`), a zapis `paid` w obiegu stripe jest bramkowany
   * w bazie do roli `service_role` (0030). Wstrzykiwany, bo test podstawia
   * klienta realnego, ale własnego.
   */
  db: SupabaseClient;
  /**
   * Odczyt płatności u dostawcy — JEDYNE źródło stanu (ADR-049).
   * Podpis bierze konto najemcy, bo płatność żyje na koncie połączonym.
   */
  readIntent: (intentId: string, connectedAccountId: string) => Promise<IntentRead>;
  /**
   * Odczyt ZWROTU u dostawcy (Z5, ADR-069) — lustro `readIntent`. Zdarzenie
   * `charge.refund.updated` niesie sam `re_...` i nic więcej; o tym, czy
   * pieniądze wróciły do klienta, mówi wyłącznie ten odczyt.
   */
  readRefund: (refundId: string, connectedAccountId: string) => Promise<RefundRead>;
  /** Sekret podpisu. Wstrzykiwany, żeby test nie zależał od env procesu. */
  secret: string | undefined;
  /** Zegar do okna tolerancji podpisu. */
  now?: Date;
}

/** Co się realnie stało — lustro `webhook_events.status` z 0030. */
export type WebhookOutcome = "processed" | "failed";

/** Rozszerza `SettlementOrder` o pola, z których liczymy sumę oczekiwaną. */
interface OrderRow extends SettlementOrder {
  payment_provider: string;
  total_rental_grosze: number;
  delivery_grosze: number;
  /** Waluta UTRWALONA na zamówieniu (0049, ADR-103) — z niej powstał intent. */
  currency: string;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Zamyka wiersz rejestru werdyktem. `reason` jest OBOWIĄZKOWY przy `failed`
 * i dopuszczalny przy `processed` — bo „rozpatrzone i świadomie bez zapisu
 * stanu" (nieobsługiwany typ, brak zamówienia, płatność w toku) to też
 * informacja, której cisza by nie oddała.
 */
async function finish(
  db: SupabaseClient,
  eventRowId: string,
  outcome: WebhookOutcome,
  reason: string | null,
): Promise<void> {
  const { error } = await db
    .from("webhook_events")
    .update({ status: outcome, processed_at: new Date().toISOString(), error: reason })
    .eq("id", eventRowId);

  // Porażka domknięcia rejestru NIE wywraca odpowiedzi: stan zamówienia jest
  // już utrwalony, a ponowienie całej ścieżki przez dostawcę nic tu nie
  // poprawi. Zostaje wiersz w `received` i ślad w logach serwera — wzorzec
  // „uczciwej częściowej porażki" (ADR-046).
  if (error) {
    console.error(
      `[stripe-webhook] nie udało się domknąć wiersza rejestru ${eventRowId}: ${error.message}`,
    );
  }
}

/** Zwolnienie dzierżawy przed 5xx — patrz nagłówek pliku. */
async function release(db: SupabaseClient, eventRowId: string): Promise<void> {
  const { error } = await db.from("webhook_events").delete().eq("id", eventRowId);
  if (error) {
    console.error(
      `[stripe-webhook] nie udało się zwolnić dzierżawy zdarzenia ${eventRowId}: ${error.message}. ` +
        "Ponowna dostawa zostanie uznana za duplikat — wymaga ręcznego usunięcia wiersza.",
    );
  }
}

/**
 * Konto najemcy u dostawcy — bierzemy je z NASZEJ bazy, po tenancie, nie
 * z pola `account` w ciele zdarzenia. Ciało mówi, na czyim koncie zdarzenie
 * POWSTAŁO; baza mówi, na czyje konto MY skierowaliśmy tę płatność. Przy
 * rozjeździe to drugie jest tym, o co nam chodzi.
 *
 * `null` w `accountId` przy `ok: true` nie występuje — brak konta jest
 * osobnym wynikiem, żeby wołający musiał go obsłużyć jawnie.
 */
async function connectedAccountFor(
  db: SupabaseClient,
  tenantId: string,
): Promise<
  | { ok: true; accountId: string }
  | { ok: false; retryable: boolean; reason: string }
> {
  const query = await db
    .from("payment_accounts")
    .select("provider_account_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (query.error) {
    return {
      ok: false,
      retryable: true,
      reason: `Odczyt konta najemcy nie powiódł się: ${query.error.message}`,
    };
  }

  const accountId = (query.data as { provider_account_id: string } | null)?.provider_account_id;
  if (!accountId) {
    return {
      ok: false,
      retryable: false,
      reason: `Najemca ${tenantId} nie ma konta u dostawcy — nie ma na czym wykonać odczytu.`,
    };
  }
  return { ok: true, accountId };
}

/** Wiersz żądania zwrotu (0031) — punkt zaczepienia zdarzeń refundu. */
interface RefundRequestRow {
  id: string;
  tenant_id: string;
  order_id: string;
  amount_grosze: number;
  status: string;
}

/** Zapis wyniku odczytu w rejestrze ŻĄDAŃ. Nigdy w rejestrze zdarzeń. */
async function markRefundRequest(
  db: SupabaseClient,
  requestId: string,
  status: "pending" | "succeeded" | "failed",
  lastError: string | null,
): Promise<void> {
  const { error } = await db
    .from("deposit_refunds")
    .update({ status, last_error: lastError })
    .eq("id", requestId);
  if (error) {
    console.error(
      `[stripe-webhook] nie udało się zapisać stanu żądania zwrotu ${requestId}: ${error.message}`,
    );
  }
}

/**
 * Gałąź zdarzeń ZWROTU (Z5, ADR-069).
 *
 * Kształt jest lustrem gałęzi płatności i to nie jest przypadek — obie
 * odpowiadają na to samo pytanie („co dostawca zrobił z pieniędzmi") w ten
 * sam sposób: zdarzenie mówi TYLKO, o co zapytać.
 *
 * PUNKT ZACZEPIENIA: `deposit_refunds.provider_reference`, czyli NASZ ślad
 * po żądaniu, które sami wysłaliśmy. Zwrot zlecony z panelu dostawcy —
 * poza naszym obiegiem — nie ma tu wiersza i zostaje zarejestrowany jako
 * niepowiązany. To jest świadome: nie wiemy, czy tamten zwrot dotyczył
 * kaucji, czy najmu, a zgadywanie księgowałoby cudzą decyzję jako naszą.
 *
 * KOLEJNOŚĆ: rejestr zdarzeń → potem `payment_status`. Odwrotna daje 23514
 * z bramki spójności (0030, reguła B), bo ta czyta saldo punktowo.
 */
async function handleRefundEvent(
  event: StripeEventEnvelope,
  eventRowId: string,
  deps: StripeWebhookDeps,
): Promise<Response> {
  const requestQuery = await deps.db
    .from("deposit_refunds")
    .select("id, tenant_id, order_id, amount_grosze, status")
    .eq("provider_reference", event.objectId)
    .maybeSingle();

  if (requestQuery.error) {
    await release(deps.db, eventRowId);
    return json(500, { error: `Odczyt żądania zwrotu nie powiódł się: ${requestQuery.error.message}` });
  }

  const request = requestQuery.data as RefundRequestRow | null;
  if (!request) {
    await finish(
      deps.db,
      eventRowId,
      "processed",
      `Żaden zwrot zlecony z panelu nie jest związany z ${event.objectId} — zarejestrowane bez zapisu stanu.`,
    );
    return json(200, { status: "unrelated", eventId: event.id });
  }

  const account = await connectedAccountFor(deps.db, request.tenant_id);
  if (!account.ok) {
    if (account.retryable) {
      await release(deps.db, eventRowId);
      return json(500, { error: account.reason });
    }
    await finish(deps.db, eventRowId, "failed", account.reason);
    return json(200, { status: "failed", eventId: event.id });
  }

  // --- ODCZYT: jedyne źródło prawdy o zwrocie ---
  let read: RefundRead;
  try {
    read = await deps.readRefund(event.objectId, account.accountId);
  } catch (error) {
    await release(deps.db, eventRowId);
    return json(500, { error: `Odczyt zwrotu u dostawcy nie powiódł się: ${errorMessage(error)}` });
  }

  const verdict = refundVerdict(read);

  if (verdict.outcome === "failed") {
    // ZERO wiersza w rejestrze zdarzeń — kaucja NIE wróciła. Powód zostaje
    // w rejestrze żądań, żeby operator wiedział, co powiedzieć klientowi.
    await markRefundRequest(deps.db, request.id, "failed", verdict.reason);
    await finish(deps.db, eventRowId, "processed", verdict.reason);
    return json(200, { status: "refund_failed", eventId: event.id });
  }

  if (verdict.outcome === "pending") {
    await markRefundRequest(deps.db, request.id, "pending", verdict.reason);
    await finish(deps.db, eventRowId, "processed", verdict.reason);
    return json(200, { status: "noop", eventId: event.id });
  }

  // --- ZWROT POTWIERDZONY: najpierw rejestr, dopiero potem status ---
  const booked = await bookDepositEvent(deps.db, {
    tenantId: request.tenant_id,
    orderId: request.order_id,
    kind: "refunded",
    // Kwota Z ODCZYTU, nie z żądania: jeśli dostawca oddał inną, prawdą
    // jest ta, którą oddał.
    amountGrosze: verdict.amountGrosze,
    providerReference: read.refundId,
  });

  if (!booked.ok) {
    if (booked.retryable) {
      await release(deps.db, eventRowId);
      return json(500, { error: booked.reason });
    }
    await markRefundRequest(deps.db, request.id, "failed", booked.reason);
    await finish(deps.db, eventRowId, "failed", booked.reason);
    return json(200, { status: "rejected", eventId: event.id });
  }

  await markRefundRequest(deps.db, request.id, "succeeded", null);

  const settlement = await settleDepositIfComplete(deps.db, request.tenant_id, request.order_id);
  if (!settlement.ok) {
    // Zwrot JEST zaksięgowany — mówimy dokładnie, co się nie udało, zamiast
    // udawać pełny sukces albo pełną porażkę (ADR-046).
    await finish(deps.db, eventRowId, "failed", settlement.reason);
    return json(200, { status: "rejected", eventId: event.id });
  }

  await finish(
    deps.db,
    eventRowId,
    "processed",
    settlement.settled ? null : "Zwrot zaksięgowany; saldo kaucji nadal dodatnie.",
  );
  return json(200, {
    status: "processed",
    eventId: event.id,
    depositSettled: settlement.settled,
  });
}

export async function handleStripeWebhook(
  request: Request,
  deps: StripeWebhookDeps,
): Promise<Response> {
  // SUROWE ciało, przed jakimkolwiek parsowaniem: podpis liczy się z bajtów.
  const payload = await request.text();

  const verified = verifyStripeSignature({
    secret: deps.secret,
    header: request.headers.get(STRIPE_SIGNATURE_HEADER),
    payload,
    now: deps.now,
  });
  // 400 I ZERO ZAPISU. Żądanie bez dowodu autorstwa nie zostawia po sobie
  // nawet wiersza w rejestrze — inaczej rejestr dałoby się zaśmiecić
  // (i zapchać unikat na `event_id`) bez znajomości sekretu.
  if (!verified.ok) {
    return json(400, { error: verified.message, reason: verified.reason });
  }

  const parsed = parseStripeEvent(payload);
  if (!parsed.ok) {
    return json(400, { error: parsed.message });
  }
  const event = parsed.event;

  // --- Przejęcie zdarzenia: jedyne rozstrzygnięcie „ja to robię" ---
  //
  // `ignoreDuplicates` daje PostgREST-owi `Prefer: resolution=ignore-duplicates`,
  // czyli dokładnie `on conflict do nothing`. `.select()` zwraca WYŁĄCZNIE
  // wiersze faktycznie wstawione: pusta tablica = zdarzenie ma już kto inny.
  const claim = await deps.db
    .from("webhook_events")
    .upsert(
      { provider: WEBHOOK_PROVIDER, event_id: event.id, event_type: event.type },
      { onConflict: "provider,event_id", ignoreDuplicates: true },
    )
    .select("id");

  if (claim.error) {
    // Nie wiemy, czy przejęliśmy zdarzenie — więc nie wolno nam go
    // przetwarzać ani potwierdzić. Niech dostawca ponowi.
    return json(500, { error: `Rejestr zdarzeń niedostępny: ${claim.error.message}` });
  }

  const rows = (claim.data ?? []) as { id: string }[];
  if (rows.length === 0) {
    // DUPLIKAT. Nie „już przetworzone" — po prostu nie nasze. Właściciel
    // wiersza kończy (albo skończył) przetwarzanie; drugi zapis stanu byłby
    // dokładnie tym, przed czym broni unikat.
    return json(200, { status: "duplicate", eventId: event.id });
  }
  const eventRowId = rows[0]!.id;

  // --- Zdarzenia ZWROTU idą własną gałęzią (Z5) ---
  //
  // Rozgałęzienie stoi PRZED odnalezieniem zamówienia, bo obiekt zdarzenia
  // jest tu inny: `re_...`, nie `pi_...`. Szukanie zamówienia po
  // `provider_payment_intent_id` z identyfikatorem refundu zawsze chybia —
  // i chybiałoby CICHO, jako „zdarzenie niepowiązane".
  if (isObservedRefundEvent(event.type)) {
    return handleRefundEvent(event, eventRowId, deps);
  }

  // --- Czy to zdarzenie w ogóle nas obchodzi ---
  if (!isObservedIntentEvent(event.type)) {
    await finish(
      deps.db,
      eventRowId,
      "processed",
      `Typ ${event.type} nie jest obsługiwany — zdarzenie zarejestrowane bez zapisu stanu.`,
    );
    return json(200, { status: "ignored", eventId: event.id });
  }

  // --- Zamówienie: szukane po NASZEJ kolumnie, nie po polu z ciała ---
  //
  // `provider_payment_intent_id` ma unikat globalny (0029), więc trafienie
  // jest co najwyżej jedno. Brak trafienia to NORMALNY stan, nie awaria:
  // na koncie platformy powstają płatności spoza tego systemu (choćby
  // `stripe trigger` przy diagnostyce), a ich zdarzenia też tu przyjdą.
  const orderQuery = await deps.db
    .from("orders")
    .select(
      "id, tenant_id, payment_status, payment_provider, total_rental_grosze, total_deposit_grosze, delivery_grosze, currency",
    )
    .eq("provider_payment_intent_id", event.objectId)
    .maybeSingle();

  if (orderQuery.error) {
    await release(deps.db, eventRowId);
    return json(500, { error: `Odczyt zamówienia nie powiódł się: ${orderQuery.error.message}` });
  }

  const order = orderQuery.data as OrderRow | null;
  if (!order) {
    await finish(
      deps.db,
      eventRowId,
      "processed",
      `Żadne zamówienie nie jest związane z płatnością ${event.objectId} — zarejestrowane bez zapisu stanu.`,
    );
    return json(200, { status: "unrelated", eventId: event.id });
  }

  // --- Konto najemcy: potrzebne do odczytu na koncie połączonym ---
  const account = await connectedAccountFor(deps.db, order.tenant_id);
  if (!account.ok) {
    if (account.retryable) {
      await release(deps.db, eventRowId);
      return json(500, { error: account.reason });
    }
    // Zamówienie wskazuje płatność, ale najemca nie ma konta — stan
    // niespójny, którego ponowienie nie naprawi. Rejestrujemy jako ODMOWĘ
    // i kończymy 2xx.
    await finish(deps.db, eventRowId, "failed", account.reason);
    return json(200, { status: "failed", eventId: event.id });
  }
  const connectedAccountId = account.accountId;

  // --- ODCZYT: jedyne źródło stanu ---
  let read: IntentRead;
  try {
    read = await deps.readIntent(event.objectId, connectedAccountId);
  } catch (error) {
    // Awaria dostawcy jest PRZEJŚCIOWA — ponowienie ma sens, więc 5xx
    // i zwolnienie dzierżawy.
    await release(deps.db, eventRowId);
    return json(500, { error: `Odczyt płatności u dostawcy nie powiódł się: ${errorMessage(error)}` });
  }

  // Suma policzona przez NASZ serwer z utrwalonych danych zamówienia —
  // ta sama arytmetyka co w `app.get_public_order_payment` (0029). Kwota
  // z ciała zdarzenia nie występuje w tym obiegu ani razu. Waluta również
  // z UTRWALONEGO wiersza (orders.currency, 0049/ADR-103): intent powstał
  // z tej pary, więc werdykt porównuje odczyt z tym samym źródłem.
  const expectedGrosze =
    order.total_rental_grosze + order.total_deposit_grosze + order.delivery_grosze;
  const verdict = settlementVerdict(read, expectedGrosze, order.currency);

  if (verdict.status === null) {
    await finish(deps.db, eventRowId, "processed", verdict.reason);
    return json(200, { status: "noop", eventId: event.id });
  }

  // --- ZAPIS ROZLICZENIA: wspólna ścieżka, ta sama co job i akcja panelu ---
  //
  // Sekwencja (kaucja → compare-and-set → odczyt po zapisie) mieszka
  // w `lib/payment-settlement.ts` od L11 (ADR-104), bo mają ją wykonywać
  // TRZY wejścia z werdyktem z odczytu: to zdarzenie, pętla rekoncyliacji
  // i przycisk operatora. Druga kopia rozjechałaby się przy pierwszej
  // poprawce, a rozjazd byłby rozjazdem w księgowaniu pieniędzy.
  const applied = await applySettlement(deps.db, {
    order,
    targetStatus: verdict.status,
    providerReference: event.objectId,
  });

  if (!applied.ok) {
    if (applied.retryable) {
      // Awaria przejściowa (baza, rejestr kaucji) — ponowienie ma sens.
      await release(deps.db, eventRowId);
      return json(500, { error: applied.reason });
    }
    // 2xx MIMO PORAŻKI: odmowa bramki (statusów albo salda kaucji) jest
    // deterministyczna — dziesiąte ponowienie skończy się tak samo. Ślad
    // zostaje w rejestrze jako ODMOWA, nie jako przetworzenie.
    await finish(deps.db, eventRowId, "failed", applied.reason);
    return json(200, { status: "rejected", eventId: event.id });
  }

  if (!applied.changed) {
    await finish(deps.db, eventRowId, "processed", applied.reason);
    return json(200, { status: "noop", eventId: event.id });
  }

  await finish(deps.db, eventRowId, "processed", null);
  return json(200, {
    status: "processed",
    eventId: event.id,
    paymentStatus: applied.paymentStatus,
  });
}
