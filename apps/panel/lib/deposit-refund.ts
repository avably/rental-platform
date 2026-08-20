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

/**
 * 23P01 — bramka 0034 (ADR-072): rejestr pokazuje inne saldo niż to, wobec
 * którego operator podjął decyzję. Na tej ścieżce odmowa pada na wierszu
 * POTRĄCENIA, czyli PRZED `createRefund` — żaden przelew tędy nie wychodzi.
 */
const PG_STALE_BALANCE = "23P01";

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

/**
 * Potrącenie zatrzymane z kaucji przy TYM SAMYM rozliczeniu co zwrot
 * (uwagi właściciela D7/N5 — jeden modal, jedna decyzja).
 */
export interface DepositDeduction {
  amountGrosze: number;
  reasonCode: string;
  reason: string | null;
}

export interface DepositRefundInput {
  tenantId: string;
  orderId: string;
  /** Kwota ŻĄDANA, w groszach — z formularza operatora. */
  amountGrosze: number;
  /** Operator zlecający zwrot; ląduje w `created_by`. */
  actorId: string | null;
  /**
   * Potrącenie księgowane RAZEM ze zwrotem, jeśli operator je wpisał.
   *
   * DLACZEGO TU, A NIE OSOBNYM WYWOŁANIEM PRZED. Miejsce w sekwencji jest
   * jedynym zabezpieczeniem przed DWUKROTNYM potrąceniem przy dwukliku.
   * Potrącenie zaksięgowane PRZED tą funkcją przechodzi bramkę 0011 dwa razy,
   * ilekroć suma obu kopii mieści się w pobraniu (dwa razy 50 gr z kaucji 200
   * przechodzi bez mrugnięcia) — a wtedy zwrot reszty, policzony przez
   * przeglądarkę od salda SPRZED podwojenia, przekracza saldo i rozbija się
   * o 23514 JUŻ PO wyjściu pieniędzy do klienta. Dokładnie ten kształt awarii
   * („pieniądze wyszły, rejestr odmówił") ma wykluczać całe Z5.
   *
   * Wewnątrz tej funkcji potrącenie stoi ZA wstawieniem wiersza
   * `deposit_refunds`, czyli za unikatem `deposit_refunds_one_in_flight_per_order`
   * z 0032 (ADR-070). Przegrana ścieżka dwukliku wychodzi na 23505 ZANIM
   * cokolwiek zaksięguje — jeden modal to jedno potrącenie i jeden zwrot.
   */
  deduction?: DepositDeduction | null;
  /**
   * Saldo kaucji, które operator ZASTAŁ na ekranie podejmując tę decyzję
   * (0034, ADR-072). Trafia WYŁĄCZNIE na wiersz potrącenia.
   *
   * DLACZEGO NIE NA WIERSZ ZWROTU. Zwrot księguje się dopiero po potwierdzonym
   * przelewie, więc bramka odmawiająca mu zapisu zostawiłaby pieniądze
   * u klienta i rejestr twierdzący, że ich tam nie ma — czyli awarię, przed
   * którą stoi całe Z5. Odmawiać wolno temu, co jeszcze nie nastąpiło:
   * potrącenie powstaje PRZED `createRefund`, więc jego odmowa nie kosztuje
   * ani grosza. Poza tym saldo między potrąceniem a zwrotem legalnie rusza
   * cudza ścieżka (webhook potwierdzający pobranie albo zwrot), a to nie jest
   * powód, by odmówić zapisu faktu.
   */
  expectedBalanceGrosze?: number | null;
  /**
   * Opis operatora dopisywany do wiersza ZWROTU (`deposit_events.reason`).
   * Best-effort: gdy zwrot domknie webhook (potwierdzenie dostawcy przyszło
   * przed naszym odczytem), wiersz powstaje bez opisu. CHECK
   * `deposit_events_structured_reason` z 0011 obejmuje `reason_code`, nie
   * `reason` — opis przy zwrocie jest więc legalny, ale nie jest obiecany.
   */
  refundNote?: string | null;
}

