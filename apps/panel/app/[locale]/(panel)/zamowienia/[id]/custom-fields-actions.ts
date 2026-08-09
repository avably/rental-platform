"use server";

/**
 * Pola własne zamówienia z karty (C6-A2, ADR-119).
 *
 * DLACZEGO OSOBNA SEKCJA, a nie „formularz edycji zamówienia": takiego
 * formularza nie ma i nie ma go świadomie — karta zamówienia jest rozbita na
 * sekcje z własnymi akcjami (pozycje, dostawa, kaucja, notatki), bo każda ma
 * inne reguły i inne skutki. Pola własne dołączają do tego wzorca, zamiast
 * wprowadzać jeden wielki zapis obejmujący kwoty i termin.
 *
 * BRAMKĄ JEST RLS (0007) i trigger zgodności (0057). `eq("tenant_id", …)` to
 * druga warstwa; o wyniku decyduje ODCZYT PO ZAPISIE (`.select("id")`),
 * bo UPDATE, który nie trafił w żaden wiersz, nie zgłasza błędu.
 */
import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { customFieldValuesFromRow, hasCustomFieldErrors } from "@/lib/custom-fields";
import { readCustomFieldsForUpdate } from "@/lib/custom-fields-server";
import { type FormState } from "@/lib/form-state";
import { uuidSchema } from "@/lib/order-validation";
import { requireMember } from "@/lib/supabase-server";

const NOT_FOUND = "Nie udało się zapisać — zamówienie nie istnieje albo nie masz do niego dostępu.";

export async function updateOrderCustomFieldsAction(
  orderId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(orderId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }
  const tenantId = ctx.tenantId;
  if (!tenantId) return { formError: "Sesja nie wskazuje najemcy — zaloguj się ponownie." };

  // Stan sprzed edycji jest częścią zapisu — kolumna idzie do bazy w całości,
  // a ta sekcja pokazuje wyłącznie pola z flagą „panel".
  const { data: current } = await ctx.supabase
    .from("orders")
    .select("custom_fields")
    .eq("tenant_id", tenantId)
    .eq("id", id.data)
    .maybeSingle();
  if (!current) return { formError: NOT_FOUND };

  const custom = await readCustomFieldsForUpdate(
    ctx.supabase,
    tenantId,
    "order",
    formData,
    customFieldValuesFromRow(current),
  );
  if (hasCustomFieldErrors(custom)) {
    return { fieldErrors: custom.fieldErrors, ...(custom.formError ? { formError: custom.formError } : {}) };
  }

  const { data, error } = await ctx.supabase
    .from("orders")
    .update({ custom_fields: custom.values })
    .eq("tenant_id", tenantId)
    .eq("id", id.data)
    .select("id");
  if (error) return { formError: error.message };
  if (!data || data.length === 0) return { formError: NOT_FOUND };

  revalidatePath("/", "layout");
  return { success: "saved" };
}
