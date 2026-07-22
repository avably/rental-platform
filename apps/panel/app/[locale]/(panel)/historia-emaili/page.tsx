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
import { Button } from "@avably/ui";
import { EMAIL_LOG_STATUSES } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { PanelSelect } from "@/components/fields/panel-select";
import { ScreenSection } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";
import {
  EMAIL_LOG_PAGE_SIZE,
  EMAIL_LOG_ROW_COLUMNS,
  emailLogFilterSchema,
  type EmailLogRow,
} from "@/lib/email-log-view";

import { EmailLogTable } from "./email-log-table";

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

  // Układ P8 (artefakt, `secondary-email-history`): filtr trzyma MIARĘ
  // FORMULARZA, tabela zostaje na pełnej szerokości kontenera. To nie jest
  // niekonsekwencja: pole wyboru czyta się jak formularz, a rejestr wysyłek to
  // dane operacyjne, którym wąska miara odbiera kolumny.
  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">{t("intro")}</p>

      {/* Filtr GET-em — stan listy w URL (wzorzec listy zamówień). */}
      <form method="get" data-form-line-measure className="flex flex-wrap items-end gap-3 text-sm">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="filter-status" className="text-xs font-medium">
            {t("filterStatus")}
          </label>
          <PanelSelect
            id="filter-status"
            name="status"
            defaultValue={filter.status ?? ""}
            options={[
              { value: "", label: t("filterAll") },
              ...EMAIL_LOG_STATUSES.map((status) => ({
                value: status,
                label: t(`status.${status}`),
              })),
            ]}
          />
        </div>
        <Button type="submit" variant="secondary">
          {t("filterApply")}
        </Button>
      </form>

      {rows.length === 0 ? (
        // Wariant pusty zostaje KARTĄ, nie gołym zdaniem: filtr nad nim dalej
        // działa, więc pustka jest wynikiem zapytania, a nie końcem ekranu.
        <ScreenSection data-email-history-empty description={t("empty")} />
      ) : (
        <EmailLogTable
          rows={rows}
          locale={locale}
          page={page}
          total={total}
          previousHref={page > 1 ? pageHref(page - 1) : null}
          nextHref={hasNext ? pageHref(page + 1) : null}
        />
      )}
    </div>
  );
}
