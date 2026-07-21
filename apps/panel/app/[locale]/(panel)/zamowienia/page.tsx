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
import { formatMoney, type OrderStatus, type PaymentStatus, ORDER_STATUSES } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { ordersFilterSchema } from "@/lib/order-validation";
import { getTenantCurrency } from "@/lib/tenant-currency";

interface OrderRow {
  id: string;
  order_number: string;
  start_date: string;
  end_date: string;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  total_rental_grosze: number;
  customers: { full_name: string | null; email: string } | null;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireMemberPage("/zamowienia");

  const params = await searchParams;
  const single = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : undefined;
  // Błędny filtr jest ignorowany (catch → undefined), nie błędem strony.
  const filter = ordersFilterSchema.parse({
    status: single(params.status),
    od: single(params.od),
    do: single(params.do),
    klient: single(params.klient),
  });

  let query = ctx.supabase
    .from("orders")
    .select(
      "id, order_number, start_date, end_date, order_status, payment_status, total_rental_grosze, customers(full_name, email)",
    )
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter.status) query = query.eq("order_status", filter.status);
  if (filter.klient) query = query.eq("customer_id", filter.klient);
  // Filtr terminu to NACHODZENIE zakresów inclusive (konwencja 0007, ta sama
  // co kolizje silnika): zamówienie łapie się, gdy [start, end] przecina
  // [od, do] — start <= do AND end >= od.
  if (filter.od) query = query.gte("end_date", filter.od);
  if (filter.do) query = query.lte("start_date", filter.do);

  const [{ data: orders }, { data: customers }] = await Promise.all([
    query,
    ctx.supabase
      .from("customers")
      .select("id, email, full_name")
      .eq("tenant_id", ctx.tenantId)
      .order("email"),
  ]);

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("orders.list");
  const tStatus = await getTranslations("orders.status");
  const tPayment = await getTranslations("orders.paymentStatus");

  const rows = (orders ?? []) as unknown as OrderRow[];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Button asChild>
          <Link href="/zamowienia/nowe">{t("newOrder")}</Link>
        </Button>
      </header>

      {/* Filtry idą GET-em — stan listy mieszka w URL (można podesłać link). */}
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
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {tStatus(status)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-od" className="text-xs font-medium">
            {t("filterFrom")}
          </label>
          <input
            id="filter-od"
            type="date"
            name="od"
            defaultValue={filter.od ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-3"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-do" className="text-xs font-medium">
            {t("filterTo")}
          </label>
          <input
            id="filter-do"
            type="date"
            name="do"
            defaultValue={filter.do ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-3"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-klient" className="text-xs font-medium">
            {t("filterCustomer")}
          </label>
          <select
            id="filter-klient"
            name="klient"
            defaultValue={filter.klient ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-3"
          >
            <option value="">{t("filterAll")}</option>
            {(customers ?? []).map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.full_name ? `${customer.full_name} (${customer.email})` : customer.email}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          {t("apply")}
        </Button>
        <Link className="underline" href="/zamowienia">
          {t("clear")}
        </Link>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colNumber")}</TableHead>
              <TableHead>{t("colCustomer")}</TableHead>
              <TableHead>{t("colTerm")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
              <TableHead>{t("colPayment")}</TableHead>
              <TableHead>{t("colTotal")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-medium">
                  <Link className="underline" href={`/zamowienia/${order.id}`}>
                    {order.order_number}
                  </Link>
                </TableCell>
                <TableCell>
                  {order.customers?.full_name ?? order.customers?.email ?? "—"}
                </TableCell>
                <TableCell>
                  {order.start_date} — {order.end_date}
                </TableCell>
                <TableCell>
                  <Badge variant={order.order_status === "cancelled" ? "outline" : "default"}>
                    {tStatus(order.order_status)}
                  </Badge>
                </TableCell>
                <TableCell>{tPayment(order.payment_status)}</TableCell>
                <TableCell>{formatMoney(order.total_rental_grosze, currency, locale)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
