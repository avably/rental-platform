import { formatMoney } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { saveTiersAction } from "./actions";
import { TiersEditor } from "./tiers-editor";

export default async function ProductTiersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireMemberPage(`/katalog/${id}/progi`);

  const { data: product } = await ctx.supabase
    .from("products")
    .select("id, name, base_price_day_grosze, deposit_grosze, auto_increment_multiplier")
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
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href={`/katalog/${product.id}`}>
        {t("backToProduct", { name: product.name })}
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("title", { name: product.name })}</h1>
        <p className="text-sm text-gray-600">
          {t("basePriceInfo", {
            price: formatMoney(product.base_price_day_grosze, currency, locale),
          })}
        </p>
        <p className="text-sm text-gray-600">{t("billingModelInfo")}</p>
      </header>

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
    </main>
  );
}
