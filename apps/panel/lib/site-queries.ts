/**
 * Odczyt modelu sekcyjnego dla edytora 2.3b (Zadanie 2.3a, ADR-041) — zwykłe
 * funkcje serwerowe (RSC), nie server actions: odczyt nie ma być POST-em.
 * Zwracany draft to stan EDYTORA; stan publiczny czyta wyłącznie storefront
 * przez app.get_published_site.
 */
import type { Site, SiteSection } from "@avably/db";

import { requireMember } from "./supabase-server";

export interface SiteWithSections {
  site: Site;
  /** Sekcje w kolejności prezentacji (position, id) — także wyłączone (edytor je pokazuje). */
  sections: SiteSection[];
}

/**
 * Strona tenanta z kompletem sekcji albo null, gdy tenant jeszcze strony nie
 * ma (edytor woła wtedy akcję ensureSite — tworzenie jest mutacją, nie
 * skutkiem ubocznym odczytu).
 */
export async function getSiteWithSections(): Promise<SiteWithSections | null> {
  const ctx = await requireMember();

  const { data: site, error: siteError } = await ctx.supabase
    .from("sites")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
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
