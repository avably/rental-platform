"use server";

import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { safeNextPath, totpVerifySchema } from "@/lib/validation";

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
  if (!ctx) redirect(await localePath("/login"));

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error) return { error: error.message };

  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export interface VerifyState {
  error?: string;
}

/**
 * Krok 2+3 — challenge + verify: potwierdza czynnik kodem z aplikacji TOTP.
 *
 * Sukces kończy się PRZEKIEROWANIEM, nie komunikatem. Wcześniej akcja zwracała
 * `{ success }`, formularz zamieniał się w zdanie „2FA włączone" i użytkownik
 * zostawał w ślepym zaułku (potwierdzone na produkcji przy pierwszej
 * konfiguracji 2FA) — mimo że `mfa.verify` wymienia tokeny i sesja JEST już
 * aal2, czyli może iść dokładnie tam, dokąd szła.
 *
 * Konwencja ta sama co w wyzwaniu MFA (`wyzwanie/actions.ts`): opcjonalny
 * `next` z ukrytego pola formularza, sanityzowany `safeNextPath` (wyłącznie
 * ścieżki wewnętrzne — inaczej ekran 2FA byłby open-redirectem uzbrojonym
 * w świeżo podbitą sesję), fallback na stronę główną panelu.
 *
 * Fallback NIE MOŻE być zaszytym `/admin`: cel po włączeniu 2FA nie zależy od
 * tego, czy sesja ma claim superadmina, a stały skok do panelu superadmina
 * ujawniłby jego istnienie każdemu, kto włączy 2FA (maskowanie 404 —
 * ADR-010/011). Superadmin i tak trafia tam z `next`, które niesie guard.
 */
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
  if (!ctx) redirect(await localePath("/login"));

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

  redirect(await localePath(safeNextPath(formData.get("next")) ?? "/"));
}
