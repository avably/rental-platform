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
  parseStripeEvent,
  settlementVerdict,
  verifyStripeSignature,
  type IntentRead,
  type PaymentStatus,
} from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  /** Sekret podpisu. Wstrzykiwany, żeby test nie zależał od env procesu. */
  secret: string | undefined;
  /** Zegar do okna tolerancji podpisu. */
  now?: Date;
}

/** Co się realnie stało — lustro `webhook_events.status` z 0030. */
export type WebhookOutcome = "processed" | "failed";

interface OrderRow {
  id: string;
  tenant_id: string;
  payment_status: PaymentStatus;
  payment_provider: string;
  total_rental_grosze: number;
  total_deposit_grosze: number;
  delivery_grosze: number;
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
      "id, tenant_id, payment_status, payment_provider, total_rental_grosze, total_deposit_grosze, delivery_grosze",
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
  //
  // Bierzemy je z NASZEJ bazy, po tenancie zamówienia — nie z pola `account`
  // w ciele zdarzenia. Ciało mówi, na czyim koncie zdarzenie POWSTAŁO;
  // baza mówi, na czyje konto MY skierowaliśmy tę płatność. Przy rozjeździe
  // to drugie jest tym, o co nam chodzi.
  const accountQuery = await deps.db
    .from("payment_accounts")
    .select("provider_account_id")
    .eq("tenant_id", order.tenant_id)
    .maybeSingle();

  if (accountQuery.error) {
    await release(deps.db, eventRowId);
    return json(500, { error: `Odczyt konta najemcy nie powiódł się: ${accountQuery.error.message}` });
  }

  const connectedAccountId = (accountQuery.data as { provider_account_id: string } | null)
    ?.provider_account_id;
  if (!connectedAccountId) {
    // Zamówienie wskazuje płatność, ale najemca nie ma konta — stan
    // niespójny, którego ponowienie nie naprawi. Rejestrujemy jako ODMOWĘ
    // i kończymy 2xx.
    await finish(
      deps.db,
      eventRowId,
      "failed",
      `Najemca ${order.tenant_id} nie ma konta u dostawcy — nie ma na czym wykonać odczytu płatności.`,
    );
    return json(200, { status: "failed", eventId: event.id });
  }

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
  // z ciała zdarzenia nie występuje w tym obiegu ani razu.
  const expectedGrosze =
    order.total_rental_grosze + order.total_deposit_grosze + order.delivery_grosze;
  const verdict = settlementVerdict(read, expectedGrosze);

  if (verdict.status === null) {
    await finish(deps.db, eventRowId, "processed", verdict.reason);
    return json(200, { status: "noop", eventId: event.id });
  }

  if (verdict.status === order.payment_status) {
    await finish(
      deps.db,
      eventRowId,
      "processed",
      `Zamówienie jest już w statusie ${verdict.status} — bez zapisu.`,
    );
    return json(200, { status: "noop", eventId: event.id });
  }

  // --- Zapis warunkowy: compare-and-set na statusie, który widzieliśmy ---
  //
  // Filtr po STARYM statusie zamienia „nadpisz" w „zmień, jeśli nikt mnie
  // nie wyprzedził". Równoległa dostawa (inne `event_id`, ta sama płatność)
  // przechodzi ten sam odczyt i tę samą decyzję; bez tego filtru druga
  // z nich nadpisywałaby stan ustawiony przez pierwszą na podstawie
  // WCZEŚNIEJSZEGO odczytu.
  const update = await deps.db
    .from("orders")
    .update({ payment_status: verdict.status })
    .eq("id", order.id)
    .eq("payment_status", order.payment_status);

  // --- ODCZYT PO ZAPISIE: jedyne, co rozstrzyga o werdykcie ---
  //
  // Odpowiedź na UPDATE świadomie NIE decyduje. Jej brak błędu znaczy tylko
  // „żądanie przyjęto" — także wtedy, gdy nie trafiło w żaden wiersz. Błąd
  // z tej odpowiedzi wchodzi wyłącznie do UZASADNIENIA, bo niesie czytelny
  // powód odmowy bramki (23514).
  const after = await deps.db
    .from("orders")
    .select("payment_status")
    .eq("id", order.id)
    .maybeSingle();

  if (after.error || !after.data) {
    await release(deps.db, eventRowId);
    return json(500, {
      error: `Nie udało się potwierdzić zapisu odczytem: ${after.error?.message ?? "brak wiersza"}`,
    });
  }

  const confirmed = (after.data as { payment_status: PaymentStatus }).payment_status;
  if (confirmed !== verdict.status) {
    const detail = update.error ? ` Baza odmówiła: ${update.error.message}` : "";
    await finish(
      deps.db,
      eventRowId,
      "failed",
      `Zamierzano ustawić ${verdict.status}, po zapisie w bazie jest ${confirmed}.${detail}`,
    );
    // 2xx MIMO PORAŻKI: odmowa bramki statusów jest deterministyczna —
    // dziesiąte ponowienie skończy się tak samo. Ślad zostaje w rejestrze.
    return json(200, { status: "rejected", eventId: event.id });
  }

  await finish(deps.db, eventRowId, "processed", null);
  return json(200, { status: "processed", eventId: event.id, paymentStatus: confirmed });
}
