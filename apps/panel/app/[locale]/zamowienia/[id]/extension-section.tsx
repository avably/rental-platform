import { AVAILABILITY_BLOCKING_ORDER_STATUSES, type OrderStatus } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { requireMember } from "@/lib/supabase-server";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { extendOrderAction } from "./extension-actions";
import { ExtensionForm } from "./extension-form";
import { priceParamsFromRow, type ExtensionProductRow } from "./extension-pricing";

/**
 * Sekcja przedłużenia najmu (Zadanie 6). Osobny RSC z WŁASNYM odczytem
 * cennika pozycji — page.tsx dokłada tylko jedną linię (protokół
 * antykolizyjny z równoległym Zadaniem 7). Statusy terminalne nie
 * renderują sekcji: przedłużanie zwróconego/anulowanego najmu nie ma
 * sensu operacyjnego (ADR-028), a akcja i tak by odmówiła.
 */
export async function ExtensionSection({
  order,
}: {
  order: { id: string; startDate: string; endDate: string; status: OrderStatus };
}) {
  if (!AVAILABILITY_BLOCKING_ORDER_STATUSES.includes(order.status)) return null;

  const ctx = await requireMember();
  const { data: rows } = await ctx.supabase
    .from("order_items")
    .select(
      "id, products(base_price_day_grosze, deposit_grosze, auto_increment_multiplier, pricing_tiers(tier_days, multiplier))",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", order.id);

  const items = ((rows ?? []) as unknown as { id: string; products: ExtensionProductRow | null }[])
    .flatMap((row) => (row.products ? [{ itemId: row.id, params: priceParamsFromRow(row.products) }] : []));

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("orders.extension");

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("title")}</h2>
      <ExtensionForm
        orderId={order.id}
        startDate={order.startDate}
        endDate={order.endDate}
        items={items}
        currency={currency}
        locale={locale}
        action={extendOrderAction}
      />
    </section>
  );
}
