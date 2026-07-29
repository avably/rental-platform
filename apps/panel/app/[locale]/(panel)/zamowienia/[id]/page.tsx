import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@avably/ui";
import {
  emailAvailability,
  formatMoney,
  rentalDaysInclusive,
  type OrderStatus,
  type PaymentStatus,
  type ShipmentStatus,
} from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { uuidSchema } from "@/lib/order-validation";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { changeOrderStatusAction, sendTransitionEmailAction } from "../actions";
import { ContractSection } from "./contract-section";
import {
  depositTotals,
  isDepositSettled,
  runningBalances,
  type DepositEventRow,
} from "./deposit";
import { collectDepositAction, settleDepositAction } from "./deposit-actions";
import { DeliverySection } from "./delivery-section";
import { DepositForms } from "./deposit-forms";
import { DetailField } from "./detail-field";
import { EmailLogSection } from "./email-log-section";
import { ExtensionSection } from "./extension-section";
import { InvoiceSection } from "./invoice-section";
import { ItemsSection } from "./items-section";
import { CustomerCard } from "./customer-card";
import { OrderNotes, type OrderNoteEntry } from "./order-notes";
import { OrderTimeline } from "./order-timeline";
import { addOrderNoteAction, editOrderNoteAction, deleteOrderNoteAction } from "./notes-actions";
import { StatusSelect } from "./status-select";

interface OrderDetailRow {
  id: string;
  order_number: string;
  start_date: string;
  end_date: string;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  /** Obieg płatności (0027) — decyduje, czy zwrot kaucji idzie przez dostawcę. */
  payment_provider: string;
  delivery_method: string;
  total_rental_grosze: number;
  total_deposit_grosze: number;
  created_at: string;
  customers: {
    id: string;
    full_name: string | null;
    email: string;
    phone: string | null;
    address_street: string | null;
    address_zip: string | null;
    address_city: string | null;
    company_name: string | null;
    nip: string | null;
  } | null;
  pickup_locations: { name: string } | null;
}

/** Żądanie zwrotu kaucji u dostawcy (0031) — zamiar, nie fakt. */
interface DepositRefundRow {
  id: string;
  amount_grosze: number;
  status: "requested" | "pending" | "succeeded" | "failed";
  provider_reference: string | null;
  last_error: string | null;
  created_at: string;
}

