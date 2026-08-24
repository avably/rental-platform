import { getTranslations } from "next-intl/server";

import { BrandLoader } from "@/components/shell/brand-loader";

/** Fallback dla tras panelu, które nie mają dokładniejszej rezerwy geometrii. */
export default async function PanelLoading() {
  const t = await getTranslations("common");

  return (
    <div
      data-panel-route-loading
      className="flex min-h-[50vh] items-center justify-center"
    >
      <BrandLoader label={t("loading")} variant="full" showLabel />
    </div>
  );
}
