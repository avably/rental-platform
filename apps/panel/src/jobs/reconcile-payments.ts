/**
 * Rekoncyliacja płatności, które utknęły w `pending` (L11, ADR-104).
 *
 * ================== JAKĄ AWARIĘ TO SPRZĄTA ==================
 *
 * Zamówienie opłacane online zostaje w `pending` na zawsze, gdy webhook nie
 * dojedzie albo klient porzuci płatność. Skutek jest podwójnym
 * zakleszczeniem i zjada flotę:
 *
 *   - `order_status='pending'` BLOKUJE DOSTĘPNOŚĆ egzemplarza
 *     (AVAILABILITY_BLOCKING_ORDER_STATUSES, lustro w `app.assert_unit_available`),
 *   - `payment_status='pending'` BLOKUJE ANULOWANIE zamówienia
 *     (BLOCKING_PAYMENT_STATUSES; bramka 0010 rzuca 23001).
 *
 * Operator nie ma z tego stanu ŻADNEGO wyjścia w panelu, a sprzęt stoi
 * zarezerwowany dla klienta, który nigdy nie zapłacił. Ta pętla jest jedynym
 * mechanizmem, który ten stan rozstrzyga.
 *
 * ================== GRANICA ZAUFANIA JEST TA SAMA CO W WEBHOOKU ===========
 *
 * STAN PISZEMY WYŁĄCZNIE Z ODCZYTU U DOSTAWCY (ADR-049). Nigdy z ciała
 * żądania, nigdy z parametru trasy i — co jest tu pułapką swoistą dla pętli
 * — NIGDY Z WIEKU REKORDU. Wiek naszego wiersza odpowiada wyłącznie na
 * pytanie „kiedy zapytać"; na pytanie „co zapisać" odpowiada `readIntent`.
 * Sama decyzja mieszka w `reconciliationDecision` (@avably/core), której
 * sygnatura nie przyjmuje wiersza zamówienia właśnie po to, żeby nie dało
 * się tego pomylić.
 *
 * ================== KONTO CONNECTED JEST PER NAJEMCA ==================
 *
 * Pętla chodzi PO NAJEMCACH, nie po płaskiej liście zamówień, i to nie jest
 * kwestia wygody. Płatność żyje na koncie połączonym KONKRETNEGO najemcy;
 * odpytanie o nią kontem platformy albo cudzym kontem to zaglądanie
 * w cudze pieniądze — a przy zapisie: księgowanie cudzej płatności jako
 * swojej. Grupowanie po `tenant_id` sprawia, że konto jest wybrane RAZ dla
 * grupy i nie ma jak wyciec do sąsiedniej iteracji.
 *
 * ================== CZEGO TA PĘTLA NIE ROBI ==================
 *
 * NIE ANULUJE ZAMÓWIEŃ. Rozstrzyga wyłącznie oś `payment_status`; oś
 * `order_status` zostaje nietknięta, a wraz z nią rezerwacja egzemplarza.
 * Pytanie „czy system ma sam zwalniać flotę po X godzinach" jest decyzją
 * właściciela i jest świadomie odłożone (ADR-104). To, co ta pętla robi, to
 * ODDANIE OPERATOROWI MOŻLIWOŚCI DECYZJI: `payment_failed` zdejmuje blokadę
 * anulowania, więc człowiek może zamówienie anulować i zwolnić sprzęt.
 */
import {
  cancelPaymentIntent,
  readPaymentIntent,
  reconciliationCutoff,
  reconciliationDecision,
  type IntentRead,
  type PaymentStatus,
} from "@avably/core";
import { createServiceClient } from "@avably/db/service";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CHECKABLE_PAYMENT_STATUSES,
  applySettlement,
  type SettlementOrder,
} from "@/lib/payment-settlement";

/** Obieg, którego ta pętla dotyczy — offline nie ma czego rekoncyliować. */
const PAYMENT_PROVIDER_STRIPE = "stripe";

interface OrderRow extends SettlementOrder {
  payment_provider: string;
  provider_payment_intent_id: string | null;
  total_rental_grosze: number;
  delivery_grosze: number;
  /** Waluta UTRWALONA na zamówieniu (0049, ADR-103) — z niej powstał intent. */
  currency: string;
  updated_at: string;
}

