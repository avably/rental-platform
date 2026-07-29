import { getLocale, getTranslations } from "next-intl/server";

import { requireMemberPage } from "@/lib/member-page";
import { customersFilterSchema } from "@/lib/customer-validation";
import { filterCustomersBySearch } from "@/lib/customers/customer-search";
import { resolveCustomerSort, sortCustomers } from "@/lib/customers/customer-sort";

import { CustomersEmptyState } from "./customers-empty-state";
import { CustomersTable, type CustomersTableRow } from "./customers-table";
import { CustomersToolbar } from "./customers-toolbar";

/**
 * Lista klientów (R6a).
 *
 * Ekran jest server componentem: czyta bazę pod RLS tenanta, filtruje po
 * wyszukiwaniu i sortuje. Klientów nie da się tu zaznaczać ani masowo
 * przetwarzać (to nie zamówienia), więc — inaczej niż lista zamówień — nie
 * potrzebuje warstwy klienta: cała interaktywność (szukanie, sort) żyje w URL.
 *
 * LICZBA ZAMÓWIEŃ i OSTATNIE ZAMÓWIENIE są WYLICZANE z lekkiego odczytu dwóch
 * kolumn `orders` (customer_id, created_at) całego tenanta — spójnie z tym, jak
 * lista zamówień liczy kafle z całego zbioru. Gdy wolumen urośnie, zastąpić
 * agregatem SQL/widokiem.
 */

/**
 * Twardy limit odczytu strony. Wyszukiwarka i sort działają NAD tą stroną
 * (w pamięci), więc limit jest jawny: czytamy o jeden wiersz więcej niż
 * pokazujemy, żeby wiedzieć, czy zbiór został przycięty, i powiedzieć to
 * wprost (belka „pokazujemy pierwszych N”), zamiast po cichu gubić klientów.
 */
const CUSTOMERS_PAGE_LIMIT = 100;

interface CustomerRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireMemberPage("/klienci");

  const params = await searchParams;
  const single = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : undefined;
  // Błędny filtr jest ignorowany (catch → undefined), nie błędem strony.
  const filter = customersFilterSchema.parse({
    q: single(params.q),
    sort: single(params.sort),
    dir: single(params.dir),
  });

  const [{ data: customerData }, { data: orderData }, { data: banData }] = await Promise.all([
    ctx.supabase
      .from("customers")
      .select("id, email, full_name, phone")
      .eq("tenant_id", ctx.tenantId)
      // Baza stabilnego cięcia strony: alfabetycznie po e-mailu (zawsze
      // obecny). Ostateczny porządek nadaje sort w pamięci niżej.
      .order("email")
      .limit(CUSTOMERS_PAGE_LIMIT + 1),
    ctx.supabase
      .from("orders")
      .select("customer_id, created_at")
      .eq("tenant_id", ctx.tenantId),
    // Zbanowani klienci (R6b): sam customer_id wystarcza do badge'a na liście.
    ctx.supabase
      .from("customer_bans")
      .select("customer_id")
      .eq("tenant_id", ctx.tenantId),
  ]);

  const bannedIds = new Set(
    ((banData ?? []) as { customer_id: string }[]).map((b) => b.customer_id),
  );

  const allCustomers = (customerData ?? []) as CustomerRow[];
  const hasAnyCustomers = allCustomers.length > 0;
  const capped = allCustomers.length > CUSTOMERS_PAGE_LIMIT;
  const customers = capped ? allCustomers.slice(0, CUSTOMERS_PAGE_LIMIT) : allCustomers;

  // Agregat zamówień per klient: liczba + najświeższe created_at.
  const aggregate = new Map<string, { count: number; lastOrderAt: string | null }>();
  for (const order of (orderData ?? []) as { customer_id: string; created_at: string }[]) {
    const current = aggregate.get(order.customer_id) ?? { count: 0, lastOrderAt: null };
    current.count += 1;
    if (current.lastOrderAt === null || order.created_at > current.lastOrderAt) {
      current.lastOrderAt = order.created_at;
    }
    aggregate.set(order.customer_id, current);
  }

  const locale = await getLocale();
  const t = await getTranslations("customers.list");

  const rows: CustomersTableRow[] = customers.map((customer) => {
    const agg = aggregate.get(customer.id);
    return {
      id: customer.id,
      customerLabel: customer.full_name?.trim() || customer.email,
      fullName: customer.full_name,
      email: customer.email,
      phone: customer.phone,
      orderCount: agg?.count ?? 0,
      lastOrderAt: agg?.lastOrderAt ?? null,
      banned: bannedIds.has(customer.id),
    };
  });

  const searched = filterCustomersBySearch(rows, filter.q ?? "");
  const sort = resolveCustomerSort(filter.sort, filter.dir);
  const visibleRows = sortCustomers(searched, sort, locale);

  const baseParams: Record<string, string | undefined> = {
    q: filter.q,
    sort: filter.sort,
    dir: filter.dir,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Tytuł „Klienci" należy do belki (ADR-060) — tu zostaje sam PODTYTUŁ. */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>

      {hasAnyCustomers ? (
        <>
          <CustomersToolbar filter={filter} resultCount={visibleRows.length} />
          {capped ? (
            <p className="text-muted-foreground text-sm" data-customers-cap>
              {t("cap", { count: CUSTOMERS_PAGE_LIMIT })}
            </p>
          ) : null}
          {visibleRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("empty")}</p>
          ) : (
            <CustomersTable rows={visibleRows} locale={locale} sort={sort} baseParams={baseParams} />
          )}
        </>
      ) : (
        <CustomersEmptyState />
      )}
    </div>
  );
}
