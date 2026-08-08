/**
 * Ekran „Eksport danych" (C2, ADR-111) — operator zabiera SWOJE dane:
 * zamówienia, klienci, katalog jako CSV (zaufanie/anty-lock-in + fundament
 * pod przenoszalność z RODO).
 *
 * Trasa POZA PANEL_NAV_GROUPS (struktura grup jest kontraktem 1:1 z
 * artefaktem Fazy 2): wejście linkiem z ekranu organizacji, tytuł belki przez
 * PANEL_ROUTE_TITLE_OVERRIDES. Uwaga: /ustawienia-api NIE jest już takim
 * przypadkiem — od M2 (ADR-110) ma pozycję „Integracje" w grupie KANAŁY.
 */
import { getLocale, getTranslations } from "next-intl/server";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenBackLink } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";
import type { ExportErrorCode } from "@/lib/export/route-handler";

import { ExportView } from "./export-view";

export default async function DataExportPage({
  searchParams,
}: {
  searchParams: Promise<{ blad?: string }>;
}) {
  const ctx = await requireMemberPage("/eksport-danych");
  const t = await getTranslations("dataExport");
  const locale = await getLocale();

  // Kod błędu z redirectu 303 route handlera — zamknięty słownik, śmieć
  // w query nie renderuje niczego.
  const { blad } = await searchParams;
  const error: ExportErrorCode | null = blad === "limit" || blad === "zakres" ? blad : null;

  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenBackLink href="/organizacja" label={`← ${t("backLink")}`} />
      <ExportView locale={locale} isOwner={ctx.role === "owner"} error={error} />
    </FormMeasure>
  );
}
