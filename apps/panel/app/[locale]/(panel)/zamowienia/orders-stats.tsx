import { formatMoney, type CurrencyCode } from "@avably/core";
import { cn } from "@avably/ui";
import { useTranslations } from "next-intl";

import { type OrderStats } from "@/lib/orders/order-stats";

/**
 * Kafle nagłówka listy zamówień (uwaga przeglądu U1, ADR-057).
 *
 * KOMPONENT PREZENTACYJNY (bez I/O): dostaje policzone `stats`, więc kontrakt
 * renderu wywołuje go na fixture bez Supabase. Kolory wyłącznie z tokenów —
 * kwota zaległa idzie akcentem ostrzegawczym systemu (`status-attention`, ten
 * sam bursztyn co ton „attention" chipów), nigdy własnym hexem.
 *
 * Każdy kafel niesie `data-order-stat` — uchwyt dla kontraktu renderu i
 * weryfikacji w przeglądarce, żeby test pilnował OBECNOŚCI kafla, nie jego
 * pikseli.
 */
export function OrdersStats({
  stats,
  currency,
  locale,
}: {
  stats: OrderStats;
  currency: CurrencyCode;
  locale: string;
}) {
  const t = useTranslations("orders.list");
  const money = (grosze: number) => formatMoney(grosze, currency, locale);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="list" aria-label={t("title")}>
      <StatTile
        stat="all"
        label={t("statAllLabel")}
        value={String(stats.all.count)}
        caption={money(stats.all.sumGrosze)}
      />
      <StatTile
        stat="to-dispatch"
        label={t("statToDispatchLabel")}
        value={String(stats.toDispatch.count)}
        caption={t("statToDispatchCaption")}
      />
      <StatTile
        stat="in-rental"
        label={t("statInRentalLabel")}
        value={String(stats.inRental.count)}
        caption={t("statInRentalCaption")}
      />
      {/* „Do zapłaty": nagłówkiem jest KWOTA (suma zaległości), a podpisem
          liczba zamówień — dlatego akcent ostrzegawczy siedzi na wartości. */}
      <StatTile
        stat="outstanding"
        label={t("statOutstandingLabel")}
        value={money(stats.outstanding.sumGrosze)}
        caption={t("ordersCount", { count: stats.outstanding.count })}
        accent
      />
    </div>
  );
}

function StatTile({
  stat,
  label,
  value,
  caption,
  accent = false,
}: {
  stat: string;
  label: string;
  value: string;
  caption: string;
  accent?: boolean;
}) {
  return (
    <div
      data-order-stat={stat}
      role="listitem"
      className="border-border bg-card flex flex-col gap-1 rounded-lg border p-4"
    >
      <span className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
        {label}
      </span>
      <span
        className={cn(
          "text-2xl leading-tight font-semibold tabular-nums tracking-[-0.01em]",
          accent ? "text-status-attention-fg" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">{caption}</span>
    </div>
  );
}
