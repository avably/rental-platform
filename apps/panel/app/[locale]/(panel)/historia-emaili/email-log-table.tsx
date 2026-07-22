import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@avably/ui";
import { useTranslations } from "next-intl";
import { Fragment } from "react";

import { Link } from "@/i18n/navigation";
import { formatLogTimestamp, type EmailLogRow } from "@/lib/email-log-view";
import { SecondaryStatusChip } from "@/lib/secondary-status";

/**
 * Rejestr wysyłek (mockup P8: `secondary-email-history`, tabela na PEŁNEJ
 * szerokości kontenera — miara formularza obowiązuje filtr, nie dane).
 *
 * Wydzielone z ekranu z tego samego powodu co `products-table` w P4: strona
 * czyta bazę, ta funkcja rysuje wynik. Dopiero taki podział daje kontraktowi
 * renderu wiersze do obejrzenia bez Supabase.
 */
export function EmailLogTable({
  rows,
  locale,
  page,
  total,
  previousHref,
  nextHref,
}: {
  rows: readonly EmailLogRow[];
  locale: string;
  page: number;
  total: number;
  previousHref: string | null;
  nextHref: string | null;
}) {
  const t = useTranslations("emailLog");

  return (
    <div data-email-history-table className="flex flex-col gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnDate")}</TableHead>
            <TableHead>{t("columnKind")}</TableHead>
            <TableHead>{t("columnRecipient")}</TableHead>
            <TableHead>{t("columnSubject")}</TableHead>
            <TableHead>{t("columnStatus")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            // Fragment, bo powód porażki idzie WŁASNYM wierszem na całą
            // szerokość: wciśnięty do wąskiej komórki statusu urywał się na
            // krawędzi tabeli, a nieczytelny powód to z powrotem cisza, z którą
            // to zadanie kończy.
            <Fragment key={row.id}>
              <TableRow>
                <TableCell className="tabular-nums whitespace-nowrap">
                  {formatLogTimestamp(row.created_at, locale)}
                </TableCell>
                <TableCell>{t(`kind.${row.kind}` as Parameters<typeof t>[0])}</TableCell>
                <TableCell className="break-all">{row.recipient}</TableCell>
                <TableCell>
                  {/* Link do zamówienia tylko, gdy log go dotyczy: zaproszenie
                      nie ma zamówienia, a usunięte zamówienie zeruje order_id. */}
                  {row.order_id ? (
                    <Link className="underline" href={`/zamowienia/${row.order_id}`}>
                      {row.subject}
                    </Link>
                  ) : (
                    row.subject
                  )}
                </TableCell>
                <TableCell>
                  {/* Kolumna ma CHECK na dwie wartości, ale typ wiersza
                      przychodzi z bazy jako `string`. Gdyby kiedyś doszła
                      trzecia, bezpieczniejszym domysłem jest „nie wysłano" niż
                      zapewnianie operatora o sukcesie. */}
                  <SecondaryStatusChip
                    axis="email-log"
                    value={row.status === "sent" ? "sent" : "failed"}
                  />
                </TableCell>
              </TableRow>
              {row.error ? (
                // Powód porażki dostaje ton destruktywny (mockup:
                // `.secondary-failure`) — szary drobny druk pod nieudaną wysyłką
                // czytał się jak metadana, a nie jak powód, dla którego klient
                // niczego nie dostał.
                <TableRow data-email-failure-reason>
                  <TableCell colSpan={5} className="text-destructive pt-0 text-xs font-medium">
                    {row.error}
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          ))}
        </TableBody>
      </Table>

      <nav data-pagination className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground font-medium tabular-nums">
          {t("pageOf", { page, total })}
        </span>
        <span className="flex gap-2">
          {previousHref ? (
            <Button asChild variant="secondary">
              <Link href={previousHref}>{t("previousPage")}</Link>
            </Button>
          ) : null}
          {nextHref ? (
            <Button asChild variant="secondary">
              <Link href={nextHref}>{t("nextPage")}</Link>
            </Button>
          ) : null}
        </span>
      </nav>
    </div>
  );
}
