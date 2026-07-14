"use server";

import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { totpVerifySchema } from "@/lib/validation";

export interface EnrollState {
  error?: string;
  factorId?: string;
  qrCode?: string;
  secret?: string;
}

/** Krok 1 — enroll: rejestruje nowy czynnik TOTP, zwraca QR + sekret. */
export async function enrollTotpAction(
  _prevState: EnrollState,
  _formData: FormData,
): Promise<EnrollState> {
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect("/login");

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error) return { error: error.message };

  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export interface VerifyState {
  error?: string;
  success?: string;
}

/** Krok 2+3 — challenge + verify: potwierdza czynnik kodem z aplikacji TOTP. */
export async function verifyTotpAction(
  _prevState: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const parsed = totpVerifySchema.safeParse({
    factorId: formData.get("factorId"),
    code: formData.get("code"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect("/login");

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: parsed.data.factorId,
  });
  if (challengeError) return { error: challengeError.message };

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: parsed.data.factorId,
    challengeId: challenge.id,
    code: parsed.data.code,
  });
  if (verifyError) return { error: verifyError.message };

  return { success: "Uwierzytelnianie dwuskładnikowe włączone." };
}
