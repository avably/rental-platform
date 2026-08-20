/**
 * Rekoncyliacja zwrotów kaucji utkniętych w `pending` (Faza B, siatka na
 * zgubiony webhook `charge.refund.updated`) — SYMETRIA do `reconcile-payments`.
 *
 * ================== JAKĄ AWARIĘ TO SPRZĄTA ==================
 *
 * Ścieżka Z5 (`lib/deposit-refund.ts`) zostawia wiersz `deposit_refunds`
 * w `pending`, gdy `POST /v1/refunds` zwrócił identyfikator, ale potwierdzenia
 * jeszcze nie ma (BLIK/P24 rozliczają się przez system rozliczeniowy) albo gdy
 * odczyt tuż po żądaniu padł. Domknięcie ma przynieść webhook
 * `charge.refund.updated`. Gdy TEN webhook się zgubi, wiersz wisi w `pending`
 * na zawsze: rejestr kaucji jest pusty, `payment_status` nie przechodzi
 * w `deposit_refunded`, a operator widzi „zwrot w toku" bez końca. Ta pętla
 * odczytuje `GET /v1/refunds/{id}` i — jeśli dostawca mówi `succeeded` —
 * DOMYKA wiersz TĄ SAMĄ ścieżką, którą domyka webhook i akcja panelu.
 *
 * ================== ⚠ TYLKO ODCZYT I DOMKNIĘCIE, NIGDY DRUGI REFUND =========
 *
 * `provider_reference` (`re_...`) jest tu USTALONYM FAKTEM — powstał, gdy
 * pierwszy (i jedyny) `POST /v1/refunds` się wydarzył. Ta pętla go WYŁĄCZNIE
 * ODCZYTUJE. Drugi `POST /v1/refunds` oddałby kaucję DWA RAZY, więc jest
 * z konstrukcji niereprezentowalny: domykamy przez `closeDepositRefundFromRead`,
 * którego deps (`CloseDepositRefundDeps`) NIE MAJĄ `createRefund`. Dowód
 * mutacyjny w suicie joba pilnuje, że żaden `POST /v1/refunds` tą drogą nie
 * przechodzi (mutant inicjujący zwrot → czerwony test).
 *
 * Dwie warstwy, które i tak stoją pod spodem (reużyte, nie dopisane):
 *   - unikat `deposit_refunds_one_in_flight_per_order` (0032) — najwyżej JEDEN
 *     wiersz `pending`/`requested` na zamówienie, więc nie ma jak domknąć
 *     dwóch żądań tej samej kaucji,
 *   - serializacja salda w `bookDepositEvent`/`settleDepositIfComplete`
 *     (0011/0034) + unikat odnośnika `deposit_events` (0031) — dwa przebiegi
 *     albo wyścig z webhookiem księgują zwrot DOKŁADNIE RAZ (idempotencja).
 *
 * ================== KARENCJA — NIE ŚCIGAJ SIĘ Z WEBHOOKIEM ==================
 *
 * Wybór wierszy jest bramkowany karencją (`reconciliationCutoff`, 15 min):
 * wiersz, którego stan zmienił się (`updated_at`) później niż kwadrans temu,
 * nie jest ruszany — webhook `charge.refund.updated` ma dostać swoją szansę.
 * Wyścig, który mimo to zajdzie, rozstrzyga idempotencja zapisu (wyżej), a nie
 * ta pętla: wiek NASZEGO wiersza mówi wyłącznie „kiedy zapytać", nigdy
 * „co zapisać" — to rozstrzyga `GET /v1/refunds/{id}`.
 *
 * ================== KONTO POŁĄCZONE PER NAJEMCA ==================
 *
 * Odczyt zwrotu idzie kontem połączonym WŁAŚCICIELA zamówienia (`re_...` żyje
 * na koncie konkretnego najemcy). Grupowanie po `tenant_id` wybiera konto RAZ
 * na grupę, więc nie ma jak przeciec do zamówienia sąsiada — lustro
 * `reconcile-payments`.
 */
import { readDepositRefund, reconciliationCutoff, type RefundRead } from "@avably/core";
import { createServiceClient } from "@avably/db/service";
import type { SupabaseClient } from "@supabase/supabase-js";

import { closeDepositRefundFromRead } from "@/lib/deposit-refund";

/** Obieg, którego pętla dotyczy — manual nie ma czego rekoncyliować u dostawcy. */
const REFUND_PROVIDER_STRIPE = "stripe";

/** Górna granica wierszy na przebieg — lustro pozostałych pętli rekoncyliacji. */
export const DEPOSIT_REFUND_RECONCILIATION_LIMIT = 100;

/** Co pętla zrobiła z tym jednym żądaniem zwrotu. */
export type DepositRefundReconcileOutcome =
  /** Odczyt potwierdził `succeeded` → wiersz DOMKNIĘTY (`deposit_refunded`). */
  | "settled"
  /** Dostawca nadal `pending` — pieniądze w drodze, NIE domykamy. */
  | "still-pending"
  /** Odczyt/zapis nie powiódł się — wiersz zostaje w `pending`, wróci później. */
  | "failed"
  /** Brak konta połączonego — nie ma na czym wykonać odczytu. */
  | "skipped";

/**
 * Ślad diagnostyczny — ZERO odnośnika u dostawcy (`re_...`) i konta połączonego.
 * Do odnalezienia sprawy wystarczają NASZE identyfikatory.
 */
export interface DepositRefundReconcileEntry {
  refundRequestId: string;
  tenantId: string;
  orderId: string;
  outcome: DepositRefundReconcileOutcome;
  reason: string;
}

export interface ReconcileDepositRefundsResult {
  scanned: number;
  settled: number;
  stillPending: number;
  failed: number;
  skipped: number;
  entries: DepositRefundReconcileEntry[];
}

