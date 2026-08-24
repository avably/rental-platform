import { Badge } from "@avably/ui";
import {
  ORDER_STATUSES,
  canTransition,
  emailAvailability,
  formatMoney,
  isClosingForwardTransition,
  rentalDaysInclusive,
  type DeliveryPriceSource,
  type OrderStatus,
  type PaymentStatus,
  type ShipmentStatus,
} from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ScreenBackLink } from "@/components/screens/screen-header";
import { isOrderInFrozenSet } from "@/lib/closing";
import { customFieldValuesFromRow, loadPanelCustomFields } from "@/lib/custom-fields";
import { requireMemberPage } from "@/lib/member-page";
import { uuidSchema } from "@/lib/order-validation";
import { StatusChip } from "@/lib/orders/status-chip";
import { CHECKABLE_PAYMENT_STATUSES } from "@/lib/payment-settlement";
import { orderCurrencyCode } from "@/lib/tenant-currency";

import { changeOrderStatusAction, sendTransitionEmailAction } from "../actions";
import { ContractSection } from "./contract-section";
import { formatAddressLine, orderDeliveryDestination } from "./delivery-destination";
import { updateOrderCustomFieldsAction } from "./custom-fields-actions";
import { OrderCustomFieldsSection } from "./custom-fields-section";
import {
  depositTotals,
  isDepositSettled,
  runningBalances,
  type DepositEventRow,
} from "./deposit";
import { collectDepositAction, settleDepositAction } from "./deposit-actions";
import { DeliverySection } from "./delivery-section";
import { DepositForms } from "./deposit-forms";
import { DepositLedger } from "./deposit-ledger";
import { DetailField } from "./detail-field";
import { EmailLogSection } from "./email-log-section";
import { ExtensionSection } from "./extension-section";
import { InvoiceSection } from "./invoice-section";
import { ItemsSection } from "./items-section";
import { CustomerCard } from "./customer-card";
import { OrderNotes, type OrderNoteEntry } from "./order-notes";
import { OrderTimeline } from "./order-timeline";
import { addOrderNoteAction, editOrderNoteAction, deleteOrderNoteAction } from "./notes-actions";
import { archiveOrderAction, restoreOrderAction } from "../actions";
import { OrderArchiveToggle } from "./order-archive-toggle";
import { checkPaymentStatusAction } from "./payment-actions";
import { PaymentCheck } from "./payment-check";
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
  /** Kwota dostawy UTRWALONA przy tworzeniu zamówienia (0016). */
  delivery_grosze: number;
  /** Skąd ta kwota — cennik czy ustalenie ręczne operatora (0044). */
  delivery_price_source: DeliveryPriceSource;
  /** Cel dostarczenia (0044, ADR-089): punkt przewoźnika ALBO adres. */
  delivery_point_provider: string | null;
  delivery_point_code: string | null;
  delivery_point_address: string | null;
  delivery_address_source: string | null;
  delivery_address_name: string | null;
  delivery_address_street: string | null;
  delivery_address_zip: string | null;
  delivery_address_city: string | null;
  delivery_address_phone: string | null;
  total_rental_grosze: number;
  total_deposit_grosze: number;
  /** Waluta UTRWALONA na zamówieniu (0049, ADR-103) — wszystkie kwoty ekranu. */
  currency: string;
  created_at: string;
  /** Archiwizacja SOFT (0100, ADR-242): NULL = aktywne, wartość = zarchiwizowane. */
  archived_at: string | null;
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  // Opt-in okna domykania (ADR-138): szczegół działa w oknie WYŁĄCZNIE dla
  // zamrożonego zbioru (bramka niżej, po odczycie salda kaucji); sekcje
  // przesuwające wartość zobowiązania (przedłużenie, pozycje, pola własne)
  // renderują się wtedy read-only.
  const ctx = await requireMemberPage(`/zamowienia/${id}`, { closing: true });
  const closing = ctx.closing;

  if (!uuidSchema.safeParse(id).success) notFound();

  const { data: order } = await ctx.supabase
    .from("orders")
    .select(
      "id, order_number, start_date, end_date, order_status, payment_status, payment_provider, delivery_method, delivery_grosze, delivery_price_source, delivery_point_provider, delivery_point_code, delivery_point_address, delivery_address_source, delivery_address_name, delivery_address_street, delivery_address_zip, delivery_address_city, delivery_address_phone, total_rental_grosze, total_deposit_grosze, currency, created_at, archived_at, custom_fields, customers(id, full_name, email, phone, address_street, address_zip, address_city, company_name, nip), pickup_locations(name)",
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

  // BRAMKA ZAMROŻONEGO ZBIORU (ADR-138): w oknie domykania zamówienie spoza
  // zbioru nie istnieje dla tego ekranu — notFound, ta sama odpowiedź co dla
  // obcego id (nie robimy z bramki wyroczni). Saldo z odczytu wyżej.
  if (
    closing &&
    !isOrderInFrozenSet(
      {
        created_at: row.created_at,
        payment_status: row.payment_status,
        order_status: row.order_status,
      },
      totals.balanceGrosze,
      ctx.suspendedAt,
    )
  ) {
    notFound();
  }

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
    // Pomija przejściowe wiersze-zaklepania bez numeru (L5, ADR-223) — podsumowanie
    // pokazuje status i numer WYŁĄCZNIE potwierdzonych przesyłek dostawcy.
    .not("provider_order_number", "is", null)
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

  // Waluta ZAMÓWIENIA (orders.currency, 0049/ADR-103) — nie bieżące
  // ustawienie najemcy: po zmianie ustawienia ten ekran ma dalej mówić
  // walutą, w której zamówienie POWSTAŁO (kwoty, kaucje, zwroty, oś czasu).
  const currency = orderCurrencyCode(row.currency);
  const orderCustomFields = await loadPanelCustomFields(ctx.supabase, ctx.tenantId!, "order");
  const locale = await getLocale();
  const t = await getTranslations("orders.detail");
  const tDelivery = await getTranslations("orders.delivery");
  const tDeposit = await getTranslations("orders.deposit");
  const tCustomFields = await getTranslations("customFields");
  const tItems = await getTranslations("orders.items");

  // Pozycje READ-ONLY dla okna domykania (ADR-138): edytor pozycji przesuwa
  // wartość zobowiązania, więc w oknie zamiast interaktywnego ItemsSection
  // (którego guard i tak odmówi) idzie zwykła lista z własnym odczytem.
  let closingItems: {
    id: string;
    rentalGrosze: number;
    depositGrosze: number;
    productName: string | null;
    serialNumber: string | null;
  }[] = [];
  if (closing) {
    const { data: itemRows } = await ctx.supabase
      .from("order_items")
      .select("id, rental_grosze, deposit_grosze, products(name), product_units(serial_number)")
      .eq("tenant_id", ctx.tenantId)
      .eq("order_id", row.id);
    closingItems = ((itemRows ?? []) as unknown as {
      id: string;
      rental_grosze: number;
      deposit_grosze: number;
      products: { name: string } | null;
      product_units: { serial_number: string | null } | null;
    }[]).map((item) => ({
      id: item.id,
      rentalGrosze: item.rental_grosze,
      depositGrosze: item.deposit_grosze,
      productName: item.products?.name ?? null,
      serialNumber: item.product_units?.serial_number ?? null,
    }));
  }

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

  // Dozwolone przejścia liczone NA SERWERZE tym samym źródłem, którego użyje
  // StatusSelect (U3, audyt W4): zamówienie w stanie terminalnym nie renderuje
  // sekcji „Status zamówienia" z samym nagłówkiem — sekcja bez treści znika,
  // a stan czyta się z etykiety przy numerze.
  const statusTargets = ORDER_STATUSES.filter((status) =>
    closing
      ? isClosingForwardTransition(row.order_status, status)
      : canTransition(row.order_status, status),
  );
  const showPaymentCheck =
    isOnlineOrder && CHECKABLE_PAYMENT_STATUSES.includes(row.payment_status);

  // Cel dostarczenia TEGO zamówienia (U3, audyt 2.5): kolumny 0044 — adres
  // własny zamówienia, wskazanie na kartotekę albo punkt przewoźnika.
  const destination = orderDeliveryDestination(row, row.customers);

  return (
    <div className="flex flex-col gap-8">
      {/* Link powrotu OSOBNY od tytułu i NAD nim, w górnym-lewym rogu — jak
          reszta panelu (ScreenBackLink, ADR-058): nawigacja w górę hierarchii,
          nie akcja ekranu. */}
      <div className="flex flex-col gap-3">
        <ScreenBackLink href="/zamowienia" label={t("backToList")} />
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
              {t("orderKicker")}
            </p>
            {/* Stan zamówienia stoi SŁOWEM przy numerze (U3, audyt W4): ta sama
                etykieta i ton co na liście (StatusChip/statusSemantics) —
                operator z linku nie wraca na listę, żeby przeczytać status. */}
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl leading-[30px] font-semibold tracking-[-0.02em] tabular-nums">
                {row.order_number}
              </h2>
              <StatusChip axis="order" value={row.order_status} />
              {/* Zarchiwizowane mówi to WPROST przy numerze (ADR-242) — inaczej
                  operator otwiera zamówienie z archiwum bez śladu, że jest poza
                  aktywną listą. */}
              {row.archived_at ? (
                <Badge variant="outline" data-order-archived-badge>
                  {t("archivedBadge")}
                </Badge>
              ) : null}
            </div>
          </div>
        </header>
      </div>

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
                tu jedną linię, tak jak przy pozycjach i logistyce.
                W OKNIE DOMYKANIA przedłużenia NIE MA (ADR-138): przesuwa
                horyzont zobowiązania — sekcja znika, termin zostaje wyżej. */}
            {closing ? null : (
              <ExtensionSection
                order={{
                  id: row.id,
                  startDate: row.start_date,
                  endDate: row.end_date,
                  status: row.order_status,
                  currency,
                }}
              />
            )}
            <DetailField label={t("deliveryLabel")}>
              {tDelivery(row.delivery_method)}
              {row.pickup_locations ? ` - ${row.pickup_locations.name}` : null}
            </DetailField>
            {/* Adres/punkt dostarczenia TEGO zamówienia (U3, audyt 2.5):
                karta klienta pokazuje adres z kartoteki, ale zamówienie mogło
                pojechać pod „Inny adres" — cel zamówienia stoi przy metodzie
                dostawy, nie w domyśle. */}
            {destination ? (
              <DetailField
                label={destination.kind === "point" ? t("deliveryPoint") : t("deliveryAddress")}
              >
                <span data-delivery-destination={destination.kind} className="font-medium">
                  {destination.kind === "point" ? (
                    <>
                      {destination.code}
                      {destination.address ? (
                        <span className="text-muted-foreground block font-normal">
                          {destination.address}
                        </span>
                      ) : null}
                    </>
                  ) : destination.kind === "custom" ? (
                    <>
                      {destination.name ? (
                        <span className="block">{destination.name}</span>
                      ) : null}
                      {formatAddressLine(destination.street, destination.zip, destination.city)}
                      {destination.phone ? (
                        <span className="text-muted-foreground block font-normal">
                          {destination.phone}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {formatAddressLine(destination.street, destination.zip, destination.city) ??
                        "—"}
                      <span className="text-muted-foreground block font-normal">
                        {t("deliveryAddressFromCustomer")}
                      </span>
                    </>
                  )}
                </span>
              </DetailField>
            ) : null}
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

          {/* W oknie domykania pola własne są READ-ONLY (wzorzec
              contract-read-only: te same dane, jawnie bez akcji — atrapa
              formularza, którego akcja i tak odmówi, uczyłaby ignorować
              błędy). Poza oknem — edytowalna sekcja jak dotąd. */}
          {closing ? (
            orderCustomFields.length > 0 ? (
              <section
                aria-labelledby="order-custom-fields-heading"
                data-order-custom-fields-readonly
                className="border-border bg-card flex flex-col gap-3 rounded-md border p-5"
              >
                <h2
                  id="order-custom-fields-heading"
                  className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase"
                >
                  {tCustomFields("values.section")}
                </h2>
                {orderCustomFields.map((field) => {
                  const value = customFieldValuesFromRow(order)[field.id];
                  return (
                    <DetailField key={field.id} label={field.label}>
                      {value === undefined || value === null || value === ""
                        ? "—"
                        : String(value)}
                    </DetailField>
                  );
                })}
              </section>
            ) : null
          ) : (
            <OrderCustomFieldsSection
              action={updateOrderCustomFieldsAction.bind(null, row.id)}
              fields={orderCustomFields}
              values={customFieldValuesFromRow(order)}
              notSaved={query.polaWlasne === "niezapisane"}
            />
          )}

          <ContractSection orderId={row.id} />

          {/* Faktura stoi POD umową i to nie jest przypadek: obie karty
              dotyczą dokumentów wysyłanych klientowi, ale umowa powstaje
              u nas, a faktura przychodzi z zewnątrz i my ją tylko doręczamy
              (D3, ADR-076). Adres klienta wchodzi propem, bo `page.tsx`
              i tak go czyta — drugi odczyt tego samego pola po to, żeby
              sekcja była „samowystarczalna", byłby zapytaniem dla zasady. */}
          <InvoiceSection orderId={row.id} customerEmail={row.customers?.email ?? null} />

          {/* Archiwizacja SOFT (ADR-242) — karta cyklu życia w panelu bocznym,
              wzorzec przełącznika bana klienta. Odwracalna (Przywróć), więc nie
              „strefa krytyczna": znika z aktywnej listy, zostaje w bazie.
              W oknie domykania jej NIE MA — okno domyka aktywne zobowiązania,
              nie porządkuje archiwum. */}
          {closing ? null : (
            <OrderArchiveToggle
              orderId={row.id}
              archived={row.archived_at !== null}
              archiveAction={archiveOrderAction}
              restoreAction={restoreOrderAction}
            />
          )}
        </aside>

        <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1">

      {/* Sekcja statusu jest celem pozycji „Zmień status" z menu wiersza.
          SEKCJA BEZ TREŚCI ZNIKA (U3, audyt W4): na zamówieniu terminalnym
          (returned/cancelled bez rekoncyliacji) nie ma ani przejść, ani
          sprawdzenia płatności — nagłówek nad niczym uczyłby, że nagłówki
          bywają puste. Stan i tak stoi słowem przy numerze. */}
      {statusTargets.length > 0 || showPaymentCheck ? (
        <section id="status" className="flex scroll-mt-6 flex-col gap-3">
          <SectionHeading>{t("statusSection")}</SectionHeading>
          {/* Dwie akcje, nie jedna (N3, ADR-075): tranzycja utrwala się od
              razu, a wysyłkę zleca osobna akcja dopiero po oknie na cofnięcie.
              Wcześniej jedna akcja robiła oba kroki naraz. */}
          {statusTargets.length > 0 ? (
            <StatusSelect
              changeStatus={changeOrderStatusAction}
              sendEmail={sendTransitionEmailAction}
              orderId={row.id}
              currentStatus={row.order_status}
              paymentStatus={row.payment_status}
              // Liczone na serwerze: klucz transportu nie może trafić do klienta,
              // a od U1 (audyt W3) nie schodzi też POWÓD — komponent dostaje samą
              // odpowiedź „czy", treść komunikatu daje słownik.
              emailAvailability={{ available: emailAvailability().available }}
              // Okno domykania (ADR-138): dropdown pokazuje wyłącznie przejścia
              // do przodu — bramką jest predykat w akcji, to tylko lustro UI.
              closing={closing}
            />
          ) : null}

          {/* Ręczne wejście w rekoncyliację (L11, ADR-104). Widoczne WYŁĄCZNIE
              tam, gdzie ma co robić: obieg online i płatność, o którą jest
              jeszcze sens pytać dostawcę. Przy zamówieniu opłaconym przycisk
              byłby zaproszeniem do regresu, którego bramka 0027 i tak nie
              wpuści — a komunikat o odmowie bramki jest szumem, nie
              odpowiedzią. Tu operator zamyka rozmowę „zapłaciłem, a u was nie
              widać" bez czekania na kolejny przebieg pętli. */}
          {showPaymentCheck ? (
            <PaymentCheck orderId={row.id} action={checkPaymentStatusAction} />
          ) : null}
        </section>
      ) : null}

      {/* Pozycje są EDYTOWALNE (uwagi przeglądu D6/N4): wybór egzemplarza,
          ręczna cena i kaucja, dodawanie (także produktów bez wolnej sztuki,
          jawnie oznaczonych) i usuwanie. Sekcja jest samowystarczalnym RSC
          z własnym odczytem katalogu i dostępności — `page.tsx` dokłada jedną
          linię, tak jak przy przedłużeniu i logistyce.
          W OKNIE DOMYKANIA edycji pozycji NIE MA (ADR-138) — operator widzi
          read-only listę sprzętu do odebrania, bez cen z formularza. */}
      {closing ? (
        <section id="pozycje" className="flex scroll-mt-6 flex-col gap-3" data-items-readonly>
          <SectionHeading>{t("items")}</SectionHeading>
          {closingItems.length === 0 ? (
            <p className="text-muted-foreground text-sm">{tItems("empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {closingItems.map((item) => (
                <li
                  key={item.id}
                  className="border-border bg-card flex flex-wrap items-center justify-between gap-2 rounded-md border px-3.5 py-3"
                >
                  <span className="font-medium">
                    {item.productName ?? "—"}
                    {item.serialNumber ? (
                      <span className="text-muted-foreground ml-2 font-normal">
                        {item.serialNumber}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground tabular-nums tracking-[0.01em]">
                    {tItems("fieldRental")}: {formatMoney(item.rentalGrosze, currency, locale)}
                    {" · "}
                    {tItems("fieldDeposit")}: {formatMoney(item.depositGrosze, currency, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <ItemsSection
          order={{
            id: row.id,
            startDate: row.start_date,
            endDate: row.end_date,
            status: row.order_status,
            totalRentalGrosze: row.total_rental_grosze,
            totalDepositGrosze: row.total_deposit_grosze,
            currency,
          }}
        />
      )}

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
          // Anulowany najem nie pobiera kaucji (U3, audyt W4) — formularz
          // pobrania znika; rozliczenie trzymanego salda zostaje.
          collectAllowed={row.order_status !== "cancelled"}
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
          /* Karty zamiast tabeli (ADR-204, wzorzec ADR-188): tabela w
             `overflow-x-auto` zamieniała „nie mieści się" w niewidoczne
             przewijanie, a nieograniczony tekst operatora (powód potrącenia)
             rozpychał ją ponad kolumnę treści. Uzasadnienie i mechanika —
             nagłówek deposit-ledger.tsx. */
          <DepositLedger
            events={depositEvents}
            balances={balances}
            currency={currency}
            locale={locale}
            timestamp={depositTimestamp}
          />
        )}
          </div>
        </details>
      </section>

      {/* Kwota dostawy jedzie PROPEM z kolumn zamówienia, a nie odczytem
          cennika w sekcji: dopiero to sprawia, że zamówienie z ceną ustaloną
          ręcznie pokazuje swoją kwotę, a zmiana cennika nie przepisuje
          historii (R3-1b). */}
      <DeliverySection
        orderId={row.id}
        deliveryMethod={row.delivery_method}
        deliveryGrosze={row.delivery_grosze}
        deliveryPriceSource={row.delivery_price_source}
        currency={currency}
      />

      <EmailLogSection orderId={row.id} />
        </div>
      </div>
    </div>
  );
}
