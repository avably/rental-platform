/**
 * Maszyna stanów billingu SaaS — lustro TS tablicy przejść z migracji 0067
 * (J2 faza 2a, ADR-136).
 *
 * ŹRÓDŁEM PRAWDY O SUBSKRYPCJI JEST STRIPE (rdzeń stripe-native, decyzja PM
 * po spike'u J2). Lokalne `public.subscriptions` to PROJEKCJA odczytu
 * u dostawcy, a `tenants.status` — jej EGZEKUCJA. To lustro istnieje po to,
 * żeby kod TS (webhook, rekoncyliacja, testy) mówił tym samym słownikiem co
 * SQL — sama decyzja przejścia жyje w JEDNYM miejscu:
 * `app.apply_saas_subscription_state` (0067). Zmiana tutaj bez zmiany
 * w migracji to rozjazd, który pali test tabelaryczny.
 *
 * TABLICA PRZEJŚĆ (decyzja właściciela/PM — brief J2 fazy 2a; zasady okna
 * dunningowego 1-8 z 2026-08-10):
 *
 *   status subskrypcji Stripe  →  tenants.status
 *   -------------------------------------------------
 *   trialing | active          →  active   (+ suspended_at = NULL)
 *   past_due                   →  past_due (sklep DZIAŁA — predykat ADR-134)
 *   unpaid                     →  suspended (+ suspended_at przy PIERWSZYM wejściu)
 *   canceled | incomplete |
 *   incomplete_expired | paused → (bez zmiany tenants.status — projekcja tak)
 *
 * PĘTLE WŁASNE SĄ NORMĄ (zasada 6): comiesięczne `invoice.paid` przy
 * `active` i powtórki dunningowe przy `past_due` to zwykłe przebiegi,
 * nie błędy — mapowanie jest czystą funkcją stanu, nie diffem zdarzeń.
 *
 * `superadmin_locked` i `cancelled` są NIENARUSZALNE przez przejścia
 * billingowe — zapłata faktury nie zdejmuje blokady platformowej ani nie
 * reanimuje zamkniętej organizacji. Tę granicę egzekwuje SQL (0067);
 * tutaj jest tylko nazwana, bo mapowanie w ogóle nie przyjmuje statusu
 * tenanta — z konstrukcji nie ma jak jej złamać po stronie TS.
 *
 * DLACZEGO `canceled` NIE DOTYKA TENANTA. Ustawienie po stronie Stripe
 * „po wyczerpaniu prób → unpaid, nie canceled" to wymaganie konfiguracyjne
 * OPS właściciela (ADR-136). Gdyby mimo to przyszło `canceled` (np. ręczna
 * operacja w dashboardzie), zgaszenie tenanta bez tej konfiguracji byłoby
 * egzekucją, której nikt nie zdecydował — projekcja zapisuje stan, a rozjazd
 * jest widoczny w rekoncyliacji i na ekranie superadmina.
 */
import type { SaasPlanId } from "../billing/pricing";

/**
 * Pełny słownik statusów subskrypcji Stripe — LUSTRO CHECK-a
 * `subscriptions_status_check` z 0067 (W9 ze spike'u: brak `paused` w CHECK-u
 * zamieniał webhook w 23514 i mroził tenanta w poprzednim stanie).
 * `active` pisze też `app.superadmin_set_plan` (comp ręczny) — jest w zbiorze.
 */
export const SAAS_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;

export type SaasSubscriptionStatus = (typeof SAAS_SUBSCRIPTION_STATUSES)[number];

/**
 * Statusy, przy których subskrypcja ŻYJE z punktu widzenia bramki
 * jednej-subskrypcji-na-tenanta (W6): istnienie subskrypcji w tym zbiorze
 * ZAMYKA checkout — druga subskrypcja to podwójne comiesięczne obciążenie,
 * niewidoczne w naszej bazie (PK = tenant_id mieści jeden wiersz).
 * `incomplete` celowo POZA zbiorem: w trybie Checkout subskrypcja powstaje
 * dopiero po opłaceniu sesji, a wisząca `incomplete` z innej ścieżki wygasa
 * sama w 24 h i nigdy nie obciąża.
 */
export const LIVE_SAAS_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
] as const satisfies readonly SaasSubscriptionStatus[];

