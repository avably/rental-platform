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
  isObservedAccountEvent,
  isObservedIntentEvent,
  isObservedRefundEvent,
  parseStripeEvent,
  refundVerdict,
  settlementVerdict,
  verifyStripeSignature,
  type ConnectAccountSync,
  type IntentRead,
  type RefundRead,
  type StripeEventEnvelope,
  type StripeSignatureResult,
} from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import { bookDepositEvent, settleDepositIfComplete } from "./deposit-booking";
import {
  sendPaymentConfirmedEmail,
  type PaymentConfirmedEmailOverrides,
} from "./payment-confirmed-email";
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
  /**
   * PULL prawdy o KONCIE połączonym (ADR-213) — lustro `readIntent`/`readRefund`.
   * Zdarzenie `account.updated` niesie sam `acct_...`; o gotowości konta mówi
   * wyłącznie `GET /v1/accounts/{id}` (`syncConnectAccountSafely`). Funkcja
   * NIGDY nie rzuca — porażka odczytu wraca jako `{ ok:false, state:null,
   * error }`, więc handler zapisuje sam `last_error`, nie zerując gotowości.
   * Komunikaty dostawcy przechodzą przez `redactSecretKey` już w porcie
   * (`api.ts`), zanim tu dotrą.
   */
  syncAccount: (providerAccountId: string) => Promise<ConnectAccountSync>;
  /**
   * Sekret podpisu destynacji SNAPSHOT (v1). WYMAGANY w produkcji — bez niego
   * `route.ts` nie woła handlera (500). Wstrzykiwany, żeby test nie zależał
   * od env procesu.
   */
  secret: string | undefined;
  /**
   * Sekret podpisu DRUGIEJ destynacji — „Thin" (v2, ADR-222) — OPCJONALNY.
   *
   * Zdarzenia v2 „thin" (`v2.core.account.updated`, ADR-218) przychodzą z
   * OSOBNEJ destynacji Stripe z WŁASNYM sekretem `whsec_…` na TYM SAMYM
   * endpoincie URL. Podpis liczony jest tym samym schematem co Snapshot
   * (HMAC-SHA256, `v1=`, `timestamp.payload` —
   * https://docs.stripe.com/webhooks#verify-manually, potwierdzone dla thin
   * w https://docs.stripe.com/event-destinations), więc weryfikator się nie
   * zmienia — zmienia się tylko sekret, którym próbujemy.
   *
   * `undefined` = destynacja Thin jeszcze nieskonfigurowana: v1 działa bez
   * zmian, a v2 są odrzucane (zły podpis → 400), jak dziś. NIE osłabia v1.
   */
  secretThin?: string | undefined;
  /** Zegar do okna tolerancji podpisu. */
  now?: Date;
  /**
   * Nadpisania transportu maila „płatność zaksięgowana" (ADR-139) — wyłącznie
   * dla testów; produkcyjna trasa nie podaje nic i transport powstaje z env.
   */
  paymentEmail?: PaymentConfirmedEmailOverrides;
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

/** Wiersz konta najemcy — punkt zaczepienia zdarzeń KONTA (0028). */
interface PaymentAccountRow {
  tenant_id: string;
  provider_account_id: string;
}

