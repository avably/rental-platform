import { useLocale, useTranslations } from "next-intl";

import { SAAS_PLAN_PRICING, SAAS_YEARLY_MONTHS_CHARGED } from "@avably/core";

import { ScreenSection } from "@/components/screens/screen-header";

/**
 * Sekcja „Plan i rozliczenia" na /organizacja (J2 faza 1, ADR-135) —
 * WYŁĄCZNIE ODCZYT, jak cały ekran (ADR-059 D5).
 *
 * TRZY TWARDE REGUŁY tej sekcji:
 *   1. Kwoty pochodzą WYŁĄCZNIE ze stałej SAAS_PLAN_PRICING (@avably/core) —
 *      cyfra zaszyta tutaj albo w messages to rozjazd z obietnicą LP, który
 *      pali test parytetu (test/plan-billing-section.test.tsx). Tabela
 *      public.plans (placeholder start/pro/max z 0004) NIE jest źródłem cen.
 *   2. Brak wiersza subscriptions = TRIAL — stan pierwszej klasy, nie błąd.
 *      Data z tenants.trial_ends_at, stan „trwa do / minął". Trial, który
 *      minął, NICZEGO nie zmienia (obietnica LP: „po czternastu dniach nic
 *      się samo nie zdarzy") — sekcja mówi to wprost.
 *   3. ZERO przycisków, CTA i ścieżek płatności — checkout to faza 2.
 *      Pilnuje tego test (żadnego <button>/<a>/<form> w markupie sekcji).
 *
 * Widoczność: sekcja idzie konwencją /organizacja — ekran nie różnicuje ról
 * (requireMemberPage bez argumentu roli; RLS i tak pokazuje członkowi plan
 * przez tenant_select z 0001). Stan konta i publiczny cennik nie są
 * tajemnicą rozliczeniową — sekcje z akcjami płatniczymi (faza 2) dostaną
 * własny guard ownera.
 */
export function PlanBillingSection({
  subscription,
  trialEndsAt,
  now = new Date(),
}: {
  /** Wiersz subscriptions tenanta albo null (null = trial — stan pierwszej klasy). */
  subscription: { planId: string | null; status: string | null } | null;
  /** tenants.trial_ends_at (ISO) — null tylko dla wierszy spoza app.create_tenant. */
  trialEndsAt: string | null;
  /** Zegar porównania „trwa/minął" — parametr dla testowalności. */
  now?: Date;
}) {
  const t = useTranslations("organization.billing");
  const tOrg = useTranslations("organization");
  const locale = useLocale();

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Europe/Warsaw",
    }).format(new Date(iso));

  // Kwoty w PEŁNYCH złotych z groszy stałej — cennik SaaS nie ma końcówek,
  // a gdyby kiedyś miał, zaokrąglenie w dół/górę byłoby kłamstwem: dzielenie
  // jest dokładne albo test parytetu ma się zapalić przy zmianie stałej.
  // useGrouping "always": pl domyślnie NIE grupuje liczb 4-cyfrowych
  // (CLDR minimumGroupingDigits=2), a LP pisze „1 990 zł" — typografia kwot
  // ma być identyczna z cennikiem publicznym.
  const zl = (grosze: number) =>
    new Intl.NumberFormat(locale, { useGrouping: "always" }).format(grosze / 100);

  let state: string;
  if (subscription) {
    // Plan nadany ręcznie (superadmin_set_plan) — pokazujemy surowy plan_id
    // jak wiersz „Plan" wyżej; status ze słownika statusów z fallbackiem.
    const statusValue = subscription.status;
    const statusPath = `statusValue.${statusValue}` as Parameters<typeof tOrg>[0];
    const statusLabel =
      statusValue !== null && tOrg.has(statusPath) ? tOrg(statusPath) : (statusValue ?? "");
    state = t("currentPlan", {
      plan: subscription.planId ?? "—",
      status: statusLabel,
    });
  } else if (trialEndsAt === null) {
    state = t("trialNoDate");
  } else if (new Date(trialEndsAt).getTime() >= now.getTime()) {
    state = t("trialActive", { date: formatDate(trialEndsAt) });
  } else {
    state = t("trialEnded", { date: formatDate(trialEndsAt) });
  }

  return (
    <ScreenSection data-plan-billing title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-1" data-billing-state>
        <p className="text-muted-foreground text-[13px] leading-[18px] font-medium">
          {t("stateLabel")}
        </p>
        <p className="text-sm leading-5 font-medium">{state}</p>
        {subscription === null ? (
          <p className="text-muted-foreground text-[13px] leading-[18px]">{t("nothingHappens")}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-[13px] leading-[18px] font-medium">
          {t("pricingHeading")}
        </p>
        <dl className="grid gap-0">
          {SAAS_PLAN_PRICING.map((plan) => (
            <div
              key={plan.id}
              data-plan={plan.id}
              className="border-border grid grid-cols-1 gap-1 border-b py-3 last:border-b-0 sm:grid-cols-[minmax(9rem,0.65fr)_1fr] sm:gap-4"
            >
              <dt className="text-sm leading-5 font-medium">
                {t(`plans.${plan.id}.name` as Parameters<typeof t>[0])}
                {plan.id === "premium" ? (
                  <span className="text-muted-foreground ml-2 text-[13px] font-medium">
                    {t("plans.premium.badge")}
                  </span>
                ) : null}
              </dt>
              <dd className="flex flex-col gap-0.5">
                <span className="text-sm leading-5 font-medium tabular-nums">
                  {t("monthly", { price: zl(plan.monthlyNetGrosze) })}
                </span>
                <span className="text-muted-foreground text-[13px] leading-[18px] tabular-nums">
                  {t("yearly", { price: zl(plan.yearlyNetGrosze), months: SAAS_YEARLY_MONTHS_CHARGED })}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground text-[13px] leading-[18px]">
          {t("noStrings")} {t("vatNote")}
        </p>
      </div>

      <p className="text-[13px] leading-[18px] font-medium" data-billing-activation-notice>
        {t("activationNotice")}
      </p>
    </ScreenSection>
  );
}
