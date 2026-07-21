import { Button } from "@avably/ui";
import { type OrderStatus, type PaymentStatus } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { ordersFilterSchema } from "@/lib/order-validation";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { OrdersEmptyState } from "./orders-empty-state";
import { OrdersFilters } from "./orders-filters";
import { OrdersTable, type OrdersTableRow } from "./orders-table";

interface OrderRow {
  id: string;
  order_number: string;
  start_date: string;
  end_date: string;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  total_rental_grosze: number;
  customers: { full_name: string | null; email: string } | null;
  order_items: { products: { name: string } | null }[];
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
      // `order_items(products(name))` doszło pod kolumnę „Sprzęt" z sekcji 04
      // artefaktu — odczyt zostaje w obrębie RLS tenanta, a filtry, sortowanie
      // i limit są niezmienione co do znaku.
      "id, order_number, start_date, end_date, order_status, payment_status, total_rental_grosze, customers(full_name, email), order_items(products(name))",
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

  const rows = ((orders ?? []) as unknown as OrderRow[]).map(
    (order): OrdersTableRow => ({
      id: order.id,
      orderNumber: order.order_number,
      customerLabel: order.customers?.full_name ?? order.customers?.email ?? "—",
      equipment: order.order_items
        .map((item) => item.products?.name)
        .filter((name): name is string => Boolean(name)),
      startDate: order.start_date,
      endDate: order.end_date,
      orderStatus: order.order_status,
      paymentStatus: order.payment_status,
      totalRentalGrosze: order.total_rental_grosze,
    }),
  );

  // Pusty stan z artefaktu należy się tenantowi BEZ zamówień. Pusty wynik
  // filtrów to co innego — tam zaproszenie „dodaj pierwsze" byłoby kłamstwem,
  // więc zostaje komunikat o filtrach.
  const filtered = Boolean(filter.status || filter.od || filter.do || filter.klient);

  return (
    <div className="flex flex-col gap-4">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl leading-[30px] font-semibold tracking-[-0.02em]">{t("title")}</h2>
        <Button asChild>
          <Link href="/zamowienia/nowe">{t("newOrder")}</Link>
        </Button>
      </header>

      {/* Tenant bez ANI JEDNEGO zamówienia nie dostaje filtrów: nie ma czego
          filtrować, a pasek kontrolek nad pustym ekranem to sam szum. */}
      {rows.length > 0 || filtered ? (
        <OrdersFilters filter={filter} customers={customers ?? []} />
      ) : null}

      {rows.length === 0 ? (
        filtered ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <OrdersEmptyState />
        )
      ) : (
        <OrdersTable rows={rows} currency={currency} locale={locale} />
      )}
    </div>
  );
}
