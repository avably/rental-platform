/**
 * Odczyt modelu sekcyjnego dla edytora 2.3b (Zadanie 2.3a, ADR-041) — zwykłe
 * funkcje serwerowe (RSC), nie server actions: odczyt nie ma być POST-em.
 * Zwracany draft to stan EDYTORA; stan publiczny czyta wyłącznie storefront
 * przez app.get_published_site.
 *
 * MODEL STRON (0048, ADR-093). Do 0047 tenant miał jedną stronę i ten plik
 * mógł ją znaleźć samym `tenant_id`. Teraz wersji jest wiele, a najwyżej jedna
 * z nich jest ŻYWA — więc każdy odczyt musi powiedzieć, KTÓREJ wersji dotyczy.
 * `maybeSingle()` po `tenant_id` nie jest tu już „prawie dobre": przy drugiej
 * wersji zwraca błąd, a nie stronę.
 */
import type { Site, SiteSection } from "@avably/db";

import { requireMember } from "./supabase-server";

export interface SiteWithSections {
  site: Site;
  /** Sekcje w kolejności prezentacji (position, id) — także wyłączone (edytor je pokazuje). */
  sections: SiteSection[];
}

/**
 * Wszystkie wersje strony tenanta — wejście listy stron. Kolejność: ŻYWA
 * pierwsza, potem od najnowszej, bo tak wygląda pytanie operatora („co widzi
 * klient i nad czym ostatnio pracowałem"), a nie „w jakiej kolejności powstały".
 */
export async function listSites(): Promise<Site[]> {
  const ctx = await requireMember();

  const { data, error } = await ctx.supabase
    .from("sites")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Odczyt listy stron nie powiódł się: ${error.message}`);

  return (data ?? []) as Site[];
}

/**
 * WSKAZANA wersja strony z kompletem sekcji albo null, gdy taka wersja nie
 * istnieje (albo należy do innego tenanta — RLS tnie wiersz i wynik jest ten
 * sam, celowo nieodróżnialny).
 */
export async function getSiteWithSections(siteId: string): Promise<SiteWithSections | null> {
  const ctx = await requireMember();

  const { data: site, error: siteError } = await ctx.supabase
    .from("sites")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", siteId)
    .maybeSingle();
  if (siteError) throw new Error(`Odczyt strony nie powiódł się: ${siteError.message}`);
  if (!site) return null;

  const { data: sections, error: sectionsError } = await ctx.supabase
    .from("site_sections")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("site_id", site.id)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (sectionsError) throw new Error(`Odczyt sekcji nie powiódł się: ${sectionsError.message}`);

  return { site: site as Site, sections: (sections ?? []) as SiteSection[] };
}
