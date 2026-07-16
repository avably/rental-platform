/**
 * Guard stron panelu dostępnych dla KAŻDEGO członka tenanta (owner i staff)
 * — wzorzec requireSuperadminPage z lib/superadmin.ts, bez osi superadmina.
 *
 * Katalog (Zadanie 3) świadomie nie zawęża roli: obsługa katalogu to praca
 * lady, a nie zarządzanie organizacją — te same polityki RLS (0007) dają
 * zapis operacyjny każdemu członkowi, a kasowanie ownerowi. Guard w panelu
 * jest nawigacją i czytelnym komunikatem; bramką jest RLS.
 */
import { redirect } from "next/navigation";

import { AuthError, type AuthContext } from "./auth";
import { localePath } from "./navigation";
import { requireMember } from "./supabase-server";

export async function requireMemberPage(nextPath: string): Promise<AuthContext> {
  try {
    return await requireMember();
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;

    // Prefiks locale doklejony TU (patrz lib/navigation.ts) — bez tego user
    // z /pl/katalog lądowałby na /en/login.
    if (error.code === "unauthenticated") {
      redirect(await localePath("/login", { next: nextPath }));
    }
    // Zalogowany bez organizacji (albo inna odmowa) → strona główna panelu,
    // która pokieruje dalej (założenie organizacji).
    redirect(await localePath("/"));
  }
}
