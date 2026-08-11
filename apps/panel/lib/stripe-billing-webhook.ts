/**
 * Handler webhooka BILLINGU SaaS (J2 faza 2a, ADR-136) — jedyne miejsce,
 * które przenosi `tenants.status` ze zdarzeń rozliczeniowych.
 *
 * LUSTRO ARCHITEKTURY `stripe-webhook.ts` (Z4, ADR-067) — te same reguły:
 *
 *   1. PODPIS DOWODZI AUTORSTWA, NIE AKTUALNOŚCI — z ciała wyłącznie
 *      identyfikatory (`parseStripeEvent`), ani jednej linii czytającej stan
 *      z payloadu.
 *   2. STAN Z ODCZYTU: zdarzenie to budzik; po claim ZAWSZE
 *      `GET /v1/subscriptions/{id}` i dopiero ODCZYT idzie do projekcji.
 *      Zdarzenia `cs_…`/`in_…` mają odczyt DWUSTOPNIOWY (W9 z krytyki
 *      spike'u): identyfikator subskrypcji bierzemy z ODCZYTU sesji/faktury,
 *      nie z pola `data.object.subscription` payloadu.
 *   3. IDEMPOTENCJA = ograniczenie bazy: claim `insert … on conflict do
 *      nothing` do `webhook_events` z provider='stripe-billing' (0067
 *      poszerza CHECK z 0030; unikat (provider, event_id) bez zmian).
 *      Ponowiona dostawa = duplikat = zero skutków, w tym ZERO drugiego
 *      maila dunningowego.
 *   4. MUTACJA STANU W JEDNYM MIEJSCU SQL: `app.apply_saas_subscription_state`
 *      (tablica przejść, pętle własne, nienaruszalność superadmin_locked/
 *      cancelled, suspended_at). Handler tłumaczy odczyt na argumenty i nic
 *      poza tym.
 *   5. 2xx ≠ SUKCES BIZNESOWY: odmowa deterministyczna (P0011/P0012, CHECK,
 *      unikat cudzej subskrypcji) kończy się 2xx z wierszem `failed`
 *      z powodem; 5xx wyłącznie tam, gdzie ponowienie ma szansę pomóc
 *      (awaria odczytu u dostawcy / bazy) — wtedy ZWALNIAMY DZIERŻAWĘ.
 *
 * MAPOWANIE OBIEKT→TENANT JEST PRZYPIĘTE DO ODCZYTU: `metadata.tenant_id`
 * ustawiamy sami na subskrypcji przy tworzeniu sesji Checkoutu (server
 * action ownera), a czytamy WYŁĄCZNIE z GET-a u dostawcy. Zdarzenie cudzego
 * obiektu (fixture `stripe trigger`, obiekt bez naszych metadanych) kończy
 * się „unrelated" bez dotknięcia czyjegokolwiek stanu; subskrypcja
 * zmapowana już na innego tenanta odbija się o unikat częściowy z 0067.
 *
 * TOR PLATFORMY, NIE CONNECT: zdarzenia billingu są account-level konta
 * platformy — deps nie mają pojęcia „konto połączone" i to jest różnica
 * konstrukcyjna, nie przeoczenie.
 */
import {
  STRIPE_SIGNATURE_HEADER,
  isObservedSaasBillingEvent,
  parseStripeEvent,
  planFromPriceLookupKey,
  verifyStripeSignature,
  type SaasSubscriptionRead,
} from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Nazwa dostawcy w rejestrze zdarzeń — lustro CHECK-a z 0067. */
export const BILLING_WEBHOOK_PROVIDER = "stripe-billing";

/**
 * Kody odmowy DETERMINISTYCZNEJ z bazy: ponowienie skończy się identycznie,
 * więc odpowiadamy 2xx z wierszem `failed` (dostawca nie ponawia w
 * nieskończoność), a powód zostaje w rejestrze.
 *   P0011 — tenant nie istnieje; P0012 — druga żywa subskrypcja (bramka
 *   podmiany); 23514 — CHECK (status spoza słownika); 23505 — unikat
 *   (subskrypcja/customer zmapowane na innego tenanta); 23503 — FK (plan).
 */
const DETERMINISTIC_DB_CODES = new Set(["P0011", "P0012", "23514", "23505", "23503"]);

