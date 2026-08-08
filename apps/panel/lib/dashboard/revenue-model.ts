/**
 * Model przychodu dashboardu — czysta arytmetyka na wierszach agregatu
 * `app.dashboard_revenue` (C1, ADR-109). ZERO I/O: funkcje dostają wiersze
 * i „dziś" (YYYY-MM-DD w Europe/Warsaw, patrz `warsawToday`), więc kontrakt
 * testuje się na fixture bez Supabase.
 *
 * Multiwaluta (ADR-103): wiersze przychodzą per waluta i TAKIE zostają —
 * jedno podsumowanie per waluta, bez przeliczania kursami i bez dodawania
 * groszy różnych walut. Waluta DOMINUJĄCA (najwyższy przychód 12 mies.)
 * idzie na kafle główne, pozostałe pokazują się osobno.
 */
import type { DashboardRevenueRow } from "./queries";

export interface RevenueMonthPoint {
  /** Pierwszy dzień miesiąca (YYYY-MM-DD). */
  monthStart: string;
  /** Przychód zrealizowany: najem + dostawa (grosze, jedna waluta). */
  totalGrosze: number;
  ordersCount: number;
}

export interface CurrencyRevenueSummary {
  currency: string;
  currentMonthGrosze: number;
  currentMonthOrders: number;
  previousMonthGrosze: number;
  previousMonthOrders: number;
  last12Grosze: number;
  last12Orders: number;
  /** Pełna oś czasu: dokładnie `months` punktów, brakujące miesiące = 0. */
  trend: RevenueMonthPoint[];
}

/** Pierwszy dzień miesiąca daty ISO (bez obiektu Date — zero stref). */
export function monthStartIso(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

/** Przesuwa pierwszy dzień miesiąca o `delta` miesięcy (delta może być ujemna). */
export function addMonthsIso(monthIso: string, delta: number): string {
  const year = Number(monthIso.slice(0, 4));
  const month = Number(monthIso.slice(5, 7));
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
}

/** Ostatnie `months` miesięcy (rosnąco), kończąc na miesiącu `todayIso`. */
export function monthSequence(todayIso: string, months: number): string[] {
  const current = monthStartIso(todayIso);
  return Array.from({ length: months }, (_, i) =>
    addMonthsIso(current, i - (months - 1)),
  );
}

/**
 * Składa podsumowania per waluta. Kolejność: przychód 12 mies. malejąco —
 * pierwsza pozycja to waluta dominująca. Wiersze spoza osi czasu (starsze
 * niż okno) nie występują — funkcja SQL ich nie zwraca.
 */
export function buildRevenueSummaries(
  rows: readonly DashboardRevenueRow[],
  todayIso: string,
  months = 12,
): CurrencyRevenueSummary[] {
  const timeline = monthSequence(todayIso, months);
  const currentMonth = monthStartIso(todayIso);
  const previousMonth = addMonthsIso(currentMonth, -1);

  const byCurrency = new Map<string, Map<string, DashboardRevenueRow>>();
  for (const row of rows) {
    const forCurrency = byCurrency.get(row.currency_code) ?? new Map();
    forCurrency.set(row.month_start, row);
    byCurrency.set(row.currency_code, forCurrency);
  }

  const summaries: CurrencyRevenueSummary[] = [];
  for (const [currency, monthsMap] of byCurrency) {
    const trend: RevenueMonthPoint[] = timeline.map((monthStart) => {
      const row = monthsMap.get(monthStart);
      return {
        monthStart,
        totalGrosze: row ? row.rental_grosze + row.delivery_grosze : 0,
        ordersCount: row ? row.orders_count : 0,
      };
    });
    const point = (monthStart: string): RevenueMonthPoint =>
      trend.find((p) => p.monthStart === monthStart) ?? {
        monthStart,
        totalGrosze: 0,
        ordersCount: 0,
      };

    const current = point(currentMonth);
    const previous = point(previousMonth);
    summaries.push({
      currency,
      currentMonthGrosze: current.totalGrosze,
      currentMonthOrders: current.ordersCount,
      previousMonthGrosze: previous.totalGrosze,
      previousMonthOrders: previous.ordersCount,
      last12Grosze: trend.reduce((sum, p) => sum + p.totalGrosze, 0),
      last12Orders: trend.reduce((sum, p) => sum + p.ordersCount, 0),
      trend,
    });
  }

  summaries.sort(
    (a, b) => b.last12Grosze - a.last12Grosze || a.currency.localeCompare(b.currency),
  );
  return summaries;
}
