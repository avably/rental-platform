/**
 * Rekoncyliacja stanu kont Connect najemców (Faza B, siatka na zgubiony
 * `account.updated`) — SYMETRIA do `reconcile-payments` / `reconcile-billing`.
 *
 * ================== JAKĄ AWARIĘ TO SPRZĄTA ==================
 *
 * Migawka gotowości konta w `payment_accounts` (charges/payouts/details/
 * requirements) odświeża się dziś TYLKO wtedy, gdy najemca wejdzie do panelu,
 * checkout zrobi odczyt na żywo albo dojedzie webhook `account.updated`
 * (ADR-213). Gdy dostawca zawiesi konto, a to jedno zdarzenie się zgubi
 * (albo endpoint jeszcze go nie subskrybuje), panel i pulpit pokazują
 * NIEAKTUALNĄ gotowość — a bramka sprzedaży ADR-049 czyta `charges_enabled`.
 * Ta pętla domyka lukę: cyklicznym pull-em `GET /v1/accounts` przepisuje
 * migawkę stanu, więc najpóźniej następny przebieg serii dziennej doprowadza
 * ją do prawdy źródłowej. Zasada jest ta sama, co w billingu (zasada 6): pętla
 * własna, nie drugi zegar — przebieg bez driftu to seria no-opów.
 *
 * ================== GRANICA ZAUFANIA JAK W WEBHOOKU ==================
 *
 * STAN WYŁĄCZNIE Z ODCZYTU (ADR-049). Prawda o gotowości mieszka u dostawcy;
 * pytamy o nią `syncConnectAccountSafely` (GET /v1/accounts/{id}), które NIGDY
 * nie rzuca — porażka odczytu zwraca sam powód (`last_error`), a kolumny
 * gotowości zostają NIETKNIĘTE (fail-safe, lustro `cacheFromSync` i gałęzi
 * `account.updated` webhooka). Awaria po naszej stronie nie ma prawa wyglądać
 * jak „konto przestało przyjmować płatności".
 *
 * PISZEMY WYŁĄCZNIE KOLUMNY STANU, NIGDY `provider_account_id`. To jedyna
 * kolumna, która nie jest cache'em (0028) — wskazuje, o czyje pieniądze chodzi.
 * Patch niżej jej nie zawiera ani razu; niezależnie broni jej trigger
 * niezmienności z 0028 (FIRE'uje też dla `service_role`).
 *
 * ================== ROZJAZD = ANOMALIA RAPORTOWANA, NIE UKRYWANA ==========
 *
 * Gdy pull ujawni, że migawka RÓŻNIŁA SIĘ od prawdy źródłowej, wpis przebiegu
 * dostaje wynik `drift-refreshed` — dokładnie jak `reconcile-billing` raportuje
 * `drift-repaired`. Odświeżamy migawkę (to jej natura: cache z odczytu), ale
 * NIE zamiatamy faktu, że któreś `account.updated` się zgubiło. „Nie naprawiaj
 * na siłę" znaczy tu: żadnego zapisu stanu spoza odczytu i żadnego dotykania
 * identyfikatora konta — a nie „nie odświeżaj cache'u".
 *
 * ================== ŚLAD BEZ IDENTYFIKATORA KONTA ==================
 *
 * Wpis przebiegu niesie WYŁĄCZNIE `tenant_id`. `provider_account_id` (`acct_...`)
 * to informacja o cudzej działalności — wraca w odpowiedzi trasy joba i wchodzi
 * do logów, więc nie ma tam wstępu (lustro redakcji z `reconcile-payments`).
 */
import { syncConnectAccountSafely, type ConnectAccountSync } from "@avably/core";
import { createServiceClient } from "@avably/db/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Górna granica kont na przebieg — lustro `BILLING_RECONCILIATION_LIMIT`. */
export const CONNECT_RECONCILIATION_LIMIT = 100;

