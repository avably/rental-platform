"use server";

/**
 * Zapis ustawień dostaw: upsert per klucz tenant_settings (PK tenant_id+key).
 * Zod u źródła (schematy produkują jsonb w kształcie bazy), autorytatywnie
 * odmawiają CHECK-i 0013 kodem 23514 — komunikat mapowany dla operatora.
 *
 * Zapis otwarty dla KAŻDEGO członka, spójnie z polityką RLS tenant_settings
 * z 0007 — UI nie udaje bramki, której baza nie ma; zawężenie do ownera to
 * spisany dług (ADR-031).
 */
import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { AuthError } from "@/lib/auth";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

import {
  deliverySettingsCredentialsSchema,
  deliverySettingsParcelSchema,
  deliverySettingsPricingSchema,
  deliverySettingsSenderSchema,
} from "./delivery-settings-validation";

const PG_CHECK_VIOLATION = "23514";

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

async function upsertSetting(key: string, value: unknown): Promise<FormState> {
  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { data, error } = await ctx.supabase
    .from("tenant_settings")
    .upsert(
      {
        tenant_id: ctx.tenantId,
        key,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,key" },
    )
    .select("key");
  if (error) {
    if (error.code === PG_CHECK_VIOLATION) {
      return {
        formError:
          "Wartości odrzucone przez walidację bazy — sprawdź kompletność pól i spróbuj ponownie.",
      };
    }
    return { formError: error.message };
  }
  if (!data || data.length === 0) {
    return { formError: "Nie udało się zapisać ustawienia." };
  }

  revalidatePath("/", "layout");
  return { success: key };
}

function parseWith<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: Record<string, string>,
): { value: z.infer<Schema> } | { state: FormState } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { state: zodErrorToState(parsed.error) };
  return { value: parsed.data };
}

export async function saveCourierCredentialsAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = parseWith(deliverySettingsCredentialsSchema, {
    email: str(formData.get("email")),
    password: str(formData.get("password")),
    environment: str(formData.get("environment")),
  });
  if ("state" in result) return result.state;
  return upsertSetting("globkurier_credentials", result.value);
}

export async function saveCourierSenderAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = parseWith(deliverySettingsSenderSchema, {
    name: str(formData.get("name")),
    street: str(formData.get("street")),
    houseNumber: str(formData.get("houseNumber")),
    apartmentNumber: str(formData.get("apartmentNumber")),
    postCode: str(formData.get("postCode")),
    city: str(formData.get("city")),
    phone: str(formData.get("phone")),
    email: str(formData.get("email")),
  });
  if ("state" in result) return result.state;
  return upsertSetting("courier_sender", result.value);
}

export async function saveCourierParcelAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = parseWith(deliverySettingsParcelSchema, {
    lengthCm: str(formData.get("lengthCm")),
    widthCm: str(formData.get("widthCm")),
    heightCm: str(formData.get("heightCm")),
    weightKg: str(formData.get("weightKg")),
  });
  if ("state" in result) return result.state;
  return upsertSetting("courier_parcel", result.value);
}

export async function saveDeliveryPricingAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = parseWith(deliverySettingsPricingSchema, {
    courierPrice: str(formData.get("courierPrice")),
    courierFreeAbove: str(formData.get("courierFreeAbove")),
    parcelLockerPrice: str(formData.get("parcelLockerPrice")),
    parcelLockerFreeAbove: str(formData.get("parcelLockerFreeAbove")),
    ownDeliveryPrice: str(formData.get("ownDeliveryPrice")),
    ownDeliveryFreeAbove: str(formData.get("ownDeliveryFreeAbove")),
  });
  if ("state" in result) return result.state;
  return upsertSetting("delivery_pricing", result.value);
}
