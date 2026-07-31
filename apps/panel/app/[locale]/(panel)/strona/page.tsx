/**
 * Edytor storefrontu tenanta (Zadanie 2.3b — EDYTOR + PODGLĄD SZKICU, skóra P8b).
 *
 * Serwerowo: guard członka, utworzenie strony przy pierwszym wejściu
 * (`ensureSite`, idempotentne — tworzenie to mutacja, nie skutek uboczny
 * odczytu) i odczyt szkicu (`getSiteWithSections`, warstwa danych 2.3a).
 * Interakcja żyje w kliencie (`SiteEditor`), który woła akcje modelu
 * sekcyjnego 2.3a.
 *
 * Katalogu do podglądu ta strona już NIE czyta (kreator A3): podgląd jest
 * osobnym dokumentem w ramce (`/podglad-strony`) i czyta go sam, wspólnym
 * helperem `previewProductsFor`. Dwa odczyty tego samego katalogu po obu
 * stronach ramki byłyby tylko okazją do rozjazdu.
 *
 * Nieudany odczyt szkicu kończy się WŁASNYM stanem (`SiteLoadError`), a nie
 * pustym edytorem: mockup `secondary-site-editor` stawia tę granicę wprost, bo
 * „nie ma sekcji” i „nie wiadomo, czy są sekcje” to dwa różne komunikaty.
 */
import { getFormatter, getTranslations } from "next-intl/server";

import { ScreenBackLink } from "@/components/screens/screen-header";
import { ensureSite } from "@/lib/actions/site";
import { requireMemberPage } from "@/lib/member-page";
import { getSiteWithSections } from "@/lib/site-queries";

import { toEditorSections } from "./content";
import { SiteEditor } from "./site-editor";
import { SiteLoadError } from "./site-load-error";

export default async function SitePage() {
  await requireMemberPage("/strona");
  const t = await getTranslations("site");

  // Utworzenie strony przy pierwszym wejściu (jedna per tenant, idempotentne).
  const ensured = await ensureSite();
  const data = ensured.ok ? await getSiteWithSections() : null;

  if (!ensured.ok || !data) {
    return (
      <SiteLoadError
        backLabel={t("backHome")}
        title={t("loadErrorTitle")}
        message={ensured.ok ? t("loadError") : ensured.error}
      />
    );
  }

  const format = await getFormatter();

  const publishedAtLabel = data.site.published_at
    ? format.dateTime(new Date(data.site.published_at), {
        dateStyle: "short",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="flex flex-col gap-4">
      <ScreenBackLink href="/" label={t("backHome")} />
      <SiteEditor
        siteId={data.site.id}
        template={data.site.template}
        sections={toEditorSections(data.sections)}
        publishedAtLabel={publishedAtLabel}
      />
    </div>
  );
}
