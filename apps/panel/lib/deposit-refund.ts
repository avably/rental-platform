/**
 * Zwrot kaucji przez dostawcę, zlecany z panelu (Z5, ADR-069).
 *
 * ================== CO TU JEST TRUDNE ==================
 *
 * Zwrot pieniędzy to jedyna operacja w tym systemie, przy której KAŻDA
 * z trzech możliwych odpowiedzi jest prawdziwa i żadnej nie wolno zwinąć
 * w pozostałe:
 *
 *   „zwrócone"    — pieniądze są u klienta (potwierdzone ODCZYTEM),
 *   „w toku"      — dostawca przyjął żądanie, pieniędzy jeszcze nie ma,
 *   „odrzucone"   — nie będzie zwrotu, oto powód.
 *
 * Zwinięcie „w toku" w „zwrócone" to kłamstwo wobec klienta, o którym
 * dowiemy się od niego. Zwinięcie „w toku" w „odrzucone" jest gorsze:
 * operator zleci DRUGI zwrot tej samej kaucji, podczas gdy pierwszy jest
 * w drodze — i najemca odda kaucję dwa razy.
 *
 * Dlatego stan pośredni ma tu własny byt w bazie (`deposit_refunds`,
 * migracja 0031), własną nazwę statusu i własną reprezentację w UI.
 *
 * ================== SEKWENCJA I DLACZEGO TAKA ==================
 *
 *   1. wiersz `deposit_refunds` (status `requested`) — PRZED żądaniem,
 *      bo jego identyfikator jest kluczem idempotencji dostawcy. Dwuklik
 *      operatora trafia w ten sam klucz i nie robi drugiego refundu,
 *   2. `POST /v1/refunds` → SAM IDENTYFIKATOR (`@avably/core` nie oddaje
 *      stąd statusu — bariera w kształcie typu),
 *   3. zapis odnośnika + status `pending`. To jest zapis o ŻĄDANIU,
 *      nie o zwrocie; rejestr kaucji jest w tej chwili nadal pusty,
 *   4. `GET /v1/refunds/{id}` — ODCZYT, jedyna podstawa twierdzenia,
 *   5. dopiero teraz: wiersz `refunded` w rejestrze kaucji,
 *   6. dopiero PO potwierdzeniu zapisu: `payment_status='deposit_refunded'`.
 *
 * Kroki 5 i 6 w odwrotnej kolejności dają 23514 z bramki spójności (0030,
 * reguła B) — odmowę, która wygląda jak błąd bramki, a jest błędem
 * kolejności. Rozdział na `bookDepositEvent` i `settleDepositIfComplete`
 * (lib/deposit-booking.ts) sprawia, że tej kolejności nie da się odwrócić
 * przez przestawienie pól w jednym wywołaniu.
 *
 * ================== CZEGO TU NIE MA ==================
 *
 * `service_role`. Akcja panelu biegnie z sesją operatora — klient
 * service-role jest w tym repo zarezerwowany dla webhooków (ograniczenie
 * globalne 2 fazy 3, bramka `scripts/audit-service-role.sh`). Wszystkie
 * zapisy tego modułu przechodzą więc przez RLS tenanta, a przejście
 * w `deposit_refunded` jest w obiegu stripe świadomie POZA zbiorem
 * bramkowanym do service-role (0030): rozliczenie kaucji jest decyzją
 * operatora, a nie twierdzeniem o wpłacie.
 */
import { StripeApiError, refundVerdict, type RefundRead } from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import { bookDepositEvent, settleDepositIfComplete } from "./deposit-booking";

/** Statusy `deposit_refunds` oznaczające żądanie NIEDOMKNIĘTE (0031). */
export const IN_FLIGHT_REFUND_STATUSES = ["requested", "pending"] as const;

/**
 * 23505 — częściowy unikat `deposit_refunds_one_in_flight_per_order` (0032,
 * ADR-070): równoległy dwuklik trafił w drugie żądanie zwrotu w locie.
 */
const PG_UNIQUE_VIOLATION = "23505";

export interface DepositRefundDeps {
  db: SupabaseClient;
  /** `POST /v1/refunds` — oddaje SAM identyfikator (patrz `@avably/core`). */
  createRefund: (params: {
    intentId: string;
    amountGrosze: number;
    connectedAccountId: string;
    idempotencyKey: string;
    orderId: string;
    refundRequestId: string;
  }) => Promise<string>;
  /** `GET /v1/refunds/{id}` — jedyna podstawa twierdzenia o zwrocie. */
  readRefund: (refundId: string, connectedAccountId: string) => Promise<RefundRead>;
}

export interface DepositRefundInput {
  tenantId: string;
  orderId: string;
  /** Kwota ŻĄDANA, w groszach — z formularza operatora. */
  amountGrosze: number;
  /** Operator zlecający zwrot; ląduje w `created_by`. */
  actorId: string | null;
}

