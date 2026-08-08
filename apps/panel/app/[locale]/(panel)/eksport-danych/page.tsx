/**
 * Ekran „Eksport danych" (C2, ADR-111) — operator zabiera SWOJE dane:
 * zamówienia, klienci, katalog jako CSV (zaufanie/anty-lock-in + fundament
 * pod przenoszalność z RODO).
 *
 * Wejście: pozycja „Eksport danych" w grupie ORGANIZACJA (od M2/ADR-110 —
 * wcześniej ekran był osiągalny wyłącznie linkiem z organizacji, który
 * ZOSTAJE jako drugie wejście). Tytuł belki bierze się z pozycji nawigacji,
 * więc nazwa w menu i w nagłówku jest jedna.
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
