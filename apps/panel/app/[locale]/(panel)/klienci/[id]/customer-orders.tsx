import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@avably/ui";
import { formatMoney, type CurrencyCode, type OrderStatus } from "@avably/core";
import { useTranslations } from "next-intl";
import { type ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { StatusChip } from "@/lib/orders/status-chip";

/**
 * Historia zamówień klienta na jego karcie (R6a).
 *
 * Skrócona lista wzorcem listy zamówień: numer / termin / kwota / status
 * zamówienia, a KAŻDY wiersz prowadzi do szczegółu zamówienia. Kotwica per
 * komórka (`CellLink`) jak w listach — poprawne w Safari (lekcja #117).
 *
 * KOMPONENT PREZENTACYJNY: dostaje gotowe wiersze, bez I/O.
 */

export interface CustomerOrderRow {
  id: string;
  orderNumber: string;
  startDate: string;
  endDate: string;
  totalRentalGrosze: number;
  orderStatus: OrderStatus;
}

const HEAD_CLASS =
  "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";
const CELL_CLASS = "h-[52px] p-0";

function formatTerm(locale: string, startDate: string, endDate: string): string {
  const format = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  return format.formatRange(new Date(`${startDate}T00:00:00Z`), new Date(`${endDate}T00:00:00Z`));
}

function CellLink({
  href,
  primary = false,
  align = "left",
  className,
  ariaLabel,
  children,
}: {
  href: string;
  primary?: boolean;
  align?: "left" | "right";
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      data-cell-link
      data-row-link={primary ? "" : undefined}
      tabIndex={primary ? undefined : -1}
      aria-hidden={primary ? undefined : true}
      aria-label={primary ? ariaLabel : undefined}
      className={cn(
        "text-foreground flex h-[52px] items-center px-3.5 no-underline outline-none",
        align === "right" && "justify-end",
        primary &&
          "rounded-sm hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-accent dark:focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function CustomerOrders({
  orders,
  currency,
  locale,
}: {
  orders: CustomerOrderRow[];
  currency: CurrencyCode;
  locale: string;
}) {
  const t = useTranslations("customers.card");

  return (
    <section
      data-customer-orders
      aria-labelledby="customer-history-heading"
      className="border-border bg-card flex flex-col gap-4 rounded-md border p-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="customer-history-heading"
          className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase"
        >
          {t("historyHeading")}
        </h2>
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("historyHint")}</p>
      </div>

      {orders.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("historyEmpty")}</p>
      ) : (
        <>
          {/* Desktop: tabela. Poniżej `md` — stos kart. */}
          <div className="border-border overflow-x-auto rounded-lg border md:block hidden">
            <Table className="min-w-2xl border-collapse">
              <TableHeader>
                <TableRow className="hover:border-b-border">
                  <TableHead className={HEAD_CLASS}>{t("colId")}</TableHead>
                  <TableHead className={HEAD_CLASS}>{t("colTerm")}</TableHead>
                  <TableHead className={cn(HEAD_CLASS, "text-right")}>{t("colAmount")}</TableHead>
                  <TableHead className={HEAD_CLASS}>{t("colStatus")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const href = `/zamowienia/${order.id}`;
                  const openLabel = t("openOrder", { number: order.orderNumber });
                  return (
                    <TableRow
                      key={order.id}
                      data-customer-order-row
                      className="transition-colors [transition-duration:var(--motion-fast)] hover:bg-muted focus-within:bg-muted"
                    >
                      <TableCell className={CELL_CLASS}>
                        <CellLink href={href} primary ariaLabel={openLabel} className="font-medium tabular-nums tracking-[0.01em]">
                          {order.orderNumber}
                        </CellLink>
                      </TableCell>
                      <TableCell className={CELL_CLASS}>
                        <CellLink href={href} className="tabular-nums tracking-[0.01em]">
                          {formatTerm(locale, order.startDate, order.endDate)}
                        </CellLink>
                      </TableCell>
                      <TableCell className={CELL_CLASS}>
                        <CellLink href={href} align="right" className="tabular-nums">
                          {formatMoney(order.totalRentalGrosze, currency, locale)}
                        </CellLink>
                      </TableCell>
                      <TableCell className={CELL_CLASS}>
                        <CellLink href={href}>
                          <StatusChip axis="order" value={order.orderStatus} />
                        </CellLink>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/zamowienia/${order.id}`}
                  data-customer-order-row
                  aria-label={t("openOrder", { number: order.orderNumber })}
                  className="border-border bg-card block rounded-lg border p-4 no-underline outline-none transition-colors [transition-duration:var(--motion-fast)] hover:bg-muted focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground font-medium tabular-nums tracking-[0.01em]">
                      {order.orderNumber}
                    </span>
                    <span className="text-foreground font-semibold tabular-nums">
                      {formatMoney(order.totalRentalGrosze, currency, locale)}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 text-sm tabular-nums">
                    {formatTerm(locale, order.startDate, order.endDate)}
                  </div>
                  <div className="mt-3">
                    <StatusChip axis="order" value={order.orderStatus} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
