"use server";

/** Akcje zmiany kolejności i usuwania zdjęć produktu. */

import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { invalidateStorefrontCatalog } from "@/lib/catalog-cache";
import { sortOrderSchema, uuidSchema } from "@/lib/catalog-validation";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

const BUCKET = "product-images";

export async function updateImageAction(
  productId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const productIdParsed = uuidSchema.safeParse(productId);
  if (!productIdParsed.success) return { formError: productIdParsed.error.issues[0]!.message };

  const imageId = uuidSchema.safeParse(formData.get("imageId"));
  if (!imageId.success) return { formError: imageId.error.issues[0]!.message };

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Jeden formularz wiersza obsługuje zapis kolejności i usunięcie — przycisk
  // niesie `intent` (FormData zawiera nazwę/wartość klikniętego przycisku).
  if (formData.get("intent") === "delete") {
    // Kasujemy NAJPIERW wiersz (autorytatywne źródło tego, co widać), zdejmując
    // przy okazji storage_path skasowanego wiersza; potem plik. `.select`
    // zamienia ciche „zero wierszy" (RLS/nieistnienie) w czytelną odmowę.
    const { data, error } = await ctx.supabase
      .from("product_images")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("product_id", productIdParsed.data)
      .eq("id", imageId.data)
      .select("storage_path");
    if (error) return { formError: error.message };
    if (!data || data.length === 0) {
      return { formError: "Nie znaleziono zdjęcia albo brak uprawnień do usunięcia." };
    }

    // Plik po skasowanym wierszu. Gdyby remove padło, zostaje niewidoczny
    // obiekt (sprzątnie go przyszły job czyszczący) — wiersza już nie ma, więc
    // panel i storefront go nie pokażą; spójność widoku zachowana.
    await ctx.supabase.storage.from(BUCKET).remove([data[0]!.storage_path]);

    revalidatePath("/", "layout");
    // Cache katalogu w SKLEPIE (ADR-184) — panelowy `revalidatePath` go nie
    // dosięga: to osobna aplikacja Next. Patrz lib/catalog-cache.ts.
    await invalidateStorefrontCatalog(ctx.tenantId!);
    return { success: "deleted" };
  }

  const sortOrder = sortOrderSchema.safeParse(formData.get("sortOrder"));
  if (!sortOrder.success) return zodErrorToState(sortOrder.error);

  const { data, error } = await ctx.supabase
    .from("product_images")
    .update({ sort_order: sortOrder.data })
    .eq("tenant_id", ctx.tenantId)
    .eq("product_id", productIdParsed.data)
    .eq("id", imageId.data)
    .select("id");
  if (error) return { formError: error.message };
  if (!data || data.length === 0) return { formError: "Nie znaleziono zdjęcia." };

  revalidatePath("/", "layout");
  // Cache katalogu w SKLEPIE (ADR-184) — panelowy `revalidatePath` go nie
  // dosięga: to osobna aplikacja Next. Patrz lib/catalog-cache.ts.
  await invalidateStorefrontCatalog(ctx.tenantId!);
  return { success: "saved" };
}
