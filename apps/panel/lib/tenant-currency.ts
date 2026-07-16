/**
 * Waluta operacyjna tenanta: tenant_settings key='currency', fallback PLN.
 *
 * LOKALIZACJA TYMCZASOWA (świadomie): dziś jedynym źródłem waluty rozliczeń
 * PLATFORMY jest plans.currency (0005), ale waluta, w której najemca wycenia
 * SWÓJ katalog, to inna oś — i docelowo (faza 2/3, storefront + Stripe)
 * dostanie własne miejsce w modelu. Do tego czasu żyje w tenant_settings,
 * żeby panel nie zaszywał "zł" w kodzie.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_CURRENCY, isCurrencyCode, type CurrencyCode } from "@avably/core";

export async function getTenantCurrency(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<CurrencyCode> {
  const { data } = await supabase
    .from("tenant_settings")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("key", "currency")
    .maybeSingle();

  // Skalar JSON (string) — inne kształty (obiekt, liczba, nieznany kod)
  // spadają na domyślną walutę zamiast wywracać render listy produktów.
  const value = (data as { value?: unknown } | null)?.value;
  return typeof value === "string" && isCurrencyCode(value) ? value : DEFAULT_CURRENCY;
}
