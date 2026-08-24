/**
 * Config-first hub „Uruchomienie" (wariant C, ADR-228) — MODEL faz/kroków,
 * SYGNAŁY detekcji i SOFT-GATE publikacji.
 *
 * ================== SKĄD BIORĄ SIĘ STANY KROKÓW ==================
 *
 * Ani jeden krok nie jest „odhaczany ręcznie": stan liczy się z danych, które
 * i tak już są. Rdzeń sygnałów to `fetchStartCardSignals` (UX1, ADR-140) — ten
 * sam odczyt, którym żyje karta pulpitu — a hub DOKŁADA dwa sygnały read-only,
 * bez ani jednej nowej kolumny czy migracji:
 *
 *   • REGULAMIN I POLITYKA (`legalReady`) — bramka sprzedaży. Liczona TAK SAMO,
 *     jak checkout liczy `legalGateOpen` (apps/storefront/.../checkout/page.tsx):
 *     sklep sprzedaje dopiero, gdy OPUBLIKOWANE są OBA dokumenty — regulamin
 *     ORAZ polityka prywatności (H-COMP-01, ADR-191). „Opublikowany" = wiersz
 *     `legal_documents` danego rodzaju ma `current_version_id` (migracja 0063:
 *     to on wskazuje żywą wersję; `app.get_published_legal_documents`, którego
 *     używa checkout, zwraca wyłącznie dokumenty z ustawionym wskaźnikiem).
 *
 *   • DOSTAWA (`hasDelivery`) — czy klient ma JAK odebrać sprzęt, liczone tak,
 *     jak decyduje o tym storefront. `app.get_public_catalog` (migracja 0072)
 *     składa listę odbioru z AKTYWNYCH punktów (`pickup_locations.active`) i
 *     listę metod płatnych z cennika `tenant_settings.delivery_pricing`
 *     (courier/parcel_locker/own_delivery). Syntetyczna metoda „pickup" jest w
 *     tej liście ZAWSZE, więc sama jej obecność niczego nie dowodzi — realna
 *     droga odbioru istnieje, gdy jest AKTYWNY punkt odbioru LUB skonfigurowana
 *     metoda płatna. Cennik czyta jedyne w repo źródło prawdy
 *     `deliveryPricingFromSettings` (@avably/core) — to samo, którego używa
 *     ekran ustawień dostaw (`delivery-settings-status.ts`).
 *
 * Detekcja respektuje RLS/tenant jak `fetchStartCardSignals`: klient z sesji
 * operatora, jawny filtr `tenant_id` jako obrona w głąb. Błąd transportu RZUCA
 * — hub z fałszywym „zrobione"/„niezrobione" to zmyślony stan konta.
 *
 * ================== SOFT-GATE PUBLIKACJI ==================
 *
 * `publishSite` (lib/actions/site.ts) jest w kodzie BEZWARUNKOWY — baza nie
 * pyta o legalia, ofertę ani dostawę. Logiczną bramkę „czy sklep może już
 * sprzedawać" trzyma więc TEN moduł: `publishGateBlockers` liczy minimum
 * sprzedażowe (oba dokumenty prawne + ≥1 produkt AKTYWNY + metoda dostawy).
 * Hub deep-linkuje do `/strona` (tam żyje `PublishDialog`/`publishSite`)
 * DOPIERO, gdy bramka otwarta — publikacji ani jej rewalidacji NIE
 * reimplementujemy.
 */
import { deliveryPricingFromSettings } from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidateTag, unstable_cache } from "next/cache";

import {
  fetchStartCardSignals,
  startSteps,
  type StartCardSignals,
} from "@/lib/dashboard/start-card";

/** Rodzaje dokumentów, których wymaga bramka sprzedaży (lustro CHECK-u 0063). */
const LEGAL_REQUIRED_KINDS = ["terms", "privacy"] as const;

/**
 * Surowe sygnały huba = sygnały karty startowej (reużyte) + dwa dołożone
 * read-only + licznik produktów aktywnych na potrzeby soft-gate.
 */
export interface LaunchSignals extends StartCardSignals {
  /** OBA dokumenty prawne opublikowane (tak jak `legalGateOpen` w checkoutcie). */
  legalReady: boolean;
  /** Aktywny punkt odbioru LUB skonfigurowana płatna metoda dostawy. */
  hasDelivery: boolean;
  /** Liczba produktów `active = true` — soft-gate pyta o produkt SPRZEDAWALNY. */
  activeProductCount: number;
  /** Zweryfikowana własna domena (krok opcjonalny — subdomena działa od razu). */
  customDomainReady: boolean;
}