export type DepositRefundOutcome =
  /** Odczyt potwierdził zwrot; `depositSettled` mówi, czy saldo wróciło do zera. */
  | { status: "settled"; amountGrosze: number; depositSettled: boolean; deductionGrosze: number }
  /** Żądanie przyjęte, pieniędzy u klienta JESZCZE NIE MA. Rejestr pusty. */
  | { status: "pending"; reason: string; deductionGrosze: number }
  /**
   * Nie będzie zwrotu — rejestr pusty, powód zapisany i pokazany.
   *
   * `staleBalance` wyróżnia JEDEN powód odmowy: bramka 0034 zastała w rejestrze
   * inne saldo niż to, wobec którego podjęto decyzję. Wołający ma go pokazać
   * PRZY POLU salda i zdaniem o odświeżeniu ekranu, a nie jako błąd kwoty —
   * kwota była dobra, nieaktualna jest podstawa.
   */
  | { status: "failed"; reason: string; deductionGrosze: number; staleBalance?: boolean };

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
 * Zależności DOMKNIĘCIA — świadomie WĘŻSZE niż `DepositRefundDeps`: jest tu
 * `readRefund` (GET /v1/refunds/{id}), a NIE MA `createRefund` (POST
 * /v1/refunds). To nie jest oszczędność, tylko bariera w kształcie typu:
 * ścieżka domykająca żądanie zwrotu NIE MA CZYM zainicjować drugiego zwrotu.
 * Tor rekoncyliacji (siatka na zgubiony webhook) buduje deps właśnie tak —
 * bez `createRefund` — więc podwojenie zwrotu jest tam niereprezentowalne.
 */
export type CloseDepositRefundDeps = Pick<DepositRefundDeps, "db" | "readRefund">;

export interface CloseDepositRefundInput {
  tenantId: string;
  orderId: string;
  /** Wiersz `deposit_refunds`, który domykamy (jego `id`). */
  requestId: string;
  /** Odnośnik dostawcy JUŻ ZNANY (`re_...`, `deposit_refunds.provider_reference`). */
  refundId: string;
  connectedAccountId: string;
  /** Autor zapisu w `deposit_events.created_by`; NULL dla toru automatycznego. */
  actorId?: string | null;
  /** Opis operatora dopisywany do wiersza ZWROTU — best-effort (patrz niżej). */
  refundNote?: string | null;
  /** Potrącenie zaksięgowane wcześniej TĄ SAMĄ decyzją — przenoszone do wyniku. */
  deductionGrosze?: number;
}

/**
 * Domknięcie żądania zwrotu WYŁĄCZNIE Z ODCZYTU — kroki 7-9 sekwencji
 * `requestDepositRefund`, wydzielone, bo wykonują je DWIE ścieżki:
 *
 *   - `requestDepositRefund` tuż PO `POST /v1/refunds` (mamy świeży `re_...`),
 *   - `reconcile-deposit-refunds` (src/jobs) — SIATKA BEZPIECZEŃSTWA na
 *     zgubiony webhook `charge.refund.updated`: wiersz `deposit_refunds`
 *     utknął w `pending`, `re_...` jest już w `provider_reference`, a webhook,
 *     który miał go domknąć, nie dojechał.
 *
 * JEDNA ŚCIEŻKA DOMKNIĘCIA, NIE DWIE KOPIE. Różnica między kopiami byłaby
 * różnicą w KSIĘGOWANIU PIENIĘDZY (ten sam argument, co w `deposit-booking.ts`):
 * werdykt z odczytu, kolejność „rejestr → payment_status", idempotencja przez
 * unikat odnośnika — muszą być identyczne dla obu wywołujących.
 *
 * ⚠ TA FUNKCJA NIGDY NIE INICJUJE ZWROTU. Przyjmuje `refundId` jako ustalony
 * FAKT i tylko go ODCZYTUJE. Podwojenie zwrotu jest tu niemożliwe z kształtu
 * `CloseDepositRefundDeps` (brak `createRefund`) — a dowód mutacyjny w suicie
 * joba pilnuje, żeby żaden `POST /v1/refunds` nie wszedł tą drogą.
 */
