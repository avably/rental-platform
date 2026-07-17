import {
  AVAILABILITY_BLOCKING_ORDER_STATUSES,
  DELIVERY_PRICING_KEY,
  deliveryPricingFromSettings,
  type DeliveryPricing,
  type IsoDate,
  type TenantSettingRow,
} from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { buildDayMap, type ProductPricingRow } from "../pricing";
import { createOrderAction } from "../actions";
import {
  OrderWizard,
  type WizardBooked,
  type WizardCustomer,
  type WizardProduct,
  type WizardUnit,
} from "./order-wizard";

/** Zakres kalendarza dostępności: od dziś, ~3 miesiące w przód. */
const CALENDAR_DAYS = 90;

interface ProductRow extends ProductPricingRow {
  name: string;
  product_units: { id: string; unavailable_from: string | null; unavailable_to: string | null }[];
}

interface BookedRow {
  unit_id: string;
  orders: { start_date: string; end_date: string };
}

export default async function NewOrderPage() {
  const ctx = await requireMemberPage("/zamowienia/nowe");

  const [
    { data: customers },
    { data: products },
    { data: locations },
    { data: bookedRows },
    { data: settingsRows },
  ] = await Promise.all([
      ctx.supabase
        .from("customers")
        .select("id, email, full_name")
        .eq("tenant_id", ctx.tenantId)
        .order("email"),
      ctx.supabase
        .from("products")
        .select(
          "id, name, base_price_day_grosze, deposit_grosze, auto_increment_multiplier, buffer_before_days, buffer_after_days, pricing_tiers(tier_days, multiplier), product_units(id, unavailable_from, unavailable_to)",
        )
        .eq("tenant_id", ctx.tenantId)
        .eq("active", true)
        .order("name")
        .order("created_at", { referencedTable: "product_units", ascending: true }),
      ctx.supabase
        .from("pickup_locations")
        .select("id, name")
        .eq("tenant_id", ctx.tenantId)
        .eq("active", true)
        .order("name"),
      // Zajęte terminy: pozycje z przypisanym egzemplarzem na zamówieniach
      // w statusach blokujących — warstwa wywołująca silnika filtruje po
      // statusie (komentarz w availability.ts); jedno źródło prawdy o liście
      // statusów: AVAILABILITY_BLOCKING_ORDER_STATUSES.
      ctx.supabase
        .from("order_items")
        .select("unit_id, orders!inner(start_date, end_date, order_status)")
        .eq("tenant_id", ctx.tenantId)
        .not("unit_id", "is", null)
        .in("orders.order_status", [...AVAILABILITY_BLOCKING_ORDER_STATUSES]),
      // Cennik dostaw do PODGLĄDU kosztu w kreatorze (ADR-030). Autorytatywny
      // koszt liczy akcja serwerowa — tu chodzi o informację na żywo.
      ctx.supabase
        .from("tenant_settings")
        .select("key, value")
        .eq("tenant_id", ctx.tenantId)
        .eq("key", DELIVERY_PRICING_KEY),
    ]);

  // Wadliwy cennik (nie powinien wystąpić — CHECK 0013 pilnuje kształtu) nie
  // może wywrócić strony tworzenia zamówienia: spada na brak podglądu kosztu,
  // a realny błąd i tak wyjdzie przy tworzeniu (akcja liczy autorytatywnie).
  let deliveryPricing: DeliveryPricing | null = null;
  try {
    deliveryPricing = deliveryPricingFromSettings((settingsRows ?? []) as TenantSettingRow[]);
  } catch {
    deliveryPricing = null;
  }

  // „Dziś" w UTC — spójnie z IsoDate silnika (doby bez strefy). To odczyt
  // zegara, nie arytmetyka dat: całą arytmetykę robi buildDayMap silnikiem.
  const today = new Date().toISOString().slice(0, 10) as IsoDate;

  const bookedByUnit = new Map<string, WizardBooked[]>();
  for (const row of (bookedRows ?? []) as unknown as BookedRow[]) {
    const list = bookedByUnit.get(row.unit_id) ?? [];
    list.push({
      unitId: row.unit_id,
      startDate: row.orders.start_date,
      endDate: row.orders.end_date,
    });
    bookedByUnit.set(row.unit_id, list);
  }

  const wizardProducts: WizardProduct[] = ((products ?? []) as unknown as ProductRow[]).map(
    (product) => {
      const units: WizardUnit[] = product.product_units.map((unit) => ({
        unitId: unit.id,
        unavailableFrom: unit.unavailable_from,
        unavailableTo: unit.unavailable_to,
      }));
      const booked: WizardBooked[] = units.flatMap((unit) => bookedByUnit.get(unit.unitId) ?? []);
      const params = {
        bufferBeforeDays: product.buffer_before_days,
        bufferAfterDays: product.buffer_after_days,
      };
      return {
        pricing: {
          id: product.id,
          base_price_day_grosze: product.base_price_day_grosze,
          deposit_grosze: product.deposit_grosze,
          auto_increment_multiplier: product.auto_increment_multiplier,
          buffer_before_days: product.buffer_before_days,
          buffer_after_days: product.buffer_after_days,
          pricing_tiers: product.pricing_tiers,
        },
        name: product.name,
        units,
        booked,
        dayMap: buildDayMap(units, booked, params, today, CALENDAR_DAYS),
      };
    },
  );

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("orders.form");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Link className="text-sm underline" href="/zamowienia">
          {t("backToList")}
        </Link>
      </header>

      {wizardProducts.length === 0 ? (
        <p className="text-sm text-gray-600">{t("noProducts")}</p>
      ) : (
        <OrderWizard
          action={createOrderAction}
          customers={(customers ?? []) as WizardCustomer[]}
          products={wizardProducts}
          locations={locations ?? []}
          currency={currency}
          locale={locale}
          deliveryPricing={deliveryPricing}
        />
      )}
    </main>
  );
}
