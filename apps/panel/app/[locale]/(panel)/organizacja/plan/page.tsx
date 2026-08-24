import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { isLiveSaasSubscriptionStatus, stripeBillingAvailability } from "@avably/core";

import { ManageBillingSection } from "@/components/billing/manage-billing-section";
import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenBackLink } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import { SaasCheckoutCta } from "../checkout-cta";
import { PlanBillingSection } from "../plan-billing-section";

/**
 * Plan i rozliczenia — podstrona huba `/organizacja` (uwaga właściciela
 * 2026-08-24, ADR-238).
 *
 * RELOKACJA, NIE ZMIANA FUNKCJI: cała logika J2 (cennik ze stałej
 * SAAS_PLAN_PRICING, checkout ADR-136, portal/zmiana planu ADR-152) zostaje
 * BEZ ZMIAN — przeniósł się tylko URL. Komponenty (`PlanBillingSection`,
 * `SaasCheckoutCta`, `ManageBillingSection`) i ich testy są nietknięte.
 *
 * OKNO DOMYKANIA (ADR-138): ta strona NIESIE opt-in `{ closing: true }`, bo po
 * przeniesieniu billingu z ekranu organizacji to TU mieszka jedyna droga
 * zapłaty przywracającej dostęp zawieszonemu tenantowi. `requireBillingOwner`
 * w sekcjach billing przepuszcza `suspended`, więc płatność działa w oknie.
 * Rozszerzenie allowlisty jest ŚWIADOME i przypięte snapshotem
 * (closing-optin-inventory.test.ts).
 *
 * WIDOCZNOŚĆ CTA (ADR-135/136): checkout dostaje WYŁĄCZNIE owner przy dostępnym
 * torze płatności i braku żywej subskrypcji; guardem akcji jest
 * `requireBillingOwner` (K1), widoczność to UX, nie bramka.
 */
export default async function OrganizationPlanPage() {
  const ctx = await requireMemberPage("/organizacja/plan", { closing: true });

  const { data: tenant } = await ctx.supabase
    .from("tenants")
    .select("id, status, trial_ends_at, subscriptions(plan_id, status)")
    .eq("id", ctx.tenantId)
    .maybeSingle();

  if (!tenant) notFound();

  const t = await getTranslations("organization");

  const subscriptionRaw = (tenant as { subscriptions?: unknown }).subscriptions;
  const subscription = (Array.isArray(subscriptionRaw) ? subscriptionRaw[0] : subscriptionRaw) as
    | { plan_id: string | null; status: string | null }
    | null
    | undefined;

  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenBackLink href="/organizacja" label={t("backToHub")} />

      {/* Plan i rozliczenia (ADR-135; CTA checkoutu ADR-136) — stan konta +
          cennik ze stałej @avably/core. CTA WYŁĄCZNIE dla ownera, przy dostępnym
          torze płatności i braku żywej subskrypcji. */}
      <PlanBillingSection
        subscription={
          subscription ? { planId: subscription.plan_id, status: subscription.status } : null
        }
        trialEndsAt={tenant.trial_ends_at}
        checkoutCta={
          ctx.role === "owner" &&
          stripeBillingAvailability().available &&
          !(subscription?.status && isLiveSaasSubscriptionStatus(subscription.status)) ? (
            <SaasCheckoutCta />
          ) : undefined
        }
      />

      {/* Zarządzanie abonamentem (ADR-152) — Portal klienta, zmiana planu,
          reaktywacja. Karta bramkuje się SAMA (requireBillingOwner + stan
          projekcji) i przy braku czegokolwiek do zrobienia nie renderuje nic. */}
      <ManageBillingSection />
    </FormMeasure>
  );
}
