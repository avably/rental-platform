/**
 * Rdzeń ZMIANY PLANU i REAKTYWACJI żywej subskrypcji (J2 faza 3, ADR-152).
 *
 * ============ JEDEN TOR ZDARZEŃ, NIE DWA ============
 *
 * Obie ścieżki kończą się JEDNYM żądaniem do dostawcy i na tym ich rola się
 * kończy. Projekcji `public.subscriptions` ani `tenants.status` NIE dotykają:
 * dostawca odpowiada `customer.subscription.updated`, a to zdarzenie od fazy
 * 2a jest już na liście `OBSERVED_SAAS_BILLING_EVENTS` i przechodzi tym samym
 * webhookiem, tą samą idempotencją i tą samą tablicą przejść (ADR-136).
 * Zmiana planu = nowy `lookup_key` w odczycie → `plan_id` w projekcji.
 * Reaktywacja = `cancel_at_period_end=false` w odczycie → ta sama kolumna.
 * Drugi tor zapisu byłby tu najgorszym możliwym wynikiem — nie ma go.
 *
 * ============ WERDYKT ZAWSZE Z ODCZYTU (ADR-049) ============
 *
 * Projekcja mówi WYŁĄCZNIE „którą subskrypcję mam prawo dotknąć" (wiersz
 * zawężony do `tenant_id`, czytany klientem sesji ownera — RLS jest bramką).
 * O tym, CO z tą subskrypcją wolno zrobić, decyduje ODCZYT u dostawcy: status,
 * flaga anulowania, obecny plan i `metadata.tenant_id`. Projekcja bywa
 * spóźniona o webhooka albo przekłamana ręczną operacją — decyzja podjęta na
 * niej byłaby decyzją na cudzych danych.
 *
 * ============ TRZY BRAMKI, KAŻDA Z OSOBNA ============
 *
 *   (a) TOŻSAMOŚĆ: `metadata.tenant_id` z odczytu musi być NASZ. Wiersz
 *       projekcji z cudzym `sub_…` (skrzyżowane strumienie, wpis ręczny) nie
 *       daje prawa do cudzej subskrypcji.
 *   (b) STATUS SUBSKRYPCJI: wyłącznie `trialing`/`active`
 *       (MANAGEABLE_SAAS_SUBSCRIPTION_STATUSES). `past_due`/`unpaid` to dług
 *       — droga z nich prowadzi przez zapłatę.
 *   (c) STATUS TENANTA: wyłącznie `trialing`/`active`. Bramka (b) sama nie
 *       wystarcza, bo statusy potrafią się rozjechać legalnie:
 *       `app.superadmin_set_plan` pisze subskrypcję `active`, NIE dotykając
 *       `tenants.status`. Bez (c) tenant zawieszony w oknie domykania
 *       (ADR-138) miałby w reaktywacji boczne drzwi z powrotem do pełnego
 *       panelu — a okno domykania ma zostać nienaruszone.
 *
 * ============ ZEGAR TRIALA ============
 *
 * Żadna z tych ścieżek nie podaje dostawcy pola trialu — patrz
 * `updateSubscriptionPrice` w `@avably/core`. Zmiana planu w dół i z powrotem
 * NIE resetuje okresu próbnego, bo nie ma czym go zresetować.
 */
import {
  isManageableSaasSubscriptionStatus,
  planFromPriceLookupKey,
  saasPriceLookupKey,
  type SaasBillingInterval,
  type SaasPlanId,
  type SaasSubscriptionRead,
} from "@avably/core";
import type { TenantStatus } from "@avably/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Wycinek portu rozliczeń dla obu ścieżek zarządzania (DI dla testów). */
export interface BillingSubscriptionClient {
  readSaasSubscription(subscriptionId: string): Promise<SaasSubscriptionRead>;
  findPriceIdByLookupKey(lookupKey: string): Promise<string>;
  updateSubscriptionPrice(input: {
    subscriptionId: string;
    itemId: string;
    priceId: string;
  }): Promise<{ subscriptionId: string }>;
  resumeSubscription(input: { subscriptionId: string }): Promise<{ subscriptionId: string }>;
}

export interface BillingSubscriptionDeps {
  /** Klient SESJI właściciela — projekcja i status tenanta przez RLS. */
  supabase: SupabaseClient;
  billing: BillingSubscriptionClient;
}

export type BillingSubscriptionOutcome = { ok: true } | { error: string };

/** Statusy tenanta, w których zarządzanie abonamentem jest OTWARTE (bramka c). */
export const MANAGEABLE_TENANT_STATUSES: readonly TenantStatus[] = ["trialing", "active"];

export const NO_SUBSCRIPTION =
  "Ta organizacja nie ma jeszcze abonamentu - wybierz plan, żeby go uruchomić.";
export const SUBSCRIPTION_NOT_MANAGEABLE =
  "Abonament czeka na uregulowanie płatności - najpierw opłać zaległą fakturę w zarządzaniu płatnościami.";
export const FOREIGN_SUBSCRIPTION =
  "Nie udało się potwierdzić abonamentu tej organizacji. Skontaktuj się ze wsparciem Avably.";
export const PLAN_ALREADY_ACTIVE = "Ten plan i okres rozliczeniowy są już aktywne.";
export const PLAN_ITEM_MISSING =
  "Nie udało się odczytać pozycji abonamentu u dostawcy płatności. Spróbuj ponownie za chwilę.";
