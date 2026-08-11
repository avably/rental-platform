/**
 * Okno domykania (Zasada 8, ADR-138) — warstwa panelu nad predykatami
 * z `@avably/core`:
 *
 *   - `assertClosableOrder` — predykat NA ARGUMENCIE akcji: w trybie
 *     domykania każda akcja dotycząca zamówienia działa WYŁĄCZNIE na
 *     zamrożonym zbiorze (isOpenObligation). To jest realny koszt okna,
 *     nie flaga — bez niego opt-in `{ closing: true }` otwierałby akcje
 *     dla KAŻDEGO zamówienia zawieszonego najemcy.
 *   - `readTenantBillingState` — jeden fail-silent odczyt statusu + zegara
 *     dla shella (baner z licznikiem dni, filtr nawigacji). Fail-SILENT,
 *     bo shell to informacja, nie guard — twardą bramką jest requireMember.
 *
 * Poza trybem domykania (`ctx.closing === false`) `assertClosableOrder`
 * jest no-opem: normalna praca panelu nie płaci ani jednym zapytaniem.
 */
import { isOpenObligation } from "@avably/core";
import type { TenantStatus } from "@avably/db";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  depositTotals,
  type DepositEventRow,
} from "@/app/[locale]/(panel)/zamowienia/[id]/deposit";

import { AuthError, type AuthContext } from "./auth";

/** Komunikat odmowy poza zamrożonym zbiorem — jeden dla wszystkich akcji. */
const OUTSIDE_FROZEN_SET_MESSAGE =
  "W oknie domykania można obsługiwać wyłącznie najmy opłacone przed zawieszeniem organizacji.";

/**
 * Kształt wiersza zamówienia, o który pyta predykat zbioru. Eksportowany
 * dla listy zamówień, która filtruje CAŁĄ stronę tym samym predykatem.
 */
export interface ClosableOrderRow {
  created_at: string;
  payment_status: string;
  order_status: string;
}

/**
 * Czy zamówienie należy do zamrożonego zbioru — wspólne wejście listy
 * i predykatu na argumencie. Saldo kaucji jest ISTOTNE wyłącznie dla
 * `returned`; wołający podaje je z rejestru (deposit_events).
 */
export function isOrderInFrozenSet(
  row: ClosableOrderRow,
  depositBalanceGrosze: number,
  suspendedAt: string | null,
): boolean {
  return isOpenObligation(
    {
      createdAt: row.created_at,
      paymentStatus: row.payment_status as never,
      orderStatus: row.order_status as never,
      depositBalanceGrosze,
    },
    suspendedAt,
  );
}

/**
 * Predykat na argumencie (ADR-138): w trybie domykania akcja dotycząca
 * `orderId` przechodzi WYŁĄCZNIE, gdy zamówienie należy do zamrożonego
 * zbioru. Poza trybem — no-op (zero zapytań).
 *
 * Rzuca:
 *   - `AuthError` 403 `tenant_suspended_closing` — zamówienie poza zbiorem
 *     ALBO nieistniejące (jedna odmowa, żeby nie robić z niej wyroczni),
 *   - `Error` (→ 500) przy awarii odczytu — fail-closed jak w guardzie:
 *     czkawka bazy nie może przepuścić mutacji.
 */
export async function assertClosableOrder(ctx: AuthContext, orderId: string): Promise<void> {
  if (!ctx.closing) return;

  const { data: order, error } = await ctx.supabase
    .from("orders")
    .select("created_at, payment_status, order_status")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Nie udało się zweryfikować zamówienia w oknie domykania: ${error.message}`,
    );
  }
  if (!order) {
    throw new AuthError(403, OUTSIDE_FROZEN_SET_MESSAGE, "tenant_suspended_closing");
  }

  const row = order as ClosableOrderRow;

  // Saldo kaucji czytamy WYŁĄCZNIE tam, gdzie predykat o nie pyta —
  // `returned` z saldem 0 wypadło ze zbioru, z saldem ≠ 0 zostaje.
  let depositBalanceGrosze = 0;
  if (row.order_status === "returned") {
    const events = await ctx.supabase
      .from("deposit_events")
      .select("kind, amount_grosze")
      .eq("tenant_id", ctx.tenantId)
      .eq("order_id", orderId);
    if (events.error) {
      throw new Error(
        `Nie udało się odczytać rejestru kaucji w oknie domykania: ${events.error.message}`,
      );
    }
    depositBalanceGrosze = depositTotals(
      (events.data ?? []) as Pick<DepositEventRow, "kind" | "amount_grosze">[],
    ).balanceGrosze;
  }

  if (!isOrderInFrozenSet(row, depositBalanceGrosze, ctx.suspendedAt)) {
    throw new AuthError(403, OUTSIDE_FROZEN_SET_MESSAGE, "tenant_suspended_closing");
  }
}

/** Stan rozliczeniowy tenanta dla shella (baner + nawigacja). */
export interface TenantBillingState {
  status: TenantStatus;
  suspendedAt: string | null;
}

/**
 * Fail-silent odczyt statusu i zegara zawieszenia — JEDEN na żądanie shella,
 * współdzielony przez baner i filtr nawigacji. `null` przy braku organizacji
 * albo awarii odczytu: shell nie ma prawa wywrócić się o baner (twardą
 * bramką statusów pozostaje requireMember/RLS).
 */
export async function readTenantBillingState(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TenantBillingState | null> {
  try {
    const { data } = await supabase
      .from("tenants")
      .select("status, suspended_at")
      .eq("id", tenantId)
      .maybeSingle();
    if (!data) return null;
    const row = data as { status: TenantStatus; suspended_at: string | null };
    return { status: row.status, suspendedAt: row.suspended_at };
  } catch {
    return null;
  }
}
