import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
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
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href={`/katalog/${product.id}`}>
        {t("backToProduct", { name: product.name })}
      </Link>
      <h1 className="text-xl font-semibold">{t("title", { name: product.name })}</h1>

      <AddUnitForm action={addUnitAction.bind(null, product.id)} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          {t("listHeading", { count: (units ?? []).length })}
        </h2>
        {(units ?? []).length === 0 ? (
          <p className="text-sm text-gray-600">{t("empty")}</p>
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
    </main>
  );
}
