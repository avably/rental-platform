/**
 * PODZIAŁ SEKCJI SZKICU NA „STRONĘ" I „POWŁOKĘ" — LUSTRO SKLEPU (ADR-172).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Od ADR-154 stopka jest sekcją POWŁOKI: sklep bierze ją ze strony GŁÓWNEJ
 * i rysuje na każdej trasie. Kreator o tym rozstrzygnięciu nie wiedział —
 * pozwalał dodać stopkę na dowolnej stronie, rysował ją na płótnie i w
 * podglądzie, a sklep jej nigdy nie renderował. Skutek był dwustronny i CICHY:
 *
 *   • praca włożona w stopkę podstrony (godziny, telefon, odnośniki) nie
 *     docierała do ani jednego klienta — bez błędu i bez śladu;
 *   • podgląd podstrony pokazywał stopkę, której klient NIE zobaczy, i nie
 *     pokazywał tej, którą zobaczy.
 *
 * ==================== ROZSTRZYGNIĘCIE ====================
 *
 * Prawdą jest sklep, nie kreator: stopka należy do POWŁOKI i mieszka na
 * stronie głównej. Podgląd przestaje więc rysować stopkę własną podstrony,
 * a zaczyna rysować tę ze strony głównej — dokładnie jak `/store/[slug]`,
 * który treść bierze z własnej strony, a powłokę z głównej.
 *
 * Różnica wobec sklepu jest jedna i celowa: sklep czyta stan OPUBLIKOWANY,
 * podgląd — SZKICOWY. To ta sama zasada, co przy znaku firmy (ADR-160)
 * i wyglądzie (ADR-161): podgląd odpowiada na pytanie „co zobaczy klient PO
 * publikacji", więc bierze to, co zostanie opublikowane.
 *
 * Kryterium podziału jest REJESTR SEKCJI PRZYPIĘTYCH z rdzenia
 * (`isPinnedLastType`) — ten sam, którym dzieli je storefront
 * (`lib/site/page-sections.ts`). Drugi typ przypięty (pasek zgód?) wejdzie do
 * powłoki obu powierzchni bez dotykania żadnego z tych dwóch plików.
 */
import { HOME_PAGE_SLUG, isPinnedLastType } from "@avably/core/site";
import type { SiteSection } from "@avably/db";
import type { SupabaseClient } from "@supabase/supabase-js";

import { toEditorSections } from "@/app/[locale]/(panel)/strona/content";

/** Sekcja gotowa do podania rendererowi — kształt, którego chce `SiteRenderer`. */
export interface PreviewSection {
  id: string;
  position: number;
  type: string;
  content: unknown;
}

export interface PreviewShell {
  /** Sekcje STRONY — wszystko poza przypiętymi, w kolejności prezentacji. */
  page: PreviewSection[];
  /** Sekcje POWŁOKI — przypięte, wzięte ze strony GŁÓWNEJ najemcy. */
  shell: PreviewSection[];
  /**
   * Czy TA strona niesie własną sekcję przypiętą, której sklep nie wyrenderuje.
   *
   * Wartość istnieje po to, żeby podgląd mógł to POWIEDZIEĆ. Ciche pominięcie
   * byłoby drugą odmianą tej samej wady: operator dalej nie wiedziałby, że jego
   * praca nie dociera do klienta — tyle że teraz nie widziałby jej nawet
   * w podglądzie.
   */
  shadowedPinned: boolean;
}

/** To, co klient zobaczy po publikacji: bez sekcji wyłączonych i usuniętych. */
function visible(sections: SiteSection[]): ReturnType<typeof toEditorSections> {
  return toEditorSections(sections).filter(
    (section) => section.enabled && !section.deletedInDraft,
  );
}

function forRender(sections: ReturnType<typeof toEditorSections>): PreviewSection[] {
  return sections.map((section) => ({
    id: section.id,
    position: section.position,
    type: section.type,
    content: section.content,
  }));
}

/**
 * Sekcje przypięte ze SZKICU strony głównej najemcy — albo pusta lista, gdy
 * strony głównej nie ma (nowy najemca) albo nie ma na niej stopki.
 *
 * Odczyt idzie tą samą drogą, co reszta panelu: klientem z sesji, przez RLS.
 * `maybeSingle()` po parze (najemca, slug pusty) jest bezpieczne — od 0073
 * adres szkicu jest unikalny w obrębie najemcy.
 */
async function homePagePinned(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<PreviewSection[]> {
  const { data: home } = await supabase
    .from("sites")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("slug", HOME_PAGE_SLUG)
    .maybeSingle();
  const homeId = (home as { id?: string } | null)?.id;
  if (!homeId) return [];

  const { data: sections } = await supabase
    .from("site_sections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("site_id", homeId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  return forRender(
    visible((sections ?? []) as SiteSection[]).filter((section) =>
      isPinnedLastType(section.type),
    ),
  );
}

/**
 * Podział sekcji podglądu — patrz nagłówek pliku.
 *
 * `slug` przychodzi z wiersza strony: pusty string to strona GŁÓWNA (0073,
 * ADR-157). To jest ten „wsad, czy ta strona jest główna", którego brakowało
 * — bez niego `isPinnedLastType` odpowiada na pytanie o TYP sekcji, ale nikt
 * nie pyta o STRONĘ, na której ta sekcja stoi.
 */
export async function previewShellSections(
  supabase: SupabaseClient,
  tenantId: string,
  slug: string | null | undefined,
  sections: SiteSection[],
): Promise<PreviewShell> {
  const widoczne = visible(sections);
  const page = forRender(widoczne.filter((section) => !isPinnedLastType(section.type)));
  const wlasnePrzypiete = widoczne.filter((section) => isPinnedLastType(section.type));

  // Strona główna JEST powłoką — jej stopka renderuje się w sklepie wszędzie,
  // więc podgląd bierze ją stąd i drugiego odczytu nie robi.
  if ((slug ?? HOME_PAGE_SLUG) === HOME_PAGE_SLUG) {
    return { page, shell: forRender(wlasnePrzypiete), shadowedPinned: false };
  }

  return {
    page,
    shell: await homePagePinned(supabase, tenantId),
    shadowedPinned: wlasnePrzypiete.length > 0,
  };
}
