"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { clearTenantViewCookie } from "@/lib/superadmin";

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  // Podgląd tenanta nie może przeżyć wylogowania (ADR-010) — kolejna sesja,
  // także innego użytkownika na tej samej przeglądarce, startuje czysta.
  await clearTenantViewCookie();

  redirect("/login");
}