/**
 * Gałąź zdarzeń CYKLU ŻYCIA KONTA (ADR-213).
 *
 * Domyka najpoważniejszą lukę toru Connect (ADR-049): dziś stan konta w bazie
 * odświeża się TYLKO wtedy, gdy najemca wejdzie do panelu albo checkout zrobi
 * odczyt na żywo — więc zawieszenie konta przez dostawcę nie propaguje się
 * do migawki, a panel/pulpit pokazują nieaktualną gotowość.
 *
 * ================== TRZY REGUŁY, KTÓRYCH TA GAŁĄŹ PILNUJE ==================
 *
 * 1. TOŻSAMOŚĆ NAJEMCY Z NASZEJ BAZY, NIGDY Z PAYLOADU. Z ciała bierzemy
 *    wyłącznie IDENTYFIKATOR konta (`event.account`, `acct_...`) — którego
 *    konta dotyczy zdarzenie. Po tym identyfikatorze odczytujemy wiersz
 *    `payment_accounts`; to on mówi, czyj to najemca. Ani jedno pole stanu
 *    z payloadu nie wchodzi do zapisu. Brak wiersza = konto nie jest nasze
 *    (konto platformy, cudze konto): rejestrujemy zdarzenie i milczymy.
 *
 * 2. STAN Z ODCZYTU (`account.updated`). Zdarzenie mówi tylko „odśwież to
 *    konto"; JAKI jest stan, mówi `GET /v1/accounts/{id}` (`syncAccount`).
 *    FAIL-SAFE: porażka odczytu zapisuje SAM `last_error` i zostawia
 *    kolumny gotowości nietknięte — awaria po naszej stronie nie ma prawa
 *    wyglądać jak „konto przestało przyjmować płatności" (lustro
 *    `cacheFromSync` z akcji panelu).
 *
 * 3. DEAUTORYZACJA ZAMYKA TOR ONLINE (`account.application.deauthorized`).
 *    Najemca odłączył aplikację — platforma straciła dostęp do konta, więc
 *    odczyt i tak by odmówił. Zamiast pytać o coś, czego już nie widzimy,
 *    zerujemy migawkę gotowości (`charges_enabled=false`, `payouts_enabled=
 *    false`) z powodem w `last_error`. To zamyka bramkę sprzedaży ADR-049
 *    (`canAcceptCharges` czyta `charges_enabled`). WIĄZANIA NIE KASUJEMY:
 *    usunięcie wiersza to świadoma akcja WŁAŚCICIELA (0028), nie skutek
 *    uboczny zdarzenia; provider_account_id i historia zostają.
 *
 * `provider_account_id` NIE JEST tu pisany ANI RAZU — piszemy wyłącznie
 * kolumny stanu. Nawet gdyby był: trigger niezmienności 0028 (BEFORE UPDATE
 * → 23514) FIRE'uje także dla `service_role` (bypassrls nie omija triggerów),
 * więc bramka konta stoi niezależnie od tej ścieżki.
 */
