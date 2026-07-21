/**
 * Ekran globalny historii wysyłek (Zadanie 2.8, ADR-045): wszystkie
 * wiadomości tenanta, od najnowszej, z filtrem statusu i paginacją.
 *
 * Filtr i strona idą GET-em — stan listy mieszka w URL (wzorzec listy
 * zamówień), więc „pokaż mi te nieudane" da się komuś podesłać linkiem.
 *
 * Paginacja jest po OFFSECIE (range), nie kursorem: rejestr rośnie wolno
 * (kilka wiadomości na zamówienie), a operator wchodzi tu po ostatnie
 * kilkadziesiąt wpisów, nie po pełny eksport. Indeks (tenant_id, created_at
 * desc) z 0021 obsługuje dokładnie to zapytanie.
 */
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@avably/ui";
import { EMAIL_LOG_STATUSES } from "@avably/core";
import { Fragment } from "react";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import {
  EMAIL_LOG_PAGE_SIZE,
  EMAIL_LOG_ROW_COLUMNS,
  emailLogFilterSchema,
  formatLogTimestamp,
  type EmailLogRow,
} from "@/lib/email-log-view";

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireMemberPage("/historia-emaili");

  const params = await searchParams;
  const single = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : undefined;
  const filter = emailLogFilterSchema.parse({
    status: single(params.status),
    strona: single(params.strona),
  });

  const page = filter.strona ?? 1;
  const from = (page - 1) * EMAIL_LOG_PAGE_SIZE;

  let query = ctx.supabase
    .from("email_logs")
    .select(EMAIL_LOG_ROW_COLUMNS, { count: "exact" })
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .range(from, from + EMAIL_LOG_PAGE_SIZE - 1);
  if (filter.status) query = query.eq("status", filter.status);

  const { data, count } = await query;

  const rows = (data ?? []) as unknown as EmailLogRow[];
  const total = count ?? 0;
  const hasNext = from + rows.length < total;

  const locale = await getLocale();
  const t = await getTranslations("emailLog");

  /** Link stronicowania zachowuje aktywny filtr — inaczej „dalej" gubiłoby go. */
  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    if (filter.status) search.set("status", filter.status);
    if (target > 1) search.set("strona", String(target));
    const query = search.toString();
    return `/historia-emaili${query ? `?${query}` : ""}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
      </header>

      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      {/* Filtr GET-em — stan listy w URL (wzorzec listy zamówień). */}
      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-status" className="text-xs font-medium">
            {t("filterStatus")}
          </label>
          <select
            id="filter-status"
            name="status"
            defaultValue={filter.status ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-3"
          >
            <option value="">{t("filterAll")}</option>
            {EMAIL_LOG_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          {t("filterApply")}
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
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
                // szerokość: wciśnięty do wąskiej komórki statusu urywał się
                // na krawędzi tabeli, a nieczytelny powód to z powrotem cisza,
                // z którą to zadanie kończy.
                <Fragment key={row.id}>
                  <TableRow>
                    <TableCell className="whitespace-nowrap">
                      {formatLogTimestamp(row.created_at, locale)}
                    </TableCell>
                    <TableCell>{t(`kind.${row.kind}`)}</TableCell>
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
                      <div>
                        <Badge variant={row.status === "failed" ? "outline" : "default"}>
                          {t(`status.${row.status}`)}
                        </Badge>
                      </div>
                    </TableCell>
                  </TableRow>
                  {row.error ? (
                    <TableRow>
                      <TableCell colSpan={5} className="pt-0 text-xs text-muted-foreground">
                        {row.error}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>

          <nav className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{t("pageOf", { page, total })}</span>
            <span className="flex gap-2">
              {page > 1 ? (
                <Button asChild variant="outline">
                  <Link href={pageHref(page - 1)}>{t("previousPage")}</Link>
                </Button>
              ) : null}
              {hasNext ? (
                <Button asChild variant="outline">
                  <Link href={pageHref(page + 1)}>{t("nextPage")}</Link>
                </Button>
              ) : null}
            </span>
          </nav>
        </>
      )}
    </div>
  );
}
