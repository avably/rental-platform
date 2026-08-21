"use server";

/**
 * PUBLIKACJA WYGLĄDU SKLEPU (ADR-230) — własny czasownik ekranu „Wygląd sklepu".
 *
 * Wygląd (motyw/akcent/kroje) jest własnością NAJEMCY (ADR-161) i wchodzi na
 * żywo przez to samo RPC, którym wypuszcza go publikacja dowolnej strony
 * (`publishSite` → `app.publish_tenant_appearance`). Ekran designu ma jednak
 * WŁASNE wejście publikacji — jak logo (`publishTenantLogoAction`) — bo operator
 * może chcieć przemalować sklep, nie dotykając ani jednej strony. ŻADNEGO nowego
 * RPC: reużywamy istniejące `app.publish_tenant_appearance` (bezargumentowe,
 * tenant z `app.tenant_id()`).
 *
 * KTO PILNUJE CZEGO. Ten plik nie jest bramką: granicę draft/publish trzyma
 * strażnik kolumn opublikowanych w bazie (kanon ADR-091), a żywego członkostwa —
 * samo RPC. Tu zostaje tłumaczenie odmowy na zdanie dla operatora i unieważnienie
 * cache storefrontu tagiem TENANTA (kontrakt ADR-041) — bo zmienia się to samo,
 * co przy publikacji strony: co widzi klient tego najemcy.
 *
 * UWAGA: plik "use server" — WSZYSTKIE eksporty muszą być async funkcjami.
 */
import { revalidatePath, revalidateTag } from "next/cache";
import { getTranslations } from "next-intl/server";

import { tenantCacheTag } from "@avably/core/site";

import type { SiteActionResult } from "@/lib/site-validation";
import { requireMember } from "@/lib/supabase-server";

export async function publishTenantAppearanceAction(): Promise<SiteActionResult> {
  const t = await getTranslations("storeAppearance");

  let ctx: Awaited<ReturnType<typeof requireMember>>;
  try {
    ctx = await requireMember();
  } catch {
    return { ok: false, error: t("errors.denied") };
  }

  const { error } = await ctx.supabase.schema("app").rpc("publish_tenant_appearance");
  if (error) return { ok: false, error: t("errors.publish") };

  revalidatePath("/", "layout");
  if (ctx.tenantId) revalidateTag(tenantCacheTag(ctx.tenantId), "max");
  return { ok: true };
}