/** Kolejność config-first: firma/zgodność → logistyka → oferta → uruchomienie. */
export const LAUNCH_STEP_KEYS = [
  "organization",
  "legal",
  "contract",
  "emails",
  "delivery",
  "payments",
  "domain",
  "product",
  "appearance",
] as const;

export type LaunchStepKey = (typeof LAUNCH_STEP_KEYS)[number];

export type LaunchPhaseId = 1 | 2 | 3 | 4;

export interface LaunchStep {
  key: LaunchStepKey;
  phase: LaunchPhaseId;
  done: boolean;
  /** Wlicza się do pierścienia postępu i do „ukończenia" (opcjonalne — nie). */
  required: boolean;
  /** Krok opcjonalny — dostępny osobno, ale nie wymuszany (dashed). */
  optional: boolean;
  /** Twarda bramka sprzedaży (dziś: regulamin i polityka) — wyróżnienie „!". */
  gate: boolean;
  /** Deep-link do istniejącego ekranu konfiguracji. */
  href: string;
}

/** Docelowe ekrany kroków — deep-linki do tego, co już istnieje. */
export const LAUNCH_STEP_HREFS: Record<LaunchStepKey, string> = {
  organization: "/organizacja",
  legal: "/dokumenty-prawne",
  contract: "/ustawienia-umow",
  emails: "/ustawienia-emaili",
  delivery: "/ustawienia-dostaw",
  payments: "/ustawienia-platnosci",
  domain: "/ustawienia-domen",
  product: "/katalog/nowy",
  appearance: "/strona",
};

/**
 * Stany kroków z sygnałów — CZYSTA funkcja (testowalna bez Supabase).
 *
 * Pięć stanów współdzielonych z kartą startową NIE jest liczonych drugi raz:
 * bierze je `startSteps` (jedno źródło prawdy — produkt, strona, umowa, e-maile,
 * płatności). Hub tylko przekłada je na swój porządek faz i dokłada legalia,
 * dostawę i domenę. „Dane organizacji" są zawsze ✓ (seed z `create_tenant`).
 * „Wygląd/uruchomienie" = strona główna OPUBLIKOWANA (sygnał `store` karty).
 */
export function launchSteps(signals: LaunchSignals): LaunchStep[] {
  const base = Object.fromEntries(
    startSteps(signals).map((step) => [step.key, step.done]),
  ) as Record<string, boolean>;

  const step = (
    key: LaunchStepKey,
    phase: LaunchPhaseId,
    done: boolean,
    flags: { required?: boolean; optional?: boolean; gate?: boolean } = {},
  ): LaunchStep => ({
    key,
    phase,
    done,
    required: flags.required ?? false,
    optional: flags.optional ?? false,
    gate: flags.gate ?? false,
    href: LAUNCH_STEP_HREFS[key],
  });

  return [
    // Faza 1 — firma i zgodność.
    step("organization", 1, true, { required: true }),
    step("legal", 1, signals.legalReady, { required: true, gate: true }),
    step("contract", 1, base.contract === true, { required: true }),
    step("emails", 1, base.emails === true, { required: true }),
    // Faza 2 — logistyka i płatności.
    step("delivery", 2, signals.hasDelivery, { required: true }),
    step("payments", 2, base.payments === true, { optional: true }),
    step("domain", 2, signals.customDomainReady, { optional: true }),
    // Faza 3 — oferta.
    step("product", 3, base.product === true, { required: true }),
    // Faza 4 — wygląd i uruchomienie (ukończenie powiązane z publikacją strony).
    step("appearance", 4, base.store === true, { required: true }),
  ];
}

export interface LaunchProgress {
  done: number;
  total: number;
}

/** Postęp WYMAGANYCH kroków (opcjonalne nie liczą się do pierścienia). */
export function launchProgress(steps: readonly LaunchStep[]): LaunchProgress {
  const required = steps.filter((step) => step.required);
  return { done: required.filter((step) => step.done).length, total: required.length };
}

/** Hub (baner pulpitu, pozycja nav) znika, gdy KOMPLET wymaganych kroków zrobiony. */
export function isLaunchComplete(steps: readonly LaunchStep[]): boolean {
  return steps.filter((step) => step.required).every((step) => step.done);
}

