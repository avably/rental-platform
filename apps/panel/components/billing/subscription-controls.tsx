"use client";

/**
 * Sterowanie żywym abonamentem (J2 faza 3, ADR-152): zmiana planu/interwału
 * i cofnięcie anulowania.
 *
 * DLACZEGO KOMUNIKAT „ZA CHWILĘ", A NIE NOWY STAN OD RAZU. Obie akcje kończą
 * się jednym żądaniem do dostawcy; nasza projekcja zmienia się dopiero, gdy
 * wróci webhook (ADR-136 — jedno miejsce zapisu). Ekran, który po kliknięciu
 * pokazywałby nowy plan, kłamałby przez kilkaset milisekund i psułby jedyną
 * zasadę tego toru. Dlatego mówimy wprost, że zmiana jest przyjęta, i
 * odświeżamy dane serwerowe (`router.refresh`) — wtedy stan przychodzi
 * z projekcji, czyli z prawdy.
 *
 * Widoczność przycisków ustala strona serwerowa; guardem akcji jest
 * `requireBillingOwner`, a bramki stanu — rdzeń `lib/billing-subscription.ts`.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { SAAS_BILLING_INTERVALS, SAAS_PLAN_PRICING } from "@avably/core";

import {
  changeSaasPlanAction,
  reactivateSaasSubscriptionAction,
} from "@/lib/actions/billing-management";

const BUTTON_CLASS =
  "border-border inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-[13px] font-semibold outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:outline-ring";

export function SubscriptionControls({
  currentPlanId,
  canReactivate,
}: {
  /**
   * `plan_id` z projekcji — WYŁĄCZNIE do oznaczenia bieżącego planu.
   *
   * Interwału rozliczeniowego projekcja nie przechowuje (0067 trzyma plan,
   * status i daty okresu, nie `lookup_key`), a zgadywanie go z długości okresu
   * byłoby heurystyką udającą fakt. Dlatego oba przyciski interwału zostają
   * klikalne także na bieżącym planie — miesiąc↔rok to legalna zmiana — a
   * jedyne wywołanie bez skutku (ten sam plan i ten sam interwał) odrzuca
   * rdzeń akcji nazwanym komunikatem, po ODCZYCIE u dostawcy.
   */
  currentPlanId: string | null;
  /** Czy abonament ma ustawione anulowanie na koniec okresu (jest co wznawiać). */
  canReactivate: boolean;
}) {
  const t = useTranslations("organization.billing.manage");
  const tCheckout = useTranslations("organization.billing.checkout");
  const tBilling = useTranslations("organization.billing");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok?: true; error?: string }>) => {
    setError(null);
    setAccepted(false);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setAccepted(true);
        router.refresh();
        return;
      }
      setError(result.error ?? t("unknownError"));
    });
  };

  return (
    <div className="flex flex-col gap-3" data-subscription-controls>
      {canReactivate ? (
        <div className="flex flex-col gap-2" data-subscription-reactivate>
          <p className="text-[13px] leading-[18px] font-medium">{t("reactivateHeading")}</p>
          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {t("reactivateDescription")}
          </p>
          <div>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(reactivateSaasSubscriptionAction)}
              className={BUTTON_CLASS}
              data-subscription-reactivate-cta
            >
              {t("reactivateCta")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2" data-subscription-plan-change>
        <p className="text-[13px] leading-[18px] font-medium">{t("planChangeHeading")}</p>
        <p className="text-muted-foreground text-[13px] leading-[18px]">
          {t("planChangeDescription")}
        </p>
        <div className="flex flex-col gap-2">
          {SAAS_PLAN_PRICING.map((plan) => (
            <div key={plan.id} className="flex flex-wrap items-center gap-2" data-plan-change-plan={plan.id}>
              <span className="text-sm leading-5 font-medium">
                {tBilling(`plans.${plan.id}.name` as Parameters<typeof tBilling>[0])}
                {plan.id === currentPlanId ? (
                  <span
                    className="text-muted-foreground ml-2 text-[13px] font-medium"
                    data-plan-change-current={plan.id}
                  >
                    {t("planCurrent")}
                  </span>
                ) : null}
              </span>
              {SAAS_BILLING_INTERVALS.map((interval) => (
                <button
                  key={interval}
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => changeSaasPlanAction({ planId: plan.id, interval }))}
                  className={BUTTON_CLASS}
                  data-plan-change-cta={`${plan.id}-${interval}`}
                >
                  {tCheckout(interval)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {accepted ? (
        <p className="text-[13px] leading-[18px] font-medium" role="status" data-subscription-accepted>
          {t("accepted")}
        </p>
      ) : null}
      {error ? (
        <p
          className="text-destructive text-[13px] leading-[18px]"
          role="alert"
          data-subscription-error
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
