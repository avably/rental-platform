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

import { changeOrderStatusAction } from "../actions";
import {
  depositTotals,
  isDepositSettled,
  runningBalances,
  type DepositEventRow,
} from "./deposit";
import {
  collectDepositAction,
  deductDepositAction,
  refundDepositAction,
} from "./deposit-actions";
import { DeliverySection } from "./delivery-section";
import { DepositForms } from "./deposit-forms";
import { DetailField } from "./detail-field";
import { EmailLogSection } from "./email-log-section";
import { ExtensionSection } from "./extension-section";
import { OrderStatusAxes } from "./order-status-axes";
import { StatusButtons } from "./status-buttons";

interface OrderDetailRow {
  id: string;
  order_number: string;
  start_date: string;
  end_date: string;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  delivery_method: string;
  total_rental_grosze: number;
  total_deposit_grosze: number;
  notes: string | null;
  created_at: string;
  customers: { full_name: string | null; email: string; phone: string | null } | null;
  pickup_locations: { name: string } | null;
  order_items: {
    id: string;
    rental_grosze: number;
    deposit_grosze: number;
    products: { name: string } | null;
    product_units: { id: string; serial_number: string | null } | null;
  }[];
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
      "id, order_number, start_date, end_date, order_status, payment_status, delivery_method, total_rental_grosze, total_deposit_grosze, notes, created_at, customers(full_name, email, phone), pickup_locations(name), order_items(id, rental_grosze, deposit_grosze, products(name), product_units(id, serial_number))",
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
    .select("id, kind, amount_grosze, reason_code, reason, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", row.id)
    .order("created_at", { ascending: true });
  const depositEvents = (depositRows ?? []) as unknown as DepositEventRow[];
  const totals = depositTotals(depositEvents);
  const balances = runningBalances(depositEvents);

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

  const equipment = row.order_items
    .map((item) => item.products?.name)
    .filter((name): name is string => Boolean(name));

  /**
   * Oś zdarzeń wyłącznie z danych, które ekran ma na wejściu: utworzenie
   * zamówienia, zdarzenia kaucji i nadania przesyłek. Zero zdarzeń
   * dopisywanych „dla kompletu" — czego produkt nie zapisuje, tego oś nie
   * pokazuje.
   */
  const timeline = [
    { at: row.created_at, label: t("timelineCreated") },
    ...depositEvents.map((event) => ({
      at: event.created_at,
      label: `${tDeposit(`kinds.${event.kind}`)} — ${formatMoney(event.amount_grosze, currency, locale)}`,
    })),
    ...shipments.map((shipment) => ({
      at: shipment.created_at,
      label: t("timelineShipment", { number: shipment.provider_order_number }),
    })),
  ].sort((left, right) => left.at.localeCompare(right.at));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm tabular-nums tracking-[0.01em]">
            {row.order_number}
          </p>
          <h1 className="text-2xl leading-[30px] font-semibold tracking-[-0.02em]">
            {row.customers?.full_name ?? row.customers?.email ?? t("customer")}
          </h1>
        </div>
        <Link className="text-sm underline underline-offset-[3px]" href="/zamowienia">
          {t("backToList")}
        </Link>
      </header>

      {/* Przestronny detal z sekcji 05: kolumna główna + panel boczny 320px. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <DetailField label={t("equipment")}>{equipment[0] ?? "—"}</DetailField>
          <DetailField label={t("term")}>
            <span className="tabular-nums tracking-[0.01em]">{term}</span>{" "}
            <span className="text-muted-foreground font-normal">({t("days", { days })})</span>
          </DetailField>
          <DetailField label={t("quantity")}>
            <span className="tabular-nums tracking-[0.01em]">
              {t("quantityUnit", { count: row.order_items.length })}
            </span>
          </DetailField>
          <DetailField label={t("value")}>
            <span className="tabular-nums tracking-[0.01em]">
              {formatMoney(row.total_rental_grosze, currency, locale)}
            </span>
          </DetailField>
          {row.notes ? (
            <DetailField label={t("notes")}>
              <span className="font-normal whitespace-pre-wrap">{row.notes}</span>
            </DetailField>
          ) : null}

          <section className="flex flex-col gap-2">
            <SectionHeading>{t("history")}</SectionHeading>
            <ol className="text-muted-foreground flex list-disc flex-col gap-1 pl-[18px] text-sm leading-[22px]">
              {timeline.map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  <span className="tabular-nums">{depositTimestamp.format(new Date(entry.at))}</span>{" "}
                  — {entry.label}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="border-border flex flex-col gap-4 lg:border-l lg:pl-6">
          {/* Wszystkie osie statusu obok siebie — trzecia tylko wtedy, gdy
              zamówienie naprawdę ma przesyłkę. */}
          <OrderStatusAxes
            orderStatus={row.order_status}
            paymentStatus={row.payment_status}
            shipmentStatus={latestShipment?.status ?? null}
          />

          <DetailField label={t("depositLabel")}>
            <span className="tabular-nums tracking-[0.01em]">
              {formatMoney(row.total_deposit_grosze, currency, locale)}
            </span>
          </DetailField>
          <DetailField label={t("deliveryLabel")}>
            {tDelivery(row.delivery_method)}
            {row.pickup_locations ? ` — ${row.pickup_locations.name}` : null}
          </DetailField>
          <DetailField label={t("trackingNumber")}>
            {latestShipment?.tracking_number ?? (
              <span className="text-muted-foreground font-normal">{t("trackingMissing")}</span>
            )}
          </DetailField>
          <DetailField label={t("customer")}>
            <span className="flex flex-col font-normal">
              <span>{row.customers?.email}</span>
              {row.customers?.phone ? <span>{row.customers.phone}</span> : null}
            </span>
          </DetailField>
        </aside>
      </div>

