/**
 * Karta „Faktura" szczegółu zamówienia (D3, ADR-076) — samowystarczalny
 * server component z własnym odczytem (wzorzec ContractSection).
 *
 * ============== STAN „WYSŁANA" JEST WYPROWADZANY, NIE PRZECHOWYWANY ==============
 *
 * Odpowiedź na pytanie „czy faktura poszła" bierze się WYŁĄCZNIE z historii
 * wysyłek: istnieje wpis `kind = 'invoice'` ze statusem `sent` dla tego
 * zamówienia. Kolumny `orders.invoice_sent` nie ma i nie będzie.
 *
 * Powód jest ten sam, dla którego rejestr kaucji nie ma kolumny salda:
 * flaga byłaby DRUGIM źródłem prawdy o jednym fakcie, zapisywanym PO
 * wysyłce i osobnym żądaniem. Wystarczy, że raz nie dojdzie — wiadomość
 * u klienta jest, a panel mówi „nie wysłano" — żeby operator wysłał
 * fakturę drugi raz. Wpis w historii powstaje w TEJ SAMEJ ścieżce co
 * żądanie do dostawcy (`sendAndLog`), więc jest bliżej zdarzenia niż
 * cokolwiek, co dałoby się dopisać obok.
 *
 * KARTA NIE UDAJE ARCHIWUM. Pokazuje, że faktura wyszła, kiedy i na jaki
 * adres — a wysłanego PDF-a u siebie nie zostawia i mówi to wprost.
 * Archiwum dokumentów finansowych to osobna decyzja (bucket, izolacja,
 * retencja), a nie skutek uboczny wysyłki maila.
 */
import { StatusBadge } from "@avably/ui";
import { getLocale, getTranslations } from "next-intl/server";

import { formatLogTimestamp } from "@/lib/email-log-view";
import { secondaryStatusProps } from "@/lib/secondary-status";
import { requireMember } from "@/lib/supabase-server";

import { sendInvoiceAction } from "./invoice-actions";
import { InvoiceDialog } from "./invoice-dialog";

interface SentInvoiceRow {
  created_at: string;
  recipient: string;
}

export async function InvoiceSection({
  orderId,
  customerEmail,
}: {
  orderId: string;
  customerEmail: string | null;
}) {
  // Opt-in okna domykania (ADR-138): wysyłka faktury jest na allowliście.
  const ctx = await requireMember(undefined, { closing: true });
  const locale = await getLocale();
  const t = await getTranslations("orders.invoice");

  // Jedno zapytanie, jedno pytanie: czy i kiedy poszła OSTATNIA udana
  // wysyłka. Nieudane próby pokazuje sekcja historii komunikacji razem
  // z powodem — powielanie ich tutaj dałoby dwa miejsca mówiące o tym
  // samym, a karta ma odpowiadać na „czy klient ma fakturę".
  const { data, count } = await ctx.supabase
    .from("email_logs")
    .select("created_at, recipient", { count: "exact" })
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", orderId)
    .eq("kind", "invoice")
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(1);

  const rows = (data ?? []) as SentInvoiceRow[];
  const lastSent = rows[0] ?? null;
  const sentCount = count ?? rows.length;

  return (
    <section
      data-invoice-card
      aria-labelledby="invoice-heading"
      className="border-border bg-card flex flex-col gap-4 rounded-md border p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="invoice-heading"
          className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase"
        >
          {t("title")}
        </h2>
        {lastSent ? (
          <StatusBadge {...secondaryStatusProps("email-log", "sent")}>{t("sentBadge")}</StatusBadge>
        ) : null}
      </div>

      {customerEmail ? (
        <>
          {lastSent ? (
            <div className="flex flex-col gap-0.5">
              <p className="text-foreground text-sm">
                {t("lastSentAt", { at: formatLogTimestamp(lastSent.created_at, locale) })}
              </p>
              <p className="text-muted-foreground text-xs break-all">{lastSent.recipient}</p>
              {/* Liczba wysyłek jest pokazana TYLKO wtedy, gdy jest większa
                  od jednej: „wysłano 1 raz" to szum, a „wysłano 3 razy"
                  bywa jedynym śladem korekty, o której nikt nie pamięta. */}
              {sentCount > 1 ? (
                <p className="text-muted-foreground text-xs">{t("sentCount", { count: sentCount })}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{t("notSent")}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <InvoiceDialog
              orderId={orderId}
              customerEmail={customerEmail}
              action={sendInvoiceAction}
              resend={Boolean(lastSent)}
            />
          </div>
        </>
      ) : (
        // Bez adresu nie ma dokąd wysłać — przycisk otwierający okno, które
        // i tak skończy się odmową, byłby obietnicą bez pokrycia.
        <p className="text-status-attention-fg text-sm">{t("noCustomerEmail")}</p>
      )}
    </section>
  );
}
