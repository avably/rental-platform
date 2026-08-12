import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ScreenSection } from "@/components/screens/screen-header";
import { fetchProductUnits } from "@/lib/catalog/card-query";
import { deploymentCellProps } from "@/lib/catalog/deployed-today";
import { requireMemberPage } from "@/lib/member-page";
import { warsawToday } from "@/lib/orders/order-dates";

import { saveUnitsAction } from "./actions";
import { UnitsEditor } from "./units-editor";

/**
 * Zakładka „Egzemplarze" karty produktu (U8b, ADR-146).
 *
 * Powrót do produktu i nazwa rekordu niesie `../layout.tsx` — tu zostaje sama
 * treść. Stan egzemplarzy (na którym zamówieniu wisi sztuka i kiedy wraca)
 * czytamy TĄ SAMĄ funkcją, która liczy dostępność na karcie
 * (`lib/catalog/card-query.ts`), żeby liczba „X z N" i kolumna stanu nie
 * mogły się rozjechać.
 */
export default async function ProductUnitsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireMemberPage(`/katalog/${id}/egzemplarze`);

  const { data: product } = await ctx.supabase
    .from("products")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (!product) notFound();

  const { units, unitCount, deployedToday } = await fetchProductUnits(
    ctx.supabase,
    ctx.tenantId!,
    product.id,
    { today: warsawToday() },
  );

  const locale = await getLocale();
  const t = await getTranslations("catalog.units");

  return (
    <ScreenSection
      data-product-units
      title={t("heading")}
      status={
        unitCount === 0 ? null : (
          <span
            {...deploymentCellProps(deployedToday, unitCount)}
            className="text-muted-foreground text-sm tabular-nums"
          >
            {t("deployedOf", { deployed: deployedToday, total: unitCount })}
          </span>
        )
      }
      description={t("intro")}
    >
      <UnitsEditor
        action={saveUnitsAction.bind(null, product.id)}
        initialRows={units}
        locale={locale}
      />
    </ScreenSection>
  );
}
