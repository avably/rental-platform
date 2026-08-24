"use server";

/** Akcje zmiany kolejności i usuwania zdjęć produktu. */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AuthError } from "@/lib/auth";
import { invalidateStorefrontCatalog } from "@/lib/catalog-cache";
import { sortOrderSchema, uuidSchema } from "@/lib/catalog-validation";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

const BUCKET = "product-images";

/**
 * KOLEJNOŚĆ ZDJĘĆ PRZECIĄGANIEM (uwaga właściciela, ADR-237).
 *
 * Klient przysyła CAŁĄ listę identyfikatorów w docelowej kolejności — pozycja
 * w tablicy JEST nowym `sort_order` (0 = zdjęcie główne). Zapis idzie wierszami
 * (PostgREST nie umie nadać różnych wartości jednym żądaniem), każdy zawężony
 * najemcą i produktem z sesji, a `.select("id")` po każdym UPDATE zamienia ciche
 * „zero wierszy" (RLS / cudzy produkt / obcy identyfikator) w czytelną odmowę.
 *
 * Piszemy tylko te wiersze, których pozycja NAPRAWDĘ się zmieniła: gest, który
 * nic nie przestawił (upuszczenie w to samo miejsce), nie ma prawa przepisywać
 * całej listy.
 */
const orderedIdsSchema = z
  .array(uuidSchema)
  .min(1, "Brak zdjęć do uporządkowania.")
  .max(200, "Zbyt wiele zdjęć do uporządkowania (maksymalnie 200).");

export async function reorderProductImagesAction(
  productId: string,
  orderedIds: string[],
): Promise<FormState> {
  const productIdParsed = uuidSchema.safeParse(productId);
  if (!productIdParsed.success) return { formError: productIdParsed.error.issues[0]!.message };

  const ids = orderedIdsSchema.safeParse(orderedIds);
  if (!ids.success) return zodErrorToState(ids.error);
  // Duplikat identyfikatora rozjechałby pozycje (dwa wiersze pod jednym id),
  // więc odrzucamy go, zanim cokolwiek zapiszemy.
  if (new Set(ids.data).size !== ids.data.length) {
    return { formError: "Powtórzone zdjęcie na liście kolejności." };
  }

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Stan wyjściowy z bazy — zawężony najemcą i produktem — pozwala pisać tylko
  // to, co się zmieniło, i sprawdzić, że klient nie przysłał zdjęcia z innego
  // produktu ani nie pominął żadnego z bieżących.
  const { data: current, error: currentError } = await ctx.supabase
    .from("product_images")
    .select("id, sort_order")
    .eq("tenant_id", ctx.tenantId)
    .eq("product_id", productIdParsed.data);
  if (currentError) return { formError: currentError.message };

  const currentById = new Map((current ?? []).map((row) => [row.id as string, row.sort_order as number]));
  if (currentById.size !== ids.data.length || ids.data.some((id) => !currentById.has(id))) {
    return { formError: "Lista kolejności nie zgadza się ze zdjęciami produktu." };
  }

  for (let index = 0; index < ids.data.length; index += 1) {
    const id = ids.data[index]!;
    if (currentById.get(id) === index) continue;
    const { data, error } = await ctx.supabase
      .from("product_images")
      .update({ sort_order: index })
      .eq("tenant_id", ctx.tenantId)
      .eq("product_id", productIdParsed.data)
      .eq("id", id)
      .select("id");
    if (error) return { formError: error.message };
    if (!data || data.length === 0) return { formError: "Nie znaleziono zdjęcia albo brak uprawnień." };
  }

  revalidatePath("/", "layout");
  // Cache katalogu w SKLEPIE (ADR-185) — kolejność zdjęć zmienia kopertę
  // publiczną (pierwsze zdjęcie jest główne). Patrz lib/catalog-cache.ts.
  await invalidateStorefrontCatalog(ctx.tenantId!);
  return { success: "reordered" };
}

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
    // Cache katalogu w SKLEPIE (ADR-185) — panelowy `revalidatePath` go nie
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
  // Cache katalogu w SKLEPIE (ADR-185) — panelowy `revalidatePath` go nie
  // dosięga: to osobna aplikacja Next. Patrz lib/catalog-cache.ts.
  await invalidateStorefrontCatalog(ctx.tenantId!);
  return { success: "saved" };
}
