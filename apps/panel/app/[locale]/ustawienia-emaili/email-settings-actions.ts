"use server";

/**
 * Zapis nadawcy e-maili: upsert klucza email_sender w tenant_settings
 * (PK tenant_id+key), wzorem delivery-settings-actions. Zod u źródła produkuje
 * jsonb w kształcie bazy, autorytatywnie odmawia CHECK 0014 kodem 23514 —
 * komunikat mapowany dla operatora.
 *
 * Zapis otwarty dla KAŻDEGO członka, spójnie z polityką RLS tenant_settings
 * z 0007 (jak dostawy) — UI nie udaje bramki, której baza nie ma.
 *
 * Sklejka FormData wyekstrahowana do funkcji CZYSTEJ i pokryta testem — lekcja
 * 8b (sendEmail): pole obecne w schemacie, którego akcja NIE czyta z FormData,
 * ginie cicho (parsed zawsze bez niego, walidacja przechodzi, wartość nie leci
 * do bazy). Dowód mutacyjny pilnuje, że reply_to jest realnie odczytany.
 */
import { revalidatePath } from "next/cache";

import { EMAIL_SENDER_KEY } from "@avably/core";

import { AuthError } from "@/lib/auth";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

import { emailSenderSchema } from "./email-settings-validation";

const PG_CHECK_VIOLATION = "23514";

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

export function emailSenderInputFromFormData(formData: FormData): {
  name: string;
  replyTo: string;
} {
  return { name: str(formData.get("name")), replyTo: str(formData.get("replyTo")) };
}

export async function saveEmailSenderAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = emailSenderSchema.safeParse(emailSenderInputFromFormData(formData));
  if (!parsed.success) return zodErrorToState(parsed.error);

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
        key: EMAIL_SENDER_KEY,
        value: parsed.data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,key" },
    )
    .select("key");
  if (error) {
    if (error.code === PG_CHECK_VIOLATION) {
      return {
        formError:
          "Wartości odrzucone przez walidację bazy — sprawdź nazwę nadawcy i adres odpowiedzi.",
      };
    }
    return { formError: error.message };
  }
  if (!data || data.length === 0) {
    return { formError: "Nie udało się zapisać nadawcy." };
  }

  revalidatePath("/", "layout");
  return { success: EMAIL_SENDER_KEY };
}