const ORDER_COLUMNS =
  "id, tenant_id, payment_status, payment_provider, provider_payment_intent_id, " +
  "total_rental_grosze, total_deposit_grosze, delivery_grosze, currency, updated_at";

/** Co pętla zrobiła z tym jednym zamówieniem. */
export type ReconciliationOutcome =
  /** Status przestawiony na podstawie odczytu. */
  | "settled"
  /** Płatność wygaszona u dostawcy, a POTEM status przestawiony. */
  | "expired"
  /** Odczyt zgodny z tym, co już mamy — nie było czego zapisywać. */
  | "unchanged"
  /** Brak podstawy do zmiany stanu (płatność w toku, czeka na klienta). */
  | "skipped"
  /** Nie udało się: awaria odczytu, odmowa bramki, rozjazd po zapisie. */
  | "failed";

/**
 * Ślad diagnostyczny jednego zamówienia.
 *
 * ZERO DANYCH KLIENTA I ZERO IDENTYFIKATORÓW U DOSTAWCY. Ani nazwiska, ani
 * adresu e-mail, ani `pi_...`, ani — przede wszystkim — konta connected
 * najemcy: ten wpis wraca w odpowiedzi trasy joba i wchodzi do logów, a
 * identyfikator konta połączonego jest informacją o cudzej działalności,
 * nie diagnostyką. Do odnalezienia sprawy wystarczą dwa nasze UUID-y.
 */
export interface ReconciliationEntry {
  orderId: string;
  tenantId: string;
  outcome: ReconciliationOutcome;
  /** Status PO zapisie; `null`, gdy nic nie zapisano. */
  paymentStatus: PaymentStatus | null;
  reason: string;
}

export interface ReconcilePaymentsResult {
  scanned: number;
  settled: number;
  expired: number;
  unchanged: number;
  skipped: number;
  failed: number;
  entries: ReconciliationEntry[];
}

