/**
 * WYGLĄD SKLEPU DO ODCZYTU W PANELU (ADR-161).
 *
 * Jedno miejsce, z którego kreator, podgląd szkicu i każda przyszła
 * powierzchnia biorą motyw, akcent i parę krojów. Do fazy 2 wygląd czytało się
 * z wiersza edytowanej STRONY (`sites.style_draft` + `sites.template`) i to
 * było poprawne, dopóki wiersz `sites` znaczył WERSJĘ jednej strony. Odkąd
 * wiersze są osobnymi STRONAMI, taki odczyt znaczył „inny wygląd na każdej
 * podstronie" — a sklep ma jeden.
 *
 * ODCZYT IDZIE PRZEZ RLS (`own_select` na `tenants`, 0001), więc obcy wiersz
 * nie ma jak wejść do zapytania. Filtr `.eq("id", tenantId)` jest zawężeniem
 * i czytelnym błędem, a nie mechanizmem ochrony.
 *
 * FAIL-SOFT jest tu świadomy: nieudany odczyt albo brak wiersza dają wygląd
 * DOMYŚLNY, a nie wyjątek. Kreator bez wyglądu to i tak byłby kreator
 * domyślnego motywu; wywrócenie całej trasy z powodu jednej kolumny
 * dekoracyjnej zabrałoby operatorowi dostęp do treści, którą właśnie pisze.
 */
import { resolveSiteStyle, type ResolvedSiteStyle } from "@avably/core/site";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Styl SZKICU najemcy — to, co operator widzi w kreatorze i w podglądzie.
 * Kolumna `template` wchodzi jako FALLBACK motywu dla najemcy sprzed ADR-090:
 * identyfikatory motywów zastanych są celowo tymi samymi napisami, co wartości
 * tej kolumny, więc mapowanie jest tożsamością, a nie tablicą do zapomnienia.
 */
export async function getTenantDraftStyle(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ResolvedSiteStyle> {
  const { data } = await supabase
    .from("tenants")
    .select("template, style_draft")
    .eq("id", tenantId)
    .maybeSingle();

  return resolveSiteStyle(data?.style_draft, data?.template as string | undefined);
}