export const NOTHING_TO_RESUME =
  "Abonament nie jest anulowany - nie ma czego wznawiać.";

/** Wynik wspólnej części obu ścieżek: własna, zarządzalna subskrypcja z ODCZYTU. */
type Resolved = { read: SaasSubscriptionRead } | { error: string };

/**
 * Wspólne wejście obu ścieżek: znajdź WŁASNĄ subskrypcję i sprawdź trzy
 * bramki. Kolejność jest częścią kontraktu — najpierw „czy w ogóle moja",
 * potem „czy wolno ją dziś ruszać".
 */
async function resolveManageableSubscription(
  deps: BillingSubscriptionDeps,
  tenantId: string,
): Promise<Resolved> {
  // Bramka (c): status tenanta z ŻYWEGO odczytu przez RLS — nie z claimu JWT.
  const tenantQuery = await deps.supabase
    .from("tenants")
    .select("status")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantQuery.error) {
    return { error: `Odczyt statusu organizacji nie powiódł się: ${tenantQuery.error.message}` };
  }
  const tenantStatus = (tenantQuery.data as { status: TenantStatus } | null)?.status;
  if (!tenantStatus || !MANAGEABLE_TENANT_STATUSES.includes(tenantStatus)) {
    return { error: SUBSCRIPTION_NOT_MANAGEABLE };
  }

  // Adres subskrypcji WYŁĄCZNIE z własnego wiersza projekcji (RLS).
  const projection = await deps.supabase
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (projection.error) {
    return { error: `Odczyt stanu subskrypcji nie powiódł się: ${projection.error.message}` };
  }
  const subscriptionId = (projection.data as { stripe_subscription_id: string | null } | null)
    ?.stripe_subscription_id;
  if (!subscriptionId) {
    return { error: NO_SUBSCRIPTION };
  }

  const read = await deps.billing.readSaasSubscription(subscriptionId);

  // Bramka (a): tożsamość z ODCZYTU, nigdy z naszego wiersza.
  if (read.tenantIdFromMetadata !== tenantId) {
    return { error: FOREIGN_SUBSCRIPTION };
  }

  // Bramka (b): status subskrypcji u dostawcy.
  if (!isManageableSaasSubscriptionStatus(read.status)) {
    return { error: SUBSCRIPTION_NOT_MANAGEABLE };
  }

  return { read };
}

export interface ChangeSaasPlanInput {
  tenantId: string;
  planId: SaasPlanId;
  interval: SaasBillingInterval;
}

/**
 * ZMIANA PLANU żywej subskrypcji — podmiana ceny na istniejącej pozycji.
 * Zero nowych subskrypcji (bramka W6 z fazy 2a zostaje nietknięta: liczba
 * żywych subskrypcji na tenanta się nie zmienia) i zero zapisu u nas.
 */
export async function changeSaasPlan(
  deps: BillingSubscriptionDeps,
  input: ChangeSaasPlanInput,
): Promise<BillingSubscriptionOutcome> {
  const resolved = await resolveManageableSubscription(deps, input.tenantId);
  if ("error" in resolved) return resolved;
  const { read } = resolved;

  // Zamiar docelowy vs zamiar OBECNY — oba w tej samej konwencji lookup_key,
  // więc porównanie jest porównaniem planu i interwału naraz.
  const target = saasPriceLookupKey(input.planId, input.interval);
  const current = planFromPriceLookupKey(read.priceLookupKey);
  if (current && saasPriceLookupKey(current.planId, current.interval) === target) {
    return { error: PLAN_ALREADY_ACTIVE };
  }

  // Pozycja subskrypcji to ADRES podmiany. Brak = odmowa GŁOŚNA: bez niej
  // żądanie bez `items[0][id]` DOŁOŻYŁOBY drugą pozycję zamiast podmienić
  // pierwszą, czyli najemca płaciłby za dwa plany naraz.
  if (!read.itemId) {
    return { error: PLAN_ITEM_MISSING };
  }

  const priceId = await deps.billing.findPriceIdByLookupKey(target);
  await deps.billing.updateSubscriptionPrice({
    subscriptionId: read.subscriptionId,
    itemId: read.itemId,
    priceId,
  });
  return { ok: true };
}

/**
 * REAKTYWACJA — cofnięcie anulowania na koniec okresu. Dotyczy WYŁĄCZNIE
 * subskrypcji, która jeszcze żyje (`cancel_at_period_end = true`): powrót po
 * subskrypcji już wygaszonej (`canceled`) to nowy Checkout, którego bramka W6
 * wtedy nie zamyka — i tamta droga istnieje od fazy 2a.
 */
export async function reactivateSaasSubscription(
  deps: BillingSubscriptionDeps,
  input: { tenantId: string },
): Promise<BillingSubscriptionOutcome> {
  const resolved = await resolveManageableSubscription(deps, input.tenantId);
  if ("error" in resolved) return resolved;
  const { read } = resolved;

  // Obie strony: bez flagi anulowania nie ma czego wznawiać, a „wznowienie"
  // działającego abonamentu byłoby pustym żądaniem z komunikatem sukcesu.
  if (!read.cancelAtPeriodEnd) {
    return { error: NOTHING_TO_RESUME };
  }

  await deps.billing.resumeSubscription({ subscriptionId: read.subscriptionId });
  return { ok: true };
}
