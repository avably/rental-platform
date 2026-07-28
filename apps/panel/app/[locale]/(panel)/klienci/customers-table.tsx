import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@avably/ui";
import { useTranslations } from "next-intl";
import { Fragment, type ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { type CustomerSortKey } from "@/lib/customer-validation";
import {
  ariaSortForCustomer,
  customerSortHref,
  type ResolvedCustomerSort,
} from "@/lib/customers/customer-sort";

/**
 * Tabela listy klientów (R6a).
 *
 * Kolumny: Klient / E-mail / Telefon / Zamówienia / Ostatnie zamówienie.
 * Wzorce przejęte z listy zamówień (`orders-table.tsx`):
 *  - CAŁY wiersz prowadzi do karty klienta — KAŻDA WIDOCZNA komórka treściowa
 *    niesie własną kotwicę wypełniającą komórkę (`CellLink`). To NIE jest
 *    ozdobnik: pojedyncza rozciągnięta nakładka na `position: relative` na
 *    `<tr>` nie działa w Safari (lekcja #117), więc każda komórka ma prawdziwy
 *    link do tego samego adresu; etykietę i fokus niesie jedna kotwica
 *    (`primary`), reszta jest `aria-hidden` i poza tabem;
 *  - nagłówki SORTOWALNE tam, gdzie sort ma sens (klient, liczba zamówień,
 *    ostatnie zamówienie) — link zmienia sort/dir w URL, `aria-sort` niesie
 *    stan. E-mail i telefon nie sortują (to pola kontaktu, nie oś porządku);
 *  - poniżej `md` zamiast poziomego przewijania — STOS KART.
 *
 * KOMPONENT PREZENTACYJNY (bez I/O, bez async, bez stanu): dostaje gotowe
 * wiersze i efektywny `sort`, więc kontrakt renderu puszcza go na fixture bez
 * Supabase.
 */

export interface CustomersTableRow {
  id: string;
  /** Etykieta klienta: nazwa albo e-mail (gotowa do wyświetlenia). */
  customerLabel: string;
  fullName: string | null;
  email: string;
  phone: string | null;
  orderCount: number;
  /** ISO timestamp ostatniego zamówienia albo null (klient bez zamówień). */
  lastOrderAt: string | null;
}

const HEAD_CLASS =
  "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

/** Komórka treściowa bez własnego paddingu — wypełnia ją kotwica `CellLink`. */
const CELL_CLASS = "h-[52px] p-0";

/** Inicjały klienta na awatar karty: z nazwy (max 2 słowa) albo z e-maila. */
function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email.trim();
  if (source === "") return "—";
  const words = source.split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

/** Ostatnie zamówienie jako data w formacie locale; timestamp czytamy w Warszawie. */
function formatLastOrder(locale: string, iso: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(new Date(iso));
}

/**
 * Kotwica wypełniająca komórkę wiersza — mechanizm „cały wiersz prowadzi do
 * karty". Każda WIDOCZNA komórka treściowa niesie WŁASNĄ kotwicę (zero
 * pozycjonowania, zero nakładek — poprawne w każdej przeglądarce, w tym
 * Safari). Etykietę i fokus niesie `primary`; pozostałe są `aria-hidden` i
 * wyjęte z taba, żeby czytnik nie ogłaszał wielu identycznych linków.
 */
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

export function CustomersTable({
  rows,
  locale,
  sort,
  baseParams,
}: {
  rows: CustomersTableRow[];
  locale: string;
  /** Efektywny sort (klucz + kierunek) — dla `aria-sort` i strzałek nagłówków. */
  sort: ResolvedCustomerSort;
  /** Zatwierdzone parametry URL zachowywane w linkach sortu. */
  baseParams: Record<string, string | undefined>;
}) {
  const t = useTranslations("customers.list");

  const sortableHead = (label: string, key: CustomerSortKey, align: "left" | "right" = "left") => {
    const href = `/klienci${customerSortHref(baseParams, key, sort)}`;
    const active = sort.key === key;
    return (
      <TableHead
        aria-sort={ariaSortForCustomer(key, sort)}
        className={cn(HEAD_CLASS, align === "right" && "text-right")}
      >
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

  const orderCountCell = (row: CustomersTableRow) =>
    row.orderCount > 0 ? t("ordersCount", { count: row.orderCount }) : t("noOrders");

  const lastOrderCell = (row: CustomersTableRow) =>
    row.lastOrderAt ? formatLastOrder(locale, row.lastOrderAt) : t("noOrders");

  return (
    <>
      {/* Desktop: tabela. Poniżej `md` schodzimy na karty. */}
      <div className="border-border bg-card hidden overflow-x-auto rounded-lg border md:block">
        <Table className="min-w-3xl border-collapse">
          <TableHeader>
            <TableRow className="hover:border-b-border">
              {sortableHead(t("colCustomer"), "klient")}
              <TableHead className={HEAD_CLASS}>{t("colEmail")}</TableHead>
              <TableHead className={HEAD_CLASS}>{t("colPhone")}</TableHead>
              {sortableHead(t("colOrders"), "zamowienia", "right")}
              {sortableHead(t("colLastOrder"), "ostatnie")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const href = `/klienci/${row.id}`;
              const openLabel = t("openCard", { name: row.customerLabel });
              return (
                <TableRow
                  key={row.id}
                  data-customer-row
                  data-customer-id={row.id}
                  className="transition-colors [transition-duration:var(--motion-fast)] hover:bg-muted focus-within:bg-muted"
                >
                  <TableCell data-cell="customer" className={CELL_CLASS}>
                    <CellLink href={href} primary ariaLabel={openLabel} className="font-medium">
                      {row.customerLabel}
                    </CellLink>
                  </TableCell>
                  <TableCell data-cell="email" className={CELL_CLASS}>
                    <CellLink href={href} className="text-muted-foreground">
                      {row.email}
                    </CellLink>
                  </TableCell>
                  <TableCell data-cell="phone" className={CELL_CLASS}>
                    <CellLink href={href} className="text-muted-foreground tabular-nums">
                      {row.phone ?? t("noPhone")}
                    </CellLink>
                  </TableCell>
                  <TableCell data-cell="orders" className={CELL_CLASS}>
                    <CellLink href={href} align="right" className="tabular-nums">
                      {orderCountCell(row)}
                    </CellLink>
                  </TableCell>
                  <TableCell data-cell="last-order" className={CELL_CLASS}>
                    <CellLink href={href} className="tabular-nums tracking-[0.01em]">
                      {lastOrderCell(row)}
                    </CellLink>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stos kart. Ta sama tablica `rows`, cała karta prowadzi do karty
          klienta. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/klienci/${row.id}`}
              data-customer-card
              data-customer-id={row.id}
              aria-label={t("openCard", { name: row.customerLabel })}
              className="border-border bg-card block rounded-lg border p-4 no-underline outline-none transition-colors [transition-duration:var(--motion-fast)] hover:bg-muted focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="bg-secondary text-secondary-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                >
                  {initialsFor(row.fullName, row.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate font-medium">{row.customerLabel}</p>
                  <p className="text-muted-foreground truncate text-sm">{row.email}</p>
                </div>
              </div>
              <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
                <span>{row.phone ?? t("noPhone")}</span>
                <span>{orderCountCell(row)}</span>
                <span>{lastOrderCell(row)}</span>
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
