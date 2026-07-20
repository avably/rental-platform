"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { authErrorKey, logAuthProviderError } from "@/app/[locale]/(auth)/auth-error";
import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resetConfirmSchema } from "@/lib/validation";

export interface ResetConfirmState {
  error?: string;
}

export async function resetConfirmAction(
  _prevState: ResetConfirmState,
  formData: FormData,
): Promise<ResetConfirmState> {
  const parsed = resetConfirmSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) {
    return { error: "Sesja resetu wygasła lub link jest nieprawidłowy. Poproś o nowy link." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    // Jak w rejestracji (ADR-051): surowa treść do logu, na ekran nasz tekst.
    // Tu najczęściej `weak_password` (polityka hasła po stronie dostawcy jest
    // ostrzejsza niż nasz schemat) i `same_password`.
    logAuthProviderError("reset-confirm", error);
    const t = await getTranslations("authError");
    return { error: t(authErrorKey(error)) };
  }

  redirect(await localePath("/login", { reset: "ok" }));
}
