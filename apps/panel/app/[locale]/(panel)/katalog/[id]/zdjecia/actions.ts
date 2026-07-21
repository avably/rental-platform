"use server";

/**
 * Akcje zdjęć produktu (product_images + Storage, 0018). Upload wgrywa plik do
 * bucketu `product-images` pod ścieżką {tenant_id}/{product_id}/{uuid} i dopisuje
 * wiersz metadanych — dwie operacje na dwóch systemach (Storage + Postgres),
 * spinane kompensacją: gdy insert wiersza padnie po udanym uploadzie, plik jest
 * kasowany, żeby nie zostawić osieroconego obiektu bez wiersza.
 *
 * Izolację ZAPISU pilnują polityki storage.objects (pierwszy segment ścieżki =
 * tenant claim) i RLS product_images (ADR-040) — akcja podaje własny tenant_id z
 * kontekstu, ale bramką ostateczną jest baza, nie ten kod.
 */
import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import {
  IMAGE_MIME_EXTENSIONS,
  imageFileSchema,
  sortOrderSchema,
  uuidSchema,
} from "@/lib/catalog-validation";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

const BUCKET = "product-images";

/** Potwierdza, że produkt należy do tenanta wołającego — czytelny błąd zamiast 23503. */
async function assertOwnProduct(
  ctx: Awaited<ReturnType<typeof requireMember>>,
  productId: string,
): Promise<boolean> {
  const { data } = await ctx.supabase
    .from("products")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", productId)
    .maybeSingle();
  return Boolean(data);
}

export async function uploadImageAction(
  productId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(productId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const parsedFile = imageFileSchema.safeParse(formData.get("file"));
  if (!parsedFile.success) return zodErrorToState(parsedFile.error);
  const file = parsedFile.data;

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  if (!(await assertOwnProduct(ctx, id.data))) {
    return { formError: "Nie znaleziono produktu." };
  }

  // Kolejność nowego zdjęcia: na koniec listy (max + 1), żeby upload nie
  // przestawiał istniejącego porządku. Pusta lista → 0.
  const { data: last } = await ctx.supabase
    .from("product_images")
    .select("sort_order")
    .eq("tenant_id", ctx.tenantId)
    .eq("product_id", id.data)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = last ? last.sort_order + 1 : 0;

  const extension = IMAGE_MIME_EXTENSIONS[file.type]!;
  const storagePath = `${ctx.tenantId}/${id.data}/${randomUUID()}.${extension}`;

  const { error: uploadError } = await ctx.supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type });
  if (uploadError) return { formError: `Nie udało się wgrać pliku: ${uploadError.message}` };

  const { error: insertError } = await ctx.supabase.from("product_images").insert({
    tenant_id: ctx.tenantId,
    product_id: id.data,
    storage_path: storagePath,
    sort_order: nextSortOrder,
  });
  if (insertError) {
    // Kompensacja: wiersz nie powstał, więc plik zostałby sierotą — kasujemy go.
    await ctx.supabase.storage.from(BUCKET).remove([storagePath]);
    return { formError: insertError.message };
  }

  revalidatePath("/", "layout");
  return { success: "added" };
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
  return { success: "saved" };
}
