import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ScreenSection } from "@/components/screens/screen-header";
import { fetchProductCard } from "@/lib/catalog/card-query";
import { customFieldValuesFromRow, loadPanelCustomFields } from "@/lib/custom-fields";
import { groszeToInputValue } from "@/lib/money-input";
import { requireMemberPage } from "@/lib/member-page";
import { warsawToday } from "@/lib/orders/order-dates";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { updateProductAction } from "../actions";
import { ProductForm } from "../product-form";
import { ProductHistory, ProductOverview } from "./product-overview";

/**
 * KARTA PRODUKTU — zakładka „Dane" (U8b, ADR-146).
 *
 * Ekran był dotąd samym formularzem edycji („Edycja produktu: …") z trzema
 * przyciskami do podstron w prawym górnym rogu. Nie było na nim ani zdjęcia,
 * ani dostępności, ani historii, ani przychodu — czyli ani jednej rzeczy,
 * po którą operator otwiera produkt. Teraz stan rzeczy stoi NAD formularzem,
 * a historia najmów pod nim; nawigację po rekordzie niesie pasek zakładek
 * z `layout.tsx`, więc nazwa produktu i powrót do listy nie powtarzają się
 * już na każdej podstronie.
 *
 * Odczyt żyje W CAŁOŚCI w `lib/catalog/card-query.ts` (wzorzec U8a): sonda
 * izolacji woła tę samą funkcję, którą woła ekran, więc broni produkcji,
 * a nie swojej kopii zapytania.
 *
 * „Dziś" to Europe/Warsaw, nie UTC — to pojęcie operatora stojącego za ladą,
 * a północ UTC potrafi cofnąć dzień względem jego zegara.
 */
export default async function ProductDataPage({
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

  const card = await fetchProductCard(ctx.supabase, ctx.tenantId!, product.id, {
    today: warsawToday(),
    // Baza publicznych URL-i Storage. NEXT_PUBLIC_SUPABASE_URL jest
    // wstrzykiwane build-time — zdjęcie to goły URL publiczny, bez
    // transformacji zależnej od planu hostingu (ADR-145).
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  });

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const customFields = await loadPanelCustomFields(ctx.supabase, ctx.tenantId!, "product");
  const locale = await getLocale();
  const t = await getTranslations("catalog.card");

  return (
    <div className="flex flex-col gap-6">
      <ProductOverview
        capped={card.capped}
        deployedToday={card.deployedToday}
        historyCount={card.historyCount}
        locale={locale}
        productId={product.id}
        revenue={card.revenue}
        thumbnail={card.thumbnail}
        unitCount={card.unitCount}
      />

      <ScreenSection title={t("dataHeading")} description={t("dataHint")}>
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
      </ScreenSection>

      <ProductHistory rows={card.history} locale={locale} />
    </div>
  );
}
