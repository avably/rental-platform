import { formatMoney } from "@avably/core";
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
import { type ReactNode } from "react";

import { ScreenSection } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import type { ProductHistoryRow } from "@/lib/catalog/card-query";
import { deploymentCellProps } from "@/lib/catalog/deployed-today";
import type { ProductRevenueBucket } from "@/lib/catalog/product-revenue";
import type { ProductThumbnail } from "@/lib/catalog/product-thumbnail";
import { StatusChip } from "@/lib/orders/status-chip";

/**
 * KARTA PRODUKTU JAKO WĘZEŁ (U8b, ADR-146) — warstwa prezentacji.
 *
 * Ekran produktu był dotąd WYŁĄCZNIE formularzem edycji: operator widział
 * pola, których nie zmienia, i nie widział ani jednej rzeczy, po którą tu
 * przyszedł (czy sprzęt jest na półce, ile na nim zarobił, kto go miał).
 * Te bloki odpowiadają na to pytanie, ZANIM zacznie się formularz.
 *
 * KOMPONENT PREZENTACYJNY: dostaje gotowe wiersze, zero I/O — cały odczyt
 * żyje w `lib/catalog/card-query.ts`, żeby sonda izolacji miała jedno
 * miejsce do zbadania.
 */

const HEAD_CLASS =
  "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";
const CELL_CLASS = "h-[52px] p-0";

/** Etykieta liczby — micro-label z sekcji 02 artefaktu (ADR-058). */
function StatLabel({ children }: { children: ReactNode }) {
  return (
    <dt className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
      {children}
    </dt>
  );
}

function PhotoGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2" y="3.5" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6.5" cy="7.5" r="1.3" fill="currentColor" />
      <path
        d="M3.2 12.6l3.3-3.1a1.2 1.2 0 011.6 0l2.4 2.2 1.4-1.2a1.2 1.2 0 011.6 0l1.3 1.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Zdjęcie produktu — GOŁY publiczny URL z bucketu (`product-thumbnail.ts`,
 * U8a/ADR-145), nie transformacja obrazów Supabase: transformacje są opcją
 * planu hostingu, a główny ekran pracy nie ma prawa od niej zależeć.
 *
 * Rozmiar ze skali (`size-32`), nie z wartości arbitralnej — kontrakt
 * spójności panelu trzyma szerokości w jednej notacji.
 */
function ProductPhoto({ thumbnail, href }: { thumbnail: ProductThumbnail | null; href: string }) {
  const t = useTranslations("catalog.card");

  return (
    <div data-product-photo={thumbnail ? "image" : "placeholder"} className="flex flex-col gap-1.5">
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- zdjęcie z publicznego bucketu Storage (goły URL publiczny, ADR-145), nie zasób lokalny next/image
        <img
          src={thumbnail.url}
          alt={thumbnail.alt}
          width={128}
          height={128}
          decoding="async"
          className="border-border size-32 min-w-32 rounded-md border object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="border-border bg-muted text-muted-foreground flex size-32 min-w-32 items-center justify-center rounded-md border"
        >
          <PhotoGlyph />
        </span>
      )}
      <Link
        href={href}
        className="text-muted-foreground hover:text-foreground w-fit rounded-sm text-[13px] leading-[18px] no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
      >
        {thumbnail ? t("photoManage") : t("photoEmpty")}
      </Link>
    </div>
  );
}

