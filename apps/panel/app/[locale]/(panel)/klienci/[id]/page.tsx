import { type OrderStatus } from "@avably/core";
import { Badge } from "@avably/ui";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { uuidSchema } from "@/lib/order-validation";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { setCustomerBanAction, updateCustomerAction } from "./actions";
import { CustomerBanToggle } from "./customer-ban-toggle";
import { CustomerEditForm } from "./customer-edit-form";
import { CustomerOrders, type CustomerOrderRow } from "./customer-orders";

/**
 * Karta klienta (R6a).
 *
 * Server component: czyta klienta i jego zamówienia pod RLS tenanta, renderuje
 * formularz edycji (kontakt + faktura + adres) i skróconą historię zamówień
 * z wierszami-linkami do szczegółów. Zapis idzie przez `updateCustomerAction`
 * (RLS + Zod). Wejście z listy oraz z karty „Profil klienta" w szczególe
 * zamówienia (link „Karta klienta").
 */

/** Skrócona historia: tyle najświeższych zamówień pokazujemy na karcie. */
const HISTORY_LIMIT = 50;

interface CustomerDetailRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  company_name: string | null;
  nip: string | null;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  created_at: string;
}

interface OrderHistoryRow {
  id: string;
  order_number: string;
  start_date: string;
  end_date: string;
  total_rental_grosze: number;
  order_status: OrderStatus;
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireMemberPage(`/klienci/${id}`);

  if (!uuidSchema.safeParse(id).success) notFound();

  const { data: customer } = await ctx.supabase
    .from("customers")
    .select(
      "id, email, full_name, phone, company_name, nip, address_street, address_zip, address_city, created_at",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!customer) notFound();

  const row = customer as CustomerDetailRow;

  const { data: orderData } = await ctx.supabase
    .from("orders")
    .select("id, order_number, start_date, end_date, total_rental_grosze, order_status")
    .eq("tenant_id", ctx.tenantId)
    .eq("customer_id", id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  // Stan bansu (R6b): istnieje wiersz customer_bans dla tego klienta = zbanowany.
  // Odczyt pod RLS tenanta (0040) — jedno lekkie zapytanie po kluczu.
  const { data: ban } = await ctx.supabase
    .from("customer_bans")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("customer_id", id)
    .maybeSingle();
  const banned = ban != null;

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("customers.card");

  const orders: CustomerOrderRow[] = ((orderData ?? []) as OrderHistoryRow[]).map((order) => ({
    id: order.id,
    orderNumber: order.order_number,
    startDate: order.start_date,
    endDate: order.end_date,
    totalRentalGrosze: order.total_rental_grosze,
    orderStatus: order.order_status,
  }));

  const displayName = row.full_name?.trim() || row.email;
  const since = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(new Date(row.created_at));

  const updateAction = updateCustomerAction.bind(null, row.id);
  // Akcja ustawia stan PRZECIWNY do widzianego — intencja nie jedzie z klienta.
  const banAction = setCustomerBanAction.bind(null, row.id, !banned);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/klienci"
          data-customer-back
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm no-underline outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
        >
          <BackArrow />
          {t("backToList")}
        </Link>
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-2xl leading-[30px] font-semibold tracking-[-0.01em]">{displayName}</h2>
            {banned ? (
              <Badge data-customer-header-ban-badge variant="destructive">
                {t("ban.statusBanned")}
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground text-sm">{t("sinceLabel", { date: since })}</p>
        </div>
      </div>

      <CustomerBanToggle banned={banned} action={banAction} />

      <CustomerEditForm
        action={updateAction}
        defaults={{
          email: row.email,
          fullName: row.full_name ?? "",
          phone: row.phone ?? "",
          companyName: row.company_name ?? "",
          nip: row.nip ?? "",
          addressStreet: row.address_street ?? "",
          addressZip: row.address_zip ?? "",
          addressCity: row.address_city ?? "",
        }}
      />

      <CustomerOrders orders={orders} currency={currency} locale={locale} />
    </div>
  );
}

function BackArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10 3.5L5.5 8L10 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
