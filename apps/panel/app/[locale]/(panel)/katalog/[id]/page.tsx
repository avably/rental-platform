import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { groszeToInputValue } from "@/lib/money-input";
import { requireMemberPage } from "@/lib/member-page";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { updateProductAction } from "../actions";
import { ProductForm } from "../product-form";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireMemberPage(`/katalog/${id}`);

  const { data: product } = await ctx.supabase
    .from("products")
    .select(
      "id, name, description, base_price_day_grosze, deposit_grosze, auto_increment_multiplier, buffer_before_days, buffer_after_days, active",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (!product) notFound();

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const t = await getTranslations("catalog.productForm");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/katalog">
        {t("backToList")}
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("editTitle", { name: product.name })}</h1>
        <nav className="flex gap-3 text-sm">
          <Link className="underline" href={`/katalog/${product.id}/egzemplarze`}>
            {t("unitsLink")}
          </Link>
          <Link className="underline" href={`/katalog/${product.id}/progi`}>
            {t("tiersLink")}
          </Link>
          <Link className="underline" href={`/katalog/${product.id}/zdjecia`}>
            {t("imagesLink")}
          </Link>
        </nav>
      </header>
      <ProductForm
        action={updateProductAction.bind(null, product.id)}
        currencyCode={currency}
        defaults={{
          name: product.name,
          description: product.description ?? "",
          basePriceDay: groszeToInputValue(product.base_price_day_grosze),
          deposit: groszeToInputValue(product.deposit_grosze),
          autoIncrementMultiplier: String(product.auto_increment_multiplier),
          bufferBeforeDays: String(product.buffer_before_days),
          bufferAfterDays: String(product.buffer_after_days),
          active: product.active,
        }}
      />
    </main>
  );
}
