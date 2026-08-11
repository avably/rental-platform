"use server";

/**
 * Akcja startu Checkoutu abonamentu (J2 faza 2a, ADR-136) — CIENKA:
 * guard + walidacja + złożenie zależności; rdzeń W6/K2 mieszka w
 * `lib/billing-checkout.ts` (testowalny z wstrzykniętym klientem).
 *
 * GUARD: `requireBillingOwner` (K1) — owner-only, przepuszcza `suspended`
 * (żeby zawieszony mógł zapłacić), odrzuca `superadmin_locked`/`cancelled`.
 *
 * K4 (CSP `form-action 'self'`): akcja NIE robi `redirect()` na hosta
 * Checkoutu — Chromium egzekwuje form-action także na łańcuchu przekierowań
 * po submit formularza, a objaw byłby CICHY. Akcja ZWRACA URL, a komponent
 * kliencki nawiguje `window.location.assign(url)` — nawigacja skryptowa
 * form-action nie podlega, więc CSP zostaje NIETKNIĘTE (wariant najmniej
 * poszerzający politykę; dowód w przeglądarce — weryfikacja ADR-136).
 *
 * Kwoty NIE występują w tej ścieżce: cena wynika z cennika na koncie
 * platformy (lookup_key `saas_<plan>_<interwał>`, bootstrap wg
 * SAAS_PLAN_PRICING — parytet przypięty testem).
 */
import {
  SAAS_PLAN_PRICING,
  StripeApiError,
  StripeBillingClient,
  StripeConfigError,
  siteUrl,
  stripeBillingAvailability,
  type SaasBillingInterval,
  type SaasPlanId,
} from "@avably/core";
import { getLocale } from "next-intl/server";

import { AuthError } from "@/lib/auth";
import { startSaasCheckout } from "@/lib/billing-checkout";
import { requireBillingOwner } from "@/lib/billing-guard";
import { localePath } from "@/lib/navigation";

export interface StartSaasCheckoutResult {
  url?: string;
  error?: string;
}

function isSaasPlanId(value: string): value is SaasPlanId {
  return SAAS_PLAN_PRICING.some((plan) => plan.id === value);
}

function isSaasInterval(value: string): value is SaasBillingInterval {
  return value === "monthly" || value === "yearly";
}

export async function startSaasCheckoutAction(input: {
  planId: string;
  interval: string;
}): Promise<StartSaasCheckoutResult> {
  let ctx;
  try {
    ctx = await requireBillingOwner();
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    throw error;
  }

  if (!isSaasPlanId(input.planId) || !isSaasInterval(input.interval)) {
    return { error: "Nieznany plan albo interwał rozliczeniowy." };
  }

  const availability = stripeBillingAvailability();
  if (!availability.available) {
    return { error: `Płatności abonamentu są niedostępne: ${availability.reason}` };
  }

  const locale = await getLocale();
  const organizationPath = await localePath("/organizacja");
  const base = siteUrl();

  try {
    return await startSaasCheckout(
      { supabase: ctx.supabase, billing: new StripeBillingClient() },
      {
        tenantId: ctx.tenantId!,
        userEmail: ctx.user.email,
        planId: input.planId,
        interval: input.interval,
        locale,
        successUrl: `${base}${organizationPath}?checkout=sukces`,
        cancelUrl: `${base}${organizationPath}?checkout=anulowano`,
      },
    );
  } catch (error) {
    if (error instanceof StripeConfigError || error instanceof StripeApiError) {
      // Komunikaty portu są już zredagowane (redactSecretKey) — mogą iść
      // na ekran właściciela.
      return { error: error.message };
    }
    throw error;
  }
}
