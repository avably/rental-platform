"use server";

import { redirect } from "next/navigation";

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
    return { error: error.message };
  }

  redirect(await localePath("/login", { reset: "ok" }));
}
