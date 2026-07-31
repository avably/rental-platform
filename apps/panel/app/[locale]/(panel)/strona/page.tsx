/**
 * Zakładka „Strona sklepu" — LAUNCHER kreatora (K1, ADR-083).
 *
 * Serwerowo zostaje dokładnie tyle, ile launcher potrzebuje: guard członka,
 * utworzenie strony przy pierwszym wejściu (`ensureSite`, idempotentne —
 * tworzenie to mutacja, nie skutek uboczny odczytu) i data ostatniej publikacji.
 * Szkic, katalog i cała interakcja edycyjna przeniosły się na `/strona/kreator`,
 * więc ten ekran ich nie czyta — po co miałby, skoro nic z nimi nie robi.
 *
 * `ensureSite` zostaje TUTAJ, a nie w kreatorze: launcher jest wejściem
 * z nawigacji panelu, więc to on odpowiada za istnienie strony. Kreator z pustą
 * bazą oddaje 404 (wejście na adres z ręki), zamiast zakładać byty po cichu.
 *
 * Nieudany odczyt kończy się WŁASNYM stanem (`SiteLoadError`), a nie pustym
 * ekranem: „nie ma strony" i „nie wiadomo, czy jest" to dwa różne komunikaty.
 */
import { getFormatter, getTranslations } from "next-intl/server";

import { ScreenBackLink } from "@/components/screens/screen-header";
import { ensureSite } from "@/lib/actions/site";
import { requireMemberPage } from "@/lib/member-page";
import { getSiteWithSections } from "@/lib/site-queries";

import { SiteLauncher } from "./site-launcher";
import { SiteLoadError } from "./site-load-error";

export default async function SitePage() {
  await requireMemberPage("/strona");
  const t = await getTranslations("site");

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
      <SiteLauncher siteId={data.site.id} publishedAtLabel={publishedAtLabel} />
    </div>
  );
}