export function isLiveSaasSubscriptionStatus(status: string): boolean {
  return (LIVE_SAAS_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/**
 * Statusy subskrypcji, w których najemca może SAM przestawić abonament —
 * zmienić plan albo cofnąć anulowanie (J2 faza 3, ADR-152).
 *
 * Zbiór jest WĘŻSZY od „żywej" subskrypcji i to jest jego jedyne zadanie.
 * `past_due` i `unpaid` żyją (blokują drugi checkout), ale w nich najemca
 * jest WINIEN pieniądze: zmiana planu byłaby wtedy handlem na kredyt
 * z prorata-korektą zaległej faktury, a cofnięcie anulowania — obejściem
 * zawieszenia za nieopłacenie (okno domykania, ADR-138). Droga z obu tych
 * stanów prowadzi przez zapłatę, nie przez zmianę planu. `paused`,
 * `canceled` i `incomplete*` nie mają czego przestawiać: powrót z nich to
 * nowy Checkout, którego bramka W6 już nie zamyka.
 */
export const MANAGEABLE_SAAS_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
] as const satisfies readonly SaasSubscriptionStatus[];

export function isManageableSaasSubscriptionStatus(status: string): boolean {
  return (MANAGEABLE_SAAS_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/** Statusy tenanta, które przejścia billingowe mają prawo USTAWIĆ. */
export type BillingTenantStatus = "active" | "past_due" | "suspended";

/**
 * Tłumaczenie odczytu subskrypcji na cel `tenants.status`.
 * `null` = przejście billingowe NIE dotyka statusu tenanta (projekcja tak).
 *
 * Czysta funkcja bez wyjątków: status spoza słownika też daje `null` —
 * o odmowie zapisu projekcji z nieznanym statusem decyduje CHECK w bazie
 * (głośno, w rejestrze zdarzeń), nie ciche mapowanie.
 */
export function mapSaasSubscriptionToTenantStatus(
  subscriptionStatus: string,
): BillingTenantStatus | null {
  switch (subscriptionStatus) {
    case "trialing":
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
      return "suspended";
    default:
      return null;
  }
}

/** Interwał rozliczeniowy oferty SaaS — słownik zamiaru checkoutu. */
export const SAAS_BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type SaasBillingInterval = (typeof SAAS_BILLING_INTERVALS)[number];

/**
 * Konwencja lookup_key cen na koncie platformy: `saas_<plan>_<interwał>`.
 * Mapowanie jest DWUSTRONNE i to jest jego cała wartość: checkout resolwuje
 * cenę po kluczu (zero price-id w env), a webhook wyciąga plan z ODCZYTU
 * subskrypcji (items → price.lookup_key), nigdy z payloadu zdarzenia.
 */
export function saasPriceLookupKey(planId: SaasPlanId, interval: SaasBillingInterval): string {
  return `saas_${planId}_${interval}`;
}

export interface SaasPlanIntent {
  planId: SaasPlanId;
  interval: SaasBillingInterval;
}

/** Odwrotność `saasPriceLookupKey`; nieznany klucz → null (nigdy zgadywanie). */
export function planFromPriceLookupKey(lookupKey: string | null): SaasPlanIntent | null {
  if (!lookupKey) return null;
  const match = /^saas_(standard|premium)_(monthly|yearly)$/.exec(lookupKey);
  if (!match) return null;
  return { planId: match[1] as SaasPlanId, interval: match[2] as SaasBillingInterval };
}

/**
 * Zdarzenia billingu, po których SIĘGAMY PO ODCZYT subskrypcji (lustro
 * `OBSERVED_INTENT_EVENTS` z webhook.ts). Lista NIE jest mapą „typ → stan":
 * typ odpowiada wyłącznie na pytanie „czy warto teraz zapytać dostawcę" —
 * o stan pyta się `readSaasSubscription`. Zdarzenia spoza listy są
 * rejestrowane bez zapisu stanu (ślad zamiast ciszy).
 */
export const OBSERVED_SAAS_BILLING_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

export function isObservedSaasBillingEvent(type: string): boolean {
  return (OBSERVED_SAAS_BILLING_EVENTS as readonly string[]).includes(type);
}
