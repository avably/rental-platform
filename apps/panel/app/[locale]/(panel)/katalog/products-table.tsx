import {
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@avably/ui";
import { formatMoney, type CurrencyCode } from "@avably/core";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { availabilityBadgeProps } from "@/lib/catalog/availability-chip";

import { ProductRowActions } from "./product-row-actions";

/**
 * Tabela katalogu produktów w designie Fazy 2 (ADR-058).
 *
 * Forma wprost z listy zamówień (ADR-057): ramka z przewijaniem POZIOMYM
 * tabeli zamiast całej strony, nagłówki jako micro-label z sekcji 02, kwoty
 * i liczby w `tabular-nums` (kolumna liczb ma się nie „chwiać" między
 * wierszami), stan wiersza i obrys focusu na elemencie TABOWALNYM — czyli na
 * linku z nazwą, nie na `<tr>` (lekcja ADR-057 D5).
 *
 * KOMPONENT PREZENTACYJNY (bez I/O, bez async): dostaje gotowe wiersze, więc
 * kontrakt renderu może go wywołać na fixture bez Supabase i bez Next.js.
 */

export interface ProductsTableRow {
  id: string;
  name: string;
  basePriceDayGrosze: number;
  depositGrosze: number;
  active: boolean;
  unitCount: number;
}

export function ProductsTable({
  rows,
  currency,
  locale,
}: {
  rows: ProductsTableRow[];
  currency: CurrencyCode;
  locale: string;
}) {
  const t = useTranslations("catalog.list");

  const headClass =
    "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <Table className="min-w-[720px] border-collapse">
        <TableHeader>
          <TableRow className="hover:border-b-border">
            <TableHead className={headClass}>{t("colName")}</TableHead>
            <TableHead className={`${headClass} text-right`}>{t("colPricePerDay")}</TableHead>
            <TableHead className={`${headClass} text-right`}>{t("colDeposit")}</TableHead>
            <TableHead className={`${headClass} text-right`}>{t("colUnits")}</TableHead>
            <TableHead className={headClass}>{t("colActive")}</TableHead>
            <TableHead className="h-auto px-3.5 py-3">
              <span className="sr-only">{t("colActions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-product-row data-product-id={row.id}>
              <TableCell data-cell="name" className="h-[52px] px-3.5 py-2.5">
                <Link
                  className="text-foreground rounded-sm font-medium no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
                  href={`/katalog/${row.id}`}
                >
                  {row.name}
                </Link>
              </TableCell>
              <TableCell
                data-cell="price"
                className="h-[52px] px-3.5 py-2.5 text-right tabular-nums tracking-[0.01em]"
              >
                {formatMoney(row.basePriceDayGrosze, currency, locale)}
              </TableCell>
              <TableCell
                data-cell="deposit"
                className="h-[52px] px-3.5 py-2.5 text-right tabular-nums tracking-[0.01em]"
              >
                {formatMoney(row.depositGrosze, currency, locale)}
              </TableCell>
              <TableCell
                data-cell="units"
                className="h-[52px] px-3.5 py-2.5 text-right tabular-nums tracking-[0.01em]"
              >
                {row.unitCount}
              </TableCell>
              <TableCell data-cell="availability" className="h-[52px] px-3.5 py-2.5">
                <StatusBadge {...availabilityBadgeProps(row.active)}>
                  {row.active ? t("activeYes") : t("activeNo")}
                </StatusBadge>
              </TableCell>
              <TableCell data-cell="actions" className="h-[52px] px-3.5 py-2.5 text-right">
                <ProductRowActions
                  productId={row.id}
                  labels={{
                    trigger: t("rowActions", { name: row.name }),
                    edit: t("actionEdit"),
                    units: t("unitsLink"),
                    tiers: t("tiersLink"),
                    images: t("imagesLink"),
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