/** Pierwszy niezrobiony krok WYMAGANY — jedyny z wyróżnionym CTA. */
export function firstOpenRequiredKey(
  steps: readonly LaunchStep[],
): LaunchStepKey | undefined {
  return steps.find((step) => step.required && !step.done)?.key;
}

// ================== SOFT-GATE PUBLIKACJI ==================

export type PublishBlocker = "legal" | "product" | "delivery";

/** Minimum sprzedażowe — wejście soft-gate'u (czyste, testowalne). */
export interface PublishGateSignals {
  legalReady: boolean;
  hasActiveProduct: boolean;
  hasDelivery: boolean;
}

/**
 * Braki minimum sprzedażowego, w kolejności prezentacji. Pusta lista =
 * sklep może sprzedawać, więc „Opublikuj sklep" jest aktywne. Każdy warunek
 * jest osobną gałęzią, żeby dowód mutacyjny (usunięcie sprawdzenia dostawy)
 * zapalał dokładnie jeden przypadek testu.
 */
export function publishGateBlockers(signals: PublishGateSignals): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (!signals.legalReady) blockers.push("legal");
  if (!signals.hasActiveProduct) blockers.push("product");
  if (!signals.hasDelivery) blockers.push("delivery");
  return blockers;
}

/** Bramka otwarta ⇔ zero braków minimum sprzedażowego. */
export function isPublishGateOpen(signals: PublishGateSignals): boolean {
  return publishGateBlockers(signals).length === 0;
}

/** Zawężenie pełnych sygnałów huba do wejścia soft-gate'u. */
export function publishGateSignals(signals: LaunchSignals): PublishGateSignals {
  return {
    legalReady: signals.legalReady,
    // Produkt SPRZEDAWALNY: storefront pokazuje wyłącznie `products.active`
    // (get_public_catalog), więc bramka pyta o aktywny, nie o dowolny wiersz.
    hasActiveProduct: signals.activeProductCount > 0,
    hasDelivery: signals.hasDelivery,
  };
}

// ================== ODCZYT SYGNAŁÓW ==================

/**
 * Dwa dołożone sygnały + licznik produktów aktywnych + domena, RÓWNOLEGLE,
 * klientem z sesji operatora. Błąd transportu RZUCA (jak `fetchStartCardSignals`)
 * — jedynym wyjątkiem jest WADLIWY cennik dostaw: `deliveryPricingFromSettings`
 * rzuca `CourierConfigError` na złym wpisie, a to jest „dostawa nieskonfigurowana",
 * nie awaria odczytu (spójnie z `delivery-settings-status.ts`).
 */