      {/* Sekcja statusu jest celem pozycji „Zmień status" z menu wiersza. */}
      <section id="status" className="flex scroll-mt-6 flex-col gap-3">
        <SectionHeading>{t("statusSection")}</SectionHeading>
        <StatusButtons
          action={changeOrderStatusAction}
          orderId={row.id}
          currentStatus={row.order_status}
          paymentStatus={row.payment_status}
          // Liczone na serwerze: RESEND_API_KEY nie może trafić do klienta,
          // a komponent potrzebuje wyłącznie odpowiedzi „czy i dlaczego nie".
          emailAvailability={emailAvailability()}
        />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading>{t("items")}</SectionHeading>
        <div className="border-border bg-card overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:border-b-border">
                <TableHead className="text-muted-foreground px-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
                  {t("colProduct")}
                </TableHead>
                <TableHead className="text-muted-foreground px-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
                  {t("colUnit")}
                </TableHead>
                <TableHead className="text-muted-foreground px-3.5 text-right text-[11px] font-semibold tracking-[0.06em] uppercase">
                  {t("colRental")}
                </TableHead>
                <TableHead className="text-muted-foreground px-3.5 text-right text-[11px] font-semibold tracking-[0.06em] uppercase">
                  {t("colDeposit")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {row.order_items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="px-3.5 py-3">{item.products?.name ?? "—"}</TableCell>
                  <TableCell className="px-3.5 py-3">
                    {item.product_units
                      ? (item.product_units.serial_number ?? item.product_units.id.slice(0, 8))
                      : t("unitUnassigned")}
                  </TableCell>
                  <TableCell className="px-3.5 py-3 text-right tabular-nums tracking-[0.01em]">
                    {formatMoney(item.rental_grosze, currency, locale)}
                  </TableCell>
                  <TableCell className="px-3.5 py-3 text-right tabular-nums tracking-[0.01em]">
                    {formatMoney(item.deposit_grosze, currency, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-sm font-medium">
          {t("totalRental")}:{" "}
          <span className="tabular-nums tracking-[0.01em]">
            {formatMoney(row.total_rental_grosze, currency, locale)}
          </span>
          {row.total_deposit_grosze > 0 ? (
            <>
              {" · "}
              {t("totalDeposit")}:{" "}
              <span className="tabular-nums tracking-[0.01em]">
                {formatMoney(row.total_deposit_grosze, currency, locale)}
              </span>
            </>
          ) : null}
        </p>
      </section>

      <section id="kaucja" className="flex scroll-mt-6 flex-col gap-3">
        <SectionHeading>{tDeposit("title")}</SectionHeading>
        {depositEvents.length === 0 ? (
          <p className="text-muted-foreground text-sm">{tDeposit("empty")}</p>
        ) : (
          <div className="border-border bg-card overflow-x-auto rounded-lg border">
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
                    <TableCell className="px-3.5 py-3">{tDeposit(`kinds.${event.kind}`)}</TableCell>
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
        {/* div, nie p: StatusBadge renderuje element inline w rzędzie chipów,
            a układ i tak jest flexem, nie akapitem. */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            {tDeposit("collected")}:{" "}
            <span className="tabular-nums tracking-[0.01em]">
              {formatMoney(totals.collectedGrosze, currency, locale)}
            </span>
          </span>
          <span>
            {tDeposit("settled")}:{" "}
            <span className="tabular-nums tracking-[0.01em]">
              {formatMoney(totals.settledGrosze, currency, locale)}
            </span>
          </span>
          <span className="font-semibold">
            {tDeposit("balance")}:{" "}
            <span className="tabular-nums tracking-[0.01em]">
              {formatMoney(totals.balanceGrosze, currency, locale)}
            </span>
          </span>
          {/* Rozliczona kaucja NIE jest osią statusu domenowego: nie ma wpisu
              w statusSemantics, więc nie dostaje chipa statusu. Zwykły badge
              mówi „stan wyliczony z salda", a nie „czwarta oś" — i nie kusi
              do wpisania rodzaju z palca wbrew kontraktowi tonu (ADR-057). */}
          {isDepositSettled(totals) ? (
            <Badge variant="outline">{tDeposit("settledBadge")}</Badge>
          ) : null}
        </div>
        <DepositForms
          orderId={row.id}
          balanceGrosze={totals.balanceGrosze}
          suggestedCollectGrosze={Math.max(row.total_deposit_grosze - totals.collectedGrosze, 0)}
          currency={currency}
          locale={locale}
          actions={{
            collect: collectDepositAction,
            refund: refundDepositAction,
            deduct: deductDepositAction,
          }}
        />
      </section>

      <ExtensionSection order={{ id: row.id, startDate: row.start_date, endDate: row.end_date, status: row.order_status }} />

      <DeliverySection orderId={row.id} deliveryMethod={row.delivery_method} totalRentalGrosze={row.total_rental_grosze} />

      <EmailLogSection orderId={row.id} />
    </div>
  );
}
