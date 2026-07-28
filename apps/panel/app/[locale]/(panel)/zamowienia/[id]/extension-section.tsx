import { type OrderStatus } from "@avably/core";
import { getLocale } from "next-intl/server";

import { requireMember } from "@/lib/supabase-server";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { extendOrderAction } from "./extension-actions";
import { ExtensionForm } from "./extension-form";
import { canExtendOrder, priceParamsFromRow, type ExtensionProductRow } from "./extension-pricing";

/**
 * Wejście w przedłużenie PRZY TERMINIE (R4). RSC z WŁASNYM odczytem cennika
 * pozycji — `page.tsx` dokłada tylko jedną linię w karcie podsumowania, tuż pod
 * terminem najmu (protokół antykolizyjny, jak przy pozycjach i logistyce).
 * Osobna sekcja przedłużenia zniknęła — to relokacja UI, mechanika bez zmian.
 */
export async function ExtensionSection({
  order,
}: {
  order: { id: string; startDate: string; endDate: string; status: OrderStatus };
}) {
  if (!canExtendOrder(order.status)) return null;

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

  return (
    // Klucz po terminie: udane przedłużenie zmienia end_date, więc po odświeżeniu
    // formularz montuje się od nowa (zwinięty, pusty wybór) — domknięcie bez
    // efektu z setState.
    <ExtensionForm
      key={order.endDate}
      orderId={order.id}
      startDate={order.startDate}
      endDate={order.endDate}
      items={items}
      currency={currency}
      locale={locale}
      action={extendOrderAction}
    />
  );
}
