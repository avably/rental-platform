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
import { EmailLogSection } from "./email-log-section";
import { ExtensionSection } from "./extension-section";
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

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("orders.detail");
  const tStatus = await getTranslations("orders.status");
  const tPayment = await getTranslations("orders.paymentStatus");
  const tDelivery = await getTranslations("orders.delivery");
  const tDeposit = await getTranslations("orders.deposit");

  const depositTimestamp = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  });

  // Długość najmu liczy silnik — jedyne źródło arytmetyki dat.
  const days = rentalDaysInclusive(row.start_date, row.end_date);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title", { number: row.order_number })}</h1>
        <Link className="text-sm underline" href="/zamowienia">
          {t("backToList")}
        </Link>
      </header>

      <section className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("customer")}</p>
          <p>
            {row.customers?.full_name ?? "—"}
            <br />
            {row.customers?.email}
            {row.customers?.phone ? (
              <>
                <br />
                {row.customers.phone}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("term")}</p>
          <p>
            {row.start_date} — {row.end_date} ({t("days", { days })})
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("deliveryMethod")}</p>
          <p>
            {tDelivery(row.delivery_method)}
            {row.pickup_locations ? ` — ${row.pickup_locations.name}` : null}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("paymentLabel")}</p>
          <p>{tPayment(row.payment_status)}</p>
        </div>
        {row.notes ? (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <p className="font-medium">{t("notes")}</p>
            <p className="whitespace-pre-wrap">{row.notes}</p>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("items")}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colProduct")}</TableHead>
              <TableHead>{t("colUnit")}</TableHead>
              <TableHead>{t("colRental")}</TableHead>
              <TableHead>{t("colDeposit")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {row.order_items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.products?.name ?? "—"}</TableCell>
                <TableCell>
                  {item.product_units
                    ? (item.product_units.serial_number ?? item.product_units.id.slice(0, 8))
                    : t("unitUnassigned")}
                </TableCell>
                <TableCell>{formatMoney(item.rental_grosze, currency, locale)}</TableCell>
                <TableCell>{formatMoney(item.deposit_grosze, currency, locale)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-sm font-semibold">
          {t("totalRental")}: {formatMoney(row.total_rental_grosze, currency, locale)}
          {row.total_deposit_grosze > 0
            ? ` · ${t("totalDeposit")}: ${formatMoney(row.total_deposit_grosze, currency, locale)}`
            : null}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{tDeposit("title")}</h2>
        {depositEvents.length === 0 ? (
          <p className="text-sm text-gray-500">{tDeposit("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tDeposit("colDate")}</TableHead>
                <TableHead>{tDeposit("colKind")}</TableHead>
                <TableHead>{tDeposit("colAmount")}</TableHead>
                <TableHead>{tDeposit("colReason")}</TableHead>
                <TableHead>{tDeposit("colBalance")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {depositEvents.map((event, index) => (
                <TableRow key={event.id}>
                  <TableCell>{depositTimestamp.format(new Date(event.created_at))}</TableCell>
                  <TableCell>{tDeposit(`kinds.${event.kind}`)}</TableCell>
                  <TableCell>
                    {event.kind === "collected" ? "+" : "−"}
                    {formatMoney(event.amount_grosze, currency, locale)}
                  </TableCell>
                  <TableCell>
                    {event.reason_code ? tDeposit(`reasonCodes.${event.reason_code}`) : null}
                    {event.reason_code && event.reason ? " — " : null}
                    {event.reason ?? (event.reason_code ? null : "—")}
                  </TableCell>
                  <TableCell>{formatMoney(balances[index]!, currency, locale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {/* div, nie p: Badge renderuje <div>, a <div> w <p> to błąd hydratacji */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            {tDeposit("collected")}: {formatMoney(totals.collectedGrosze, currency, locale)}
          </span>
          <span>
            {tDeposit("settled")}: {formatMoney(totals.settledGrosze, currency, locale)}
          </span>
          <span className="font-semibold">
            {tDeposit("balance")}: {formatMoney(totals.balanceGrosze, currency, locale)}
          </span>
          {isDepositSettled(totals) ? <Badge variant="outline">{tDeposit("settledBadge")}</Badge> : null}
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

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("statusSection")}</h2>
        {/* div, nie p: Badge renderuje <div>, a <div> w <p> to błąd hydratacji */}
        <div>
          <Badge variant={row.order_status === "cancelled" ? "outline" : "default"}>
            {tStatus(row.order_status)}
          </Badge>
        </div>
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

      <EmailLogSection orderId={row.id} />
    </main>
  );
}
