/**
 * Rekoncyliacja stanu subskrypcji SaaS (J2 faza 2a, ADR-136) — SIATKA
 * BEZPIECZEŃSTWA na zgubiony webhook, NIE drugi zegar.
 *
 * ZASADA 1 OKNA DUNNINGOWEGO: jeden zegar, należy do dostawcy. Ta pętla
 * NICZEGO nie liczy i nie eskaluje — dla każdej znanej subskrypcji robi
 * dokładnie to, co zrobiłby webhook: ODCZYT u dostawcy →
 * `app.apply_saas_subscription_state`. Zgubione zdarzenie nie zostawia
 * najemcy w martwym stanie, bo najpóźniej następny przebieg serii dziennej
 * (ADR-130) doprowadzi projekcję i `tenants.status` do prawdy źródłowej.
 * Pętle własne są normą (zasada 6): przebieg bez driftu to seria no-opów.
 *
 * ZAKRES: wiersze `subscriptions` ze `stripe_subscription_id` — czyli
 * wyłącznie tenanty, które przeszły przez checkout (projekcja istnieje
 * od pierwszego webhooka; brak wiersza = trial fazy 1, Stripe'a nie ma).
 * Comp superadmina (wiersz bez stripe_subscription_id) świadomie POZA
 * pętlą: nie ma prawdy źródłowej u dostawcy, którą można by czytać.
 *
 * GRANICE ZAUFANIA jak w webhooku: stan wyłącznie z odczytu; tenant
 * wyłącznie z `metadata.tenant_id` ODCZYTU — rozjazd metadanych z wierszem
 * projekcji jest raportowany jako anomalia, nigdy „naprawiany" zgadywaniem.
 *
 * KONTO PLATFORMY: subskrypcje SaaS żyją na naszym koncie (StripeBillingClient
 * bez nagłówka Stripe-Account) — inaczej niż pętla płatności zamówień,
 * która chodzi po kontach połączonych najemców.
 */
import {
  StripeBillingClient,
  planFromPriceLookupKey,
  type SaasSubscriptionRead,
} from "@avably/core";
import { createServiceClient } from "@avably/db/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Górna granica wierszy na przebieg — lustro podejścia pętli płatności:
 * każda subskrypcja to odczyt sieciowy u dostawcy, a budżet czasu w serii
 * dziennej jest wspólny. Zaległość ponad limit wraca w następnym przebiegu.
 */
export const BILLING_RECONCILIATION_LIMIT = 100;

export interface BillingReconciliationEntry {
  tenantId: string;
  subscriptionId: string;
  outcome: "ok" | "drift-repaired" | "failed";
  /** Zdanie diagnostyczne bez identyfikatorów wrażliwych. */
  reason?: string;
}

export interface ReconcileBillingResult {
  checked: number;
  /** Ile przebiegów zmieniło tenants.status — czyli realny drift. */
  driftRepaired: number;
  failed: number;
  entries: BillingReconciliationEntry[];
}

export interface ReconcileBillingDeps {
  /** Klient bazy; w produkcji service-role (allowlista src/jobs/**). */
  db?: SupabaseClient;
  /** Odczyt subskrypcji u dostawcy — wstrzykiwany dla testów. */
  readSubscription?: (subscriptionId: string) => Promise<SaasSubscriptionRead>;
  limit?: number;
}

interface SubscriptionRow {
  tenant_id: string;
  stripe_subscription_id: string;
}

export async function reconcileBilling(
  deps: ReconcileBillingDeps = {},
): Promise<ReconcileBillingResult> {
  const db = deps.db ?? createServiceClient();
  const readSubscription =
    deps.readSubscription ??
    ((id: string) => new StripeBillingClient().readSaasSubscription(id));
  const limit = deps.limit ?? BILLING_RECONCILIATION_LIMIT;

  const query = await db
    .from("subscriptions")
    .select("tenant_id, stripe_subscription_id")
    .not("stripe_subscription_id", "is", null)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (query.error) {
    throw new Error(`Odczyt projekcji subskrypcji nie powiódł się: ${query.error.message}`);
  }

  const rows = (query.data ?? []) as SubscriptionRow[];
  const entries: BillingReconciliationEntry[] = [];
  let driftRepaired = 0;
  let failed = 0;

  for (const row of rows) {
    const base = { tenantId: row.tenant_id, subscriptionId: row.stripe_subscription_id };
    try {
      const read = await readSubscription(row.stripe_subscription_id);

      // Tenant WYŁĄCZNIE z metadanych odczytu — rozjazd z projekcją to
      // anomalia do raportu, nie do cichej naprawy (granica zaufania).
      if (read.tenantIdFromMetadata !== row.tenant_id) {
        failed += 1;
        entries.push({
          ...base,
          outcome: "failed",
          reason: "metadata.tenant_id odczytu nie zgadza się z wierszem projekcji",
        });
        continue;
      }

      const plan = planFromPriceLookupKey(read.priceLookupKey);
      if (!plan) {
        failed += 1;
        entries.push({
          ...base,
          outcome: "failed",
          reason: "cena subskrypcji bez klucza saas_<plan>_<interwał>",
        });
        continue;
      }

      const applied = await db.schema("app").rpc("apply_saas_subscription_state", {
        p_tenant_id: row.tenant_id,
        p_stripe_customer_id: read.customerId,
        p_stripe_subscription_id: read.subscriptionId,
        p_subscription_status: read.status,
        p_plan_id: plan.planId,
        p_current_period_start: read.currentPeriodStart,
        p_current_period_end: read.currentPeriodEnd,
        p_cancel_at_period_end: read.cancelAtPeriodEnd,
      });
      if (applied.error) {
        failed += 1;
        entries.push({ ...base, outcome: "failed", reason: applied.error.message });
        continue;
      }

      const outcome = (applied.data ?? {}) as { tenant_changed?: boolean };
      if (outcome.tenant_changed === true) {
        driftRepaired += 1;
        entries.push({ ...base, outcome: "drift-repaired" });
      } else {
        entries.push({ ...base, outcome: "ok" });
      }
    } catch (error) {
      failed += 1;
      entries.push({
        ...base,
        outcome: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { checked: rows.length, driftRepaired, failed, entries };
}
