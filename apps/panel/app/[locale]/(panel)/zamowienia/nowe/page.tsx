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
import { loadPanelCustomFields } from "@/lib/custom-fields";
import { requireMemberPage } from "@/lib/member-page";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { buildDayMap, type ProductPricingRow } from "../pricing";
import { createOrderAction } from "../actions";
import { OrderWizard } from "./order-wizard";
import type {
  WizardBooked,
  WizardCustomer,
  WizardProduct,
  WizardUnit,
} from "./wizard-data";

/** Zakres kalendarza dostępności: od dziś, ~3 miesiące w przód. */
const CALENDAR_DAYS = 90;

/**
 * Ile klientów wczytujemy do wyszukiwarki kreatora (R3).
 *
 * Wyszukiwarka filtruje NAD WCZYTANĄ STRONĄ — wzorzec listy klientów (R6a)
 * i listy zamówień. Odczyt bez limitu ciągnąłby całą kartotekę tenanta do
 * każdego renderu ekranu tworzenia zamówienia. „+1" jest sondą: gdy wróci
 * o wiersz więcej, niż mieści strona, ekran WIE, że zbiór jest ucięty,
 * i mówi to operatorowi zamiast po cichu nie znaleźć klienta.
 */
const CUSTOMER_SUGGESTION_LIMIT = 200;

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
  const customFields = await loadPanelCustomFields(ctx.supabase, ctx.tenantId!, "order");

  const [
    { data: customers },
    { data: products },
    { data: locations },
    { data: bookedRows },
    { data: settingsRows },
    { data: paymentAccounts },
  ] = await Promise.all([
      ctx.supabase
        .from("customers")
        .select("id, email, full_name, phone, address_street, address_zip, address_city")
        .eq("tenant_id", ctx.tenantId)
        .order("email")
        .limit(CUSTOMER_SUGGESTION_LIMIT + 1),
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
      // ISTNIENIE konta rozliczeniowego — bramka wyboru płatności online
      // (ta sama, którą egzekwuje app.create_order). To NIE jest ocena
      // gotowości konta: tę wolno stwierdzić wyłącznie odczytem u dostawcy
      // (ADR-049), więc `charges_enabled` świadomie tu nie występuje.
      ctx.supabase
        .from("payment_accounts")
        .select("tenant_id")
        .eq("tenant_id", ctx.tenantId)
        .limit(1),
    ]);

  // Wadliwy cennik (nie powinien wystąpić — CHECK 0013 pilnuje kształtu) nie
  // może wywrócić strony tworzenia zamówienia: spada na brak podglądu kosztu,
  // a realny błąd i tak wyjdzie przy tworzeniu (akcja liczy autorytatywnie).
  let deliveryPricing: DeliveryPricing | null;
  try {
    deliveryPricing = deliveryPricingFromSettings((settingsRows ?? []) as TenantSettingRow[]);
  } catch {
    deliveryPricing = null;
  }

  const customerRows = (customers ?? []) as WizardCustomer[];
  const customersTruncated = customerRows.length > CUSTOMER_SUGGESTION_LIMIT;

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
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-end gap-3">
        <Link className="text-sm underline" href="/zamowienia">
          {t("backToList")}
        </Link>
      </header>

      {wizardProducts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noProducts")}</p>
      ) : (
        <OrderWizard
          action={createOrderAction}
          customers={customerRows.slice(0, CUSTOMER_SUGGESTION_LIMIT)}
          customersTruncated={customersTruncated}
          products={wizardProducts}
          locations={locations ?? []}
          currency={currency}
          locale={locale}
          deliveryPricing={deliveryPricing}
          paymentAccountConnected={(paymentAccounts ?? []).length > 0}
          customFields={customFields}
        />
      )}
    </div>
  );
}
