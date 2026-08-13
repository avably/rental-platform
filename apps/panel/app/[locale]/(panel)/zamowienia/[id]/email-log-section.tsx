/**
 * Sekcja „Historia komunikacji" szczegółu zamówienia (Zadanie 2.8, ADR-045;
 * treść wiadomości — uwaga właściciela D10, 0035/ADR-073) — SAMOWYSTARCZALNY
 * server component (własny odczyt), wpinany do page.tsx jedną linią
 * (wzorzec DeliverySection).
 *
 * Odpowiada na trzy pytania, a nie na dwa. Do 0035 były to: czy klient
 * dostał wiadomość i — jeśli nie — dlaczego. Trzecie, w sporze z klientem
 * najczęstsze, brzmi: CO DOKŁADNIE dostał. Metadane nie odpowiadają na nie
 * w ogóle, a odtworzenie treści z szablonu po fakcie odpowiada ŹLE
 * (uzasadnienie w nagłówku migracji 0035).
 *
 * Powód porażki jest pokazany WPROST przy wierszu, a nie skryty pod ikoną:
 * to jedyny ślad po nieudanej wysyłce i ukrywanie go zamieniałoby rejestr
 * z powrotem w ciszę.
 *
 * WPIS BEZ TREŚCI MÓWI TO WPROST. Wiadomości sprzed 0035 nie mają i nigdy
 * mieć nie będą zapisanej treści. Dostają zdanie „treść niedostępna", a NIE
 * przycisk podglądu otwierający puste okno — pusty podgląd czyta się jako
 * „klient dostał pustą wiadomość", czyli jako nieprawdę o tym, co wyszło.
 */
import {
  StatusBadge,
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
import { secondaryStatusProps } from "@/lib/secondary-status";

import { loadEmailBodyAction } from "./email-body-actions";
import { EmailPreviewModal } from "./email-preview-modal";

/**
 * Kolumny sekcji = kolumny wspólne + BIT „czy jest co pokazywać".
 *
 * `email_log_has_body` to kolumna WYLICZANA z 0035 (funkcja nad wierszem),
 * nie sama treść: lista ma wiedzieć, czy podgląd ma sens, bez ściągania
 * kilkuset kilobajtów cudzej korespondencji przy KAŻDYM otwarciu zamówienia.
 */
export const ORDER_EMAIL_LOG_COLUMNS = `${EMAIL_LOG_ROW_COLUMNS}, hasBody:email_log_has_body`;

export interface OrderEmailLogRow extends EmailLogRow {
  hasBody: boolean;
}

export async function EmailLogSection({ orderId }: { orderId: string }) {
  // Opt-in okna domykania (ADR-138): historia maili to odczyt dowodów.
  const ctx = await requireMember(undefined, { closing: true });
  const locale = await getLocale();
  const t = await getTranslations("emailLog");

  const { data } = await ctx.supabase
    .from("email_logs")
    .select(ORDER_EMAIL_LOG_COLUMNS)
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", orderId)
    // Indeks (tenant_id, created_at desc) z 0021; najnowsze na górze, bo
    // pytanie brzmi „czy OSTATNIA zmiana statusu wyszła".
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as unknown as OrderEmailLogRow[];

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("orderSectionTitle")}</h2>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("emptyForOrder")}</p>
      ) : (
        // CZTERY KOLUMNY, NIE SZEŚĆ — i to jest wynik pomiaru, nie gustu.
        // Rodzaj, temat i odbiorca w osobnych kolumnach dawały tabelę o
        // szerokości minimalnej 1179 px w kolumnie szczegółu szerokiej na
        // 644 px (1280 px, tryb desktopowy), czyli poziome przewijanie przy
        // KAŻDYM otwarciu zamówienia — pierwszą rzeczą, jaką operator
        // widziałby w historii, byłby pasek przewijania. Trzy dane opisujące
        // TĘ SAMĄ wiadomość jadą więc jedną kolumną, jedna pod drugą.
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columnDate")}</TableHead>
              <TableHead>{t("columnMessage")}</TableHead>
              <TableHead>{t("columnStatus")}</TableHead>
              <TableHead>{t("columnContent")}</TableHead>
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
                  <TableCell className="align-top whitespace-nowrap">
                    {formatLogTimestamp(row.created_at, locale)}
                  </TableCell>
                  {/* `whitespace-normal` jest tu KONIECZNE, nie kosmetyczne:
                      TableCell z @avably/ui domyślnie ma `whitespace-nowrap`,
                      więc temat i adres nie łamały się wcale — tabela rosła do
                      800 px w kolumnie szerokiej na 644 i wracało przewijanie
                      poziome, którego pozbyliśmy się schodząc z sześciu kolumn
                      na cztery (zmierzone, nie założone). */}
                  <TableCell className="align-top whitespace-normal">
                    {/* Kolejność jest kolejnością czytania: CO to za
                        wiadomość, jak brzmiał jej temat, do kogo poszła. */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">{t(`kind.${row.kind}`)}</span>
                      <span className="break-words font-medium">{row.subject}</span>
                      <span className="text-xs text-muted-foreground break-all">
                        {row.recipient}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    {/* Wrapper utrzymuje chip jako jeden blok w komórce tabeli. */}
                    <div>
                      <StatusBadge
                        {...secondaryStatusProps(
                          "email-log",
                          row.status === "failed" ? "failed" : "sent",
                        )}
                      >
                        {t(`status.${row.status}`)}
                      </StatusBadge>
                    </div>
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    {row.hasBody ? (
                      <EmailPreviewModal
                        logId={row.id}
                        orderId={orderId}
                        subject={row.subject}
                        load={loadEmailBodyAction}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("bodyUnavailable")}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
                {row.error ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="pt-0 text-xs whitespace-normal text-muted-foreground"
                    >
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
