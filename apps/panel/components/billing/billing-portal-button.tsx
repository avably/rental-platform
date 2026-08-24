"use client";

/**
 * Wejście do PORTALU KLIENTA dostawcy płatności (J2 faza 3, ADR-152).
 *
 * Komponent kliencki z tego samego powodu co CTA checkoutu (K4, faza 2a):
 * akcja serwerowa ZWRACA adres sesji, a przeglądarka idzie tam przez
 * `window.location.assign` — `redirect()` z akcji formularza zostałby CICHO
 * ucięty przez CSP `form-action 'self'`. Nawigacja skryptowa tej dyrektywie
 * nie podlega, więc polityka zostaje nietknięta.
 *
 * Renderowany WYŁĄCZNIE tam, gdzie strona serwerowa uznała to za zasadne
 * (owner, dostępny tor płatności, istniejący klient u dostawcy) — komponent
 * NIE JEST guardem; guardem akcji jest `requireBillingOwner`.
 */
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { BrandLoader } from "@/components/shell/brand-loader";
import { openBillingPortalAction } from "@/lib/actions/billing-management";

const BUTTON_CLASS =
  "border-border inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-[13px] font-semibold outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:outline-ring";

export function BillingPortalButton() {
  const t = useTranslations("organization.billing.manage");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = () => {
    setError(null);
    startTransition(async () => {
      const result = await openBillingPortalAction();
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      setError(result.error ?? t("unknownError"));
    });
  };

  return (
    <div className="flex flex-col gap-2" data-billing-portal>
      <p className="text-muted-foreground text-[13px] leading-[18px]">{t("portalDescription")}</p>
      <div>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={open}
          className={BUTTON_CLASS}
          data-billing-portal-cta
        >
          {t("portalCta")}
        </button>
      </div>
      {pending ? (
        <BrandLoader
          label={t("portalRedirecting")}
          variant="compact"
          showLabel
          className="flex-row justify-start gap-2 [&_[data-brand-loader-label]]:text-[13px] [&_[data-brand-loader-label]]:leading-[18px]"
        />
      ) : null}
      {error ? (
        <p className="text-destructive text-[13px] leading-[18px]" role="alert" data-billing-portal-error>
          {error}
        </p>
      ) : null}
    </div>
  );
}
