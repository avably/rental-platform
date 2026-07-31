"use client";

/**
 * LAUNCHER strony sklepu (K1, ADR-083) — to, co zostaje z zakładki „Strona
 * sklepu", gdy edycja przenosi się na pełnoekranowe płótno `/strona/kreator`.
 *
 * Zakładka odpowiada dziś na trzy pytania i na nic więcej: czy strona jest
 * opublikowana, gdzie się ją buduje, jak wypchnąć zmiany do klientów. Formularzy
 * tu NIE MA — dwie kolumny (szablon, lista sekcji z formularzami treści, podgląd
 * szkicu) zastąpił kreator, a zostawienie ich obok dawałoby DWA miejsca edycji
 * tego samego szkicu, z których jedno zawsze byłoby o krok w tyle.
 *
 * PUBLIKACJA ZOSTAJE TUTAJ (i w pasku kreatora): to decyzja o stanie
 * publicznym, a nie krok budowania — operator ma ją mieć pod ręką również bez
 * wchodzenia na płótno.
 */
import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { ScreenSection } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import { publishSite } from "@/lib/actions/site";
import { SecondaryStatusChip } from "@/lib/secondary-status";

export function SiteLauncher({
  siteId,
  publishedAtLabel,
}: {
  siteId: string;
  /** Sformatowana data ostatniej publikacji albo null — nigdy nieopublikowana. */
  publishedAtLabel: string | null;
}) {
  const t = useTranslations("site");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  function publish() {
    setError(null);
    setPublished(false);
    startTransition(async () => {
      const result = await publishSite(siteId);
      if (result.ok) setPublished(true);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">{t("subtitle")}</p>

      <ScreenSection
        data-publish-status
        title={t("publish.heading")}
        status={
          // Oś `site-publish` zna WYŁĄCZNIE stan „opublikowana" — strona nigdy
          // nieopublikowana dostaje zdanie, a nie chip udający stan spoza mapy.
          publishedAtLabel ? <SecondaryStatusChip axis="site-publish" value="published" /> : null
        }
        description={
          publishedAtLabel
            ? t("publish.publishedAt", { date: publishedAtLabel })
            : t("publish.notPublished")
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild type="button" size="lg">
            <Link href="/strona/kreator" data-open-builder>
              {t("builder.open")}
            </Link>
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-publish-site
            onClick={publish}
            loading={pending}
            disabled={pending}
          >
            {pending ? t("publish.publishing") : t("publish.publish")}
          </Button>
          {published ? (
            <span role="status" className="text-status-positive-fg text-sm">
              {t("publish.published")}
            </span>
          ) : null}
        </div>
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("builder.openHint")}</p>
      </ScreenSection>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
