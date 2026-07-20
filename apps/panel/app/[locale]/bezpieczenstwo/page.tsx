import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { safeNextPath } from "@/lib/validation";

import { TotpEnrollForm } from "./form";

/**
 * Włączenie 2FA. Tu kieruje `requireSuperadminPage` superadmina bez żadnego
 * czynnika (`mfa_enrollment_required`), więc ekran musi umieć oddać go tam,
 * dokąd szedł — `next` przenosimy do formularza, sanityzowany tą samą funkcją
 * co wszędzie w panelu (wyłącznie ścieżki wewnętrzne).
 */
export default async function SecurityPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const { next } = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login"));

  const t = await getTranslations("security");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <TotpEnrollForm next={safeNextPath(next) ?? undefined} />
    </main>
  );
}
