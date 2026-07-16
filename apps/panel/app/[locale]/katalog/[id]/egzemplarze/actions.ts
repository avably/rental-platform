"use server";

/**
 * Akcje egzemplarzy (product_units). Okno serwisowe ma lustro CHECK-ów bazy
 * w unitSchema — operator dostaje czytelny komunikat z walidacji, a CHECK
 * (0007) zostaje bramką ostateczną.
 */
import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { unitSchema, uuidSchema } from "@/lib/catalog-validation";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

function parseUnitForm(formData: FormData) {
  return unitSchema.safeParse({
    serialNumber: formData.get("serialNumber"),
    unavailableFrom: formData.get("unavailableFrom"),
    unavailableTo: formData.get("unavailableTo"),
    unavailableReason: formData.get("unavailableReason"),
  });
}

function unitPayload(input: ReturnType<typeof unitSchema.parse>) {
  return {
    serial_number: input.serialNumber,
    unavailable_from: input.unavailableFrom,
    unavailable_to: input.unavailableTo,
    unavailable_reason: input.unavailableReason,
  };
}

/** 23505 na product_units_serial_key → komunikat, nie surowy PostgREST. */
function mapDbError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "Egzemplarz z tym numerem seryjnym już istnieje dla tego produktu.";
  }
  return error.message;
}

export async function addUnitAction(
  productId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(productId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const parsed = parseUnitForm(formData);
  if (!parsed.success) return zodErrorToState(parsed.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { error } = await ctx.supabase.from("product_units").insert({
    tenant_id: ctx.tenantId,
    product_id: id.data,
    ...unitPayload(parsed.data),
  });
  if (error) return { formError: mapDbError(error) };

  revalidatePath("/", "layout");
  return { success: "added" };
}

export async function updateUnitAction(
  productId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const productIdParsed = uuidSchema.safeParse(productId);
  if (!productIdParsed.success) return { formError: productIdParsed.error.issues[0]!.message };

  const unitId = uuidSchema.safeParse(formData.get("unitId"));
  if (!unitId.success) return { formError: unitId.error.issues[0]!.message };

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Jeden formularz wiersza obsługuje zapis i usunięcie — przycisk niesie
  // `intent` (FormData zawiera nazwę/wartość przycisku, którym wysłano).
  if (formData.get("intent") === "delete") {
    // RLS: kasowanie egzemplarzy jest zastrzeżone dla ownera (0007) i DELETE
    // spoza uprawnień NIE zgłasza błędu — dosięga zero wierszy. .select("id")
    // zamienia ciche nic w czytelną odmowę.
    const { data, error } = await ctx.supabase
      .from("product_units")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("product_id", productIdParsed.data)
      .eq("id", unitId.data)
      .select("id");
    if (error) return { formError: error.message };
    if (!data || data.length === 0) {
      return {
        formError:
          "Nie usunięto egzemplarza — usuwanie wymaga roli właściciela (owner) albo egzemplarz nie istnieje.",
      };
    }
    revalidatePath("/", "layout");
    return { success: "deleted" };
  }

  const parsed = parseUnitForm(formData);
  if (!parsed.success) return zodErrorToState(parsed.error);

  const { data, error } = await ctx.supabase
    .from("product_units")
    .update(unitPayload(parsed.data))
    .eq("tenant_id", ctx.tenantId)
    .eq("product_id", productIdParsed.data)
    .eq("id", unitId.data)
    .select("id");
  if (error) return { formError: mapDbError(error) };
  if (!data || data.length === 0) return { formError: "Nie znaleziono egzemplarza." };

  revalidatePath("/", "layout");
  return { success: "saved" };
}
