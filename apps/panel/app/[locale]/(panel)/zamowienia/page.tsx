import { Button } from "@avably/ui";
import {
  CLOSING_OBLIGATION_PAYMENT_STATUSES,
  CLOSING_OPEN_ORDER_STATUSES,
  type OrderStatus,
  type PaymentStatus,
} from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import {
  depositTotals,
  type DepositEventRow,
} from "@/app/[locale]/(panel)/zamowienia/[id]/deposit";
import { requireMemberPage } from "@/lib/member-page";
import { ordersFilterSchema } from "@/lib/order-validation";
import { getTenantCurrency, orderCurrencyCode } from "@/lib/tenant-currency";
import { datePresetRange } from "@/lib/orders/date-presets";
import { DAY_PICKUP_ORDER_STATUSES } from "@/lib/orders/day-filters";
import { addIsoDays, warsawToday } from "@/lib/orders/order-dates";
import { computeOrderStats, type OrderStatRow } from "@/lib/orders/order-stats";
import { filterBySearch, type OrderSearchable } from "@/lib/orders/order-search";
import { ORDER_SORT_COLUMNS, resolveOrderSort } from "@/lib/orders/order-sort";

import { archiveOrderAction, restoreOrderAction } from "./actions";
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
  // Opt-in okna domykania (ADR-138): lista jest HUBEM domykania — w trybie
  // `ctx.closing` zawężona do zamrożonego zbioru, bez statystyk i bez
  // tworzenia nowych zamówień.
  const ctx = await requireMemberPage("/zamowienia", { closing: true });
  const closing = ctx.closing;

  const params = await searchParams;
  // Widok archiwum (ADR-242): aktywne (domyślnie) vs zarchiwizowane. W OKNIE
  // DOMYKANIA (ADR-138) archiwum jest wyłączone — okno operuje zamrożonym
  // zbiorem aktywnych zobowiązań, więc `archiwum` ignorujemy i zostajemy przy
  // aktywnych (archived_at is null, predykat niżej).
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
    dzien: single(params.dzien),
    archiwum: single(params.archiwum),
  });

  // Archiwum niedostępne w oknie domykania (patrz wyżej).
  const archived = !closing && filter.archiwum === "1";

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
  // W OKNIE DOMYKANIA statystyk nie ma (spec Zasady 8: „bez statystyk") —
  // zapytanie o kafle w ogóle nie wychodzi.
  const [{ data: statOrders }, tableResult, { data: customers }] = await Promise.all([
    closing
      ? Promise.resolve({ data: [] as never[] })
      : // `archived_at` dochodzi (ADR-242): kafle liczą się z AKTYWNYCH (filtr
        // niżej), a obecność zarchiwizowanych mówi, czy pokazać przełącznik
        // archiwum nawet gdy aktywnych już nie ma.
        ctx.supabase
          .from("orders")
          .select("start_date, order_status, payment_status, total_rental_grosze, archived_at")
          .eq("tenant_id", ctx.tenantId),
    (() => {
      let query = ctx.supabase
        .from("orders")
        .select(
          "id, order_number, start_date, end_date, order_status, payment_status, total_rental_grosze, currency, customers(full_name, email), order_items(products(name))",
        )
        .eq("tenant_id", ctx.tenantId);
      // OŚ ARCHIWUM (ADR-242): domyślnie tylko AKTYWNE (archived_at is null);
      // widok archiwum pokazuje WYŁĄCZNIE zarchiwizowane. Okno domykania nigdy
      // nie pokazuje archiwum — zamrożony zbiór to aktywne zobowiązania.
      if (archived) {
        query = query.not("archived_at", "is", null);
      } else {
        query = query.is("archived_at", null);
      }
      // ZAMROŻONY ZBIÓR (ADR-138): trzy warunki predykatu schodzą do bazy;
      // czwarty (saldo kaucji przy `returned`) dofiltrowuje się niżej,
      // po odczycie rejestru — baza nie trzyma salda w kolumnie.
      if (closing) {
        query = query
          .lt("created_at", ctx.suspendedAt!)
          .in("payment_status", [...CLOSING_OBLIGATION_PAYMENT_STATUSES])
          .in("order_status", [...CLOSING_OPEN_ORDER_STATUSES, "returned"]);
      }
      if (filter.status) query = query.eq("order_status", filter.status);
      if (filter.klient) query = query.eq("customer_id", filter.klient);
      // Filtr terminu to NACHODZENIE zakresów inclusive (konwencja 0007):
      // start <= do AND end >= od.
      if (range.od) query = query.gte("end_date", range.od);
      if (range.do) query = query.lte("start_date", range.do);
      // Filtr dnia (UX1, ADR-140): definicje zbiorów są LUSTREM gałęzi
      // app.dashboard_day (0069) — licznik kafla „Zobacz wszystkie (N)"
      // i wynik tej listy muszą się zgadzać. `alarmy` ma czwarty warunek
      // (saldo kaucji przy `returned`) doliczany z rejestru po odczycie,
      // tym samym zabiegiem co zamrożony zbiór okna domykania.
      switch (filter.dzien) {
        case "wydania-dzis":
          query = query
            .eq("start_date", today)
            .in("order_status", [...DAY_PICKUP_ORDER_STATUSES]);
          break;
        case "zwroty-dzis":
          query = query.eq("end_date", today).eq("order_status", "picked_up");
          break;
        case "po-terminie":
          query = query.lt("end_date", today).eq("order_status", "picked_up");
          break;
        case "jutro":
          query = query
            .eq("start_date", addIsoDays(today, 1))
            .in("order_status", [...DAY_PICKUP_ORDER_STATUSES]);
          break;
        case "alarmy":
          query = query.or(
            "and(payment_status.eq.payment_failed,order_status.neq.cancelled),order_status.eq.returned",
          );
          break;
        case undefined:
          break;
      }
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

  // Kafle liczą się z AKTYWNYCH (ADR-242): zarchiwizowane NIE zasilają
  // statystyk operacyjnych. `archivedCount` (z tego samego odczytu) mówi, ile
  // jest zarchiwizowanych — dla etykiety przełącznika i dla decyzji, czy w
  // ogóle pokazać belkę, gdy aktywnych już nie ma.
  const allStatOrders = (statOrders ?? []) as {
    start_date: string;
    order_status: OrderStatus;
    payment_status: PaymentStatus;
    total_rental_grosze: number;
    archived_at: string | null;
  }[];
  const archivedCount = allStatOrders.filter((order) => order.archived_at !== null).length;
  const statRows: OrderStatRow[] = allStatOrders
    .filter((order) => order.archived_at === null)
    .map((order) => ({
      startDate: order.start_date,
      orderStatus: order.order_status,
      paymentStatus: order.payment_status,
      totalRentalGrosze: order.total_rental_grosze,
    }));
  const stats = computeOrderStats(statRows, today);

  let orders = (tableResult.data ?? []) as unknown as OrderRow[];

  // Czwarty warunek zamrożonego zbioru: `returned` zostaje WYŁĄCZNIE
  // z niezerowym saldem kaucji (klient czeka na zwrot). Jeden odczyt
  // rejestru dla kandydatów, salda liczone tym samym silnikiem co ekran
  // kaucji (depositTotals).
  if (closing) {
    const returnedIds = orders
      .filter((order) => order.order_status === "returned")
      .map((order) => order.id);
    if (returnedIds.length > 0) {
      const { data: eventRows } = await ctx.supabase
        .from("deposit_events")
        .select("order_id, kind, amount_grosze")
        .eq("tenant_id", ctx.tenantId)
        .in("order_id", returnedIds);
      const eventsByOrder = new Map<string, Pick<DepositEventRow, "kind" | "amount_grosze">[]>();
      for (const row of (eventRows ?? []) as {
        order_id: string;
        kind: DepositEventRow["kind"];
        amount_grosze: number;
      }[]) {
        const list = eventsByOrder.get(row.order_id) ?? [];
        list.push({ kind: row.kind, amount_grosze: row.amount_grosze });
        eventsByOrder.set(row.order_id, list);
      }
      orders = orders.filter(
        (order) =>
          order.order_status !== "returned" ||
          depositTotals(eventsByOrder.get(order.id) ?? []).balanceGrosze !== 0,
      );
    }
  }

  // Czwarty warunek filtra `dzien=alarmy` (lustro gałęzi kaucyjnej 0069):
  // `returned` zostaje WYŁĄCZNIE z otwartym saldem kaucji; zamówienia
  // payment_failed zostają niezależnie od salda (to ich gałąź licznika).
  // Ten sam zabieg co przy zamrożonym zbiorze okna domykania — saldo liczy
  // depositTotals z rejestru, bo baza nie trzyma go w kolumnie.
  if (!closing && filter.dzien === "alarmy") {
    const returnedIds = orders
      .filter(
        (order) =>
          order.order_status === "returned" && order.payment_status !== "payment_failed",
      )
      .map((order) => order.id);
    if (returnedIds.length > 0) {
      const { data: eventRows } = await ctx.supabase
        .from("deposit_events")
        .select("order_id, kind, amount_grosze")
        .eq("tenant_id", ctx.tenantId)
        .in("order_id", returnedIds);
      const eventsByOrder = new Map<string, Pick<DepositEventRow, "kind" | "amount_grosze">[]>();
      for (const row of (eventRows ?? []) as {
        order_id: string;
        kind: DepositEventRow["kind"];
        amount_grosze: number;
      }[]) {
        const list = eventsByOrder.get(row.order_id) ?? [];
        list.push({ kind: row.kind, amount_grosze: row.amount_grosze });
        eventsByOrder.set(row.order_id, list);
      }
      orders = orders.filter(
        (order) =>
          order.order_status !== "returned" ||
          order.payment_status === "payment_failed" ||
          depositTotals(eventsByOrder.get(order.id) ?? []).balanceGrosze > 0,
      );
    }
  }

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
    dzien: filter.dzien,
    sort: filter.sort,
    dir: filter.dir,
    // Widok archiwum przenosi się przez sortowanie i inne linki (ADR-242).
    archiwum: archived ? "1" : undefined,
  };

  // W oknie domykania kafli nie ma, więc „czy są zamówienia" mówi zamrożony
  // zbiór — a pusty zbiór NIE pokazuje zaproszenia do tworzenia (tworzenie
  // jest OFF), tylko komunikat okna. Wyjścia po pustym zbiorze NIE MA —
  // okno kończy wyłącznie zegar (spec (d): perwersyjny bodziec).
  //
  // Poza oknem: belka (z przełącznikiem archiwum) należy się każdemu, kto ma
  // JAKIEKOLWIEK zamówienia — także gdy wszystkie są zarchiwizowane, inaczej
  // droga do archiwum znikałaby razem z ostatnim aktywnym (ADR-242). Dopiero
  // brak zamówień W OGÓLE pokazuje zaproszenie do utworzenia pierwszego.
  const hasAnyOrders = closing ? orders.length > 0 : allStatOrders.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Tytuł „Zamówienia" należy do belki (ADR-060: topbar jest jedynym
          właścicielem widocznego tytułu), więc tu zostaje sam PODTYTUŁ jako
          copy kontekstowe i akcja „Nowe zamówienie" (w oknie domykania —
          bez akcji: nowe zamówienie to nowe zobowiązanie, nie domykanie). */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {closing ? t("closingSubtitle") : archived ? t("archivedSubtitle") : t("subtitle")}
        </p>
        {closing ? null : (
          <Button asChild>
            <Link href="/zamowienia/nowe">{t("newOrder")}</Link>
          </Button>
        )}
      </header>

      {/* Tenant BEZ ani jednego zamówienia dostaje zaproszenie, nie kafle zer
          i pustą belkę filtrów — nie ma czego liczyć ani filtrować. */}
      {hasAnyOrders ? (
        <>
          {/* Kafle statystyk TYLKO w widoku aktywnych: w archiwum opisywałyby
              stan operacyjny, którego archiwum nie dotyczy (ADR-242). */}
          {closing || archived ? null : (
            <OrdersStats stats={stats} currency={currency} locale={locale} />
          )}
          <OrdersToolbar
            filter={filter}
            customers={customers ?? []}
            resultCount={visibleRows.length}
            archived={archived}
            archivedCount={archivedCount}
            showArchiveToggle={!closing}
          />
          {visibleRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {archived ? t("archivedEmpty") : t("empty")}
            </p>
          ) : (
            /* Lista jest interaktywna od U4/U5 (zaznaczanie, wybór kolumn),
               więc opakowuje ją klient — sam odczyt i filtrowanie zostają na
               serwerze. W oknie domykania archiwizacja jest OFF, więc akcje
               wiersza nie schodzą (ADR-242). */
            <OrdersList
              rows={visibleRows}
              locale={locale}
              sort={sort}
              baseParams={baseParams}
              archiveControls={
                closing
                  ? undefined
                  : { archived, archiveAction: archiveOrderAction, restoreAction: restoreOrderAction }
              }
            />
          )}
        </>
      ) : closing ? (
        <p className="text-muted-foreground text-sm">{t("closingEmpty")}</p>
      ) : (
        <OrdersEmptyState />
      )}
    </div>
  );
}
