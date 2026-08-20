"use server";

/**
 * Akcje ZARZĄDZANIA ABONAMENTEM (J2 faza 3, ADR-152): Portal klienta, zmiana
 * planu, reaktywacja. CIENKIE — guard, walidacja zamiaru i złożenie
 * zależności; cała decyzja mieszka w `lib/billing-portal.ts` i
 * `lib/billing-subscription.ts` (testowalnych ze wstrzykniętym klientem
 * rozliczeń i klientem bazy), tak jak w fazie 2a.
 *
 * GUARD: `requireBillingOwner` — ten sam, co checkout (K1). Owner-only,
 * przepuszcza `suspended` (zawieszony MUSI mieć jak zapłacić — i to właśnie
 * Portal jest tą drogą, gdy subskrypcja jest `unpaid`, bo checkoutu bramka W6
 * wtedy nie przepuści), odrzuca `superadmin_locked`/`cancelled`.
 *
 * K4 (CSP `form-action 'self'`): akcje ZWRACAJĄ adres/werdykt i nie robią
 * `redirect()` na hosta dostawcy — nawigację skryptową wykonuje komponent
 * kliencki. Polityka CSP zostaje nietknięta (rozstrzygnięcie fazy 2a).
 *
 * MODUŁ "use server" EKSPORTUJE WYŁĄCZNIE FUNKCJE ASYNCHRONICZNE — stała albo
 * obiekt w eksportach wywraca cały moduł („no exports at all") dopiero na
 * `next build`, więc słowniki komunikatów żyją w rdzeniach, nie tutaj.
 */
import {
  SAAS_PLAN_PRICING,
  StripeApiError,
  StripeBillingClient,
  StripeConfigError,
  stripeBillingAvailability,
  type SaasBillingInterval,
  type SaasPlanId,
} from "@avably/core";
import { getLocale } from "next-intl/server";

import { AuthError } from "@/lib/auth";
import { openBillingPortal } from "@/lib/billing-portal";
import { requireBillingOwner } from "@/lib/billing-guard";
import { changeSaasPlan, reactivateSaasSubscription } from "@/lib/billing-subscription";
import { localePath } from "@/lib/navigation";
import { panelBaseUrlFromRequest } from "@/lib/panel-url";

export interface BillingPortalActionResult {
  url?: string;
  error?: string;
}

export interface BillingManagementActionResult {
  ok?: true;
  error?: string;
}

function isSaasPlanId(value: string): value is SaasPlanId {
  return SAAS_PLAN_PRICING.some((plan) => plan.id === value);
}

function isSaasInterval(value: string): value is SaasBillingInterval {
  return value === "monthly" || value === "yearly";
}

/** Komunikaty portu są już zredagowane (`redactSecretKey`) — mogą iść na ekran. */
function providerError(error: unknown): string | null {
  if (error instanceof StripeConfigError || error instanceof StripeApiError) return error.message;
  return null;
}

/**
 * Otwarcie Portalu klienta. `returnUrl` wraca na ekran organizacji — powrót
 * NICZEGO nie potwierdza i niczego nie zapisuje (stan przestawia webhook
 * z odczytu), więc parametr jest wyłącznie sygnałem dla ekranu.
 */
export async function openBillingPortalAction(): Promise<BillingPortalActionResult> {
  let ctx;
  try {
    ctx = await requireBillingOwner();
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    throw error;
  }

  const availability = stripeBillingAvailability();
  if (!availability.available) {
    return { error: `Zarządzanie płatnościami jest niedostępne: ${availability.reason}` };
  }

  const locale = await getLocale();
  const organizationPath = await localePath("/organizacja");
  // ORIGIN PANELU (`app.avably.io`), nie kanon marketingowy (`avably.io`):
  // powrót z Portalu wraca na ekran organizacji w panelu — `siteUrl()`
  // odsyłał na LP i kończył się 404, ta sama klasa co Checkout (ADR-221).
  const base = await panelBaseUrlFromRequest();

  try {
    return await openBillingPortal(
      { supabase: ctx.supabase, billing: new StripeBillingClient() },
      {
        tenantId: ctx.tenantId!,
        locale,
        returnUrl: `${base}${organizationPath}?portal=powrot`,
      },
    );
  } catch (error) {
    const message = providerError(error);
    if (message) return { error: message };
    throw error;
  }
}

/** Zmiana planu/interwału żywej subskrypcji — jedno żądanie, zero zapisu u nas. */
export async function changeSaasPlanAction(input: {
  planId: string;
  interval: string;
}): Promise<BillingManagementActionResult> {
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
    return { error: `Zmiana planu jest niedostępna: ${availability.reason}` };
  }

  try {
    return await changeSaasPlan(
      { supabase: ctx.supabase, billing: new StripeBillingClient() },
      { tenantId: ctx.tenantId!, planId: input.planId, interval: input.interval },
    );
  } catch (error) {
    const message = providerError(error);
    if (message) return { error: message };
    throw error;
  }
}

/** Cofnięcie anulowania na koniec okresu. */
export async function reactivateSaasSubscriptionAction(): Promise<BillingManagementActionResult> {
  let ctx;
  try {
    ctx = await requireBillingOwner();
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    throw error;
  }

  const availability = stripeBillingAvailability();
  if (!availability.available) {
    return { error: `Wznowienie abonamentu jest niedostępne: ${availability.reason}` };
  }

  try {
    return await reactivateSaasSubscription(
      { supabase: ctx.supabase, billing: new StripeBillingClient() },
      { tenantId: ctx.tenantId! },
    );
  } catch (error) {
    const message = providerError(error);
    if (message) return { error: message };
    throw error;
  }
}