export interface ReconcileDepositRefundsDeps {
  /** Klient bazy; w produkcji SERVICE-ROLE (allowlista `src/jobs/**`). */
  db?: SupabaseClient;
  /**
   * `GET /v1/refunds/{id}` na koncie POŁĄCZONYM — jedyna podstawa twierdzenia
   * o zwrocie. Wstrzykiwany; produkcja bierze `readDepositRefund`. NIE MA tu
   * bliźniaczego `createRefund` — i to jest cała ochrona przed drugim zwrotem.
   */
  readRefund?: (refundId: string, connectedAccountId: string) => Promise<RefundRead>;
  /** Zegar; wstrzykiwany, żeby test nie czekał kwadransa (karencja). */
  now?: Date;
  limit?: number;
}

interface RefundRow {
  id: string;
  tenant_id: string;
  order_id: string;
  provider_reference: string | null;
}

const REFUND_COLUMNS = "id, tenant_id, order_id, provider_reference";

const defaultReadRefund = (refundId: string, connectedAccountId: string): Promise<RefundRead> =>
  readDepositRefund(refundId, { connectedAccountId });

/**
 * Konta najemców u dostawcy — JEDNYM zapytaniem dla całej partii (lustro
 * `reconcile-payments`). Najemca bez konta NIE trafia do mapy: jego zwroty
 * zostają pominięte z powodem, zamiast pójść z pustym kontem (na konto
 * platformy).
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
 * Pełny przebieg: wybiera zwroty utknięte w `pending` starsze niż karencja
 * i domyka je NAJEMCA PO NAJEMCY, WYŁĄCZNIE Z ODCZYTU.
 */
export async function reconcileDepositRefunds(
  deps: ReconcileDepositRefundsDeps = {},
): Promise<ReconcileDepositRefundsResult> {
  const db = deps.db ?? createServiceClient();
  const readRefund = deps.readRefund ?? defaultReadRefund;
  const now = deps.now ?? new Date();
  const cutoff = reconciliationCutoff(now).toISOString();

  const { data, error } = await db
    .from("deposit_refunds")
    .select(REFUND_COLUMNS)
    .eq("provider", REFUND_PROVIDER_STRIPE)
    .eq("status", "pending")
    .not("provider_reference", "is", null)
    .lte("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(deps.limit ?? DEPOSIT_REFUND_RECONCILIATION_LIMIT);
  if (error) {
    throw new Error(`Odczyt żądań zwrotu nie powiódł się: ${error.message}`);
  }

  const rows = (data ?? []) as RefundRow[];

  // Grupowanie PO NAJEMCY: konto połączone wybieramy raz na grupę (uzasadnienie
  // w nagłówku pliku).
  const byTenant = new Map<string, RefundRow[]>();
  for (const row of rows) {
    const bucket = byTenant.get(row.tenant_id);
    if (bucket) bucket.push(row);
    else byTenant.set(row.tenant_id, [row]);
  }

  const accounts = await connectedAccounts(db, [...byTenant.keys()]);
  const entries: DepositRefundReconcileEntry[] = [];

  for (const [tenantId, tenantRows] of byTenant) {
    const connectedAccountId = accounts.get(tenantId);

    for (const row of tenantRows) {
      const base = {
        refundRequestId: row.id,
        tenantId,
        orderId: row.order_id,
      };

      if (!connectedAccountId) {
        // Bez konta najemcy nie ma NA CZYM wykonać odczytu (lustro pętli płatności).
        entries.push({
          ...base,
          outcome: "skipped",
          reason: "Najemca nie ma konta u dostawcy — nie ma na czym wykonać odczytu.",
        });
        continue;
      }

      if (!row.provider_reference) {
        // Filtr wyżej to wyklucza; strażnik na wypadek zmiany zapytania.
        entries.push({
          ...base,
          outcome: "skipped",
          reason: "Żądanie w pending bez odnośnika u dostawcy — nie ma czego odczytać.",
        });
        continue;
      }

      // DOMKNIĘCIE WYŁĄCZNIE Z ODCZYTU — ta sama ścieżka, którą domyka webhook
      // i akcja panelu. Brak `createRefund` w deps = brak drugiego zwrotu.
      const outcome = await closeDepositRefundFromRead(
        { db, readRefund },
        {
          tenantId,
          orderId: row.order_id,
          requestId: row.id,
          refundId: row.provider_reference,
          connectedAccountId,
          // Domknięcie automatyczne — brak człowieka, więc `created_by = NULL`
          // (lustro ścieżki webhooka).
          actorId: null,
        },
      );

      if (outcome.status === "settled") {
        entries.push({ ...base, outcome: "settled", reason: "" });
      } else if (outcome.status === "pending") {
        entries.push({ ...base, outcome: "still-pending", reason: outcome.reason });
      } else {
        entries.push({ ...base, outcome: "failed", reason: outcome.reason });
      }
    }
  }

  const result: ReconcileDepositRefundsResult = {
    scanned: entries.length,
    settled: entries.filter((e) => e.outcome === "settled").length,
    stillPending: entries.filter((e) => e.outcome === "still-pending").length,
    failed: entries.filter((e) => e.outcome === "failed").length,
    skipped: entries.filter((e) => e.outcome === "skipped").length,
    entries,
  };

  // Ślad przebiegu: SAME LICZBY (powody per żądanie wracają w odpowiedzi trasy).
  console.info(
    `[reconcile-deposit-refunds] sprawdzono ${result.scanned}, ` +
      `domknięto ${result.settled}, wciąż w toku ${result.stillPending}, ` +
      `nieudanych ${result.failed}, pominięto ${result.skipped}`,
  );
  return result;
}
