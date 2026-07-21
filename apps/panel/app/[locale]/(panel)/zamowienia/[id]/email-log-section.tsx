/**
 * Sekcja „Wysłane wiadomości" szczegółu zamówienia (Zadanie 2.8, ADR-045) —
 * SAMOWYSTARCZALNY server component (własny odczyt), wpinany do page.tsx
 * jedną linią (wzorzec DeliverySection).
 *
 * Odpowiada na dwa pytania, na które do tej pory nie było gdzie odpowiedzieć:
 * czy klient dostał wiadomość i — jeśli nie — dlaczego. Powód porażki jest
 * pokazany WPROST przy wierszu, a nie skryty pod ikoną: to jedyny ślad po
 * nieudanej wysyłce i ukrywanie go zamieniałoby rejestr z powrotem w ciszę.
 */
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@avably/ui";
import { Fragment } from "react";
import { getLocale, getTranslations } from "next-intl/server";

import { requireMember } from "@/lib/supabase-server";
import { EMAIL_LOG_ROW_COLUMNS, formatLogTimestamp, type EmailLogRow } from "@/lib/email-log-view";

export async function EmailLogSection({ orderId }: { orderId: string }) {
  const ctx = await requireMember();
  const locale = await getLocale();
  const t = await getTranslations("emailLog");

  const { data } = await ctx.supabase
    .from("email_logs")
    .select(EMAIL_LOG_ROW_COLUMNS)
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", orderId)
    // Indeks (tenant_id, created_at desc) z 0021; najnowsze na górze, bo
    // pytanie brzmi „czy OSTATNIA zmiana statusu wyszła".
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as unknown as EmailLogRow[];

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("orderSectionTitle")}</h2>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("emptyForOrder")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columnDate")}</TableHead>
              <TableHead>{t("columnKind")}</TableHead>
              <TableHead>{t("columnRecipient")}</TableHead>
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
                    {/* div, nie p: Badge renderuje <div> (wzorzec z page.tsx) */}
                    <div>
                      <Badge variant={row.status === "failed" ? "outline" : "default"}>
                        {t(`status.${row.status}`)}
                      </Badge>
                    </div>
                  </TableCell>
                </TableRow>
                {row.error ? (
                  <TableRow>
                    <TableCell colSpan={4} className="pt-0 text-xs text-muted-foreground">
                      {row.error}
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
