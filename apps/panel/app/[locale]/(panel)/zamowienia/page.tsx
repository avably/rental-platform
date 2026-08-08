import { Button } from "@avably/ui";
import { type OrderStatus, type PaymentStatus } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { ordersFilterSchema } from "@/lib/order-validation";
import { getTenantCurrency, orderCurrencyCode } from "@/lib/tenant-currency";
import { datePresetRange } from "@/lib/orders/date-presets";
import { warsawToday } from "@/lib/orders/order-dates";
import { computeOrderStats, type OrderStatRow } from "@/lib/orders/order-stats";
import { filterBySearch, type OrderSearchable } from "@/lib/orders/order-search";
import { ORDER_SORT_COLUMNS, resolveOrderSort } from "@/lib/orders/order-sort";

import { OrdersEmptyState } from "./orders-empty-state";
import { OrdersList } from "./orders-list";
import { OrdersStats } from "./orders-stats";
import { type OrdersTableRow } from "./orders-table";
import { OrdersToolbar } from "./orders-toolbar";

interface OrderRow {
  id: string;
  order_number: string;
  start_date: string;
  end_date: string;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  total_rental_grosze: number;
  currency: string;
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
    q: single(params.q),
    sort: single(params.sort),
    dir: single(params.dir),
    preset: single(params.preset),
  });

  const today = warsawToday();
  // Preset (szybki chip) wygrywa nad surowym od/do i wyklucza się z nim: gdy
  // jest, zakres liczymy z niego; w przeciwnym razie z pól własnego zakresu.
  const range = filter.preset ? datePresetRange(filter.preset, today) : { od: filter.od, do: filter.do };

  const sort = resolveOrderSort(filter.sort, filter.dir);
  const sortColumn = ORDER_SORT_COLUMNS[sort.key];
  // „Klient" sortuje po ZŁOŻONEJ etykiecie (nazwa-albo-e-mail), której nie da
  // się czysto wyrazić w `order by` PostgREST po zagnieżdżonym zasobie —
  // sortujemy więc stronę w pamięci (spójnie z wyborem wyszukiwarki). Kolumny
  // własne `orders` idą sortem bazy: globalnie i skalowalnie.
  const sortInDb = sortColumn.foreignTable === undefined;

  // Kafle liczą się z CAŁEGO zbioru tenanta (nie ze strony ani z filtra) —
  // lekki odczyt czterech kolumn. Gdy wolumen urośnie, zastąpić agregatem SQL.
  const [{ data: statOrders }, tableResult, { data: customers }] = await Promise.all([
    ctx.supabase
      .from("orders")
      .select("start_date, order_status, payment_status, total_rental_grosze")
      .eq("tenant_id", ctx.tenantId),
    (() => {
      let query = ctx.supabase
        .from("orders")
        .select(
          "id, order_number, start_date, end_date, order_status, payment_status, total_rental_grosze, currency, customers(full_name, email), order_items(products(name))",
        )
        .eq("tenant_id", ctx.tenantId);
      if (filter.status) query = query.eq("order_status", filter.status);
      if (filter.klient) query = query.eq("customer_id", filter.klient);
      // Filtr terminu to NACHODZENIE zakresów inclusive (konwencja 0007):
      // start <= do AND end >= od.
      if (range.od) query = query.gte("end_date", range.od);
      if (range.do) query = query.lte("start_date", range.do);
      // Sort bazy dla kolumn własnych; dla „Klient" bierzemy stabilny
      // created_at desc i dosortowujemy stronę niżej.
      if (sortInDb) {
        query = query.order(sortColumn.column, { ascending: sort.dir === "asc" });
        if (sortColumn.column !== "created_at") {
          query = query.order("created_at", { ascending: false });
        }
      } else {
        query = query.order("created_at", { ascending: false });
      }
      return query.limit(100);
    })(),
    ctx.supabase
      .from("customers")
      .select("id, email, full_name")
      .eq("tenant_id", ctx.tenantId)
      .order("email"),
  ]);

  // Waluta OPERACYJNA najemcy — od 0049 służy tu WYŁĄCZNIE kaflom
  // statystyk (agregaty sumują grosze przez całą historię; suma mieszanych
  // walut nie istnieje, a rozbicie agregatów per waluta to świadomie
  // odłożona wielowalutowość operacyjna — ADR-103/§8 planu). Kwoty
  // WIERSZY mówią walutą SWOJEGO zamówienia (orders.currency).
  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("orders.list");
  const tOrderStatus = await getTranslations("orders.statusLabels.order");
  const tPaymentStatus = await getTranslations("orders.statusLabels.payment");

  const statRows: OrderStatRow[] = (
    (statOrders ?? []) as {
      start_date: string;
      order_status: OrderStatus;
      payment_status: PaymentStatus;
      total_rental_grosze: number;
    }[]
  ).map((order) => ({
    startDate: order.start_date,
    orderStatus: order.order_status,
    paymentStatus: order.payment_status,
    totalRentalGrosze: order.total_rental_grosze,
  }));
  const stats = computeOrderStats(statRows, today);

  const orders = (tableResult.data ?? []) as unknown as OrderRow[];
  const rows: OrdersTableRow[] = orders.map((order) => ({
    id: order.id,
    orderNumber: order.order_number,
    customerLabel: order.customers?.full_name ?? order.customers?.email ?? "—",
    customerName: order.customers?.full_name ?? null,
    customerEmail: order.customers?.email ?? null,
    equipment: order.order_items
      .map((item) => item.products?.name)
      .filter((name): name is string => Boolean(name)),
    startDate: order.start_date,
    endDate: order.end_date,
    orderStatus: order.order_status,
    paymentStatus: order.payment_status,
    totalRentalGrosze: order.total_rental_grosze,
    currency: orderCurrencyCode(order.currency),
  }));

  // Haystack wyszukiwarki: numer + klient + ETYKIETY statusów (tłumaczenia zna
  // tylko warstwa i18n, stąd filtr nad odczytaną stroną — patrz order-search.ts).
  const searchables: OrderSearchable[] = orders.map((order) => ({
    id: order.id,
    orderNumber: order.order_number,
    customerName: order.customers?.full_name ?? null,
    customerEmail: order.customers?.email ?? null,
    orderStatusLabel: tOrderStatus(order.order_status),
    paymentStatusLabel: tPaymentStatus(order.payment_status),
  }));

  const visibleIds = new Set(filterBySearch(searchables, filter.q ?? "").map((s) => s.id));
  let visibleRows = rows.filter((row) => visibleIds.has(row.id));
  if (!sortInDb) {
    const direction = sort.dir === "asc" ? 1 : -1;
    visibleRows = [...visibleRows].sort(
      (a, b) => a.customerLabel.localeCompare(b.customerLabel, locale) * direction,
    );
  }

  const baseParams: Record<string, string | undefined> = {
    q: filter.q,
    status: filter.status,
    od: filter.od,
    do: filter.do,
    klient: filter.klient,
    preset: filter.preset,
    sort: filter.sort,
    dir: filter.dir,
  };

  const hasAnyOrders = stats.all.count > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Tytuł „Zamówienia" należy do belki (ADR-060: topbar jest jedynym
          właścicielem widocznego tytułu), więc tu zostaje sam PODTYTUŁ jako
          copy kontekstowe i akcja „Nowe zamówienie". */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        <Button asChild>
          <Link href="/zamowienia/nowe">{t("newOrder")}</Link>
        </Button>
      </header>

      {/* Tenant BEZ ani jednego zamówienia dostaje zaproszenie, nie kafle zer
          i pustą belkę filtrów — nie ma czego liczyć ani filtrować. */}
      {hasAnyOrders ? (
        <>
          <OrdersStats stats={stats} currency={currency} locale={locale} />
          <OrdersToolbar filter={filter} customers={customers ?? []} resultCount={visibleRows.length} />
          {visibleRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("empty")}</p>
          ) : (
            /* Lista jest interaktywna od U4/U5 (zaznaczanie, wybór kolumn),
               więc opakowuje ją klient — sam odczyt i filtrowanie zostają na
               serwerze. */
            <OrdersList rows={visibleRows} locale={locale} sort={sort} baseParams={baseParams} />
          )}
        </>
      ) : (
        <OrdersEmptyState />
      )}
    </div>
  );
}
