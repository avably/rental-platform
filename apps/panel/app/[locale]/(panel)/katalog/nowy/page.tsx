import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { createProductAction } from "../actions";
import { ProductForm } from "../product-form";

export default async function NewProductPage() {
  const ctx = await requireMemberPage("/katalog/nowy");
  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const t = await getTranslations("catalog.productForm");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/katalog">
        {t("backToList")}
      </Link>
      <h1 className="text-xl font-semibold">{t("createTitle")}</h1>
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
    </main>
  );
}
