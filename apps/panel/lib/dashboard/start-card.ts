/**
 * Karta „Zacznij tutaj" na pulpicie (UX1, ADR-140) — stan kroków LICZONY
 * z danych, które już są. ZERO nowych kolumn i zero „odhaczania ręcznie":
 * krok jest zrobiony wtedy i tylko wtedy, gdy mówią to istniejące wiersze.
 *
 * Źródła stanów (wszystkie po RLS z sesji operatora, jak sekcje pulpitu):
 *   1. produkt + egzemplarz — `products` (pierwszy wiersz) i `product_units`
 *      (licznik); krok wymaga OBU, bo bez egzemplarza nie ma dostępności;
 *   2. strona sklepu — `sites.published_at` (NULL = nigdy nie opublikowana,
 *      publikacja wyłącznie przez app.publish_site — ADR-041);
 *   3. dane firmy do umów — `tenant_settings` klucz `contract_document`
 *      (CHECK z 0026 gwarantuje komplet pól, więc sama obecność wystarcza);
 *   4. nadawca e-maili — `tenant_settings` klucz `email_sender` (ADR-033);
 *   5. płatności online — `payment_accounts.charges_enabled` (dopiero konto
 *      ZDOLNE przyjmować płatności jest „podłączone"; sam wiersz to
 *      rozpoczęty onboarding);
 *   6. pierwsze zamówienie — `orders` (dowolny wiersz; zamówienie testowe
 *      na końcu listy przechodzi PEŁNY, skonfigurowany cykl najmu).
 *
 * `ordersCount` służy też bramce siatki dnia: przy ZERZE zamówień miejsce
 * kafli zajmuje ta karta (stany wykluczają się — spec UX1), więc jeden odczyt
 * karmi obie decyzje renderu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const START_STEP_KEYS = [
  "product",
  "store",
  "contract",
  "emails",
  "payments",
  "firstOrder",
] as const;

export type StartStepKey = (typeof START_STEP_KEYS)[number];

/** Surowe sygnały z bazy — wejście czystego modelu kroków. */
export interface StartCardSignals {
  firstProductName: string | null;
  unitCount: number;
  publishedAt: string | null;
  hasContractDocument: boolean;
  hasEmailSender: boolean;
  chargesEnabled: boolean;
  ordersCount: number;
}

export interface StartStep {
  key: StartStepKey;
  done: boolean;
}

/**
 * Stany kroków z sygnałów — CZYSTA funkcja (testowalna bez Supabase).
 * Kolejność = kolejność karty: fundament (1–2) → konfiguracja sprzedaży
 * (3–5) → pierwsze zamówienie (6, korekta właściciela — zamyka listę).
 */
export function startSteps(signals: StartCardSignals): StartStep[] {
  return [
    { key: "product", done: signals.firstProductName !== null && signals.unitCount > 0 },
    { key: "store", done: signals.publishedAt !== null },
    { key: "contract", done: signals.hasContractDocument },
    { key: "emails", done: signals.hasEmailSender },
    { key: "payments", done: signals.chargesEnabled },
    { key: "firstOrder", done: signals.ordersCount > 0 },
  ];
}

/** Karta znika W CAŁOŚCI dopiero po komplecie kroków. */
export function isStartComplete(steps: readonly StartStep[]): boolean {
  return steps.every((step) => step.done);
}

/**
 * Odczyt sygnałów karty — sześć lekkich zapytań RÓWNOLEGLE, klientem z sesji
 * operatora (RLS ogranicza do tenanta; jawny filtr tenant_id to obrona
 * w głąb, spójnie z resztą ekranów panelu). Błąd odczytu RZUCA — karta
 * z fałszywym „zrobione"/„niezrobione" to zmyślony stan konta.
 */
export async function fetchStartCardSignals(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<StartCardSignals> {
  const fail = (source: string, message: string): never => {
    throw new Error(`Odczyt karty startowej (${source}) nie powiódł się: ${message}`);
  };

  const [product, units, site, settings, payments, orders] = await Promise.all([
    supabase
      .from("products")
      .select("name")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("product_units")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabase
      .from("sites")
      .select("published_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("tenant_settings")
      .select("key")
      .eq("tenant_id", tenantId)
      .in("key", ["contract_document", "email_sender"]),
    supabase
      .from("payment_accounts")
      .select("charges_enabled")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
  ]);

  if (product.error) fail("products", product.error.message);
  if (units.error) fail("product_units", units.error.message);
  if (site.error) fail("sites", site.error.message);
  if (settings.error) fail("tenant_settings", settings.error.message);
  if (payments.error) fail("payment_accounts", payments.error.message);
  if (orders.error) fail("orders", orders.error.message);

  const settingKeys = new Set((settings.data ?? []).map((row) => row.key as string));

  return {
    firstProductName: (product.data?.name as string | undefined) ?? null,
    unitCount: units.count ?? 0,
    publishedAt: (site.data?.published_at as string | undefined) ?? null,
    hasContractDocument: settingKeys.has("contract_document"),
    hasEmailSender: settingKeys.has("email_sender"),
    chargesEnabled: payments.data?.charges_enabled === true,
    ordersCount: orders.count ?? 0,
  };
}
