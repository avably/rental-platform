import { getTranslations } from "next-intl/server";

import { NotFoundScreen } from "@/components/screens/not-found-screen";

/**
 * 404 podstron katalogu (ADR-058) — łapie m.in. produkt spoza tenanta
 * i nieistniejący punkt odbioru. Kod i tytuł współdzielone z P4, wyjście
 * własne: katalog produktów.
 */
export default async function CatalogNotFound() {
  const t = await getTranslations("catalog.list");

  return <NotFoundScreen back={{ href: "/katalog", label: t("title") }} />;
}
