/**
 * Odczyty dashboardu operatora (C1, ADR-109).
 *
 * WSZYSTKIE liczby liczą się W BAZIE — cztery funkcje `app.dashboard_*`
 * (migracja 0054, SECURITY INVOKER + RLS + jawny filtr tenanta). Panel
 * niczego nie sumuje po pobranych wierszach: dostaje gotowe agregaty
 * i wyłącznie je prezentuje. Kwoty przychodzą per WALUTA WIERSZA
 * (ADR-103) — warstwa widoku nigdy nie dodaje groszy różnych walut.
 *
 * Błąd odczytu RZUCA, nie udaje zera: dashboard z fałszywym „0 zł" to
 * dokładnie ten rodzaj zmyślonego KPI, którego ta strona ma nie mieć.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

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

export type DashboardAttentionKind =
  | "overdue_return"
  | "payment_failed"
  | "deposit_unsettled";

export interface DashboardAttentionRow {
  kind: DashboardAttentionKind;
  order_id: string;
  order_number: string;
  customer_name: string;
  end_date: string;
  amount_grosze: number;
  currency_code: string;
}

export interface DashboardData {
  revenue: DashboardRevenueRow[];
  utilization: DashboardUtilizationRow[];
  topCustomers: DashboardTopCustomerRow[];
  attention: DashboardAttentionRow[];
}

/** Okna dashboardu — jedna stała, żeby nagłówki sekcji mówiły prawdę. */
export const DASHBOARD_WINDOWS = {
  revenueMonths: 12,
  utilizationDays: 30,
  topCustomersLimit: 10,
  attentionLimitPerKind: 20,
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
  const [revenue, utilization, topCustomers, attention] = await Promise.all([
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
    rpcRows<DashboardAttentionRow>(supabase, "dashboard_attention", {
      p_limit: DASHBOARD_WINDOWS.attentionLimitPerKind,
    }),
  ]);

  return { revenue, utilization, topCustomers, attention };
}
