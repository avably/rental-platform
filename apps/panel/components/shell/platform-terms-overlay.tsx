/**
 * PRZESŁONA AKCEPTACJI REGULAMINU PLATFORMY (0070, ADR-141 — konta
 * istniejące, faza „po effective_from" z §14 projektu regulaminu).
 *
 * Renderowana przez layout `(panel)` ZAMIAST `children`, gdy organizacja
 * ownera nie ma dowodu akceptacji obowiązującej wersji (decyzję podejmuje
 * `readPlatformTermsGate`). To jest TREŚĆ, nie guard (wzorzec ADR-133):
 * zero redirectów, więc zero ryzyka pętli onboardingu; personel i sesje bez
 * organizacji nigdy tego ekranu nie widzą.
 *
 * Treść regulaminu ŚWIADOMIE nie jest tu renderowana — jedno źródło tekstu
 * to strona publiczna LP (`/{locale}/terms`, ta sama baza przez
 * `app.get_platform_terms`), do której prowadzi link w nowej karcie.
 */
import { CANONICAL_SITE_URL, bcp47, type Locale } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { PlatformTermsAcceptForm } from "./platform-terms-accept-form";

export interface PlatformTermsOverlayProps {
  versionId: string;
  versionLabel: string;
  effectiveFrom: string;
}

export async function PlatformTermsOverlay({
  versionId,
  versionLabel,
  effectiveFrom,
}: PlatformTermsOverlayProps) {
  const t = await getTranslations("platformTerms");
  const locale = (await getLocale()) as Locale;
  const termsUrl = `${CANONICAL_SITE_URL}/${locale}/terms`;
  const effectiveDate = new Intl.DateTimeFormat(bcp47(locale), { dateStyle: "long" }).format(
    new Date(effectiveFrom),
  );

  return (
    <section
      data-platform-terms-overlay
      aria-labelledby="platform-terms-overlay-title"
      className="mx-auto flex max-w-xl flex-col gap-4 py-10"
    >
      <h1 id="platform-terms-overlay-title" className="text-xl font-semibold">
        {t("title", { version: versionLabel })}
      </h1>
      <p className="text-sm text-muted-foreground">
        {t("description", { date: effectiveDate })}
      </p>
      <p className="text-sm">
        <a
          href={termsUrl}
          target="_blank"
          rel="noreferrer"
          className="font-semibold underline underline-offset-[3px]"
          data-platform-terms-link
        >
          {t("linkLabel", { version: versionLabel })}
        </a>
      </p>
      <PlatformTermsAcceptForm versionId={versionId} versionLabel={versionLabel} />
    </section>
  );
}
