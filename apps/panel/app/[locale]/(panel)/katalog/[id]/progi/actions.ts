"use server";

/**
 * Zapis progów cenowych (pricing_tiers). Edytor wysyła KOMPLETNY cennik
 * produktu; zapis to upsert po (tenant_id, product_id, tier_days) + usunięcie
 * progów, których w nowym cenniku nie ma.
 *
 * Kolejność świadoma: NAJPIERW upsert, POTEM delete. Odwrotnie (wyczyść i
 * wstaw) awaria między krokami zostawiałaby produkt BEZ cennika — a nadmiar
 * progów po nieudanym delete jest widoczny w edytorze i poprawialny drugim
 * zapisem. PostgREST nie daje tu transakcji; dedykowane RPC to przesada dla
 * konfiguracji poprawialnej wpisem (kasowanie progów jest przy członku, 0007).
 */
import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { invalidateStorefrontCatalog } from "@/lib/catalog-cache";
import { tiersSchema, uuidSchema } from "@/lib/catalog-validation";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

export async function saveTiersAction(
  productId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(productId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const parsed = tiersSchema.safeParse(formData.get("tiers"));
  if (!parsed.success) return zodErrorToState(parsed.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  if (parsed.data.length > 0) {
    const { error: upsertError } = await ctx.supabase.from("pricing_tiers").upsert(
      parsed.data.map((tier) => ({
        tenant_id: ctx.tenantId,
        product_id: id.data,
        tier_days: tier.tierDays,
        multiplier: tier.multiplier,
        label: tier.label,
        sort_order: tier.sortOrder,
      })),
      { onConflict: "tenant_id,product_id,tier_days" },
    );
    if (upsertError) return { formError: upsertError.message };
  }

  const keptDays = parsed.data.map((tier) => tier.tierDays);
  // Bez `.select("id")` po delete — ŚWIADOMY wyjątek od konwencji mutacji:
  // zero skasowanych wierszy jest tu poprawnym wynikiem (nowy cennik bywa
  // nadzbiorem starego), więc pusty wynik niczego by nie sygnalizował.
  let deleteQuery = ctx.supabase
    .from("pricing_tiers")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("product_id", id.data);
  if (keptDays.length > 0) {
    deleteQuery = deleteQuery.not("tier_days", "in", `(${keptDays.join(",")})`);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) return { formError: deleteError.message };

  revalidatePath("/", "layout");
  // Cache katalogu w SKLEPIE (ADR-184) — panelowy `revalidatePath` go nie
  // dosięga: to osobna aplikacja Next. Patrz lib/catalog-cache.ts.
  await invalidateStorefrontCatalog(ctx.tenantId!);
  return { success: "saved" };
}
