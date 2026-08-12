import { formatMoney } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ScreenSection } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { saveTiersAction } from "./actions";
import { TiersEditor } from "./tiers-editor";

/**
 * Zakładka „Progi cenowe" karty produktu.
 *
 * Powrót do produktu i nazwa rekordu przeniosły się do `../layout.tsx` (U8b,
 * ADR-146) — powtarzanie ich na każdej podstronie sprawiało, że cztery widoki
 * jednego rekordu wyglądały na cztery osobne ekrany.
 */
export default async function ProductTiersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireMemberPage(`/katalog/${id}/progi`);

  const { data: product } = await ctx.supabase
    .from("products")
    .select("id, base_price_day_grosze, deposit_grosze, auto_increment_multiplier")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (!product) notFound();

  const { data: tiers } = await ctx.supabase
    .from("pricing_tiers")
    .select("id, tier_days, multiplier, label, sort_order")
    .eq("tenant_id", ctx.tenantId)
    .eq("product_id", id)
    .order("tier_days", { ascending: true });

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("catalog.tiers");

  return (
    <ScreenSection title={t("heading")}>
      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground text-sm">
          {t("basePriceInfo", {
            price: formatMoney(product.base_price_day_grosze, currency, locale),
          })}
        </p>
        <p className="text-muted-foreground text-sm">{t("billingModelInfo")}</p>
      </div>

      <TiersEditor
        action={saveTiersAction.bind(null, product.id)}
        currency={currency}
        pricing={{
          basePriceDayGrosze: product.base_price_day_grosze,
          depositGrosze: product.deposit_grosze,
          autoIncrementMultiplier: Number(product.auto_increment_multiplier),
        }}
        initialRows={(tiers ?? []).map((tier) => ({
          tierDays: String(tier.tier_days),
          multiplier: String(tier.multiplier),
          label: tier.label ?? "",
          sortOrder: String(tier.sort_order),
        }))}
      />
    </ScreenSection>
  );
}
