import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale } from "next-intl/server";

import { DASHBOARD_WINDOWS, fetchDashboardData } from "@/lib/dashboard/queries";
import { buildRevenueSummaries } from "@/lib/dashboard/revenue-model";
import { warsawToday } from "@/lib/orders/order-dates";

import {
  DashboardAttentionSection,
  DashboardCustomersSection,
  DashboardRevenueSection,
  DashboardUtilizationSection,
} from "./dashboard-view";

/**
 * Warstwa I/O dashboardu (C1, ADR-109): jedyne miejsce, które woła bazę.
 *
 * Cztery agregaty idą RÓWNOLEGLE (Promise.all w fetchDashboardData) na
 * kliencie z sesji operatora — SECURITY INVOKER + RLS ograniczają wynik do
 * tenanta z kontekstu, panel niczego nie dolicza. „Dziś" = warsawToday()
 * (okna miesięczne tak, jak widzi je operator, nie UTC).
 *
 * OSOBNY komponent async (nie kod w page.tsx): strona główna musi pozostać
 * renderowalna bez Supabase w testach kontraktu (`test/home-page.test.ts`)
 * — element `<DashboardSections>` w drzewie nie wykonuje I/O, dopóki React
 * go nie wyrenderuje.
 */
export async function DashboardSections({ supabase }: { supabase: SupabaseClient }) {
  const locale = await getLocale();
  const today = warsawToday();
  const data = await fetchDashboardData(supabase);
  const revenueSummaries = buildRevenueSummaries(
    data.revenue,
    today,
    DASHBOARD_WINDOWS.revenueMonths,
  );

  return (
    <div className="flex flex-col gap-4" data-dashboard="true">
      <DashboardRevenueSection summaries={revenueSummaries} locale={locale} />
      <DashboardAttentionSection rows={data.attention} locale={locale} />
      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardUtilizationSection rows={data.utilization} locale={locale} />
        <DashboardCustomersSection rows={data.topCustomers} locale={locale} />
      </div>
    </div>
  );
}
