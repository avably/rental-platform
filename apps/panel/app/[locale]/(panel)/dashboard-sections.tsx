import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale, getTranslations } from "next-intl/server";

import { DASHBOARD_WINDOWS, fetchDashboardData } from "@/lib/dashboard/queries";
import {
  fetchStartCardSignals,
  isStartComplete,
  startSteps,
} from "@/lib/dashboard/start-card";
import { buildRevenueSummaries } from "@/lib/dashboard/revenue-model";
import { warsawToday } from "@/lib/orders/order-dates";

import { DashboardDaySection } from "./dashboard-day";
import { DashboardStartCard } from "./dashboard-start-card";
import {
  DashboardCustomersSection,
  DashboardRevenueSection,
  DashboardUtilizationSection,
} from "./dashboard-view";

/**
 * Warstwa I/O dashboardu (C1, ADR-109; widok dnia i karta startowa: UX1,
 * ADR-140): jedyne miejsce, które woła bazę.
 *
 * Agregaty idą RÓWNOLEGLE (Promise.all) na kliencie z sesji operatora —
 * SECURITY INVOKER + RLS ograniczają wynik do tenanta z kontekstu, panel
 * niczego nie dolicza. „Dziś" = warsawToday() (okna tak, jak widzi je
 * operator, nie UTC).
 *
 * HIERARCHIA TREŚCI (spec UX1):
 *  1. karta „Zacznij tutaj" — dopóki kroki nie są skompletowane
 *     (`isStartComplete`); stan liczony z danych, zero odhaczania ręcznie;
 *  2. sekcja „Dzisiaj" (pięć kafli z `app.dashboard_day`) — WYŁĄCZNIE gdy
 *     tenant ma jakiekolwiek zamówienie: przy zerze zamówień każdy kafel
 *     byłby zerowy, a miejsce siatki zajmuje karta startowa (te dwa stany
 *     się wykluczają — spec UX1);
 *  3. metryki właścicielskie (przychód / wykorzystanie / złoci klienci) —
 *     bez zmian, niżej. Osobnej sekcji „Wymaga uwagi" już nie ma: jej treść
 *     przejął kafel „Alarmy pieniężne" (jedno źródło prawdy).
 *
 * OSOBNY komponent async (nie kod w page.tsx): strona główna musi pozostać
 * renderowalna bez Supabase w testach kontraktu (`test/home-page.test.ts`)
 * — element `<DashboardSections>` w drzewie nie wykonuje I/O, dopóki React
 * go nie wyrenderuje.
 */
export async function DashboardSections({
  supabase,
  tenantId,
}: {
  supabase: SupabaseClient;
  tenantId: string;
}) {
  const locale = await getLocale();
  const t = await getTranslations("home.dashboard.start");
  const today = warsawToday();
  const [data, signals] = await Promise.all([
    fetchDashboardData(supabase),
    fetchStartCardSignals(supabase, tenantId),
  ]);
  const steps = startSteps(signals);
  const revenueSummaries = buildRevenueSummaries(
    data.revenue,
    today,
    DASHBOARD_WINDOWS.revenueMonths,
  );

  return (
    <div className="flex flex-col gap-4" data-dashboard="true">
      {isStartComplete(steps) ? null : (
        <DashboardStartCard
          steps={steps}
          productDetail={
            steps[0].done && signals.firstProductName
              ? t("productDetail", {
                  name: signals.firstProductName,
                  count: signals.unitCount,
                })
              : undefined
          }
        />
      )}
      {signals.ordersCount > 0 ? (
        <DashboardDaySection rows={data.day} today={today} locale={locale} />
      ) : null}
      <DashboardRevenueSection summaries={revenueSummaries} locale={locale} />
      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardUtilizationSection rows={data.utilization} locale={locale} />
        <DashboardCustomersSection rows={data.topCustomers} locale={locale} />
      </div>
    </div>
  );
}