async function handleAccountEvent(
  event: StripeEventEnvelope,
  eventRowId: string,
  deps: StripeWebhookDeps,
): Promise<Response> {
  // IDENTYFIKATOR z górnopoziomowego `event.account`, nie z `data.object`:
  // przy `account.application.deauthorized` obiektem ciała jest APLIKACJA
  // (`ca_...`), więc `acct_...` żyje wyłącznie w tym polu. Dla zdarzeń v2
  // „thin" (`v2.core.account.updated`, ADR-218) ciało w ogóle nie ma
  // `data.object` — parser wstawia tu `related_object.id` (`acct_…`), więc
  // ta gałąź dostaje identyfikator tym samym polem i NIE MUSI wiedzieć, którą
  // wersją przyszło zdarzenie. Tożsamość i tak wychodzi z NASZEJ bazy po id.
  const accountId = event.account;
  if (!accountId) {
    await finish(
      deps.db,
      eventRowId,
      "processed",
      `Zdarzenie ${event.type} bez identyfikatora konta (event.account) — zarejestrowane bez zapisu stanu.`,
    );
    return json(200, { status: "unrelated", eventId: event.id });
  }

  // TOŻSAMOŚĆ NAJEMCY z NASZEJ bazy po identyfikatorze konta — nigdy z ciała.
  const accountQuery = await deps.db
    .from("payment_accounts")
    .select("tenant_id, provider_account_id")
    .eq("provider_account_id", accountId)
    .maybeSingle();

  if (accountQuery.error) {
    // Nie wiemy, czyje to konto — więc nie wolno nam nic zapisać ani
    // potwierdzić. Awaria przejściowa: zwalniamy dzierżawę, dostawca ponowi.
    await release(deps.db, eventRowId);
    return json(500, { error: `Odczyt konta najemcy nie powiódł się: ${accountQuery.error.message}` });
  }

  const account = accountQuery.data as PaymentAccountRow | null;
  if (!account) {
    // Konto nie jest nasze (konto platformy, cudze konto Connect). Rejestr
    // niesie ślad, że przyszło, ale żaden stan nie jest naszym stanem.
    await finish(
      deps.db,
      eventRowId,
      "processed",
      `Konto ${accountId} nie jest związane z żadnym najemcą — zarejestrowane bez zapisu stanu.`,
    );
    return json(200, { status: "unrelated", eventId: event.id });
  }

  // --- DEAUTORYZACJA: zamknięcie toru online bez odczytu (patrz reguła 3) ---
  if (event.type === "account.application.deauthorized") {
    const { error } = await deps.db
      .from("payment_accounts")
      .update({
        charges_enabled: false,
        payouts_enabled: false,
        last_error:
          "Najemca odłączył aplikację od konta płatności (account.application.deauthorized) — tor online zamknięty do ponownego onboardingu.",
        last_synced_at: new Date().toISOString(),
      })
      // Filtr po tenant_id (PK) NA WIERZCHU — piszemy wyłącznie kolumny stanu,
      // provider_account_id nietknięty (broni go i tak trigger 0028).
      .eq("tenant_id", account.tenant_id);

    if (error) {
      await release(deps.db, eventRowId);
      return json(500, { error: `Zapis stanu konta nie powiódł się: ${error.message}` });
    }

    await finish(deps.db, eventRowId, "processed", "Konto odłączone — tor online zamknięty.");
    return json(200, { status: "deauthorized", eventId: event.id });
  }

  // --- account.updated: PULL prawdy i przepisanie migawki gotowości ---
  //
  // Odczyt idzie na `provider_account_id` z NASZEGO wiersza, nie na wartość
  // z ciała — nawet gdyby ciało niosło inny `acct_...`, pytamy o konto, które
  // znaleźliśmy po identyfikatorze zdarzenia.
  const sync = await deps.syncAccount(account.provider_account_id);

  // FAIL-SAFE: przy porażce odczytu (`state === null`) piszemy SAM `last_error`
  // i zostawiamy kolumny gotowości nietknięte — lustro `cacheFromSync`.
  const patch = sync.state
    ? {
        charges_enabled: sync.state.chargesEnabled,
        payouts_enabled: sync.state.payoutsEnabled,
        details_submitted: sync.state.detailsSubmitted,
        requirements_due: sync.state.requirementsDue,
        last_error: null,
        last_synced_at: new Date().toISOString(),
      }
    : { last_error: sync.error };

  const { error } = await deps.db
    .from("payment_accounts")
    .update(patch)
    .eq("tenant_id", account.tenant_id);

  if (error) {
    await release(deps.db, eventRowId);
    return json(500, { error: `Zapis stanu konta nie powiódł się: ${error.message}` });
  }

  // Odczyt się udał → wiersz odświeżony, `processed` bez powodu. Odczyt padł →
  // stan poprzedni zostaje, a powód (już zredagowany w porcie) trafia do
  // rejestru jako uzasadnienie PRZETWORZONEGO wiersza (wzorzec 8b/ADR-046):
  // ponowienie przez dostawcę nie naprawi trwałej awarii konfiguracji, a stan
  // najemcy i tak nie ucierpiał.
  await finish(deps.db, eventRowId, "processed", sync.ok ? null : sync.error);
  return json(200, {
    status: "processed",
    eventId: event.id,
    accountSynced: sync.ok,
  });
}

/**
 * Weryfikacja podpisu przeciw OBU sekretom destynacji (Snapshot + Thin, ADR-222).
 *
 * Ten sam endpoint URL obsługuje DWIE destynacje Stripe — Snapshot (v1)
 * i Thin (v2 „thin", ADR-218) — a KAŻDA ma WŁASNY sekret `whsec_…`. Zdarzenie
 * jest AUTENTYCZNE, gdy pasuje do KTÓREGOKOLWIEK z NASZYCH sekretów: oba są
 * naszymi tajemnicami, więc dopasowanie do dowolnego dowodzi autorstwa dostawcy.
 * Napastnik bez żadnego z sekretów nie sfałszuje podpisu pasującego do choćby
 * jednego — akceptacja „któregokolwiek" NIE osłabia bezpieczeństwa.
 *
 * KOLEJNOŚĆ I BRAK OSŁABIENIA v1: Snapshot próbowany jest ZAWSZE (pierwszy).
 * Sekret Thin jest opcjonalny (`undefined` pomijamy) — jego brak nie zmienia
 * werdyktu dla v1 ani o jotę. Wszystkie bramki poza samym HMAC (obecność
 * nagłówka, format, okno tolerancji) dają ten sam wynik dla każdego sekretu,
 * więc „ostatnia porażka" jest tak samo czytelna niezależnie od kolejności:
 * zwracamy ją, żeby 400 niosło konkretny powód (np. `signature_mismatch`), a nie
 * generyczny „coś nie tak".
 */
