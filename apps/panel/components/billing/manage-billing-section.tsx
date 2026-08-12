/**
 * Sekcja „Zarządzanie abonamentem" (J2 faza 3, ADR-152) — SERWEROWA.
 *
 * Osobna karta obok „Planu i rozliczeń", nie rozbudowa tamtej: tamta jest
 * czystym ODCZYTEM stanu i cennika (ADR-135, kontrakt „zero ścieżek płatności
 * bez wstrzykniętego CTA"), a tutaj mieszkają wyłącznie DZIAŁANIA na żywym
 * abonamencie. Rozdział pilnuje sam siebie: sekcja odczytowa dalej nie zna
 * żadnego przycisku.
 *
 * SAMA SIĘ BRAMKUJE ROLĄ. Woła `requireBillingOwner` — DOKŁADNIE ten guard,
 * który bramkuje akcje (owner-only, przepuszcza `suspended`, odrzuca
 * `superadmin_locked`/`cancelled`), więc widzi ją ten i tylko ten, komu akcja
 * odpowie. Staff nie dostaje ani jednego przycisku (nie „wyłączony" — nie ma
 * go w markupie). Odmowa guardu = brak sekcji, nie błąd ekranu: to karta
 * dodatkowa, a nie treść strony.
 *
 * CZEGO SEKCJA NIE ROBI: nie czyta niczego service-rolem, nie pokazuje
 * identyfikatorów dostawcy (`cus_…`/`sub_…` zostają po stronie serwera —
 * ekran mówi planem, statusem i datą) i nie zapisuje stanu.
 */
import { getTranslations } from "next-intl/server";

import { isManageableSaasSubscriptionStatus, stripeBillingAvailability } from "@avably/core";

import { BillingPortalButton } from "@/components/billing/billing-portal-button";
import { SubscriptionControls } from "@/components/billing/subscription-controls";
import { ScreenSection } from "@/components/screens/screen-header";
import { AuthError } from "@/lib/auth";
import { requireBillingOwner } from "@/lib/billing-guard";

interface ManageableProjection {
  plan_id: string | null;
  status: string | null;
  cancel_at_period_end: boolean | null;
  stripe_customer_id: string | null;
}

export async function ManageBillingSection() {
  if (!stripeBillingAvailability().available) return null;

  let ctx;
  try {
    ctx = await requireBillingOwner();
  } catch (error) {
    // Staff, zawieszone rozliczenia, brak sesji — karta po prostu nie istnieje.
    if (error instanceof AuthError) return null;
    throw error;
  }

  const { data } = await ctx.supabase
    .from("subscriptions")
    .select("plan_id, status, cancel_at_period_end, stripe_customer_id")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  const projection = data as ManageableProjection | null;

  // Brak wiersza = okres próbny: nie ma czym zarządzać, a droga do pierwszej
  // płatności to CTA checkoutu w sekcji odczytowej. Zero pustych kart.
  if (!projection) return null;

  const hasCustomer = Boolean(projection.stripe_customer_id);
  const manageable = isManageableSaasSubscriptionStatus(projection.status ?? "");
  if (!hasCustomer && !manageable) return null;

  const t = await getTranslations("organization.billing.manage");

  return (
    <ScreenSection data-manage-billing title={t("title")} description={t("description")}>
      {hasCustomer ? <BillingPortalButton /> : null}
      {manageable ? (
        <SubscriptionControls
          currentPlanId={projection.plan_id}
          canReactivate={projection.cancel_at_period_end === true}
        />
      ) : null}
    </ScreenSection>
  );
}
