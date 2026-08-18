import { formatMoney } from "@avably/core";
import { cn } from "@avably/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type {
  DashboardTopCustomerRow,
  DashboardUtilizationRow,
} from "@/lib/dashboard/queries";
import type { CurrencyRevenueSummary } from "@/lib/dashboard/revenue-model";
import { orderCurrencyCode } from "@/lib/tenant-currency";

/**
 * Sekcje dashboardu operatora (C1, ADR-109) — KOMPONENTY PREZENTACYJNE.
 *
 * Zero I/O: wiersze przychodzą z `app.dashboard_*` (agregaty policzone
 * w bazie), a jedyna „logika" tutaj to formatowanie i puste stany. Kontrakt
 * renderu (`test/dashboard-view-contract.test.tsx`) woła te komponenty na
 * fixture bez Supabase.
 *
 * Zasady twarde:
 *  • kwoty ZAWSZE z walutą wiersza (`orderCurrencyCode`, ADR-103) — sekcje
 *    nigdy nie dodają groszy różnych walut; waluta dominująca dostaje kafle,
 *    pozostałe własne, osobne wiersze;
 *  • puste stany mówią „brak danych w tym oknie" wprost — zero placeholderów
 *    udających dane (reguła „bez zmyślonych KPI" zostaje, dane są realne);
 *  • każda sekcja i kafel niosą `data-dashboard-*` — uchwyty dla kontraktu
 *    renderu i weryfikacji w przeglądarce (obecność, nie piksele).
 */

const UTILIZATION_DISPLAY_LIMIT = 10;

function monthLabel(monthStart: string, locale: string): string {
  // Data jest dniem pierwszym miesiąca; formatowanie w UTC trzyma etykietę
  // niezależną od strefy maszyny renderującej.
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${monthStart}T00:00:00Z`));
}

function dateLabel(dateIso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${dateIso}T00:00:00Z`));
}

