import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

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

  const t = await getTranslations("mfaChallenge");

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col justify-center gap-4">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      <TotpChallengeForm next={safeNextPath(next) ?? undefined} />
    </div>
  );
}
