import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";
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
  if (!ctx) redirect("/login");

  // Sesja już jest aal2 — nie ma czego podbijać.
  if (ctx.aal === "aal2") redirect(safeNextPath(next) ?? "/");

  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (!factors?.totp.some((factor) => factor.status === "verified")) {
    redirect("/bezpieczenstwo");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Potwierdź tożsamość</h1>
      <p className="text-sm text-gray-600">
        Ta sekcja wymaga uwierzytelnienia dwuskładnikowego. Podaj kod z aplikacji
        uwierzytelniającej.
      </p>
      <TotpChallengeForm next={safeNextPath(next) ?? undefined} />
    </main>
  );
}
