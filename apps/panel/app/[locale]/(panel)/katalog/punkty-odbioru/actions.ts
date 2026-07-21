"use server";

/**
 * Akcje punktów odbioru (pickup_locations). Deaktywacja zamiast kasowania —
 * punkt wskazany na żywych zamówieniach (orders_pickup_location_fk) i tak
 * nie da się usunąć; wygaszenie flagą `active` zachowuje historię.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { pickupLocationSchema, uuidSchema } from "@/lib/catalog-validation";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { localePath } from "@/lib/navigation";
import { requireMember } from "@/lib/supabase-server";

function parseLocationForm(formData: FormData) {
  return pickupLocationSchema.safeParse({
    name: formData.get("name"),
    addressStreet: formData.get("addressStreet"),
    addressZip: formData.get("addressZip"),
    addressCity: formData.get("addressCity"),
    active: formData.get("active"),
  });
}

function locationPayload(input: ReturnType<typeof pickupLocationSchema.parse>) {
  return {
    name: input.name,
    address_street: input.addressStreet,
    address_zip: input.addressZip,
    address_city: input.addressCity,
    active: input.active,
  };
}

export async function createLocationAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseLocationForm(formData);
  if (!parsed.success) return zodErrorToState(parsed.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { error } = await ctx.supabase
    .from("pickup_locations")
    .insert({ tenant_id: ctx.tenantId, ...locationPayload(parsed.data) });
  if (error) return { formError: error.message };

  redirect(await localePath("/katalog/punkty-odbioru"));
}

export async function updateLocationAction(
  locationId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(locationId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const parsed = parseLocationForm(formData);
  if (!parsed.success) return zodErrorToState(parsed.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { data, error } = await ctx.supabase
    .from("pickup_locations")
    .update(locationPayload(parsed.data))
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id.data)
    .select("id");
  if (error) return { formError: error.message };
  if (!data || data.length === 0) return { formError: "Nie znaleziono punktu odbioru." };

  return { success: "saved" };
}

/** Szybkie wygaszenie/przywrócenie z listy (bez wchodzenia w edycję). */
export async function toggleLocationAction(
  locationId: string,
  nextActive: boolean,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(locationId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { data, error } = await ctx.supabase
    .from("pickup_locations")
    .update({ active: nextActive })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id.data)
    .select("id");
  if (error) return { formError: error.message };
  if (!data || data.length === 0) return { formError: "Nie znaleziono punktu odbioru." };

  revalidatePath("/", "layout");
  return { success: "toggled" };
}
