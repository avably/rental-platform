import { getTranslations } from "next-intl/server";

import { ScreenHeader } from "@/components/screens/screen-header";
import { fetchCategories } from "@/lib/catalog/categories";
import { loadPanelCustomFields } from "@/lib/custom-fields";
import { requireMemberPage } from "@/lib/member-page";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { createProductAction } from "../actions";
import { ProductForm } from "../product-form";

export default async function NewProductPage() {
  const ctx = await requireMemberPage("/katalog/nowy");
  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const customFields = await loadPanelCustomFields(ctx.supabase, ctx.tenantId!, "product");
  const categories = await fetchCategories(ctx.supabase, ctx.tenantId!);
  const t = await getTranslations("catalog.productForm");
  // Etykieta powrotu żyje w `catalog.record` (wspólna z kartą produktu) —
  // wołanie jej spod `catalog.productForm` renderowało SUROWY klucz
  // `catalog.productForm.backToList` zamiast tłumaczenia (M-I18N-01, audyt
  // 17.08; next-intl przy braku klucza zwraca pełną ścieżkę jako tekst).
  // Pilnuje raw-i18n-key-contract.
  const tRecord = await getTranslations("catalog.record");

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        back={{ href: "/katalog", label: tRecord("backToList") }}
        title={t("createTitle")}
      />
      <ProductForm
        action={createProductAction}
        categories={categories}
        currencyCode={currency}
        customFields={customFields}
        defaults={{
          name: "",
          // Adres pusty = „nadaj z nazwy" (ADR-182). Podpowiadanie go tutaj
          // byłoby drugą regułą obok tej, którą i tak wykona baza.
          slug: "",
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
