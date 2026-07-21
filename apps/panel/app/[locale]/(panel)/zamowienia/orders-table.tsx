import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@avably/ui";
import { formatMoney, type CurrencyCode, type OrderStatus, type PaymentStatus } from "@avably/core";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { StatusChip } from "@/lib/orders/status-chip";

import { OrderRowActions } from "./order-row-actions";

/**
 * Tabela listy zamówień (sekcja 04 artefaktu Fazy 2, ADR-057).
 *
 * Kolumny co do znaku jak w artefakcie: ID / Klient / Sprzęt / Termin / Kwota
 * / Status zamówienia / Status płatności / Akcje. Dwie osie statusu jadą w
 * jednym wierszu, każda przez `StatusChip` — rodzaj semantyczny wylicza
 * `statusSemantics`, ekran nie zna słowa „positive".
 *
 * KOMPONENT PREZENTACYJNY (bez I/O, bez async): dostaje gotowe wiersze, więc
 * kontrakt renderu może go wywołać na fixture wszystkich statusów obu osi
 * (`orders-screen-contract.test.tsx`) bez Supabase i bez Next.js.
 */

export interface OrdersTableRow {
  id: string;
  orderNumber: string;
  customerLabel: string;
  /** Nazwy produktów pozycji — pierwsza w kolumnie, reszta jako „+N". */
  equipment: string[];
  startDate: string;
  endDate: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  totalRentalGrosze: number;
}

/**
 * Termin jako zakres w formacie locale (`formatRange` sam skraca powtórzony
 * miesiąc i rok, jak w mockupie). Daty są dniowe (`YYYY-MM-DD`), więc czytamy
 * je w UTC — w Europe/Warsaw północ UTC cofnęłaby dzień o jeden.
 */
function formatTerm(locale: string, startDate: string, endDate: string): string {
  const format = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  return format.formatRange(new Date(`${startDate}T00:00:00Z`), new Date(`${endDate}T00:00:00Z`));
}

export function OrdersTable({
  rows,
  currency,
  locale,
}: {
  rows: OrdersTableRow[];
  currency: CurrencyCode;
  locale: string;
}) {
  const t = useTranslations("orders.list");

  return (
    // Ramka i przewijanie poziome jak `.table-scroll` artefaktu: przy wąskim
    // ekranie przewija się TABELA, nie cała strona.
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <Table className="min-w-[880px] border-collapse">
        <TableHeader>
          <TableRow className="hover:border-b-border">
            <TableHead className="h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("colId")}
            </TableHead>
            <TableHead className="h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("colCustomer")}
            </TableHead>
            <TableHead className="h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("colEquipment")}
            </TableHead>
            <TableHead className="h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("colTerm")}
            </TableHead>
            <TableHead className="h-auto px-3.5 py-3 text-right text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("colAmount")}
            </TableHead>
            <TableHead className="h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("colOrderStatus")}
            </TableHead>
            <TableHead className="h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("colPaymentStatus")}
            </TableHead>
            <TableHead className="h-auto px-3.5 py-3">
              <span className="sr-only">{t("colActions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-order-row data-order-id={row.orderNumber}>
              <TableCell data-cell="id" className="h-[52px] px-3.5 py-2.5">
                <Link
                  // Obrys focusu MUSI siedzieć na elemencie, który naprawdę
                  // dostaje fokus. `TableRow` ma stan focus z P2, ale <tr> nie
                  // jest tabowalny — bez tego Tab po liście pokazywał domyślny
                  // cienki obrys przeglądarki zamiast 3px na limonce.
                  className="text-foreground rounded-sm font-medium tabular-nums tracking-[0.01em] no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
                  href={`/zamowienia/${row.id}`}
                >
                  {row.orderNumber}
                </Link>
              </TableCell>
              <TableCell data-cell="customer" className="h-[52px] px-3.5 py-2.5 font-medium">
                {row.customerLabel}
              </TableCell>
              <TableCell data-cell="equipment" className="h-[52px] px-3.5 py-2.5">
                {row.equipment[0] ?? "—"}
                {row.equipment.length > 1 ? (
                  <span className="text-muted-foreground">
                    {" "}
                    {t("itemsMore", { count: row.equipment.length - 1 })}
                  </span>
                ) : null}
              </TableCell>
              <TableCell
                data-cell="date"
                className="h-[52px] px-3.5 py-2.5 tabular-nums tracking-[0.01em]"
              >
                {formatTerm(locale, row.startDate, row.endDate)}
              </TableCell>
              <TableCell
                data-cell="amount"
                className="h-[52px] px-3.5 py-2.5 text-right tabular-nums tracking-[0.01em]"
              >
                {formatMoney(row.totalRentalGrosze, currency, locale)}
              </TableCell>
              <TableCell data-cell="order-status" className="h-[52px] px-3.5 py-2.5">
                <StatusChip axis="order" value={row.orderStatus} />
              </TableCell>
              <TableCell data-cell="payment-status" className="h-[52px] px-3.5 py-2.5">
                <StatusChip axis="payment" value={row.paymentStatus} />
              </TableCell>
              <TableCell data-cell="actions" className="h-[52px] px-3.5 py-2.5 text-right">
                <OrderRowActions
                  orderId={row.id}
                  labels={{
                    trigger: t("rowActions", { number: row.orderNumber }),
                    details: t("actionDetails"),
                    status: t("actionStatus"),
                  }}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
