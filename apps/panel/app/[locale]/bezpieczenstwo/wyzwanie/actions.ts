"use server";

import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { safeNextPath, totpChallengeSchema } from "@/lib/validation";

export interface ChallengeState {
  error?: string;
}

/**
 * Step-up MFA: wyzwanie ISTNIEJĄCEGO czynnika TOTP, żeby podbić świeżo
 * zalogowaną sesję z aal1 na aal2 (dług z recenzji Zadania 6 — wcześniej
 * panel umiał tylko zarejestrować NOWY czynnik, więc powracający superadmin
 * nie miał jak odzyskać aal2 bez ponownego enrollu).
 *
 * factorId NIE pochodzi z formularza: bierzemy zweryfikowany czynnik TOTP
 * użytkownika z jego sesji. Klient dostarcza wyłącznie 6-cyfrowy kod.
 */
export async function challengeTotpAction(
  _prevState: ChallengeState,
  formData: FormData,
): Promise<ChallengeState> {
  const parsed = totpChallengeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login"));

  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) return { error: factorsError.message };

  const factor = factors.totp.find((candidate) => candidate.status === "verified");
  if (!factor) {
    // Brak zweryfikowanego czynnika — użytkownik trafił tu na skróty; jedyne
    // sensowne miejsce to ekran włączenia 2FA.
    redirect(await localePath("/bezpieczenstwo"));
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: factor.id,
  });
  if (challengeError) return { error: challengeError.message };

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code: parsed.data.code,
  });
  if (verifyError) return { error: verifyError.message };

  // Sesja jest już aal2 (verify wymienia tokeny). `next` sanityzowany —
  // wyłącznie ścieżki wewnętrzne (ochrona przed open-redirect).
  redirect(await localePath(safeNextPath(formData.get("next")) ?? "/"));
}
