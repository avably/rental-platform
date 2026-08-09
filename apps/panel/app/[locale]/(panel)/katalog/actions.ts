"use server";

/**
 * Akcje CRUD produktów. Wzorzec z zaproszeń: walidacja Zod PRZED Supabase,
 * guard requireMember (obie role — katalog to praca lady, patrz
 * lib/member-page.ts), mutacje klientem z sesją — bramką jest RLS (0007),
 * zero service-role.
 */
import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth";
import { productSchema, uuidSchema } from "@/lib/catalog-validation";
import { customFieldValuesFromRow, hasCustomFieldErrors } from "@/lib/custom-fields";
import { readCustomFieldsForWrite } from "@/lib/custom-fields-server";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { localePath } from "@/lib/navigation";
import { requireMember } from "@/lib/supabase-server";

function productPayload(input: ReturnType<typeof productSchema.parse>) {
  return {
    name: input.name,
    description: input.description,
    base_price_day_grosze: input.basePriceDayGrosze,
    deposit_grosze: input.depositGrosze,
    auto_increment_multiplier: input.autoIncrementMultiplier,
    buffer_before_days: input.bufferBeforeDays,
    buffer_after_days: input.bufferAfterDays,
    active: input.active,
  };
}

function parseProductForm(formData: FormData) {
  return productSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    basePriceDayGrosze: formData.get("basePriceDayGrosze"),
    depositGrosze: formData.get("depositGrosze"),
    autoIncrementMultiplier: formData.get("autoIncrementMultiplier"),
    bufferBeforeDays: formData.get("bufferBeforeDays"),
    bufferAfterDays: formData.get("bufferAfterDays"),
    active: formData.get("active"),
  });
}

export async function createProductAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseProductForm(formData);
  if (!parsed.success) return zodErrorToState(parsed.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Pola własne PRZED zapisem: rdzeń oddaje czytelny powód przy właściwym
  // polu, zanim trigger 0057 odda swój surowy. Bramką pozostaje baza.
  const custom = await readCustomFieldsForWrite(ctx.supabase, ctx.tenantId!, "product", formData);
  if (hasCustomFieldErrors(custom)) {
    return { fieldErrors: custom.fieldErrors, ...(custom.formError ? { formError: custom.formError } : {}) };
  }

  const { error } = await ctx.supabase
    .from("products")
    .insert({ tenant_id: ctx.tenantId, ...productPayload(parsed.data), custom_fields: custom.values });
  if (error) return { formError: error.message };

  redirect(await localePath("/katalog"));
}

export async function updateProductAction(
  productId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(productId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const parsed = parseProductForm(formData);
  if (!parsed.success) return zodErrorToState(parsed.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Wartości JUŻ ZAPISANE są częścią zapisu, nie tłem: kolumna `custom_fields`
  // idzie do bazy W CAŁOŚCI, więc bez nich zapis formularza skasowałby to, co
  // stoi pod polami zarchiwizowanymi i checkoutowymi. Odczyt jest pod RLS
  // i zawężony do najemcy — nie ma jak przynieść cudzej mapy.
  const { data: current } = await ctx.supabase
    .from("products")
    .select("custom_fields")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id.data)
    .maybeSingle();

  const custom = await readCustomFieldsForWrite(
    ctx.supabase,
    ctx.tenantId!,
    "product",
    formData,
    customFieldValuesFromRow(current),
  );
  if (hasCustomFieldErrors(custom)) {
    return { fieldErrors: custom.fieldErrors, ...(custom.formError ? { formError: custom.formError } : {}) };
  }

  // .select("id") po mutacji: RLS nie zgłasza błędu przy UPDATE, który nie
  // dosięgnął żadnego wiersza (cudzy tenant / zły id) — pusty wynik to jedyny
  // sygnał, że nic się nie stało, i musi być błędem, nie cichym sukcesem.
  const { data, error } = await ctx.supabase
    .from("products")
    .update({ ...productPayload(parsed.data), custom_fields: custom.values })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id.data)
    .select("id");
  if (error) return { formError: error.message };
  if (!data || data.length === 0) return { formError: "Nie znaleziono produktu." };

  return { success: "saved" };
}
