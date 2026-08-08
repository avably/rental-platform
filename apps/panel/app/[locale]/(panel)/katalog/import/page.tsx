/**
 * Ekran importu katalogu z CSV (C3, ADR-112).
 *
 * Wejście przyciskiem z ekranu Katalog — BEZ pozycji w nawigacji (struktura
 * grup jest kontraktem artefaktu Fazy 2). Tytuł belki dziedziczy się
 * z prefiksu /katalog (matchNavItem), nagłówek własny ekranu niżej.
 *
 * `force-dynamic`: trasa interaktywna — statyczny prerender + CSP nonce
 * zabiłyby hydrację po cichu (wzorzec kreatora, ADR-083).
 */
import { getTranslations } from "next-intl/server";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenBackLink } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import { ImportWizard } from "./import-wizard";

export const dynamic = "force-dynamic";

export default async function CatalogImportPage() {
  await requireMemberPage("/katalog/import");
  const t = await getTranslations("catalogImport");

  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenBackLink href="/katalog" label={`← ${t("backLink")}`} />
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </header>
      <ImportWizard />
    </FormMeasure>
  );
}