export interface StripeBillingWebhookDeps {
  /**
   * Klient bazy — w produkcji SERVICE-ROLE (trasa webhooków, wzorzec 0030):
   * rejestr zdarzeń jest platformowy (zero polityk dla ról tenanckich),
   * a EXECUTE na `apply_saas_subscription_state` ma wyłącznie service_role.
   */
  db: SupabaseClient;
  /** Odczyt subskrypcji u dostawcy — JEDYNE źródło stanu (ADR-049/067). */
  readSubscription: (subscriptionId: string) => Promise<SaasSubscriptionRead>;
  /** Dwustopniowy odczyt `cs_…` → `sub_…` (W9): z ODCZYTU sesji, nie z payloadu. */
  readCheckoutSessionSubscriptionId: (sessionId: string) => Promise<string | null>;
  /** Dwustopniowy odczyt `in_…` → `sub_…` — lustro sesji. */
  readInvoiceSubscriptionId: (invoiceId: string) => Promise<string | null>;
  /**
   * Wysyłka maila dunningowego do najemcy przy `invoice.payment_failed`.
   * NIGDY nie rzuca — zwraca powód niewysłania albo undefined (wzorzec
   * sendInvitationEmail). Idempotencję zapewnia claim zdarzenia: ponowiona
   * dostawa nie dochodzi do tego wywołania.
   */
  sendPaymentFailedEmail?: (input: { tenantId: string }) => Promise<string | undefined>;
  /** Sekret podpisu trasy billingu (AVABLY_STRIPE_BILLING_WEBHOOK_SECRET). */
  secret: string | undefined;
  /** Zegar okna tolerancji podpisu — wstrzykiwany dla testów. */
  now?: Date;
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

/** Zamyka wiersz rejestru werdyktem (lustro `finish` z stripe-webhook.ts). */
async function finish(
  db: SupabaseClient,
  eventRowId: string,
  outcome: "processed" | "failed",
  reason: string | null,
): Promise<void> {
  const { error } = await db
    .from("webhook_events")
    .update({ status: outcome, processed_at: new Date().toISOString(), error: reason })
    .eq("id", eventRowId);
  if (error) {
    console.error(
      `[stripe-billing-webhook] nie udało się domknąć wiersza rejestru ${eventRowId}: ${error.message}`,
    );
  }
}

/** Zwolnienie dzierżawy przed 5xx — wiersz jest dzierżawą, nie pomnikiem. */
async function release(db: SupabaseClient, eventRowId: string): Promise<void> {
  const { error } = await db.from("webhook_events").delete().eq("id", eventRowId);
  if (error) {
    console.error(
      `[stripe-billing-webhook] nie udało się zwolnić dzierżawy zdarzenia ${eventRowId}: ${error.message}. ` +
        "Ponowna dostawa zostanie uznana za duplikat — wymaga ręcznego usunięcia wiersza.",
    );
  }
}

export async function handleStripeBillingWebhook(
  request: Request,
  deps: StripeBillingWebhookDeps,
): Promise<Response> {
  // SUROWE ciało przed parsowaniem — podpis liczy się z bajtów.
  const payload = await request.text();

  const verified = verifyStripeSignature({
    secret: deps.secret,
    header: request.headers.get(STRIPE_SIGNATURE_HEADER),
    payload,
    now: deps.now,
  });
  // 400 I ZERO ZAPISU — żądanie bez dowodu autorstwa nie zostawia śladu
  // (inaczej rejestr i unikat event_id dałoby się zaśmiecić bez sekretu).
  if (!verified.ok) {
    return json(400, { error: verified.message, reason: verified.reason });
  }

  const parsed = parseStripeEvent(payload);
  if (!parsed.ok) {
    return json(400, { error: parsed.message });
  }
  const event = parsed.event;

  // --- Przejęcie zdarzenia: jedyne rozstrzygnięcie „ja to robię" ---
  const claim = await deps.db
    .from("webhook_events")
    .upsert(
      { provider: BILLING_WEBHOOK_PROVIDER, event_id: event.id, event_type: event.type },
      { onConflict: "provider,event_id", ignoreDuplicates: true },
    )
    .select("id");

  if (claim.error) {
    return json(500, { error: `Rejestr zdarzeń niedostępny: ${claim.error.message}` });
  }
  const rows = (claim.data ?? []) as { id: string }[];
  if (rows.length === 0) {
    // DUPLIKAT — właściciel wiersza kończy (albo skończył) przetwarzanie.
    // Ponowiona dostawa nie zapisuje stanu i NIE wysyła drugiego maila.
    return json(200, { status: "duplicate", eventId: event.id });
  }
  const eventRowId = rows[0]!.id;

  if (!isObservedSaasBillingEvent(event.type)) {
    await finish(
      deps.db,
      eventRowId,
      "processed",
      `Typ ${event.type} nie jest obsługiwany — zdarzenie zarejestrowane bez zapisu stanu.`,
    );
    return json(200, { status: "ignored", eventId: event.id });
  }

  // --- Identyfikator subskrypcji: wprost albo odczytem dwustopniowym ---
  let subscriptionId: string | null = null;
  try {
    if (event.objectId.startsWith("sub_")) {
      subscriptionId = event.objectId;
    } else if (event.objectId.startsWith("cs_")) {
      subscriptionId = await deps.readCheckoutSessionSubscriptionId(event.objectId);
    } else if (event.objectId.startsWith("in_")) {
      subscriptionId = await deps.readInvoiceSubscriptionId(event.objectId);
    }
  } catch (error) {
    await release(deps.db, eventRowId);
    return json(500, {
      error: `Odczyt obiektu ${event.objectId} u dostawcy nie powiódł się: ${errorMessage(error)}`,
    });
  }

  if (!subscriptionId) {
    // Sesja bez subskrypcji (porzucona/wygaszona), faktura jednorazowa albo
    // obiekt nieznanego kształtu — NORMALNY stan konta platformy, nie awaria.
    await finish(
      deps.db,
      eventRowId,
      "processed",
      `Obiekt ${event.objectId} nie wskazuje subskrypcji — zarejestrowane bez zapisu stanu.`,
    );
    return json(200, { status: "unrelated", eventId: event.id });
  }

  // --- ODCZYT subskrypcji: jedyne źródło stanu ---
  let read: SaasSubscriptionRead;
  try {
    read = await deps.readSubscription(subscriptionId);
  } catch (error) {
    await release(deps.db, eventRowId);
    return json(500, {
      error: `Odczyt subskrypcji u dostawcy nie powiódł się: ${errorMessage(error)}`,
    });
  }

  // --- Tenant WYŁĄCZNIE z metadanych ODCZYTU (nigdy z payloadu) ---
  const tenantId = read.tenantIdFromMetadata;
  if (!tenantId) {
    // Subskrypcja spoza naszego obiegu (fixture `stripe trigger`, ręczny
    // obiekt w dashboardzie) — rejestrujemy i zostawiamy. Zero zgadywania.
    await finish(
      deps.db,
      eventRowId,
      "processed",
      `Subskrypcja ${subscriptionId} nie niesie metadata.tenant_id — zarejestrowane bez zapisu stanu.`,
    );
    return json(200, { status: "unrelated", eventId: event.id });
  }

  const plan = planFromPriceLookupKey(read.priceLookupKey);
  if (!plan) {
    // Subskrypcja MA nasz tenant_id, ale cenę spoza konwencji lookup_key —
    // anomalia deterministyczna (ponowienie nic nie zmieni): failed + 2xx.
    await finish(
      deps.db,
      eventRowId,
      "failed",
      `Subskrypcja ${subscriptionId} tenanta ${tenantId} ma cenę bez klucza saas_<plan>_<interwał> ` +
        `(lookup_key: ${read.priceLookupKey ?? "brak"}) — projekcja odrzucona.`,
    );
    return json(200, { status: "rejected", eventId: event.id });
  }

  // --- Mutacja stanu: JEDNO miejsce w SQL (0067) ---
  const applied = await deps.db.schema("app").rpc("apply_saas_subscription_state", {
    p_tenant_id: tenantId,
    p_stripe_customer_id: read.customerId,
    p_stripe_subscription_id: read.subscriptionId,
    p_subscription_status: read.status,
    p_plan_id: plan.planId,
    p_current_period_start: read.currentPeriodStart,
    p_current_period_end: read.currentPeriodEnd,
    p_cancel_at_period_end: read.cancelAtPeriodEnd,
  });

  if (applied.error) {
    const code = (applied.error as { code?: string }).code ?? "";
    if (DETERMINISTIC_DB_CODES.has(code)) {
      await finish(
        deps.db,
        eventRowId,
        "failed",
        `Projekcja odrzucona (${code}): ${applied.error.message}`,
      );
      return json(200, { status: "rejected", eventId: event.id });
    }
    // Awaria przejściowa bazy — ponowienie ma sens.
    await release(deps.db, eventRowId);
    return json(500, { error: `Zapis projekcji nie powiódł się: ${applied.error.message}` });
  }

  const outcome = (applied.data ?? {}) as {
    tenant_status_before?: string;
    tenant_status_after?: string;
    tenant_changed?: boolean;
  };

  // --- Mail dunningowy: PO zapisie stanu, nigdy przed ---
  //
  // Kolejność jest częścią kontraktu idempotencji: gdyby mail szedł przed
  // zapisem, awaria zapisu → release → ponowna dostawa → DRUGI mail.
  // Porażka wysyłki nie cofa stanu i nie robi 5xx (ponowienie dostawcy
  // wysłałoby maila drugi raz przy już zapisanym stanie) — zostaje jako
  // powód przy `processed` (uczciwa częściowa porażka, ADR-046).
  let emailReason: string | null = null;
  if (event.type === "invoice.payment_failed" && deps.sendPaymentFailedEmail) {
    const reason = await deps.sendPaymentFailedEmail({ tenantId });
    if (reason) {
      emailReason = `Stan zapisany; mail o nieudanej płatności nie wyszedł: ${reason}`;
    }
  }

  await finish(deps.db, eventRowId, "processed", emailReason);
  return json(200, {
    status: "processed",
    eventId: event.id,
    subscriptionStatus: read.status,
    tenantStatus: outcome.tenant_status_after ?? null,
    tenantChanged: outcome.tenant_changed === true,
  });
}