function verifySignatureAgainstSecrets(input: {
  secrets: ReadonlyArray<string | undefined>;
  header: string | null | undefined;
  payload: string;
  now?: Date;
}): StripeSignatureResult {
  let lastFailure: StripeSignatureResult | null = null;
  for (const secret of input.secrets) {
    if (!secret) continue;
    const result = verifyStripeSignature({
      secret,
      header: input.header,
      payload: input.payload,
      now: input.now,
    });
    if (result.ok) return result;
    lastFailure = result;
  }
  // Żaden sekret nie był skonfigurowany (w produkcji niemożliwe — Snapshot jest
  // wymagany przez route). Kanoniczny komunikat „brak konfiguracji" bierzemy
  // z samego weryfikatora, wołając go z pustym sekretem — bez powielania tekstu.
  return (
    lastFailure ??
    verifyStripeSignature({
      secret: undefined,
      header: input.header,
      payload: input.payload,
      now: input.now,
    })
  );
}

export async function handleStripeWebhook(
  request: Request,
  deps: StripeWebhookDeps,
): Promise<Response> {
  // SUROWE ciało, przed jakimkolwiek parsowaniem: podpis liczy się z bajtów.
  const payload = await request.text();

  // Dwie destynacje, dwa sekrety, jeden endpoint (ADR-222): akceptujemy podpis
  // pasujący do KTÓREGOKOLWIEK z naszych sekretów. Thin jest opcjonalny.
  const verified = verifySignatureAgainstSecrets({
    secrets: [deps.secret, deps.secretThin],
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

  // --- Zdarzenia KONTA idą własną gałęzią (ADR-213, v2: ADR-218) ---
  //
  // Rozgałęzienie stoi PRZED filtrem intentów, bo obiekt zdarzenia jest tu
  // inny: `acct_...`/`ca_...`, nie `pi_...`. Obejmuje v1 (`account.updated`,
  // `account.application.deauthorized`) ORAZ v2 „thin" (`v2.core.account.updated`,
  // gdzie `acct_…` przyszło z `related_object.id`). Gdyby któreś przeszło do
  // gałęzi intentów, filtr `isObservedIntentEvent` odłożyłby je jako „ignored"
  // i stan konta nigdy by się nie odświeżył.
  if (isObservedAccountEvent(event.type)) {
    return handleAccountEvent(event, eventRowId, deps);
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

  // --- MAIL „PŁATNOŚĆ ZAKSIĘGOWANA" — KROK PO utrwalonym przejściu (ADR-139)
  //
  // Warunkiem jest `changed: true` z odczytem po zapisie + `paid`: dokładnie
  // jedno wejście na przejście go dostaje (compare-and-set), a regresu
  // z `paid` bramka 0027 nie wpuszcza, więc drugiego przejścia nie ma.
  // Problem z pocztą NIE cofa stanu i NIE robi 5xx (retry dostawcy nic tu
  // nie naprawi — stan już zapisany); powód ląduje w rejestrze zdarzeń
  // jako uzasadnienie PRZETWORZONEGO wiersza (wzorzec 8b/ADR-046).
  let emailIssue: string | undefined;
  if (applied.paymentStatus === "paid") {
    emailIssue = await sendPaymentConfirmedEmail(deps.db, {
      tenantId: order.tenant_id,
      orderId: order.id,
      ...(deps.paymentEmail ?? {}),
    });
  }

  await finish(deps.db, eventRowId, "processed", emailIssue ?? null);
  return json(200, {
    status: "processed",
    eventId: event.id,
    paymentStatus: applied.paymentStatus,
  });
}
