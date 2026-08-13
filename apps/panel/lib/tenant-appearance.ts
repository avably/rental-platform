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
 * ============ NIEUDANY ODCZYT RZUCA, A NIE UDAJE DOMYŚLNEGO (ADR-174) ============
 *
 * Do ADR-174 stał tu FAIL-SOFT z uzasadnieniem „to tylko kolumna dekoracyjna,
 * a kreator bez wyglądu to i tak kreator domyślnego motywu". To uzasadnienie
 * BYŁO prawdziwe, dopóki wygląd był ustawieniem JEDNEJ podstrony. ADR-161
 * przeniósł go na najemcę: `style_draft` opisuje odtąd wygląd CAŁEGO sklepu,
 * a płótno jest jedynym miejscem, w którym operator go widzi i zmienia.
 *
 * Skutek połkniętego błędu przestał więc być kosmetyczny i stał się DROGĄ DO
 * UTRATY DANYCH: po nieudanym odczycie płótno rysuje domyślny motyw, operator
 * czyta to jako „straciłem wygląd sklepu" i naprawia jedynym dostępnym ruchem —
 * ustawia motyw od nowa. `updateStoreStyle` NADPISUJE wtedy wartość, która
 * w bazie stoi nietknięta. Awaria odczytu zamienia się w skasowanie pracy,
 * i to ręką samego operatora.
 *
 * Wywrócenie trasy jest tu odpowiedzią WŁAŚCIWĄ, a nie surowszą: kreator, który
 * nie wie, jak wygląda sklep, nie umie pokazać ani jednej rzeczy, po którą
 * operator wszedł. Wzorzec jest w repo — `site-queries.ts` i `custom-fields.ts`
 * rzucają dokładnie tak samo.
 *
 * BRAK WARTOŚCI ZOSTAJE STANEM CICHYM. Świeży najemca ma `style_draft` puste,
 * a `template` bywa `null` — `resolveSiteStyle` odpowiada wtedy motywem
 * domyślnym i to jest odpowiedź POPRAWNA, nie awaryjna. Rzuca wyłącznie odczyt,
 * który się NIE UDAŁ (`error`) albo nie zastał wiersza najemcy: po
 * `requireMemberPage` członkostwo jest ustalone, więc wiersz `tenants` o tym
 * identyfikatorze istnieje i jest widoczny przez `own_select`. Jego brak nie
 * jest legalną pustką — jest odczytem, który nie odpowiedział na pytanie.
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
  const { data, error } = await supabase
    .from("tenants")
    .select("template, style_draft")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) throw new Error(`Odczyt wyglądu sklepu nie powiódł się: ${error.message}`);
  if (!data) throw new Error("Odczyt wyglądu sklepu nie powiódł się: brak wiersza najemcy.");

  return resolveSiteStyle(data.style_draft, data.template as string | undefined);
}
