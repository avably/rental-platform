import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Button } from "@avably/ui";

import { ScreenHeader } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import { customFieldValuesFromRow, loadPanelCustomFields } from "@/lib/custom-fields";
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
      "id, name, description, base_price_day_grosze, deposit_grosze, auto_increment_multiplier, buffer_before_days, buffer_after_days, active, custom_fields",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (!product) notFound();

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const customFields = await loadPanelCustomFields(ctx.supabase, ctx.tenantId!, "product");
  const t = await getTranslations("catalog.productForm");

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        back={{ href: "/katalog", label: t("backToList") }}
        title={t("editTitle", { name: product.name })}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={`/katalog/${product.id}/egzemplarze`}>{t("unitsLink")}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={`/katalog/${product.id}/progi`}>{t("tiersLink")}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={`/katalog/${product.id}/zdjecia`}>{t("imagesLink")}</Link>
            </Button>
          </>
        }
      />
      <ProductForm
        action={updateProductAction.bind(null, product.id)}
        currencyCode={currency}
        customFields={customFields}
        customFieldValues={customFieldValuesFromRow(product)}
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
    </div>
  );
}
