"use server";

import { redirect } from "next/navigation";

import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { clearTenantViewCookie } from "@/lib/superadmin";

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  // Podgląd tenanta nie może przeżyć wylogowania (ADR-010) — kolejna sesja,
  // także innego użytkownika na tej samej przeglądarce, startuje czysta.
  await clearTenantViewCookie();

  // Cel MUSI nieść locale — tak samo jak guardy (patrz lib/navigation.ts).
  // Gołe `/login` dostaje prefiks z WYKRYWANIA (cookie/Accept-Language), a nie
  // z adresu, na którym user stał: wylogowanie z /pl potrafiło wyrzucić na
  // /en/login.
  redirect(await localePath("/login"));
}
