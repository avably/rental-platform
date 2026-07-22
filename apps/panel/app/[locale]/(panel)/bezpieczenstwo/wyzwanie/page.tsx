import { redirect } from "next/navigation";

import { FormMeasure } from "@/components/screens/form-measure";
import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { safeNextPath } from "@/lib/validation";

import { TotpChallengeForm } from "./form";

/**
 * Wyzwanie MFA (step-up aal1 → aal2) dla użytkownika, który MA już włączony
 * TOTP. Tu trafia powracający superadmin po świeżym logowaniu — kieruje go
 * `requireSuperadminPage()` (patrz lib/superadmin.ts).
 */
export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login"));

  // Sesja już jest aal2 — nie ma czego podbijać.
  if (ctx.aal === "aal2") redirect(await localePath(safeNextPath(next) ?? "/"));

  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (!factors?.totp.some((factor) => factor.status === "verified")) {
    redirect(await localePath("/bezpieczenstwo"));
  }

  // Treść wprowadzająca należy teraz do KARTY stanu (mockup P8: opis stoi pod
  // tytułem karty razem z chipem), a nie do osobnego akapitu nad formularzem.
  return (
    <FormMeasure className="flex flex-col gap-4">
      <TotpChallengeForm next={safeNextPath(next) ?? undefined} />
    </FormMeasure>
  );
}
