import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ScreenHeader } from "@/components/screens/screen-header";
import { uuidSchema } from "@/lib/catalog-validation";
import { requireMemberPage } from "@/lib/member-page";

import { updateCategoryAction } from "../actions";
import { CategoryForm } from "../category-form";

export const dynamic = "force-dynamic";

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = await params;
  const ctx = await requireMemberPage(`/katalog/kategorie/${categoryId}`);

  // Identyfikator spoza UUID nie ma prawa dojść do bazy: `.eq` na kolumnie
  // uuid oddałoby błąd składni (22P02), a nie „nie ma takiej kategorii".
  if (!uuidSchema.safeParse(categoryId).success) notFound();

  const { data: category } = await ctx.supabase
    .from("catalog_categories")
    .select("id, name, slug, description, image_path")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", categoryId)
    .maybeSingle();

  if (!category) notFound();

  const t = await getTranslations("catalog.categories");

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        back={{ href: "/katalog/kategorie", label: t("backToList") }}
        title={category.name as string}
      />
      <CategoryForm
        action={updateCategoryAction.bind(null, category.id as string)}
        defaults={{
          name: category.name as string,
          slug: category.slug as string,
          description: (category.description as string | null) ?? "",
        }}
        isNew={false}
        submitLabel={t("form.save")}
        categoryId={category.id as string}
        bannerPath={(category.image_path as string | null) ?? null}
      />
    </div>
  );
}
