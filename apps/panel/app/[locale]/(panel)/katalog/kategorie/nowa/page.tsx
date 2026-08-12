import { getTranslations } from "next-intl/server";

import { ScreenHeader } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import { createCategoryAction } from "../actions";
import { CategoryForm } from "../category-form";

export const dynamic = "force-dynamic";

export default async function NewCategoryPage() {
  await requireMemberPage("/katalog/kategorie/nowa");
  const t = await getTranslations("catalog.categories");

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        back={{ href: "/katalog/kategorie", label: t("backToList") }}
        title={t("createTitle")}
      />
      <CategoryForm
        action={createCategoryAction}
        defaults={{ name: "", slug: "", description: "" }}
        isNew
        submitLabel={t("form.create")}
      />
    </div>
  );
}