export async function closeDepositRefundFromRead(
  deps: CloseDepositRefundDeps,
  input: CloseDepositRefundInput,
): Promise<DepositRefundOutcome> {
  const deductionGrosze = input.deductionGrosze ?? 0;

  // --- 7. ODCZYT: jedyna podstawa twierdzenia o zwrocie ---
  let read: RefundRead;
  try {
    read = await deps.readRefund(input.refundId, input.connectedAccountId);
  } catch (error) {
    // Żądanie POSZŁO — pieniądze mogą być w drodze. „Nie udało się" byłoby
    // tu kłamstwem zapraszającym do ponowienia. Zostaje `pending`, a
    // dokończy to następny przebieg rekoncyliacji albo webhook.
    const reason = `Zwrot zlecony, ale nie udało się potwierdzić go odczytem: ${errorMessage(error)}`;
    await mark(deps.db, input.requestId, "pending", reason);
    return { status: "pending", reason, deductionGrosze };
  }

  const verdict = refundVerdict(read);

  if (verdict.outcome === "failed") {
    await mark(deps.db, input.requestId, "failed", verdict.reason);
    return { status: "failed", reason: verdict.reason, deductionGrosze };
  }

  if (verdict.outcome === "pending") {
    await mark(deps.db, input.requestId, "pending", verdict.reason);
    return { status: "pending", reason: verdict.reason, deductionGrosze };
  }

  // --- 8. Rejestr kaucji: dopiero TERAZ i dopiero z kwotą Z ODCZYTU ---
  const booked = await bookDepositEvent(deps.db, {
    tenantId: input.tenantId,
    orderId: input.orderId,
    kind: "refunded",
    amountGrosze: verdict.amountGrosze,
    providerReference: read.refundId,
    createdBy: input.actorId ?? null,
    reason: input.refundNote ?? null,
  });

  if (!booked.ok) {
    await mark(deps.db, input.requestId, "failed", booked.reason);
    return { status: "failed", reason: booked.reason, deductionGrosze };
  }

  await mark(deps.db, input.requestId, "succeeded", null);

  // --- 9. I dopiero PO potwierdzonym zapisie: oś payment_status ---
  const settlement = await settleDepositIfComplete(deps.db, input.tenantId, input.orderId);
  if (!settlement.ok) {
    return {
      status: "failed",
      deductionGrosze,
      reason: `Zwrot zaksięgowany u dostawcy i w rejestrze, ale rozliczenie kaucji nie przeszło: ${settlement.reason}`,
    };
  }

  return {
    status: "settled",
    amountGrosze: verdict.amountGrosze,
    depositSettled: settlement.settled,
    deductionGrosze,
  };
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
  // --- 0. Zwrot bez kwoty nie jest zwrotem ---
  //
  // `deposit_refunds.amount_grosze` ma CHECK `> 0` (0031), więc żądanie
  // o zerowej kwocie rozbiłoby się o bazę w połowie sekwencji. Rozliczenie
  // złożone z samego potrącenia (operator zatrzymuje całą kaucję) NIE
  // przechodzi tędy w ogóle — nie ma dostawcy, którego można o cokolwiek
  // poprosić — i jest księgowane wprost przez akcję panelu.
  if (input.amountGrosze <= 0) {
    return {
      status: "failed",
      deductionGrosze: 0,
      reason: "Zwrot bez kwoty nie jest zwrotem - podaj kwotę albo rozlicz kaucję samym potrąceniem.",
    };
  }

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
      deductionGrosze: 0,
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
      deductionGrosze: 0,
      reason: "To zamówienie nie ma płatności online - zwrotu nie da się zlecić u dostawcy.",
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
    return {
      status: "failed",
      deductionGrosze: 0,
      reason: `Nie udało się sprawdzić zwrotów w toku: ${inFlight.error.message}`,
    };
  }
  if ((inFlight.data ?? []).length > 0) {
    return {
      status: "pending",
      deductionGrosze: 0,
      reason:
        "Zwrot kaucji dla tego zamówienia jest już w toku u dostawcy - poczekaj na potwierdzenie zamiast zlecać drugi.",
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
      deductionGrosze: 0,
      reason: "Najemca nie ma konta u dostawcy płatności - zwrotu nie da się zlecić.",
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
        deductionGrosze: 0,
        reason:
          "Zwrot kaucji dla tego zamówienia jest już w toku u dostawcy - poczekaj na potwierdzenie zamiast zlecać drugi.",
      };
    }
    return {
      status: "failed",
      deductionGrosze: 0,
      reason: `Nie udało się zarejestrować żądania zwrotu: ${created.error.message}`,
    };
  }
  const requestRows = (created.data ?? []) as { id: string }[];
  if (requestRows.length === 0) {
    // `.select()` po mutacji potrafi oddać pustkę bez błędu, gdy polityka
    // RLS odfiltruje wiersz — pusty wynik jest tu BŁĘDEM, nie sukcesem.
    return { status: "failed", deductionGrosze: 0, reason: "Nie udało się zarejestrować żądania zwrotu." };
  }
  const requestId = requestRows[0]!.id;

  // --- 4b. Potrącenie z TEGO SAMEGO modalu — za unikatem, przed dostawcą ---
  //
  // Kolejność jest tu całym zabezpieczeniem (uzasadnienie: `deduction`
  // w DepositRefundInput). Wiersz `deposit_refunds` jest już wstawiony, więc
  // równoległy dwuklik odpadł wyżej na 23505 i tego kodu nie osiągnie.
  //
  // Potrącenie idzie obiegiem `manual` (domyślnym), bo NIE JEST ruchem
  // pieniędzy u dostawcy — to nasze roszczenie wobec kaucji, którą już mamy.
  // Wpisanie mu `provider = 'stripe'` wymagałoby odnośnika u dostawcy, a
  // takiego dla potrącenia nie ma i nigdy nie będzie (0031).
  let deductionGrosze = 0;
  if (input.deduction && input.deduction.amountGrosze > 0) {
    const deducted = await deps.db
      .from("deposit_events")
      .insert({
        tenant_id: input.tenantId,
        order_id: input.orderId,
        kind: "deducted",
        amount_grosze: input.deduction.amountGrosze,
        reason_code: input.deduction.reasonCode,
        reason: input.deduction.reason,
        // Deklaracja stanu (0034) — jedyny wiersz tej sekwencji, który
        // powstaje ZANIM cokolwiek wyjdzie do klienta, więc jedyny, któremu
        // wolno odmówić (uzasadnienie: `expectedBalanceGrosze` wyżej).
        expected_balance_grosze: input.expectedBalanceGrosze ?? null,
        created_by: input.actorId,
      })
      .select("id");

    if (deducted.error || (deducted.data ?? []).length === 0) {
      // Potrącenie odrzucone = ZERO żądania do dostawcy. Zwrot policzony
      // przez przeglądarkę jako „saldo minus potrącenie" byłby bez tego
      // potrącenia zwrotem ZA MAŁYM, a resztę zostawiłby w rejestrze bez
      // powodu. Zamykamy wiersz żądania, żeby nie blokował kolejnej próby.
      const staleBalance = deducted.error?.code === PG_STALE_BALANCE;
      const reason = staleBalance
        ? deducted.error!.message
        : deducted.error
          ? `Potrącenie odrzucone przez rejestr kaucji - zwrotu nie zlecono: ${deducted.error.message}`
          : "Potrącenia nie udało się zapisać - zwrotu nie zlecono.";
      await mark(deps.db, requestId, "failed", reason);
      return { status: "failed", deductionGrosze: 0, reason, staleBalance };
    }
    deductionGrosze = input.deduction.amountGrosze;
  }

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
    return { status: "failed", reason, deductionGrosze };
  }

  // --- 6. Odnośnik zapisany; TO NADAL NIE JEST ZWROT ---
  await mark(deps.db, requestId, "pending", null, refundId);

  // --- 7-9. Domknięcie WYŁĄCZNIE Z ODCZYTU ---
  //
  // Wspólna ścieżka z torem rekoncyliacji (`reconcile-deposit-refunds`).
  // `createRefund` wydarzył się w kroku 5; stąd w dół nie ma prawa paść ani
  // jeden `POST /v1/refunds` — dlatego przekazujemy WĘŻSZE deps (bez
  // `createRefund`): kolejny zwrot jest tu niereprezentowalny.
  return closeDepositRefundFromRead(
    { db: deps.db, readRefund: deps.readRefund },
    {
      tenantId: input.tenantId,
      orderId: input.orderId,
      requestId,
      refundId,
      connectedAccountId,
      actorId: input.actorId,
      refundNote: input.refundNote,
      deductionGrosze,
    },
  );
}