/** Nagłówek sekcji funkcjonalnej — krok `product-section` artefaktu. */
function SectionHeading({ id, children }: { id?: string; children: string }) {
  return (
    <h2 id={id} className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">
      {children}
    </h2>
  );
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireMemberPage(`/zamowienia/${id}`);

  if (!uuidSchema.safeParse(id).success) notFound();

  const { data: order } = await ctx.supabase
    .from("orders")
    .select(
      "id, order_number, start_date, end_date, order_status, payment_status, payment_provider, delivery_method, total_rental_grosze, total_deposit_grosze, created_at, customers(id, full_name, email, phone, address_street, address_zip, address_city, company_name, nip), pickup_locations(name)",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!order) notFound();

  const row = order as unknown as OrderDetailRow;

  // Rejestr kaucji: chronologia zdarzeń (indeks 0007 zaczyna się od
  // tenant_id, order_id, created_at — sortowanie jest po jego myśli).
  const { data: depositRows } = await ctx.supabase
    .from("deposit_events")
    .select("id, kind, amount_grosze, reason_code, reason, provider, provider_reference, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", row.id)
    .order("created_at", { ascending: true });
  const depositEvents = (depositRows ?? []) as unknown as DepositEventRow[];
  const totals = depositTotals(depositEvents);
  const balances = runningBalances(depositEvents);

  // Rejestr ŻĄDAŃ zwrotu (0031) — osobny od rejestru ZDARZEŃ i celowo NIE
  // wchodzący do salda. Trzyma to, czego rejestr zdarzeń nie ma prawa
  // trzymać: zwrot, o który poprosiliśmy, a którego dostawca jeszcze nie
  // potwierdził, oraz powód odmowy. Bez tego odczytu „zwrot w toku"
  // znikałby przy odświeżeniu strony.
  const { data: refundRows } = await ctx.supabase
    .from("deposit_refunds")
    .select("id, amount_grosze, status, provider_reference, last_error, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", row.id)
    .order("created_at", { ascending: true });
  const refundRequests = (refundRows ?? []) as unknown as DepositRefundRow[];
  const refundInFlight = refundRequests.some(
    (refund) => refund.status === "requested" || refund.status === "pending",
  );
  const isOnlineOrder = row.payment_provider === "stripe";

  // Trzecia oś statusu i numer przesyłki do podsumowania (sekcja 05
  // artefaktu). Czytamy WYŁĄCZNIE te trzy kolumny — pełną listę przesyłek
  // z akcjami i tak ładuje samowystarczalna DeliverySection niżej.
  const { data: shipmentRows } = await ctx.supabase
    .from("courier_shipments")
    .select("status, tracking_number, provider_order_number, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", row.id)
    .order("created_at", { ascending: true });
  const shipments = (shipmentRows ?? []) as unknown as {
    status: ShipmentStatus;
    tracking_number: string | null;
    provider_order_number: string;
    created_at: string;
  }[];
  const latestShipment = shipments.at(-1) ?? null;

  // Notatki jako lista wpisów (ADR-079), najnowsze na górze. id jako
  // rozstrzygający porządek przy równych znacznikach (indeks 0039 zaczyna się
  // od tenant_id, order_id, created_at — skan wsteczny realizuje malejąco).
  const { data: noteRows } = await ctx.supabase
    .from("order_notes")
    .select("id, body, created_by, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", row.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  const rawNotes = (noteRows ?? []) as {
    id: string;
    body: string;
    created_by: string | null;
    created_at: string;
  }[];

  // Autor wpisu: uuid → e-mail członka tenanta (resolver 0039). Jedno zapytanie
  // na całą listę; wpis historyczny (created_by null) albo autor spoza obecnego
  // zespołu → brak w mapie → UI pokaże „—".
  const { data: memberRows } = await ctx.supabase.schema("app").rpc("tenant_member_emails");
  const emailByUser = new Map<string, string>(
    ((memberRows ?? []) as { user_id: string; email: string }[]).map((m) => [m.user_id, m.email]),
  );

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("orders.detail");
  const tDelivery = await getTranslations("orders.delivery");
  const tDeposit = await getTranslations("orders.deposit");

  const depositTimestamp = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  });

  // Wpisy notatek gotowe dla komponentu klienckiego: autor rozwiązany, data
  // sformatowana na serwerze (jak znaczniki rejestru kaucji) — klient nie
  // dubluje logiki strefy czasowej.
  const noteEntries: OrderNoteEntry[] = rawNotes.map((note) => ({
    id: note.id,
    body: note.body,
    author: note.created_by ? (emailByUser.get(note.created_by) ?? null) : null,
    createdAtLabel: depositTimestamp.format(new Date(note.created_at)),
  }));
  // Termin to zakres dni — czytany w UTC, bo daty są dniowe (`YYYY-MM-DD`).
  const term = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(
    new Date(`${row.start_date}T00:00:00Z`),
    new Date(`${row.end_date}T00:00:00Z`),
  );

  // Długość najmu liczy silnik — jedyne źródło arytmetyki dat.
  const days = rentalDaysInclusive(row.start_date, row.end_date);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
            {t("orderKicker")}
          </p>
          <h2 className="text-2xl leading-[30px] font-semibold tracking-[-0.02em] tabular-nums">
            {row.order_number}
          </h2>
        </div>
        <Link className="text-sm underline underline-offset-[3px]" href="/zamowienia">
          {t("backToList")}
        </Link>
      </header>

      {/* Oś czasu zamówienia (uwaga przeglądu D5) — zastępuje rząd chipów
          statusu. Stany kroków wyliczone wyłącznie z danych, które ekran i tak
          ma na wejściu (status zamówienia/płatności/przesyłki, daty, kaucja). */}
      <OrderTimeline
        currency={currency}
        orderStatus={row.order_status}
        paymentStatus={row.payment_status}
        shipmentStatus={latestShipment?.status ?? null}
        createdAt={row.created_at}
        endDate={row.end_date}
        shipmentDispatchedAt={latestShipment?.created_at ?? null}
        deposit={{
          required: row.total_deposit_grosze > 0,
          collectedGrosze: totals.collectedGrosze,
          balanceGrosze: totals.balanceGrosze,
          settled: isDepositSettled(totals),
        }}
      />

      {/* Rama dwukolumnowa (uwaga przeglądu D9): treść operacyjna (pozycje,
          kaucja, logistyka) w kolumnie głównej, karty meta (klient,
          podsumowanie, umowa) w panelu bocznym. `col-start` trzyma panel po
          prawej na desktopie, a że jest pierwszy w źródle — na wąskim ekranie
          karta klienta ląduje NAD operacyjną resztą, nie pod nią. Miejsce na
          kolejne karty (płatności, komunikacja) zostaje w oczywistym porządku. */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <aside className="flex flex-col gap-6 lg:col-start-2 lg:row-start-1">
          {row.customers ? (
            <CustomerCard
              data={{
                customerId: row.customers.id,
                fullName: row.customers.full_name,
                email: row.customers.email,
                phone: row.customers.phone,
                addressStreet: row.customers.address_street,
                addressZip: row.customers.address_zip,
                addressCity: row.customers.address_city,
                companyName: row.customers.company_name,
                nip: row.customers.nip,
              }}
            />
          ) : null}

          <section
            data-order-summary
            aria-labelledby="summary-heading"
            className="border-border bg-card flex flex-col gap-4 rounded-md border p-5"
          >
            <h2
              id="summary-heading"
              className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase"
            >
              {t("summary")}
            </h2>
            <DetailField label={t("term")}>
              <span className="tabular-nums tracking-[0.01em]">{term}</span>{" "}
              <span className="text-muted-foreground font-normal">({t("days", { days })})</span>
            </DetailField>
            {/* Wejście w przedłużenie stoi PRZY TERMINIE (R4, uwaga właściciela):
                przycisk „Przedłuż" pod datami odsłania wybór nowej daty końca
                z dopłatą na żywo. Osobna sekcja przedłużenia zniknęła; RSC dokłada
                tu jedną linię, tak jak przy pozycjach i logistyce. */}
            <ExtensionSection
              order={{ id: row.id, startDate: row.start_date, endDate: row.end_date, status: row.order_status }}
            />
            <DetailField label={t("deliveryLabel")}>
              {tDelivery(row.delivery_method)}
              {row.pickup_locations ? ` — ${row.pickup_locations.name}` : null}
            </DetailField>
          </section>

          {/* Notatki to LISTA WPISÓW (uwaga właściciela, runda 2026-07-28):
              każdy zapis dokłada wpis (treść, autor, data), z edycją inline
              i twardym usunięciem — zamiast jednego nadpisywanego pola.
              ADR-079, migracja 0039. */}
          <section
            aria-labelledby="notes-heading"
            className="border-border bg-card flex flex-col gap-3 rounded-md border p-5"
          >
            <h2
              id="notes-heading"
              className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase"
            >
              {t("notes")}
            </h2>
            <OrderNotes
              orderId={row.id}
              notes={noteEntries}
              addAction={addOrderNoteAction}
              editAction={editOrderNoteAction}
              deleteAction={deleteOrderNoteAction}
            />
          </section>

          <ContractSection orderId={row.id} />

          {/* Faktura stoi POD umową i to nie jest przypadek: obie karty
              dotyczą dokumentów wysyłanych klientowi, ale umowa powstaje
              u nas, a faktura przychodzi z zewnątrz i my ją tylko doręczamy
              (D3, ADR-076). Adres klienta wchodzi propem, bo `page.tsx`
              i tak go czyta — drugi odczyt tego samego pola po to, żeby
              sekcja była „samowystarczalna", byłby zapytaniem dla zasady. */}
          <InvoiceSection orderId={row.id} customerEmail={row.customers?.email ?? null} />
        </aside>

        <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1">

      {/* Sekcja statusu jest celem pozycji „Zmień status" z menu wiersza. */}
      <section id="status" className="flex scroll-mt-6 flex-col gap-3">
        <SectionHeading>{t("statusSection")}</SectionHeading>
        {/* Dwie akcje, nie jedna (N3, ADR-075): tranzycja utrwala się od
            razu, a wysyłkę zleca osobna akcja dopiero po oknie na cofnięcie.
            Wcześniej jedna akcja robiła oba kroki naraz. */}
        <StatusSelect
          changeStatus={changeOrderStatusAction}
          sendEmail={sendTransitionEmailAction}
          orderId={row.id}
          currentStatus={row.order_status}
          paymentStatus={row.payment_status}
          // Liczone na serwerze: RESEND_API_KEY nie może trafić do klienta,
          // a komponent potrzebuje wyłącznie odpowiedzi „czy i dlaczego nie".
          emailAvailability={emailAvailability()}
        />
      </section>

      {/* Pozycje są EDYTOWALNE (uwagi przeglądu D6/N4): wybór egzemplarza,
          ręczna cena i kaucja, dodawanie (także produktów bez wolnej sztuki,
          jawnie oznaczonych) i usuwanie. Sekcja jest samowystarczalnym RSC
          z własnym odczytem katalogu i dostępności — `page.tsx` dokłada jedną
          linię, tak jak przy przedłużeniu i logistyce. */}
      <ItemsSection
        order={{
          id: row.id,
          startDate: row.start_date,
          endDate: row.end_date,
          status: row.order_status,
          totalRentalGrosze: row.total_rental_grosze,
          totalDepositGrosze: row.total_deposit_grosze,
        }}
      />

      <section id="kaucja" className="flex scroll-mt-6 flex-col gap-3">
        <SectionHeading>{tDeposit("title")}</SectionHeading>

        {/* NAJPIERW DZIAŁANIE, POTEM DOWÓD (uproszczenie D7/N5). Saldo
            i jeden przycisk stoją nad rejestrem, bo operator przychodzi tu
            rozliczyć kaucję, a nie przeglądać chronologię. Chronologia jest
            dowodem w sporze z klientem — zjeżdża do „szczegółów", zamiast
            zajmować pierwszy ekran. */}
        <DepositForms
          orderId={row.id}
          balanceGrosze={totals.balanceGrosze}
          collectedGrosze={totals.collectedGrosze}
          suggestedCollectGrosze={Math.max(row.total_deposit_grosze - totals.collectedGrosze, 0)}
          currency={currency}
          locale={locale}
          online={isOnlineOrder}
          refundInFlight={refundInFlight}
          actions={{
            collect: collectDepositAction,
            settle: settleDepositAction,
          }}
        />

        {/* STAN POŚREDNI MA WŁASNĄ REPREZENTACJĘ (Z5, ADR-069) i zostaje na
            wierzchu, bo jest OSTRZEŻENIEM, a nie historią. „Zwrot w toku" nie
            jest ani sukcesem, ani porażką: pieniądze wyszły z żądaniem, ale
            u klienta ich jeszcze nie ma. Gdyby ten blok był schowany, operator
            widziałby saldo dodatnie i rejestr bez wiersza — czyli obraz
            nieodróżnialny od „nikt jeszcze nic nie zrobił" — i zlecił drugi
            zwrot tej samej kaucji. */}
        {isOnlineOrder && refundRequests.some((refund) => refund.status !== "succeeded") ? (
          <ul className="flex flex-col gap-2 text-sm">
            {refundRequests
              .filter((refund) => refund.status !== "succeeded")
              .map((refund) => (
                <li key={refund.id} className="rounded border px-3.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {tDeposit(`refundStatus.${refund.status}`)}
                    </Badge>
                    <span className="tabular-nums tracking-[0.01em]">
                      {formatMoney(refund.amount_grosze, currency, locale)}
                    </span>
                    <span className="text-muted-foreground">
                      {depositTimestamp.format(new Date(refund.created_at))}
                    </span>
                  </div>
                  {refund.last_error ? (
                    <p className="text-muted-foreground mt-1">{refund.last_error}</p>
                  ) : null}
                </li>
              ))}
          </ul>
        ) : null}

        {/* `details`/`summary`, a nie stan Reacta: rozwijanie bez JS działa
            tak samo w każdej przeglądarce, a sekcja jest server-rendered —
            komponent kliencki tylko po to, żeby coś schować, byłby kosztem
            bez zysku. */}
        <details className="border-border bg-card group rounded-lg border">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">
            {tDeposit("ledgerToggle")}
            <span className="text-muted-foreground ml-2 font-normal">
              {tDeposit("collected")}:{" "}
              <span className="tabular-nums tracking-[0.01em]">
                {formatMoney(totals.collectedGrosze, currency, locale)}
              </span>
              {" · "}
              {tDeposit("settled")}:{" "}
              <span className="tabular-nums tracking-[0.01em]">
                {formatMoney(totals.settledGrosze, currency, locale)}
              </span>
            </span>
            {/* Rozliczona kaucja NIE jest osią statusu domenowego: nie ma
                wpisu w statusSemantics, więc nie dostaje chipa statusu.
                Zwykły badge mówi „stan wyliczony z salda", a nie „czwarta
                oś" — i nie kusi do wpisania rodzaju z palca wbrew
                kontraktowi tonu (ADR-057). */}
            {isDepositSettled(totals) ? (
              <Badge variant="outline" className="ml-2">
                {tDeposit("settledBadge")}
              </Badge>
            ) : null}
          </summary>
          <div className="border-border border-t px-4 py-3">
        {depositEvents.length === 0 ? (
          <p className="text-muted-foreground text-sm">{tDeposit("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:border-b-border">
                  <TableHead className="text-muted-foreground px-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
                    {tDeposit("colDate")}
                  </TableHead>
                  <TableHead className="text-muted-foreground px-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
                    {tDeposit("colKind")}
                  </TableHead>
                  <TableHead className="text-muted-foreground px-3.5 text-right text-[11px] font-semibold tracking-[0.06em] uppercase">
                    {tDeposit("colAmount")}
                  </TableHead>
                  <TableHead className="text-muted-foreground px-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
                    {tDeposit("colReason")}
                  </TableHead>
                  <TableHead className="text-muted-foreground px-3.5 text-right text-[11px] font-semibold tracking-[0.06em] uppercase">
                    {tDeposit("colBalance")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {depositEvents.map((event, index) => (
                  <TableRow key={event.id}>
                    <TableCell className="px-3.5 py-3 tabular-nums">
                      {depositTimestamp.format(new Date(event.created_at))}
                    </TableCell>
                    <TableCell className="px-3.5 py-3">
                      {tDeposit(`kinds.${event.kind}`)}
                      {/* Odnośnik u dostawcy jest DOWODEM tego wiersza —
                          w sporze z klientem to po nim odnajduje się
                          przelew. Pokazujemy go, zamiast trzymać wyłącznie
                          w bazie. */}
                      {event.provider === "stripe" ? (
                        <span className="text-muted-foreground block text-xs">
                          {tDeposit("providerOnline")}
                          {event.provider_reference ? ` · ${event.provider_reference}` : null}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-3.5 py-3 text-right tabular-nums tracking-[0.01em]">
                      {event.kind === "collected" ? "+" : "−"}
                      {formatMoney(event.amount_grosze, currency, locale)}
                    </TableCell>
                    <TableCell className="px-3.5 py-3">
                      {event.reason_code ? tDeposit(`reasonCodes.${event.reason_code}`) : null}
                      {event.reason_code && event.reason ? " — " : null}
                      {event.reason ?? (event.reason_code ? null : "—")}
                    </TableCell>
                    <TableCell className="px-3.5 py-3 text-right tabular-nums tracking-[0.01em]">
                      {formatMoney(balances[index]!, currency, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
          </div>
        </details>
      </section>

      <DeliverySection orderId={row.id} deliveryMethod={row.delivery_method} totalRentalGrosze={row.total_rental_grosze} />

      <EmailLogSection orderId={row.id} />
        </div>
      </div>
    </div>
  );
}
