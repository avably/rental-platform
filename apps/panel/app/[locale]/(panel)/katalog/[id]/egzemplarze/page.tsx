import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ScreenHeader } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import { addUnitAction, updateUnitAction } from "./actions";
import { AddUnitForm, UnitRowForm } from "./unit-forms";

export default async function ProductUnitsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireMemberPage(`/katalog/${id}/egzemplarze`);

  const { data: product } = await ctx.supabase
    .from("products")
    .select("id, name")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (!product) notFound();

  const { data: units } = await ctx.supabase
    .from("product_units")
    .select("id, serial_number, unavailable_from, unavailable_to, unavailable_reason")
    .eq("tenant_id", ctx.tenantId)
    .eq("product_id", id)
    .order("created_at", { ascending: true });

  const t = await getTranslations("catalog.units");

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        back={{
          href: `/katalog/${product.id}`,
          label: t("backToProduct", { name: product.name }),
        }}
        title={t("title", { name: product.name })}
      />

      <AddUnitForm action={addUnitAction.bind(null, product.id)} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">
          {t("listHeading", { count: (units ?? []).length })}
        </h2>
        {(units ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          (units ?? []).map((unit) => (
            <UnitRowForm
              key={unit.id}
              action={updateUnitAction.bind(null, product.id)}
              unit={{
                id: unit.id,
                serialNumber: unit.serial_number ?? "",
                unavailableFrom: unit.unavailable_from ?? "",
                unavailableTo: unit.unavailable_to ?? "",
                unavailableReason: unit.unavailable_reason ?? "",
              }}
            />
          ))
        )}
      </section>
    </div>
  );
}