export type DepositRefundOutcome =
  /** Odczyt potwierdził zwrot; `depositSettled` mówi, czy saldo wróciło do zera. */
  | { status: "settled"; amountGrosze: number; depositSettled: boolean }
  /** Żądanie przyjęte, pieniędzy u klienta JESZCZE NIE MA. Rejestr pusty. */
  | { status: "pending"; reason: string }
  /** Nie będzie zwrotu — rejestr pusty, powód zapisany i pokazany. */
  | { status: "failed"; reason: string };

interface OrderPaymentRow {
  payment_provider: string;
  provider_payment_intent_id: string | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof StripeApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Zapis wyniku w rejestrze ŻĄDAŃ — nigdy w rejestrze zdarzeń kaucji. */
async function mark(
  db: SupabaseClient,
  requestId: string,
  status: "pending" | "succeeded" | "failed",
  lastError: string | null,
  providerReference?: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status, last_error: lastError };
  if (providerReference !== undefined) patch.provider_reference = providerReference;

  const { error } = await db.from("deposit_refunds").update(patch).eq("id", requestId);
  if (error) {
    // Wiersz zostaje w poprzednim stanie, a operator zobaczy „zwrot w toku"
    // zamiast wyniku. To jest uczciwa częściowa porażka (ADR-046) — gorsza
    // byłaby cisza sugerująca, że nic się nie działo.
    console.error(
      `[deposit-refund] nie udało się zapisać stanu żądania ${requestId}: ${error.message}`,
    );
  }
}

/**
 * Zleca zwrot kaucji u dostawcy i księguje go WYŁĄCZNIE po potwierdzeniu.
 *
 * Zwraca wynik jako WARTOŚĆ, nie wyjątek (wzorzec `DomainRegistrationResult`
 * z ADR-046): odmowa dostawcy jest normalnym biegiem rzeczy, o którym
 * operator ma przeczytać na ekranie, a nie awarią do złapania piętro wyżej.
 */
