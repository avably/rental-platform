import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth";
import { requireSuperadmin } from "@/lib/supabase-server";

/**
 * Szkielet panelu superadmina — dowód działania requireSuperadmin()
 * (claim app_metadata.superadmin + wymóg aal2). Docelowy zakres (zarządzanie
 * tenantami, blokady, itd.) to Zadanie 7.
 */
export default async function SuperadminPage() {
  let ctx;
  try {
    ctx = await requireSuperadmin();
  } catch (err) {
    if (err instanceof AuthError) redirect(err.status === 401 ? "/login" : "/");
    throw err;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 p-6">
      <h1 className="text-xl font-semibold">Panel superadmina</h1>
      <p className="text-sm text-gray-600">Zalogowany jako {ctx.user.email} (aal2 potwierdzone).</p>
    </main>
  );
}