export interface ReconcilePaymentsDeps {
  /**
   * Klient bazy. W produkcji SERVICE-ROLE i to jest wymóg bazy, nie wygoda:
   * przejścia DO `paid` i `payment_failed` w obiegu stripe wolno wykonać
   * wyłącznie roli `service_role` (bramka `app.is_settlement_writer`, 0030).
   * Wstrzykiwany, bo test podstawia klienta realnego, ale własnego.
   */
  db?: SupabaseClient;
  /** Odczyt u dostawcy — JEDYNE źródło stanu (ADR-049). */
  readIntent?: (intentId: string, connectedAccountId: string) => Promise<IntentRead>;
  /**
   * Wygaszenie płatności u dostawcy. Nie zwraca stanu z rozmysłu — po tej
   * próbie i tak wykonujemy ODCZYT, bo to on rozstrzyga (patrz niżej).
   */
  cancelIntent?: (intentId: string, connectedAccountId: string) => Promise<void>;
  /** Zegar; wstrzykiwany, żeby test nie czekał doby. */
  now?: Date;
  batchSize?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const defaultReadIntent = (intentId: string, connectedAccountId: string): Promise<IntentRead> =>
  readPaymentIntent(intentId, { connectedAccountId });

const defaultCancelIntent = (intentId: string, connectedAccountId: string): Promise<void> =>
  cancelPaymentIntent(intentId, { connectedAccountId });

/**
 * Suma policzona przez NASZ serwer z utrwalonych danych zamówienia — ta sama
 * arytmetyka co w webhooku i w `app.get_public_order_payment` (0029). Kwota
 * od dostawcy nie wchodzi tu ani razu; ona jest tym, z czym porównujemy.
 *
 * WALUTA idzie obok, z tego samego wiersza (`orders.currency`, 0049/ADR-103):
 * intent powstał z pary (kwota, waluta) tego zamówienia, więc werdykt
 * porównuje odczyt z tym samym źródłem, którym posługuje się webhook —
 * zero drugiej ścieżki wyboru waluty w pętli.
 */
function expectedGroszeOf(order: OrderRow): number {
  return order.total_rental_grosze + order.total_deposit_grosze + order.delivery_grosze;
}

/**
 * Konta najemców u dostawcy — JEDNYM zapytaniem dla całej partii.
 *
 * Mapa, nie odczyt w pętli: przy sześciu zamówieniach jednego najemcy sześć
 * identycznych zapytań to koszt bez zysku. Najemca bez konta NIE trafia do
 * mapy — i jego zamówienia zostają pominięte z powodem, zamiast pójść
 * z pustym kontem (czyli na konto platformy).
 */
async function connectedAccounts(
  db: SupabaseClient,
  tenantIds: string[],
): Promise<Map<string, string>> {
  if (tenantIds.length === 0) return new Map();

  const { data, error } = await db
    .from("payment_accounts")
    .select("tenant_id, provider_account_id")
    .in("tenant_id", tenantIds);
  if (error) throw error;

  const map = new Map<string, string>();
  for (const row of (data ?? []) as { tenant_id: string; provider_account_id: string | null }[]) {
    if (row.provider_account_id) map.set(row.tenant_id, row.provider_account_id);
  }
  return map;
}

/**
 * Rozstrzyga JEDNO zamówienie na koncie JEGO najemcy.
 *
 * `connectedAccountId` jest parametrem, a nie czymś, co ta funkcja sobie
 * znajduje — dzięki temu miejsce, które wybiera konto, jest jedno i widać
 * je z zewnątrz.
 */
async function reconcileOne(
  db: SupabaseClient,
  order: OrderRow,
  connectedAccountId: string,
  deps: Required<Pick<ReconcilePaymentsDeps, "readIntent" | "cancelIntent" | "now">>,
): Promise<ReconciliationEntry> {
  const base = { orderId: order.id, tenantId: order.tenant_id };
  const intentId = order.provider_payment_intent_id;
  if (!intentId) {
    return {
      ...base,
      outcome: "skipped",
      paymentStatus: null,
      reason: "Zamówienie nie ma powiązanej płatności u dostawcy.",
    };
  }

  const expectedGrosze = expectedGroszeOf(order);

  // --- ODCZYT: jedyne źródło stanu ---
  let read: IntentRead;
  try {
    read = await deps.readIntent(intentId, connectedAccountId);
  } catch (error) {
    // Awaria dostawcy jest PRZEJŚCIOWA — zamówienie zostaje w `pending`
    // i wróci w następnym przebiegu. Nic nie zapisujemy.
    return {
      ...base,
      outcome: "failed",
      paymentStatus: null,
      reason: `Odczyt płatności u dostawcy nie powiódł się: ${errorMessage(error)}`,
    };
  }

  let decision = reconciliationDecision(read, expectedGrosze, order.currency, deps.now);
  let expired = false;

  if (decision.action === "expire") {
    // ================== KOLEJNOŚĆ JEST ISTOTĄ POPRAWNOŚCI ==================
    //
    // NAJPIERW anulujemy u dostawcy, POTEM zapisujemy cokolwiek. Odwrotna
    // kolejność dopuszcza wyścig, w którym oznaczamy płatność jako nieudaną,
    // a klient płaci sekundę później — i zostaje zamówienie z pobranymi
    // pieniędzmi i statusem mówiącym, że pieniędzy nie ma.
    //
    // Odmowa dostawcy („nie można anulować, bo status to succeeded") NIE
    // jest tu awarią — jest informacją, że wyścig właśnie się wydarzył
    // i wygrał go klient. Dlatego nie przerywa ścieżki: idziemy do odczytu,
    // bo to ON powie, co się naprawdę stało.
    let cancelNote = "";
    try {
      await deps.cancelIntent(intentId, connectedAccountId);
    } catch (error) {
      cancelNote = ` Dostawca odmówił wygaszenia: ${errorMessage(error)}`;
    }

    // --- ODCZYT PO PRÓBIE WYGASZENIA: to on rozstrzyga, nie nasza próba ---
    try {
      read = await deps.readIntent(intentId, connectedAccountId);
    } catch (error) {
      return {
        ...base,
        outcome: "failed",
        paymentStatus: null,
        reason: `Odczyt po wygaszeniu nie powiódł się: ${errorMessage(error)}${cancelNote}`,
      };
    }

    const afterCancel = reconciliationDecision(read, expectedGrosze, order.currency, deps.now);
    if (afterCancel.action === "expire") {
      // Płatność PO próbie wygaszenia nadal czeka na klienta — czyli
      // anulowanie nie doszło do skutku. Zapis `payment_failed` byłby tu
      // twierdzeniem o żywej płatności, że jest martwa.
      return {
        ...base,
        outcome: "failed",
        paymentStatus: null,
        reason: `Wygaszenie nie doszło do skutku — płatność nadal w stanie ${read.status}.${cancelNote}`,
      };
    }
    decision = afterCancel;
    expired = true;
  }

  if (decision.action === "skip") {
    return { ...base, outcome: "skipped", paymentStatus: null, reason: decision.reason };
  }

  // --- ZAPIS: wspólna ścieżka, ta sama co webhook ---
  const applied = await applySettlement(db, {
    order,
    targetStatus: decision.status,
    providerReference: intentId,
  });

  if (!applied.ok) {
    return { ...base, outcome: "failed", paymentStatus: null, reason: applied.reason };
  }
  if (!applied.changed) {
    return {
      ...base,
      outcome: "unchanged",
      paymentStatus: applied.paymentStatus,
      reason: applied.reason ?? "",
    };
  }

  return {
    ...base,
    outcome: expired ? "expired" : "settled",
    paymentStatus: applied.paymentStatus,
    reason: decision.reason,
  };
}

function tally(entries: ReconciliationEntry[]): ReconcilePaymentsResult {
  const count = (outcome: ReconciliationOutcome) =>
    entries.filter((entry) => entry.outcome === outcome).length;
  return {
    scanned: entries.length,
    settled: count("settled"),
    expired: count("expired"),
    unchanged: count("unchanged"),
    skipped: count("skipped"),
    failed: count("failed"),
    entries,
  };
}

function resolveDeps(deps: ReconcilePaymentsDeps) {
  return {
    readIntent: deps.readIntent ?? defaultReadIntent,
    cancelIntent: deps.cancelIntent ?? defaultCancelIntent,
    now: deps.now ?? new Date(),
  };
}

/**
 * Pełny przebieg: wybiera zaległe płatności i rozstrzyga je NAJEMCA PO
 * NAJEMCY.
 *
 * WYBÓR ZAMÓWIEŃ jest bramkowany karencją (`reconciliationCutoff`): płatność
 * młodsza niż kwadrans nie jest ruszana, bo webhook ma dostać swoją szansę.
 * To jedyne miejsce, w którym wiek NASZEGO rekordu ma cokolwiek do
 * powiedzenia — i mówi wyłącznie „kiedy zapytać".
 */
export async function reconcilePayments(
  deps: ReconcilePaymentsDeps = {},
): Promise<ReconcilePaymentsResult> {
  const db = deps.db ?? createServiceClient();
  const resolved = resolveDeps(deps);
  const cutoff = reconciliationCutoff(resolved.now).toISOString();

  const { data, error } = await db
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("payment_provider", PAYMENT_PROVIDER_STRIPE)
    .eq("payment_status", "pending")
    .not("provider_payment_intent_id", "is", null)
    .lte("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(deps.batchSize ?? 100);
  if (error) throw error;

  const orders = (data ?? []) as unknown as OrderRow[];

  // Grupowanie PO NAJEMCY: konto połączone wybieramy raz na grupę, więc nie
  // ma jak przeciec do zamówienia sąsiada (uzasadnienie w nagłówku pliku).
  const byTenant = new Map<string, OrderRow[]>();
  for (const order of orders) {
    const bucket = byTenant.get(order.tenant_id);
    if (bucket) bucket.push(order);
    else byTenant.set(order.tenant_id, [order]);
  }

  const accounts = await connectedAccounts(db, [...byTenant.keys()]);
  const entries: ReconciliationEntry[] = [];

  for (const [tenantId, tenantOrders] of byTenant) {
    const connectedAccountId = accounts.get(tenantId);
    if (!connectedAccountId) {
      // Bez konta najemcy nie ma NA CZYM wykonać odczytu. Pominięcie
      // z powodem, nigdy odczyt kontem platformy „na wszelki wypadek".
      for (const order of tenantOrders) {
        entries.push({
          orderId: order.id,
          tenantId,
          outcome: "skipped",
          paymentStatus: null,
          reason: "Najemca nie ma konta u dostawcy — nie ma na czym wykonać odczytu.",
        });
      }
      continue;
    }

    for (const order of tenantOrders) {
      entries.push(await reconcileOne(db, order, connectedAccountId, resolved));
    }
  }

  const result = tally(entries);
  // Ślad przebiegu: SAME LICZBY. Powody per zamówienie wracają w odpowiedzi
  // trasy (chronionej sekretem), a do logu idzie tyle, ile trzeba, żeby
  // zauważyć, że pętla nagle przestała cokolwiek rozstrzygać.
  console.info(
    `[reconcile-payments] sprawdzono ${result.scanned}, przestawiono ${result.settled}, ` +
      `wygaszono ${result.expired}, bez zmian ${result.unchanged}, ` +
      `pominięto ${result.skipped}, nieudanych ${result.failed}`,
  );
  return result;
}

/**
 * Rekoncyliacja JEDNEGO zamówienia — ścieżka przycisku operatora
 * („Sprawdź status płatności", `zamowienia/[id]/payment-actions.ts`).
 *
 * ================== DLACZEGO AKCJA PANELU WCHODZI TĘDY ==================
 *
 * Nie z wygody, tylko dlatego, że inaczej się NIE DA: przejście DO `paid`
 * i `payment_failed` w obiegu stripe jest w bazie zarezerwowane dla roli
 * `service_role` (0030), a klient z sesją operatora dostałby 23514. Klient
 * service-role omija RLS, więc mieszka wyłącznie tutaj — w `src/jobs/**`,
 * gdzie ESLint go dopuszcza — i nigdy nie wychodzi do warstwy akcji.
 *
 * ================== CZYM TA FUNKCJA NIE JEST ==================
 *
 * NIE JEST BRAMKĄ AUTORYZACJI i nie wolno jej za taką uznać. To wołający
 * ustala, czyje jest zamówienie, i robi to swoim klientem z SESJĄ, po
 * `tenant_id` z JWT. `tenantId` przychodzi tu jako ustalony FAKT, nigdy
 * z formularza — a filtr niżej idzie po OBU kolumnach (tenant + id), żeby
 * pomyłka wołającego nie zamieniła się w odczyt cudzego zamówienia.
 *
 * Karencji tu NIE MA: operator, który klika „sprawdź", pyta o TERAZ.
 * Wyścig z webhookiem rozstrzyga compare-and-set we wspólnym zapisie.
 */
export async function reconcileOrderPayment(
  input: { tenantId: string; orderId: string } & ReconcilePaymentsDeps,
): Promise<ReconciliationEntry> {
  const db = input.db ?? createServiceClient();
  const resolved = resolveDeps(input);
  const base = { orderId: input.orderId, tenantId: input.tenantId };

  const { data, error } = await db
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("tenant_id", input.tenantId)
    .eq("id", input.orderId)
    .maybeSingle();

  if (error) {
    return {
      ...base,
      outcome: "failed",
      paymentStatus: null,
      reason: `Odczyt zamówienia nie powiódł się: ${error.message}`,
    };
  }

  const order = data as unknown as OrderRow | null;
  if (!order) {
    return {
      ...base,
      outcome: "failed",
      paymentStatus: null,
      reason: "Zamówienie nie istnieje albo zostało usunięte.",
    };
  }

  if (order.payment_provider !== PAYMENT_PROVIDER_STRIPE || !order.provider_payment_intent_id) {
    return {
      ...base,
      outcome: "skipped",
      paymentStatus: order.payment_status,
      reason: "To zamówienie nie jest opłacane online — nie ma czego sprawdzać u dostawcy.",
    };
  }

  if (!CHECKABLE_PAYMENT_STATUSES.includes(order.payment_status)) {
    return {
      ...base,
      outcome: "skipped",
      paymentStatus: order.payment_status,
      reason: `Płatność jest w statusie ${order.payment_status} — rekoncyliacja dotyczy płatności oczekujących.`,
    };
  }

  const accounts = await connectedAccounts(db, [order.tenant_id]);
  const connectedAccountId = accounts.get(order.tenant_id);
  if (!connectedAccountId) {
    return {
      ...base,
      outcome: "skipped",
      paymentStatus: order.payment_status,
      reason: "Najemca nie ma konta u dostawcy — nie ma na czym wykonać odczytu.",
    };
  }

  return reconcileOne(db, order, connectedAccountId, resolved);
}