export async function requestDepositRefund(
  deps: DepositRefundDeps,
  input: DepositRefundInput,
): Promise<DepositRefundOutcome> {
  // --- 1. Płatność, z której zwracamy ---
  const orderQuery = await deps.db
    .from("orders")
    .select("payment_provider, provider_payment_intent_id")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.orderId)
    .maybeSingle();

  if (orderQuery.error || !orderQuery.data) {
    return {
      status: "failed",
      reason: `Nie udało się odczytać zamówienia: ${orderQuery.error?.message ?? "brak wiersza"}`,
    };
  }
  const order = orderQuery.data as OrderPaymentRow;

  if (order.payment_provider !== "stripe" || !order.provider_payment_intent_id) {
    // Wołający pomylił obieg. Cichy fallback na zapis ręczny byłby tu
    // najgorszym wyjściem: rejestr dostałby wiersz „zwrócone" bez żadnego
    // przelewu (ADR-035 dopuszcza to świadomie i JAWNIE, przez inną akcję).
    return {
      status: "failed",
      reason: "To zamówienie nie ma płatności online — zwrotu nie da się zlecić u dostawcy.",
    };
  }

  // --- 2. Czy jakiś zwrot już jest w drodze ---
  //
  // Bramka JEST TU, a nie tylko w UI: przycisk wyłączony w przeglądarce nie
  // broni przed drugą kartą, odświeżeniem po submicie ani powtórzonym
  // żądaniem. Zwrot w toku i zwrot ponowiony to ta sama kaucja oddana dwa
  // razy — a tego nie da się cofnąć jednym kliknięciem.
  const inFlight = await deps.db
    .from("deposit_refunds")
    .select("id, status, amount_grosze")
    .eq("tenant_id", input.tenantId)
    .eq("order_id", input.orderId)
    .in("status", [...IN_FLIGHT_REFUND_STATUSES])
    .limit(1);

  if (inFlight.error) {
    return { status: "failed", reason: `Nie udało się sprawdzić zwrotów w toku: ${inFlight.error.message}` };
  }
  if ((inFlight.data ?? []).length > 0) {
    return {
      status: "pending",
      reason:
        "Zwrot kaucji dla tego zamówienia jest już w toku u dostawcy — poczekaj na potwierdzenie zamiast zlecać drugi.",
    };
  }

  // --- 3. Konto najemcy ---
  const accountQuery = await deps.db
    .from("payment_accounts")
    .select("provider_account_id")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();

  const connectedAccountId = (accountQuery.data as { provider_account_id: string } | null)
    ?.provider_account_id;
  if (accountQuery.error || !connectedAccountId) {
    return {
      status: "failed",
      reason: "Najemca nie ma konta u dostawcy płatności — zwrotu nie da się zlecić.",
    };
  }

  // --- 4. Wiersz żądania PRZED żądaniem: jego id jest kluczem idempotencji ---
  const created = await deps.db
    .from("deposit_refunds")
    .insert({
      tenant_id: input.tenantId,
      order_id: input.orderId,
      amount_grosze: input.amountGrosze,
      created_by: input.actorId,
    })
    .select("id");

  if (created.error) {
    // 23505 = częściowy unikat `deposit_refunds_one_in_flight_per_order`
    // (0032, ADR-070): równoległy dwuklik. Bramka SELECT wyżej łapie przypadek
    // SEKWENCYJNY; ten unikat domyka WYŚCIG, w którym oba żądania minęły SELECT,
    // zanim którekolwiek zdążyło wstawić wiersz. Przegrana ścieżka NIE jest
    // porażką do ponowienia — zwrot jest w toku pod drugim żądaniem, więc
    // oddajemy dokładnie ten sam `pending` co bramka SELECT (żaden refund tą
    // ścieżką nie wyszedł: 23505 pada PRZED `createRefund`).
    if (created.error.code === PG_UNIQUE_VIOLATION) {
      return {
        status: "pending",
        reason:
          "Zwrot kaucji dla tego zamówienia jest już w toku u dostawcy — poczekaj na potwierdzenie zamiast zlecać drugi.",
      };
    }
    return { status: "failed", reason: `Nie udało się zarejestrować żądania zwrotu: ${created.error.message}` };
  }
  const requestRows = (created.data ?? []) as { id: string }[];
  if (requestRows.length === 0) {
    // `.select()` po mutacji potrafi oddać pustkę bez błędu, gdy polityka
    // RLS odfiltruje wiersz — pusty wynik jest tu BŁĘDEM, nie sukcesem.
    return { status: "failed", reason: "Nie udało się zarejestrować żądania zwrotu." };
  }
  const requestId = requestRows[0]!.id;

  // --- 5. Żądanie u dostawcy ---
  let refundId: string;
  try {
    refundId = await deps.createRefund({
      intentId: order.provider_payment_intent_id,
      amountGrosze: input.amountGrosze,
      connectedAccountId,
      idempotencyKey: requestId,
      orderId: input.orderId,
      refundRequestId: requestId,
    });
  } catch (error) {
    // ODMOWA DOSTAWCY = ZERO WIERSZA W REJESTRZE KAUCJI I POWÓD NA EKRANIE.
    // To pierwsza z dwóch warstw broniących przed zwrotem większym niż
    // pobranie; druga (bramka 0011) stoi niżej i działa nawet wtedy, gdy
    // dostawca żądanie przyjmie.
    const reason = errorMessage(error);
    await mark(deps.db, requestId, "failed", reason);
    return { status: "failed", reason };
  }

  // --- 6. Odnośnik zapisany; TO NADAL NIE JEST ZWROT ---
  await mark(deps.db, requestId, "pending", null, refundId);

  // --- 7. ODCZYT: jedyna podstawa twierdzenia o zwrocie ---
  let read: RefundRead;
  try {
    read = await deps.readRefund(refundId, connectedAccountId);
  } catch (error) {
    // Żądanie POSZŁO — pieniądze mogą być w drodze. „Nie udało się" byłoby
    // tu kłamstwem zapraszającym do ponowienia. Zostaje `pending`, a
    // dokończy to webhook `charge.refund.updated`.
    const reason = `Zwrot zlecony, ale nie udało się potwierdzić go odczytem: ${errorMessage(error)}`;
    await mark(deps.db, requestId, "pending", reason);
    return { status: "pending", reason };
  }

  const verdict = refundVerdict(read);

  if (verdict.outcome === "failed") {
    await mark(deps.db, requestId, "failed", verdict.reason);
    return { status: "failed", reason: verdict.reason };
  }

  if (verdict.outcome === "pending") {
    await mark(deps.db, requestId, "pending", verdict.reason);
    return { status: "pending", reason: verdict.reason };
  }

  // --- 8. Rejestr kaucji: dopiero TERAZ i dopiero z kwotą Z ODCZYTU ---
  const booked = await bookDepositEvent(deps.db, {
    tenantId: input.tenantId,
    orderId: input.orderId,
    kind: "refunded",
    amountGrosze: verdict.amountGrosze,
    providerReference: read.refundId,
    createdBy: input.actorId,
  });

  if (!booked.ok) {
    await mark(deps.db, requestId, "failed", booked.reason);
    return { status: "failed", reason: booked.reason };
  }

  await mark(deps.db, requestId, "succeeded", null);

  // --- 9. I dopiero PO potwierdzonym zapisie: oś payment_status ---
  const settlement = await settleDepositIfComplete(deps.db, input.tenantId, input.orderId);
  if (!settlement.ok) {
    return {
      status: "failed",
      reason: `Zwrot zaksięgowany u dostawcy i w rejestrze, ale rozliczenie kaucji nie przeszło: ${settlement.reason}`,
    };
  }

  return {
    status: "settled",
    amountGrosze: verdict.amountGrosze,
    depositSettled: settlement.settled,
  };
}