export async function fetchLaunchExtraSignals(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{
  legalReady: boolean;
  hasDelivery: boolean;
  activeProductCount: number;
  customDomainReady: boolean;
}> {
  const fail = (source: string, message: string): never => {
    throw new Error(`Odczyt sygnałów uruchomienia (${source}) nie powiódł się: ${message}`);
  };

  const [legal, pickups, pricingSetting, activeProducts, customDomain] = await Promise.all([
    supabase
      .from("legal_documents")
      .select("kind, current_version_id")
      .eq("tenant_id", tenantId)
      .in("kind", [...LEGAL_REQUIRED_KINDS]),
    supabase
      .from("pickup_locations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("active", true),
    supabase
      .from("tenant_settings")
      .select("key, value")
      .eq("tenant_id", tenantId)
      .eq("key", "delivery_pricing"),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("active", true),
    // Własna domena zweryfikowana: subdomena ma `verified = true` z definicji,
    // więc filtr `kind = custom` odróżnia realnie podłączony adres od domyślnego.
    supabase
      .from("domains")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("kind", "custom")
      .eq("verified", true)
      .limit(1)
      .maybeSingle(),
  ]);

  if (legal.error) fail("legal_documents", legal.error.message);
  if (pickups.error) fail("pickup_locations", pickups.error.message);
  if (pricingSetting.error) fail("tenant_settings", pricingSetting.error.message);
  if (activeProducts.error) fail("products", activeProducts.error.message);
  if (customDomain.error) fail("domains", customDomain.error.message);

  const publishedKinds = new Set(
    (legal.data ?? [])
      .filter((row) => (row.current_version_id as string | null) != null)
      .map((row) => row.kind as string),
  );
  const legalReady = LEGAL_REQUIRED_KINDS.every((kind) => publishedKinds.has(kind));

  const hasPickup = (pickups.count ?? 0) > 0;
  let hasPricedMethod: boolean;
  try {
    const pricing = deliveryPricingFromSettings(
      (pricingSetting.data ?? []) as { key: string; value: unknown }[],
    );
    hasPricedMethod = pricing !== null && Object.keys(pricing).length > 0;
  } catch {
    // Wadliwy cennik = dostawa nieskonfigurowana (nie awaria) — jak na ekranie
    // ustawień dostaw. Punkt odbioru może i tak otwierać dostawę.
    hasPricedMethod = false;
  }

  return {
    legalReady,
    hasDelivery: hasPickup || hasPricedMethod,
    activeProductCount: activeProducts.count ?? 0,
    customDomainReady: customDomain.data != null,
  };
}

/** Pełne sygnały huba — karta startowa (reużyta) + sygnały dołożone, równolegle. */
export async function fetchLaunchSignals(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<LaunchSignals> {
  const [base, extra] = await Promise.all([
    fetchStartCardSignals(supabase, tenantId),
    fetchLaunchExtraSignals(supabase, tenantId),
  ]);
  return { ...base, ...extra };
}

// ================== CACHE SYGNAŁÓW (per-tenant, ADR-261) ==================

/**
 * TAG CACHE SYGNAŁÓW URUCHOMIENIA — JEDEN format po obu stronach kontraktu:
 * `readCachedLaunchSignals` taguje nim wpis, a mutacje zmieniające sygnały
 * emitują `revalidateTag(launchCacheTag(id))`. Tag NIESIE `tenantId`, bo to
 * BRAMKA IZOLACJI, nie kosmetyka: wpis jednego najemcy nie może unieważnić ani
 * — co gorsza — nakarmić drugiego. Tag globalny („launch") wymieszałby sygnały
 * między najemcami i jest tu ZAKAZANY.
 *
 * Osobny od `tenantCacheTag` (`tenant:<id>`) świadomie: tamten unieważnia CAŁĄ
 * powłokę/sklep na wielu mutacjach, a ten jest CIENKI — inwaliduje się TYLKO,
 * gdy realnie zmienia się któryś z jedenastu sygnałów uruchomienia.
 */
export function launchCacheTag(tenantId: string): string {
  return `launch:${tenantId}`;
}

/**
 * Okno świeżości cache sygnałów (sekundy). Dwa sygnały zmieniają się POZA
 * panelem i nie mają jak zawołać `revalidateTag`: `chargesEnabled` (webhook
 * Stripe) i `ordersCount` (checkout sklepu). TTL jest ich jedyną siecią
 * bezpieczeństwa — reszta sygnałów inwaliduje się precyzyjnie tagiem przy
 * mutacji panelu, więc to okno domyka wyłącznie te dwa krańce, nie tłumiąc
 * świeżości kroków sterowanych z panelu.
 */
export const LAUNCH_SIGNALS_CACHE_SECONDS = 300;

/**
 * Sygnały uruchomienia SPOZA cache'u trafionego per-tenant (`unstable_cache`,
 * ADR-261). Ukończony najemca (7/7) NIE odpala jedenastu zapytań na każdym
 * renderze layoutu — trafia w gotowy wpis; świeże zapytania idą dopiero po
 * `revalidateTag(launchCacheTag(id))` z mutacji zmieniającej sygnał (albo po
 * wygaśnięciu TTL).
 *
 * Klucz i tag NIOSĄ `tenantId` — izolacja per-tenant jest twarda: dwaj
 * najemcy mają rozłączne wpisy, więc sygnały A nie mogą wyciec do B. Sam
 * ODCZYT jest niezmieniony (klient z sesji operatora + jawny filtr tenant_id +
 * RLS): cache nie rozluźnia zakresu, tylko oszczędza powtórzony koszt.
 *
 * Domknięcie przechwytuje `supabase` żądania: przy TRAFIENIU w cache w ogóle
 * się nie wykonuje (zero zapytań), a przy pudle działa klientem bieżącego
 * żądania — wynik jest identyczny dla każdego członka tego samego najemcy, bo
 * sygnały są własnością najemcy, nie użytkownika.
 */
export async function readCachedLaunchSignals(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<LaunchSignals> {
  const load = unstable_cache(
    () => fetchLaunchSignals(supabase, tenantId),
    ["launch-signals", tenantId],
    { tags: [launchCacheTag(tenantId)], revalidate: LAUNCH_SIGNALS_CACHE_SECONDS },
  );
  return load();
}

/**
 * Unieważnia cache sygnałów uruchomienia TEGO najemcy. Wołane WYŁĄCZNIE
 * z akcji serwerowych zmieniających któryś z sygnałów (pierwszy produkt,
 * publikacja legaliów, cennik/punkt dostawy, publikacja sklepu, umowy, nadawca
 * e-maili, egzemplarze, weryfikacja domeny). `tenantId` pochodzi z kontekstu
 * członkostwa (`requireMember`), nigdy z wejścia akcji — inaczej członek
 * jednego najemcy zrzucałby cache drugiemu. Profil `"max"` spójnie z resztą
 * panelu (`revalidateTag(tenantCacheTag(...), "max")`).
 */
export function revalidateLaunchSignals(tenantId: string): void {
  revalidateTag(launchCacheTag(tenantId), "max");
}

/**
 * Stan CIĄGŁEGO PRZEWODNIKA uruchomienia (ADR-229) — jedno źródło prawdy dla
 * WSZYSTKICH powierzchni onboardingu shella: badge nawigacji, sticky pasek
 * przewodnika i karta pulpitu.
 *
 * Wszystko WYPROWADZONE z JEDNEGO odczytu `fetchLaunchSignals` (ten sam, który
 * badge robił już dziś), więc pasek NIE dokłada ani jednego zapytania ponad
 * istniejący koszt — postęp, następny krok i braki liczą się z już policzonych
 * `launchSteps` / `firstOpenRequiredKey` / `publishGateBlockers`.
 */
export interface LaunchGuideState {
  /** Postęp WYMAGANYCH kroków — pierścień paska, badge i karta pokazują ten sam. */
  progress: LaunchProgress;
  /**
   * Pierwszy otwarty krok WYMAGANY — cel deep-linku „Dokończ krok". `null`, gdy
   * wszystkie wymagane zrobione poza tymi, które domyka publikacja (skrajny
   * przypadek; pasek pokazuje wtedy sam postęp bez wyróżnionego CTA). Etykietę
   * kroku odczytuje komponent z i18n (`launch.steps.<key>.title`) — moduł
   * danych nie zna tłumaczeń.
   */
  nextStep: { key: LaunchStepKey; href: string } | null;
  /** Braki minimum sprzedażowego (regulamin/produkt/dostawa) — chipy overlaya i karty. */
  blockers: PublishBlocker[];
}

/**
 * JEDEN fail-silent odczyt shella na KAŻDYM ekranie panelu (ADR-228 badge,
 * rozszerzony w ADR-229 o pasek przewodnika i karcie pulpitu; buforowany
 * per-tenant w ADR-261).
 *
 * Od ADR-261 sygnały idą przez `readCachedLaunchSignals` — ukończony najemca
 * NIE płaci jedenastu zapytań na każdym renderze layoutu, tylko trafia w cache
 * (świeżość pilnuje `revalidateTag` z mutacji + TTL). Odczyt pozostaje
 * tenant-scope (RLS + jawny filtr), a klucz/tag niosą `tenantId` — zero wycieku
 * między najemcami.
 *
 * Błąd odczytu nie może wywrócić layoutu — jak reszta fail-silent odczytów
 * shella (rozliczenia, organizacje) przy jakiejkolwiek awarii zwraca `null`
 * i wszystkie powierzchnie po prostu się nie pokazują. `null` = onboarding
 * ukończony ALBO odczyt się nie udał: pasek i badge gasną RAZEM (jedno źródło).
 */
export async function readLaunchGuideState(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<LaunchGuideState | null> {
  try {
    const signals = await readCachedLaunchSignals(supabase, tenantId);
    const steps = launchSteps(signals);
    if (isLaunchComplete(steps)) return null;
    const nextKey = firstOpenRequiredKey(steps);
    return {
      progress: launchProgress(steps),
      nextStep: nextKey ? { key: nextKey, href: LAUNCH_STEP_HREFS[nextKey] } : null,
      blockers: publishGateBlockers(publishGateSignals(signals)),
    };
  } catch {
    return null;
  }
}
