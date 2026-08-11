import { formatMoney } from "@avably/core";
import { cn } from "@avably/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { DashboardDayKind, DashboardDayRow } from "@/lib/dashboard/queries";
import { StatusChip } from "@/lib/orders/status-chip";
import { DAY_FILTER_FOR_KIND } from "@/lib/orders/day-filters";
import { orderCurrencyCode } from "@/lib/tenant-currency";

/**
 * Sekcja „Dzisiaj" pulpitu — pięć kafli dnia (UX1, ADR-140). KOMPONENT
 * PREZENTACYJNY: wiersze przychodzą z `app.dashboard_day` (0069) policzone
 * i posortowane w bazie; jedyna logika tutaj to formatowanie i stany zerowe.
 *
 * Reguły kafla (spec UX1, przypięte testem dashboard-day-view.test.tsx):
 *  • kafle NIGDY nie znikają i nie zmieniają miejsc (układ 3+2: wydania ·
 *    zwroty · po terminie / jutro · alarmy) — stały rytm dnia;
 *  • maks. 3 pozycje (obrona w głąb — baza tnie limitem, widok też);
 *  • stan zerowy: licznik „0" wyszarzony, zdanie stanu zamiast pozycji,
 *    BEZ linku „Zobacz wszystkie" (link do pustej listy to klik-wydmuszka);
 *  • kolor WYŁĄCZNIE dla wyjątków i tylko przy N>0: bursztyn = terminy
 *    („Po terminie"), czerwień = pieniądze („Alarmy pieniężne"); kafle
 *    rutyny neutralne przy każdej liczbie;
 *  • pozycja prowadzi do szczegółu zamówienia (jedyne legalne akcje —
 *    maszyna stanów), „Zobacz wszystkie (N)" do listy zamówień z filtrem
 *    `dzien` o TEJ SAMEJ definicji zbioru (liczby zawsze się zgadzają);
 *  • focus-visible: outline 2px na tokenie foreground (gęsta siatka linków);
 *  • kwoty ZAWSZE z walutą wiersza (ADR-103).
 */

export const DAY_TILE_ITEM_LIMIT = 3;

/** Kolejność kafli = kolejność mockupu; nigdy nie zależy od liczników. */
const DAY_TILE_ROWS: readonly (readonly DashboardDayKind[])[] = [
  ["pickup_today", "return_today", "overdue"],
  ["prepare_tomorrow", "money_alert"],
];

const TILE_TITLE_KEYS: Record<DashboardDayKind, string> = {
  pickup_today: "pickupTitle",
  return_today: "returnTitle",
  overdue: "overdueTitle",
  prepare_tomorrow: "prepareTitle",
  money_alert: "moneyTitle",
};

const TILE_EMPTY_KEYS: Record<DashboardDayKind, string> = {
  pickup_today: "pickupEmpty",
  return_today: "returnEmpty",
  overdue: "overdueEmpty",
  prepare_tomorrow: "prepareEmpty",
  money_alert: "moneyEmpty",
};

/** Klasa akcentu kafla wyjątków — WYŁĄCZNIE przy N>0 (reguła koloru). */
function tileAccentClass(kind: DashboardDayKind, total: number): string {
  if (total === 0) return "";
  if (kind === "overdue") return "text-status-attention-fg";
  if (kind === "money_alert") return "text-status-problem-fg";
  return "";
}

