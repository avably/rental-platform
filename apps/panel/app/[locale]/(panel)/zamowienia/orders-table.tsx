import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@avably/ui";
import { formatMoney, type CurrencyCode, type OrderStatus, type PaymentStatus } from "@avably/core";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { StatusChip } from "@/lib/orders/status-chip";
import { ariaSortFor, orderSortHref, type ResolvedSort } from "@/lib/orders/order-sort";
import { type OrderSortKey } from "@/lib/order-validation";

import { OrderRowActions } from "./order-row-actions";

/**
 * Tabela listy zamówień (sekcja 04 artefaktu Fazy 2, ADR-057; przegląd U2/U3).
 *
 * Kolumny co do znaku jak w artefakcie: ID / Klient / Sprzęt / Termin / Kwota
 * / Status zamówienia / Status płatności / Akcje. Nowości przeglądu:
 *  - nagłówki SORTOWALNE (U2) — link zmienia sort/dir w URL, `aria-sort` niesie
 *    stan; „#" sortuje chronologicznie (created_at), patrz order-sort.ts;
 *  - CAŁY wiersz prowadzi do szczegółu (U3) rozciągniętym linkiem w „#"
 *    (`after:absolute inset-0`), kolumna Akcje zostaje wyjęta (relative z-10);
 *  - na wąskim ekranie zamiast poziomego przewijania — STOS KART (U3), ten sam
 *    wiersz-model.
 *
 * KOMPONENT PREZENTACYJNY (bez I/O, bez async): dostaje gotowe wiersze i
 * efektywny `sort`, więc kontrakt renderu wywołuje go na fixture bez Supabase.
 */

export interface OrdersTableRow {
  id: string;
  orderNumber: string;
  /** Etykieta klienta: nazwa albo e-mail albo „—" (gotowa do wyświetlenia). */
  customerLabel: string;
  /** Rozłożone pola klienta — inicjały karty mobilnej i haystack wyszukiwarki. */
  customerName: string | null;
  customerEmail: string | null;
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

/** Inicjały klienta na awatar karty: z nazwy (max 2 słowa) albo z e-maila. */
function initialsFor(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.trim() || "";
  if (source === "") return "—";
  const words = source.split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

const HEAD_CLASS =
  "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

export function OrdersTable({
  rows,
  currency,
  locale,
  sort,
  baseParams,
}: {
  rows: OrdersTableRow[];
  currency: CurrencyCode;
  locale: string;
  /** Efektywny sort (klucz + kierunek) — dla `aria-sort` i strzałek nagłówków. */
  sort: ResolvedSort;
  /** Zatwierdzone parametry URL zachowywane w linkach sortu. */
  baseParams: Record<string, string | undefined>;
}) {
  const t = useTranslations("orders.list");

  const sortableHead = (label: string, key: OrderSortKey, align: "left" | "right" = "left") => {
    const href = `/zamowienia${orderSortHref(baseParams, key, sort)}`;
    const active = sort.key === key;
    return (
      <TableHead aria-sort={ariaSortFor(key, sort)} className={cn(HEAD_CLASS, align === "right" && "text-right")}>
        <Link
          href={href}
          data-sort-key={key}
          aria-label={t("sortBy", { column: label })}
          className={cn(
            "inline-flex items-center gap-1 rounded-sm text-inherit no-underline outline-none hover:text-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring",
            align === "right" && "flex-row-reverse",
          )}
        >
          <span>{label}</span>
          <SortArrow active={active} dir={sort.dir} />
        </Link>
      </TableHead>
    );
  };

  return (
    <>
      {/* Desktop: tabela. Ramka i przewijanie poziome jak `.table-scroll`
          artefaktu — dopiero na wąskim md schodzimy na karty niżej. */}
      <div className="border-border bg-card hidden overflow-x-auto rounded-lg border md:block">
        <Table className="min-w-[880px] border-collapse">
          <TableHeader>
            <TableRow className="hover:border-b-border">
              {sortableHead(t("colId"), "numer")}
              {sortableHead(t("colCustomer"), "klient")}
              <TableHead className={HEAD_CLASS}>{t("colEquipment")}</TableHead>
              {sortableHead(t("colTerm"), "termin")}
              {sortableHead(t("colAmount"), "kwota", "right")}
              {sortableHead(t("colOrderStatus"), "status")}
              {sortableHead(t("colPaymentStatus"), "platnosc")}
              <TableHead className="h-auto px-3.5 py-3">
                <span className="sr-only">{t("colActions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-order-row
                data-order-id={row.orderNumber}
                className="relative transition-colors [transition-duration:var(--motion-fast)] hover:bg-muted focus-within:bg-muted"
              >
                <TableCell data-cell="id" className="h-[52px] px-3.5 py-2.5">
                  <Link
                    // Rozciągnięty link: `after:inset-0` robi z całego wiersza
                    // cel nawigacji, ale fokus i etykieta siedzą na realnym <a>
                    // w komórce „#" — <tr> nie jest tabowalny. Kolumna Akcje
                    // wychodzi ponad tę nakładkę (relative z-10), więc jej menu
                    // działa niezależnie.
                    data-row-link
                    className="text-foreground rounded-sm font-medium tabular-nums tracking-[0.01em] no-underline outline-none after:absolute after:inset-0 after:content-[''] hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
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
                    <span className="text-muted-foreground"> {t("itemsMore", { count: row.equipment.length - 1 })}</span>
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
                <TableCell data-cell="actions" className="relative z-10 h-[52px] px-3.5 py-2.5 text-right">
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

      {/* Mobile: stos kart. Ta sama tablica `rows`, jeden wiersz-model — cała
          karta prowadzi do szczegółu. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/zamowienia/${row.id}`}
              data-order-card
              data-order-id={row.orderNumber}
              className="border-border bg-card block rounded-lg border p-4 no-underline outline-none transition-colors [transition-duration:var(--motion-fast)] hover:bg-muted focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-foreground font-medium tabular-nums tracking-[0.01em]">
                  {row.orderNumber}
                </span>
                <span className="text-foreground font-semibold tabular-nums">
                  {formatMoney(row.totalRentalGrosze, currency, locale)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="bg-secondary text-secondary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                >
                  {initialsFor(row.customerName, row.customerEmail)}
                </span>
                <span className="text-foreground truncate text-sm">{row.customerLabel}</span>
              </div>
              <div className="text-muted-foreground mt-1 text-sm tabular-nums">
                {formatTerm(locale, row.startDate, row.endDate)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusChip axis="order" value={row.orderStatus} />
                <StatusChip axis="payment" value={row.paymentStatus} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span aria-hidden="true" className={cn("text-[9px] leading-none", active ? "opacity-100" : "opacity-30")}>
      {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
    </span>
  );
}
