import { getTranslations } from "next-intl/server";

import { ScreenHeader } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { createProductAction } from "../actions";
import { ProductForm } from "../product-form";

export default async function NewProductPage() {
  const ctx = await requireMemberPage("/katalog/nowy");
  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const t = await getTranslations("catalog.productForm");

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader back={{ href: "/katalog", label: t("backToList") }} title={t("createTitle")} />
      <ProductForm
        action={createProductAction}
        currencyCode={currency}
        defaults={{
          name: "",
          description: "",
          basePriceDay: "",
          deposit: "",
          // Domyślne 1 = brak podwyżki ponad najwyższy próg (0007).
          autoIncrementMultiplier: "1",
          bufferBeforeDays: "1",
          bufferAfterDays: "1",
          active: true,
        }}
      />
    </div>
  );
}
