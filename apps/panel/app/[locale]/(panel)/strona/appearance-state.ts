/**
 * CZY WYGLĄD SKLEPU CZEKA NA PUBLIKACJĘ (ADR-171, wada W1 z audytu kreatora).
 *
 * Do tej poprawki `style_published`/`template_published` nie czytał ani jeden
 * ekran panelu — kolumny występowały w `apps/panel` WYŁĄCZNIE w testach.
 * Operator zmieniał motyw, akcent albo krój i nie miał skąd wiedzieć, czy
 * klienci już to mają; a w drugą stronę okno publikacji zapewniało go, że
 * „pozostałe strony sklepu zostają bez zmian", podczas gdy `publishSite`
 * wypuszcza wygląd CAŁEGO sklepu drugim wywołaniem (`publish_tenant_appearance`).
 *
 * ======== DLACZEGO PORÓWNANIE IDZIE PO WYGLĄDZIE ROZSTRZYGNIĘTYM ========
 *
 * Porównanie surowych kolumn dałoby odpowiedź FAŁSZYWĄ dla każdego nowego
 * najemcy, i to jest dokładnie ten rodzaj pomyłki, którą łapie się wyłącznie
 * na kształcie produkcyjnym. Świeży wiersz `tenants` ma:
 *
 *     template = 'classic'   template_published = NULL
 *     style_draft = '{}'     style_published = '{}'
 *
 * czyli `template <> template_published` jest PRAWDĄ, choć sklep pokazuje
 * dokładnie ten sam wygląd, co panel — odczyt publiczny bierze
 * `coalesce(template_published, 'classic')` (0077). Ekran świeciłby wtedy
 * „wygląd czeka na publikację" każdemu najemcy od pierwszej sekundy, a stałe
 * ostrzeżenie przestaje być czytane po drugim razie.
 *
 * `resolveSiteStyle` domyka obie strony tą samą regułą, którą render domyka
 * wygląd sklepu (motyw zastany jako fallback, akcent spoza palety motywu
 * spada na domyślny), więc porównanie odpowiada na pytanie o WIDOCZNĄ różnicę,
 * a nie o różnicę zapisu.
 */
import { resolveSiteStyle } from "@avably/core/site";

/** Cztery kolumny wyglądu z wiersza najemcy (0077) — tak, jak leżą w bazie. */
export interface TenantAppearanceColumns {
  template: string | null;
  template_published: string | null;
  style_draft: unknown;
  style_published: unknown;
}

/**
 * `true` = szkic wyglądu różni się od tego, co widzą klienci.
 *
 * Wsad `null` (nieudany odczyt) NIE jest tu obsługiwany świadomie: „nie wiadomo"
 * i „nie ma różnicy" to dwa różne stany, a funkcja boolowska umie oddać tylko
 * jeden z nich. Rozstrzyga to wołający — ekran po nieudanym odczycie nie
 * pokazuje karty w ogóle, zamiast twierdzić cokolwiek o sklepie.
 */
export function appearancePending(columns: TenantAppearanceColumns): boolean {
  const draft = resolveSiteStyle(columns.style_draft, columns.template ?? undefined);
  const published = resolveSiteStyle(
    columns.style_published,
    columns.template_published ?? undefined,
  );

  return (
    draft.theme !== published.theme ||
    draft.accent !== published.accent ||
    draft.fontPair !== published.fontPair
  );
}
