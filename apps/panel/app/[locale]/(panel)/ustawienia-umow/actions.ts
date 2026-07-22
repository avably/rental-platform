"use server";

import { revalidatePath } from "next/cache";

import type { FormState } from "@/lib/form-state";
import { zodErrorToState } from "@/lib/form-state";
import {
  CONTRACT_DOCUMENT_SETTINGS_KEY,
  contractDocumentSettingsInputFromFormData,
  contractDocumentSettingsSchema,
} from "@/lib/contract-settings";
import { AuthError } from "@/lib/auth";
import { requireMember } from "@/lib/supabase-server";

export async function saveContractSettingsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = contractDocumentSettingsSchema.safeParse(
    contractDocumentSettingsInputFromFormData(formData),
  );
  if (!parsed.success) return zodErrorToState(parsed.error);

  let context;
  try {
    context = await requireMember();
  } catch (error) {
    if (error instanceof AuthError) return { formError: error.message };
    throw error;
  }

  const { data, error } = await context.supabase
    .from("tenant_settings")
    .upsert(
      {
        tenant_id: context.tenantId,
        key: CONTRACT_DOCUMENT_SETTINGS_KEY,
        value: parsed.data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,key" },
    )
    .select("key");

  if (error) {
    if (error.code === "42501") {
      return { formError: "Tylko właściciel organizacji może zmieniać te ustawienia." };
    }
    if (error.code === "23514") {
      return { formError: "Ustawienia zostały odrzucone przez walidację bazy." };
    }
    return { formError: error.message };
  }
  if (!data?.length) return { formError: "Nie udało się zapisać ustawień umów." };

  revalidatePath("/ustawienia-umow");
  return { success: CONTRACT_DOCUMENT_SETTINGS_KEY };
}