export function ProductOverview({
  thumbnail,
  deployedToday,
  unitCount,
  revenue,
  historyCount,
  capped,
  locale,
  productId,
}: {
  thumbnail: ProductThumbnail | null;
  deployedToday: number;
  unitCount: number;
  revenue: ProductRevenueBucket[];
  historyCount: number;
  capped: boolean;
  locale: string;
  productId: string;
}) {
  const t = useTranslations("catalog.card");

  return (
    <ScreenSection data-product-overview title={t("overviewHeading")}>
      <div className="flex flex-wrap items-start gap-6">
        <ProductPhoto thumbnail={thumbnail} href={`/katalog/${productId}/zdjecia`} />

        <dl className="grid min-w-0 flex-1 grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <StatLabel>{t("deploymentHeading")}</StatLabel>
            {unitCount === 0 ? (
              <dd className="flex flex-col gap-1">
                <span className="text-muted-foreground text-sm">{t("unitsEmpty")}</span>
                <Link
                  href={`/katalog/${productId}/egzemplarze`}
                  className="text-foreground w-fit rounded-sm text-[13px] leading-[18px] no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
                >
                  {t("unitsAdd")}
                </Link>
              </dd>
            ) : (
              <dd
                {...deploymentCellProps(deployedToday, unitCount)}
                className="text-xl leading-[26px] font-semibold tabular-nums tracking-[-0.01em]"
              >
                {t("deployedOf", { deployed: deployedToday, total: unitCount })}
              </dd>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <StatLabel>{t("revenueHeading")}</StatLabel>
            <dd data-product-revenue className="flex flex-col gap-0.5">
              {revenue.length === 0 ? (
                <span className="text-muted-foreground text-sm">{t("revenueEmpty")}</span>
              ) : (
                revenue.map((bucket) => (
                  // Każda waluta OSOBNO — suma groszy różnych walut nie
                  // istnieje (ADR-103, lustro 0054).
                  <span
                    key={bucket.currency}
                    data-product-revenue-currency={bucket.currency}
                    className="text-xl leading-[26px] font-semibold tabular-nums tracking-[-0.01em]"
                  >
                    {formatMoney(bucket.rentalGrosze, bucket.currency, locale)}
                  </span>
                ))
              )}
              <span className="text-muted-foreground text-[13px] leading-[18px]">
                {t("revenueHint")}
              </span>
            </dd>
          </div>

          <div className="flex flex-col gap-1.5">
            <StatLabel>{t("rentalsHeading")}</StatLabel>
            <dd
              data-product-rentals
              className="text-xl leading-[26px] font-semibold tabular-nums tracking-[-0.01em]"
            >
              {t("rentalsCount", { count: historyCount })}
            </dd>
          </div>
        </dl>
      </div>

      {capped ? (
        <p data-product-cap className="text-muted-foreground text-sm">
          {t("cap", { count: historyCount })}
        </p>
      ) : null}
    </ScreenSection>
  );
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

function formatTerm(locale: string, startDate: string, endDate: string): string {
  const format = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  return format.formatRange(new Date(`${startDate}T00:00:00Z`), new Date(`${endDate}T00:00:00Z`));
}

/**
 * Historia najmów produktu — wzorzec historii zamówień na karcie klienta
 * (R6a): kotwica PER KOMÓRKA, nie `position` na `<tr>` (lekcja #117 —
 * `relative` na wierszu nie działa w Safari, w której pracuje właściciel).
 *
 * Kwota jest kwotą POZYCJI (`order_items.rental_grosze`), nie całego
 * zamówienia: zamówienie potrafi nieść kilka różnych produktów, a ta lista
 * mówi o jednym.
 */
export function ProductHistory({
  rows,
  locale,
}: {
  rows: ProductHistoryRow[];
  locale: string;
}) {
  const t = useTranslations("catalog.card");

  return (
    <ScreenSection data-product-history title={t("historyHeading")} description={t("historyHint")}>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("historyEmpty")}</p>
      ) : (
        <>
          <div className="border-border hidden overflow-x-auto rounded-lg border md:block">
            <Table className="min-w-2xl border-collapse">
              <TableHeader>
                <TableRow className="hover:border-b-border">
                  <TableHead className={HEAD_CLASS}>{t("colOrder")}</TableHead>
                  <TableHead className={HEAD_CLASS}>{t("colTerm")}</TableHead>
                  <TableHead className={cn(HEAD_CLASS, "text-right")}>{t("colAmount")}</TableHead>
                  <TableHead className={HEAD_CLASS}>{t("colStatus")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const href = `/zamowienia/${row.orderId}`;
                  const openLabel = t("openOrder", { number: row.orderNumber });
                  return (
                    <TableRow
                      key={row.itemKey}
                      data-product-history-row
                      className="transition-colors [transition-duration:var(--motion-fast)] hover:bg-muted focus-within:bg-muted"
                    >
                      <TableCell className={CELL_CLASS}>
                        <CellLink
                          href={href}
                          primary
                          ariaLabel={openLabel}
                          className="font-medium tabular-nums tracking-[0.01em]"
                        >
                          {row.orderNumber}
                        </CellLink>
                      </TableCell>
                      <TableCell className={CELL_CLASS}>
                        <CellLink href={href} className="tabular-nums tracking-[0.01em]">
                          {formatTerm(locale, row.startDate, row.endDate)}
                        </CellLink>
                      </TableCell>
                      <TableCell className={CELL_CLASS}>
                        <CellLink href={href} align="right" className="tabular-nums">
                          {formatMoney(row.rentalGrosze, row.currency, locale)}
                        </CellLink>
                      </TableCell>
                      <TableCell className={CELL_CLASS}>
                        <CellLink href={href}>
                          <StatusChip axis="order" value={row.orderStatus} />
                        </CellLink>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <li key={row.itemKey}>
                <Link
                  href={`/zamowienia/${row.orderId}`}
                  data-product-history-row
                  aria-label={t("openOrder", { number: row.orderNumber })}
                  className="border-border bg-card block rounded-lg border p-4 no-underline outline-none transition-colors [transition-duration:var(--motion-fast)] hover:bg-muted focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground font-medium tabular-nums tracking-[0.01em]">
                      {row.orderNumber}
                    </span>
                    <span className="text-foreground font-semibold tabular-nums">
                      {formatMoney(row.rentalGrosze, row.currency, locale)}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 text-sm tabular-nums">
                    {formatTerm(locale, row.startDate, row.endDate)}
                  </div>
                  <div className="mt-3">
                    <StatusChip axis="order" value={row.orderStatus} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </ScreenSection>
  );
}
