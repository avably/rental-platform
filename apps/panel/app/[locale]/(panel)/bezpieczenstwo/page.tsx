import { redirect } from "next/navigation";

import { FormMeasure } from "@/components/screens/form-measure";
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

  return (
    <FormMeasure className="flex flex-col gap-4">
      <TotpEnrollForm next={safeNextPath(next) ?? undefined} />
    </FormMeasure>
  );
}