/** Co pętla zrobiła z tym jednym kontem. */
export type ConnectReconcileOutcome =
  /** Odczyt zgodny z migawką — nie było czego zapisywać (zdrowy no-op). */
  | "unchanged"
  /** Odczyt RÓŻNIŁ SIĘ od migawki — odświeżony; zgubione `account.updated`. */
  | "drift-refreshed"
  /** Odczyt u dostawcy padł — zapisano SAM `last_error`, gotowość nietknięta. */
  | "sync-failed"
  /** Nasz zapis do bazy nie powiódł się. */
  | "failed";

/**
 * Ślad diagnostyczny jednego konta — ZERO `provider_account_id`. Do odnalezienia
 * sprawy wystarcza `tenant_id` (PK `payment_accounts`).
 */
export interface ConnectReconcileEntry {
  tenantId: string;
  outcome: ConnectReconcileOutcome;
  reason: string;
}

export interface ReconcileConnectAccountsResult {
  scanned: number;
  unchanged: number;
  driftRefreshed: number;
  syncFailed: number;
  failed: number;
  entries: ConnectReconcileEntry[];
}

export interface ReconcileConnectAccountsDeps {
  /**
   * Klient bazy. W produkcji SERVICE-ROLE (allowlista `src/jobs/**`): pull
   * biegnie bez sesji najemcy, a zapis kolumn stanu i tak jest w 0028 otwarty
   * dla każdej roli. Wstrzykiwany, bo test podstawia klienta realnego.
   */
  db?: SupabaseClient;
  /**
   * `GET /v1/accounts/{id}` na koncie POŁĄCZONYM (service_role retrieve'uje
   * konta połączone). Domyślnie `syncConnectAccountSafely` — nigdy nie rzuca.
   */
  syncAccount?: (providerAccountId: string) => Promise<ConnectAccountSync>;
  limit?: number;
}

interface AccountRow {
  tenant_id: string;
  provider_account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_due: unknown;
  last_error: string | null;
}

const ACCOUNT_COLUMNS =
  "tenant_id, provider_account_id, charges_enabled, payouts_enabled, " +
  "details_submitted, requirements_due, last_error";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Porównanie list wymagań niezależne od kolejności — dostawca jej nie gwarantuje. */
function sameRequirements(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort().join(" ") === [...b].sort().join(" ");
}

/**
 * Czy odczyt RÓŻNI SIĘ od migawki na osi gotowości. Wejście w drift NIE liczy
 * `last_synced_at` (rusza się przy każdym pull-u) — liczy to, co wpływa na
 * decyzje: trzy flagi gotowości i listę wymagań.
 */
function readinessDiffers(row: AccountRow, sync: ConnectAccountSync): boolean {
  if (!sync.state) return false;
  const stored = Array.isArray(row.requirements_due)
    ? (row.requirements_due as string[])
    : [];
  return (
    row.charges_enabled !== sync.state.chargesEnabled ||
    row.payouts_enabled !== sync.state.payoutsEnabled ||
    row.details_submitted !== sync.state.detailsSubmitted ||
    !sameRequirements(stored, sync.state.requirementsDue)
  );
}

/**
 * Pełny przebieg: pull stanu kont Connect, migawka po migawce.
 *
 * KOLEJNOŚĆ `last_synced_at asc nulls first` NIE JEST OZDOBĄ: najstarsza
 * migawka jest najbardziej podejrzana o zgubione zdarzenie, więc ucięcie
 * budżetu zostawia w zaległości konta ŚWIEŻO odświeżone, a nie te, które
 * najbardziej tego potrzebują. Zaległość ponad limit wraca w następnym
 * przebiegu (wznawialność jak w pętli płatności).
 *
 * THROTTLING wypada z konstrukcji: odczyty biegną SZEREGOWO (jedno `await`
 * po drugim), więc nigdy nie ma burstu równoległych GET-ów do dostawcy —
 * dokładnie ta sama zasada, dla której seria dzienna chodzi szeregowo.
 */
