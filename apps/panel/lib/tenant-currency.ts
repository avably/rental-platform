/**
 * Dwie osie waluty w panelu (podział z K3, ADR-103):
 *
 *   * `getTenantCurrency` — waluta OPERACYJNA tenanta (tenant_settings
 *     key='currency', fallback PLN). Od 0049 to źródło WYŁĄCZNIE dla
 *     CENNIKA (katalog, progi, kreator stron, kreator NOWEGO zamówienia)
 *     i — pośrednio — dla zamówień PRZYSZŁYCH: trigger 0049 utrwala ją na
 *     zamówieniu w chwili złożenia.
 *
 *   * `orderCurrencyCode` — waluta ZAMÓWIENIA, czytana z `orders.currency`
 *     (0049). Każdy ekran/akcja pokazujące kwoty ISTNIEJĄCEGO zamówienia
 *     (lista, szczegół, maile, PDF umowy) formatują tą walutą — zmiana
 *     ustawienia najemcy nie ma prawa przepisać wstecznie znaczenia kwot.
 *
 * LOKALIZACJA TYMCZASOWA (świadomie): waluta rozliczeń PLATFORMY to osobna
 * oś (plans.currency, 0005); waluta katalogu najemcy żyje w tenant_settings,
 * żeby panel nie zaszywał "zł" w kodzie.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_CURRENCY, isCurrencyCode, type CurrencyCode } from "@avably/core";

/**
 * NIEUDANY ODCZYT RZUCA; BRAK USTAWIENIA DALEJ ZNACZY PLN (ADR-174).
 *
 * Do ADR-174 ta funkcja czytała wyłącznie `data`, więc awaria bazy była
 * NIEODRÓŻNIALNA od najemcy, który waluty nigdy nie ustawił — i obie ścieżki
 * kończyły się `DEFAULT_CURRENCY`. Najemca rozliczający się w EUR dostawał
 * wtedy cały cennik podpisany „zł": kwoty w groszach są te same, więc nic nie
 * wygląda na zepsute, a płótno kreatora i podgląd szkicu obiecują klientowi
 * cenę w cudzej walucie.
 *
 * Rozróżnienie jest odtąd jawne: `error` = odczyt się NIE UDAŁ i trasa ma o tym
 * powiedzieć; brak wiersza albo wartość w nieoczekiwanym kształcie = najemca
 * nie ustawił waluty, a to jest stan LEGALNY z poprawną odpowiedzią PLN.
 */
export async function getTenantCurrency(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<CurrencyCode> {
  const { data, error } = await supabase
    .from("tenant_settings")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("key", "currency")
    .maybeSingle();

  if (error) throw new Error(`Odczyt waluty najemcy nie powiódł się: ${error.message}`);

  // Skalar JSON (string) — inne kształty (obiekt, liczba, nieznany kod)
  // spadają na domyślną walutę zamiast wywracać render listy produktów.
  const value = (data as { value?: unknown } | null)?.value;
  return typeof value === "string" && isCurrencyCode(value) ? value : DEFAULT_CURRENCY;
}

/**
 * Zawężenie `orders.currency` (string z bazy) do `CurrencyCode`.
 *
 * Kolumna ma CHECK na podzbiór SUPPORTED_CURRENCIES (0049), więc fallback
 * jest higieną granicy typów, nie realną ścieżką — dokładnie ten wzorzec,
 * którym storefront zawęża walutę z RPC (checkout/emails.ts).
 */
export function orderCurrencyCode(value: string | null | undefined): CurrencyCode {
  return typeof value === "string" && isCurrencyCode(value) ? value : DEFAULT_CURRENCY;
}