function SectionCard({
  section,
  title,
  caption,
  children,
}: {
  section: string;
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-dashboard-section={section}
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* h2, nie h3: jedyny h1 ekranu niesie belka shella (ADR-060), więc
            tytuł sekcji jest DRUGIM poziomem konspektu. h3 przeskakiwało
            poziom (M-A11Y-01, audyt 17.08); rozmiar wizualny niesie klasa,
            nie ranga znacznika. Pilnuje heading-hierarchy-contract. */}
        <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
        {caption ? (
          <span className="text-muted-foreground text-xs">{caption}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function EmptyWindow({ label }: { label: string }) {
  return (
    <p data-dashboard-empty="true" className="text-muted-foreground text-sm">
      {label}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Przychód
// ---------------------------------------------------------------------------

export function DashboardRevenueSection({
  summaries,
  locale,
}: {
  summaries: CurrencyRevenueSummary[];
  locale: string;
}) {
  const t = useTranslations("home.dashboard");
  const [dominant, ...rest] = summaries;

  return (
    <SectionCard
      section="revenue"
      title={t("revenueTitle")}
      caption={t("revenueCaption")}
    >
      {!dominant ? (
        <EmptyWindow label={t("emptyWindow")} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <RevenueTile
              stat="current-month"
              label={t("currentMonth")}
              grosze={dominant.currentMonthGrosze}
              currency={dominant.currency}
              locale={locale}
              caption={t("ordersCount", { count: dominant.currentMonthOrders })}
            />
            <RevenueTile
              stat="previous-month"
              label={t("previousMonth")}
              grosze={dominant.previousMonthGrosze}
              currency={dominant.currency}
              locale={locale}
              caption={t("ordersCount", { count: dominant.previousMonthOrders })}
            />
            <RevenueTile
              stat="last-12-months"
              label={t("last12Months")}
              grosze={dominant.last12Grosze}
              currency={dominant.currency}
              locale={locale}
              caption={t("ordersCount", { count: dominant.last12Orders })}
            />
          </div>
          <RevenueTrend summary={dominant} locale={locale} />
          {rest.length > 0 ? (
            <div className="border-border border-t pt-3">
              <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.08em] uppercase">
                {t("otherCurrencies")}
              </p>
              <ul className="flex flex-col gap-1">
                {rest.map((summary) => (
                  <li
                    key={summary.currency}
                    data-dashboard-other-currency={summary.currency}
                    className="flex items-baseline justify-between gap-2 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {t("otherCurrencyRow", { currency: summary.currency })}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatMoney(
                        summary.last12Grosze,
                        orderCurrencyCode(summary.currency),
                        locale,
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

function RevenueTile({
  stat,
  label,
  grosze,
  currency,
  locale,
  caption,
}: {
  stat: string;
  label: string;
  grosze: number;
  currency: string;
  locale: string;
  caption: string;
}) {
  return (
    <div
      data-dashboard-stat={stat}
      className="border-border flex flex-col gap-1 rounded-md border p-3"
    >
      <span className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
        {label}
      </span>
      <span className="text-2xl leading-tight font-semibold tabular-nums tracking-[-0.01em]">
        {formatMoney(grosze, orderCurrencyCode(currency), locale)}
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">{caption}</span>
    </div>
  );
}

function RevenueTrend({
  summary,
  locale,
}: {
  summary: CurrencyRevenueSummary;
  locale: string;
}) {
  const t = useTranslations("home.dashboard");
  const max = Math.max(...summary.trend.map((point) => point.totalGrosze));

  return (
    <div data-dashboard-trend={summary.currency}>
      <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.08em] uppercase">
        {t("trendTitle", { currency: summary.currency })}
      </p>
      <ol className="flex h-24 items-end gap-1" aria-hidden="false">
        {summary.trend.map((point) => {
          const height =
            max > 0 ? Math.max(point.totalGrosze > 0 ? 3 : 0, (point.totalGrosze / max) * 100) : 0;
          const label = `${monthLabel(point.monthStart, locale)}: ${formatMoney(
            point.totalGrosze,
            orderCurrencyCode(summary.currency),
            locale,
          )}`;
          return (
            <li
              key={point.monthStart}
              data-dashboard-trend-month={point.monthStart}
              className="flex min-w-0 flex-1 flex-col items-center gap-1 self-stretch"
              title={label}
              aria-label={label}
            >
              <span className="flex w-full flex-1 items-end">
                <span
                  className={cn(
                    "w-full rounded-sm",
                    point.totalGrosze > 0 ? "bg-primary/70" : "bg-border",
                  )}
                  style={{ height: `${height === 0 ? 2 : height}%` }}
                />
              </span>
              <span className="text-muted-foreground w-full truncate text-center text-[10px]">
                {monthLabel(point.monthStart, locale)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wykorzystanie sprzętu
// ---------------------------------------------------------------------------

export function DashboardUtilizationSection({
  rows,
  locale,
}: {
  rows: DashboardUtilizationRow[];
  locale: string;
}) {
  const t = useTranslations("home.dashboard");
  const shown = rows.slice(0, UTILIZATION_DISPLAY_LIMIT);
  const pctFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

  return (
    <SectionCard
      section="utilization"
      title={t("utilizationTitle")}
      caption={t("utilizationCaption")}
    >
      {shown.length === 0 ? (
        /* Pusty stan Z AKCJĄ (UX1): wskazówka jest linkiem do dodania
           produktu, nie gołym tekstem — audyt W1 nazwał to wprost. */
        <p data-dashboard-empty="true" className="text-muted-foreground text-sm">
          {t.rich("utilizationEmpty", {
            link: (chunks) => (
              <Link
                href="/katalog/nowy"
                data-dashboard-utilization-cta
                className="font-medium underline underline-offset-[3px]"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((row) => (
            <li
              key={row.product_id}
              data-dashboard-product={row.product_id}
              className="flex flex-col gap-1"
            >
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <Link
                  href={`/katalog/${row.product_id}`}
                  className="hover:underline min-w-0 truncate font-medium"
                >
                  {row.product_name}
                </Link>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {row.utilization_pct === null
                    ? t("utilizationNoUnits")
                    : t("utilizationValue", {
                        pct: pctFormat.format(Number(row.utilization_pct)),
                      })}
                </span>
              </div>
              {/* Wypełnienie paska to DANA (ułamek zajętości), nie szerokość
                  layoutu — stąd scaleX na pełnym pasku zamiast width, którego
                  kontrakt spójności ekranów (ADR-060) zakazuje w inline style. */}
              <div className="bg-border h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className="bg-primary/70 h-full w-full origin-left rounded-full"
                  style={{
                    transform: `scaleX(${
                      row.utilization_pct === null
                        ? 0
                        : Math.min(100, Number(row.utilization_pct)) / 100
                    })`,
                  }}
                />
              </div>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t("utilizationDetail", {
                  busy: row.busy_days,
                  units: row.unit_count,
                  days: row.window_days,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Złoci klienci
// ---------------------------------------------------------------------------

export function DashboardCustomersSection({
  rows,
  locale,
}: {
  rows: DashboardTopCustomerRow[];
  locale: string;
}) {
  const t = useTranslations("home.dashboard");
  // Waluta dominująca rankingu = waluta z najwyższym przychodem łącznym.
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(
      row.currency_code,
      (totals.get(row.currency_code) ?? 0) + row.revenue_grosze,
    );
  }
  const currencies = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([currency]) => currency);
  const pctFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

  return (
    <SectionCard
      section="customers"
      title={t("customersTitle")}
      caption={t("customersCaption")}
    >
      {rows.length === 0 ? (
        <EmptyWindow label={t("emptyWindow")} />
      ) : (
        <div className="flex flex-col gap-4">
          {currencies.map((currency) => (
            <div key={currency} className="flex flex-col gap-2">
              {currencies.length > 1 ? (
                <p className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">
                  {currency}
                </p>
              ) : null}
              <ol className="flex flex-col gap-2">
                {rows
                  .filter((row) => row.currency_code === currency)
                  .map((row) => (
                    <li
                      key={`${currency}:${row.customer_id}`}
                      data-dashboard-customer={row.customer_id}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/klienci/${row.customer_id}`}
                          className="hover:underline block truncate font-medium"
                        >
                          {row.customer_name}
                        </Link>
                        <span className="text-muted-foreground text-xs">
                          {t("customerDetail", {
                            count: row.orders_count,
                            date: dateLabel(row.last_order_date, locale),
                          })}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="block font-medium tabular-nums">
                          {formatMoney(
                            row.revenue_grosze,
                            orderCurrencyCode(row.currency_code),
                            locale,
                          )}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {row.share_pct === null
                            ? null
                            : t("customerShare", {
                                pct: pctFormat.format(Number(row.share_pct)),
                              })}
                        </span>
                      </div>
                    </li>
                  ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// Sekcji „Wymaga uwagi" JUŻ NIE MA (UX1, ADR-140): jej treść (nieudana
// płatność, kaucja nierozliczona) mieszka w kaflu „Alarmy pieniężne" widoku
// dnia (dashboard-day.tsx), a zaległy zwrot — w kaflu „Po terminie". Jedno
// źródło prawdy zamiast dwóch miejsc z tą samą kaucją.