export async function reconcileConnectAccounts(
  deps: ReconcileConnectAccountsDeps = {},
): Promise<ReconcileConnectAccountsResult> {
  const db = deps.db ?? createServiceClient();
  const syncAccount = deps.syncAccount ?? syncConnectAccountSafely;
  const limit = deps.limit ?? CONNECT_RECONCILIATION_LIMIT;

  const query = await db
    .from("payment_accounts")
    .select(ACCOUNT_COLUMNS)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (query.error) {
    throw new Error(`Odczyt kont Connect nie powiódł się: ${query.error.message}`);
  }

  const rows = (query.data ?? []) as unknown as AccountRow[];
  const entries: ConnectReconcileEntry[] = [];
  let driftRefreshed = 0;
  let syncFailed = 0;
  let failed = 0;

  for (const row of rows) {
    // Odczyt idzie na `provider_account_id` z NASZEGO wiersza.
    //
    // `syncConnectAccountSafely` NIE RZUCA z kontraktu (porażkę oddaje jako
    // `state === null`). Owijka defensywna jest mimo to konieczna: gdyby port
    // KIEDYŚ rzucił (błąd programistyczny) albo gdy test podstawia atrapę, jeden
    // wyjątek nie może ani wywrócić całego przebiegu, ani — co ważniejsze —
    // pchnąć nas do ZGADYWANIA stanu. Rzut = awaria NASZA: żadnego zapisu,
    // migawka NIETKNIĘTA (dokładnie jak `reconcile-payments` nic nie pisze,
    // gdy odczyt u dostawcy rzuci).
    let sync: ConnectAccountSync;
    try {
      sync = await syncAccount(row.provider_account_id);
    } catch (error) {
      failed += 1;
      entries.push({
        tenantId: row.tenant_id,
        outcome: "failed",
        reason: `Odczyt konta rzucił wyjątkiem (kontrakt: nie powinien): ${errorMessage(error)}`,
      });
      continue;
    }

    // FAIL-SAFE: porażka odczytu (`state === null`) → SAM `last_error`,
    // kolumny gotowości nietknięte (lustro `cacheFromSync` / gałęzi webhooka).
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

    const drifted = readinessDiffers(row, sync);

    // Filtr po `tenant_id` (PK) — piszemy WYŁĄCZNIE kolumny stanu, nigdy
    // `provider_account_id` (patch go nie zawiera).
    const { error } = await db
      .from("payment_accounts")
      .update(patch)
      .eq("tenant_id", row.tenant_id);

    if (error) {
      failed += 1;
      entries.push({
        tenantId: row.tenant_id,
        outcome: "failed",
        reason: `Zapis migawki nie powiódł się: ${error.message}`,
      });
      continue;
    }

    if (!sync.state) {
      syncFailed += 1;
      entries.push({
        tenantId: row.tenant_id,
        outcome: "sync-failed",
        // Powód pochodzi z portu, gdzie przeszedł redakcję i skrócenie do 500 —
        // ale to komunikat o NASZYM koncie u dostawcy, nie o cudzym.
        reason: sync.error ?? "Odczyt konta u dostawcy nie powiódł się.",
      });
      continue;
    }

    if (drifted) {
      driftRefreshed += 1;
      entries.push({
        tenantId: row.tenant_id,
        outcome: "drift-refreshed",
        reason: "Migawka różniła się od stanu u dostawcy — odświeżona (zgubione account.updated).",
      });
      continue;
    }

    entries.push({ tenantId: row.tenant_id, outcome: "unchanged", reason: "" });
  }

  const result: ReconcileConnectAccountsResult = {
    scanned: rows.length,
    unchanged: entries.filter((e) => e.outcome === "unchanged").length,
    driftRefreshed,
    syncFailed,
    failed,
    entries,
  };

  // Ślad przebiegu: SAME LICZBY. Powody per konto wracają w odpowiedzi trasy
  // (chronionej sekretem); do logu tyle, ile trzeba, żeby zauważyć, że pull
  // nagle przestał cokolwiek odświeżać albo zaczął masowo padać.
  console.info(
    `[reconcile-connect-accounts] sprawdzono ${result.scanned}, ` +
      `odświeżono ${result.driftRefreshed}, bez zmian ${result.unchanged}, ` +
      `odczyt padł ${result.syncFailed}, zapis padł ${result.failed}`,
  );
  return result;
}
