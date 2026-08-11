/**
 * Odczyty dashboardu operatora (C1, ADR-109).
 *
 * WSZYSTKIE liczby liczą się W BAZIE — funkcje `app.dashboard_*`
 * (migracje 0054 i 0069, SECURITY INVOKER + RLS + jawny filtr tenanta). Panel
 * niczego nie sumuje po pobranych wierszach: dostaje gotowe agregaty
 * i wyłącznie je prezentuje. Kwoty przychodzą per WALUTA WIERSZA
 * (ADR-103) — warstwa widoku nigdy nie dodaje groszy różnych walut.
 *
 * Błąd odczytu RZUCA, nie udaje zera: dashboard z fałszywym „0 zł" to
 * dokładnie ten rodzaj zmyślonego KPI, którego ta strona ma nie mieć.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PaymentStatus } from "@avably/core";

export interface DashboardRevenueRow {
  month_start: string;
  currency_code: string;
  rental_grosze: number;
  delivery_grosze: number;
  orders_count: number;
}

export interface DashboardUtilizationRow {
  product_id: string;
  product_name: string;
  product_active: boolean;
  unit_count: number;
  busy_days: number;
  window_days: number;
  utilization_pct: number | null;
}

export interface DashboardTopCustomerRow {
  customer_id: string;
  customer_name: string;
  currency_code: string;
  revenue_grosze: number;
  orders_count: number;
  last_order_date: string;
  share_pct: number | null;
}

/** Rodzaje kafli widoku dnia (0069, ADR-140) — lustro `app.dashboard_day`. */
export type DashboardDayKind =
  | "pickup_today"
  | "return_today"
  | "overdue"
  | "prepare_tomorrow"
  | "money_alert";

/** Podtyp pozycji kafla alarmów pieniężnych (dawna sekcja „Wymaga uwagi"). */
export type DashboardMoneyAlertKind = "payment_failed" | "deposit_unsettled";

export interface DashboardDayRow {
  kind: DashboardDayKind;
  /** Licznik CAŁEGO zbioru rodzaju (nie liczby zwróconych pozycji). */
  kind_total: number;
  item_position: number;
  order_id: string;
  order_number: string;
  customer_name: string;
  start_date: string;
  end_date: string;
  amount_grosze: number;
  currency_code: string;
  payment_status: PaymentStatus;
  unit_missing: boolean;
  item_kind: DashboardMoneyAlertKind | null;
}

export interface DashboardData {
  revenue: DashboardRevenueRow[];
  utilization: DashboardUtilizationRow[];
  topCustomers: DashboardTopCustomerRow[];
  day: DashboardDayRow[];
}

/** Okna dashboardu — jedna stała, żeby nagłówki sekcji mówiły prawdę. */
export const DASHBOARD_WINDOWS = {
  revenueMonths: 12,
  utilizationDays: 30,
  topCustomersLimit: 10,
  /** Maks. pozycji w kaflu dnia (reguła zawartości kafla, spec UX1). */
  dayItemsPerTile: 3,
} as const;

async function rpcRows<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T[]> {
  const { data, error } = await supabase.schema("app").rpc(fn, args);
  if (error) {
    throw new Error(`Odczyt dashboardu (${fn}) nie powiódł się: ${error.message}`);
  }
  return (data ?? []) as T[];
}

export async function fetchDashboardData(
  supabase: SupabaseClient,
): Promise<DashboardData> {
  const [revenue, utilization, topCustomers, day] = await Promise.all([
    rpcRows<DashboardRevenueRow>(supabase, "dashboard_revenue", {
      p_months: DASHBOARD_WINDOWS.revenueMonths,
    }),
    rpcRows<DashboardUtilizationRow>(supabase, "dashboard_utilization", {
      p_days: DASHBOARD_WINDOWS.utilizationDays,
    }),
    rpcRows<DashboardTopCustomerRow>(supabase, "dashboard_top_customers", {
      p_months: DASHBOARD_WINDOWS.revenueMonths,
      p_limit: DASHBOARD_WINDOWS.topCustomersLimit,
    }),
    // Widok dnia (0069, ADR-140): komplet pięciu kafli JEDNYM wywołaniem —
    // liczniki i najpilniejsze pozycje policzone w bazie, panel prezentuje.
    rpcRows<DashboardDayRow>(supabase, "dashboard_day", {
      p_limit: DASHBOARD_WINDOWS.dayItemsPerTile,
    }),
  ]);

  return { revenue, utilization, topCustomers, day };
}