function dayLabel(todayIso: string, locale: string): string {
  // Data jest DNIOWA (YYYY-MM-DD, Europe/Warsaw z warstwy I/O) — formatowanie
  // w UTC trzyma etykietę niezależną od strefy maszyny renderującej.
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${todayIso}T00:00:00Z`));
}

/** Dni po terminie: różnica dat dniowych w UTC (bez pułapek DST). */
function daysOverdue(endIso: string, todayIso: string): number {
  const end = Date.UTC(
    Number(endIso.slice(0, 4)),
    Number(endIso.slice(5, 7)) - 1,
    Number(endIso.slice(8, 10)),
  );
  const today = Date.UTC(
    Number(todayIso.slice(0, 4)),
    Number(todayIso.slice(5, 7)) - 1,
    Number(todayIso.slice(8, 10)),
  );
  return Math.max(0, Math.round((today - end) / 86_400_000));
}

const focusRing =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

export function DashboardDaySection({
  rows,
  today,
  locale,
}: {
  rows: DashboardDayRow[];
  today: string;
  locale: string;
}) {
  const t = useTranslations("home.dashboard.day");

  const byKind = new Map<DashboardDayKind, DashboardDayRow[]>();
  for (const row of rows) {
    const list = byKind.get(row.kind) ?? [];
    list.push(row);
    byKind.set(row.kind, list);
  }

  return (
    <section data-dashboard-section="day" className="flex flex-col gap-3">
      <h3 className="text-base font-semibold tracking-[-0.01em]">
        {t("title", { date: dayLabel(today, locale) })}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DAY_TILE_ROWS[0].map((kind) => (
          <DayTile key={kind} kind={kind} rows={byKind.get(kind) ?? []} today={today} locale={locale} />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {DAY_TILE_ROWS[1].map((kind) => (
          <DayTile key={kind} kind={kind} rows={byKind.get(kind) ?? []} today={today} locale={locale} />
        ))}
      </div>
    </section>
  );
}

function DayTile({
  kind,
  rows,
  today,
  locale,
}: {
  kind: DashboardDayKind;
  rows: DashboardDayRow[];
  today: string;
  locale: string;
}) {
  const t = useTranslations("home.dashboard.day");
  const total = rows[0]?.kind_total ?? 0;
  // Obrona w głąb: baza tnie limitem, ale reguła „maks. 3 pozycje" jest
  // regułą WIDOKU — trzyma też przy zmianie parametru po stronie I/O.
  const items = rows.slice(0, DAY_TILE_ITEM_LIMIT);
  const accent = tileAccentClass(kind, total);

  return (
    <section
      data-dashboard-day-tile={kind}
      data-day-count={total}
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <h4
          className={cn(
            "text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase",
            accent === "" ? "text-muted-foreground" : accent,
          )}
        >
          {t(TILE_TITLE_KEYS[kind])}
        </h4>
        <span
          data-day-counter
          className={cn(
            "text-2xl leading-none font-semibold tabular-nums tracking-[-0.01em]",
            total === 0 ? "text-muted-foreground" : accent,
          )}
        >
          {total}
        </span>
      </div>

      {total === 0 ? (
        <p data-day-empty="true" className="text-muted-foreground text-sm">
          {t(TILE_EMPTY_KEYS[kind])}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((row) => (
              <li key={`${row.item_kind ?? row.kind}:${row.order_id}`}>
                <DayItemLink row={row} today={today} locale={locale} />
              </li>
            ))}
          </ul>
          <Link
            href={`/zamowienia?dzien=${DAY_FILTER_FOR_KIND[kind]}`}
            data-day-see-all={kind}
            className={cn(
              "mt-auto text-sm font-medium underline underline-offset-[3px]",
              focusRing,
            )}
          >
            {t("seeAll", { count: total })}
          </Link>
        </>
      )}
    </section>
  );
}

/**
 * Pozycja kafla — jeden link do szczegółu zamówienia (jedyne legalne akcje
 * żyją tam). Treść zależy od rodzaju: braki (badge płatności + „egzemplarz
 * nieprzypisany"), saldo kaucji, dni po terminie albo etykieta alarmu.
 */
function DayItemLink({
  row,
  today,
  locale,
}: {
  row: DashboardDayRow;
  today: string;
  locale: string;
}) {
  const t = useTranslations("home.dashboard.day");
  const currency = orderCurrencyCode(row.currency_code);

  const header = (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {row.kind === "money_alert" && row.item_kind ? (
        <span className="text-status-problem-fg shrink-0 text-xs font-semibold tracking-[0.02em] uppercase">
          {t(row.item_kind === "payment_failed" ? "alarmPaymentFailed" : "alarmDeposit")}
        </span>
      ) : null}
      <span className="truncate font-medium">{row.order_number}</span>
      <span className="text-muted-foreground truncate text-xs">{row.customer_name}</span>
    </span>
  );

  let detail: React.ReactNode;
  if (row.kind === "pickup_today" || row.kind === "prepare_tomorrow") {
    detail = (
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusChip axis="payment" value={row.payment_status} />
        {row.unit_missing ? (
          <span
            data-day-unit-missing="true"
            className="border-border text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-[14px] font-medium"
          >
            {t("unitMissing")}
          </span>
        ) : null}
        <span className="text-muted-foreground ml-auto text-xs font-medium tabular-nums">
          {formatMoney(row.amount_grosze, currency, locale)}
        </span>
      </span>
    );
  } else if (row.kind === "return_today") {
    detail =
      row.amount_grosze > 0 ? (
        <span className="text-muted-foreground text-xs">
          {t("depositToSettle", {
            amount: formatMoney(row.amount_grosze, currency, locale),
          })}
        </span>
      ) : null;
  } else if (row.kind === "overdue") {
    detail = (
      <span className="text-status-attention-fg text-xs font-semibold tracking-[0.02em] uppercase">
        {t("overdueDays", { days: daysOverdue(row.end_date, today) })}
      </span>
    );
  } else {
    // money_alert: kwota sprawy (nieudana płatność = wartość zamówienia,
    // kaucja = otwarte saldo rejestru).
    detail = (
      <span className="text-muted-foreground text-xs font-medium tabular-nums">
        {formatMoney(row.amount_grosze, currency, locale)}
      </span>
    );
  }

  return (
    <Link
      href={`/zamowienia/${row.order_id}`}
      data-day-item={row.kind}
      className={cn(
        "border-border hover:bg-muted/50 flex flex-col gap-1 rounded-md border px-3 py-2 text-sm transition-colors",
        focusRing,
      )}
    >
      {header}
      {detail}
    </Link>
  );
}
