"use client";

/**
 * CTA Checkoutu abonamentu (J2 faza 2a, ADR-136) — komponent kliencki,
 * bo rozstrzygnięcie K4 wymaga NAWIGACJI SKRYPTOWEJ: server action zwraca
 * URL sesji, a przeglądarka idzie tam przez `window.location.assign` —
 * `redirect()` z akcji formularza zostałby ucięty przez CSP
 * `form-action 'self'` (Chromium egzekwuje form-action na łańcuchu
 * przekierowań po submit), i to ucięty CICHO. Nawigacja skryptowa
 * form-action nie podlega, więc polityka CSP zostaje nietknięta.
 *
 * Renderowany WYŁĄCZNIE dla ownera (decyduje strona serwerowa — komponent
 * nie jest guardem; guardem akcji jest requireBillingOwner). Kwoty w
 * etykietach NIE występują — ceny pokazuje sekcja planu ze stałej
 * SAAS_PLAN_PRICING, a prawdą obciążenia jest cennik Stripe (lookup_key).
 */
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import {
  SAAS_BILLING_INTERVALS,
  SAAS_PLAN_PRICING,
  type SaasBillingInterval,
  type SaasPlanId,
} from "@avably/core";

import { startSaasCheckoutAction } from "./billing-actions";

const BUTTON_CLASS =
  "border-border inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-[13px] font-semibold outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:outline-ring";

export function SaasCheckoutCta() {
  const t = useTranslations("organization.billing.checkout");
  const tBilling = useTranslations("organization.billing");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = (planId: SaasPlanId, interval: SaasBillingInterval) => {
    setError(null);
    startTransition(async () => {
      const result = await startSaasCheckoutAction({ planId, interval });
      if (result.url) {
        // K4: nawigacja skryptowa zamiast redirectu z akcji — patrz nagłówek.
        window.location.assign(result.url);
        return;
      }
      setError(result.error ?? t("unknownError"));
    });
  };

  return (
    <div className="flex flex-col gap-3" data-billing-checkout>
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-[13px] leading-[18px] font-medium">
          {t("heading")}
        </p>
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("description")}</p>
      </div>
      <div className="flex flex-col gap-2">
        {SAAS_PLAN_PRICING.map((plan) => (
          <div key={plan.id} className="flex flex-wrap items-center gap-2" data-checkout-plan={plan.id}>
            <span className="text-sm leading-5 font-medium">
              {tBilling(`plans.${plan.id}.name` as Parameters<typeof tBilling>[0])}
            </span>
            {SAAS_BILLING_INTERVALS.map((interval) => (
              <button
                key={interval}
                type="button"
                disabled={pending}
                onClick={() => start(plan.id, interval)}
                className={BUTTON_CLASS}
                data-checkout-cta={`${plan.id}-${interval}`}
              >
                {t(interval)}
              </button>
            ))}
          </div>
        ))}
      </div>
      {pending ? (
        <p className="text-muted-foreground text-[13px] leading-[18px]" role="status">
          {t("redirecting")}
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive text-[13px] leading-[18px]" role="alert" data-checkout-error>
          {error}
        </p>
      ) : null}
    </div>
  );
}
