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
import { SUPERADMIN_HOME } from "./superadmin";
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
    // Superadmin bez organizacji nie ma na trasie tenanckiej czego zobaczyć
    // (RLS bez claimu tenant_id → zero wierszy) — kierujemy go do panelu
    // superadmina zamiast na pusty ekran (dług #52). Na aal1
    // requireSuperadminPage przechwyci go i poprowadzi przez wyzwanie MFA.
    // Ten kod niesie WYŁĄCZNIE sesja z claimem superadmin, więc maskowanie
    // /admin (404 dla reszty) zostaje nietknięte.
    if (error.code === "superadmin_without_org") {
      redirect(await localePath(SUPERADMIN_HOME));
    }
    // Organizacja ze statusem zamykającym panel (ADR-107) → dedykowany ekran
    // z komunikatem i wylogowaniem. NIE na „/": strona główna sama pokazuje
    // dane tenanta, a każdy kolejny guard odmówiłby tym samym kodem — pętla.
    if (error.code === "tenant_suspended") {
      redirect(await localePath("/organizacja-zawieszona"));
    }
    // Cofnięte członkostwo (R12b/H-01) → ekran /dostep-cofniety, który
    // WYLOGOWUJE i odsyła na /login. NIGDY goły 403: na trasie tenanckiej
    // claim wciąż niesie stary tenant_id, więc każdy kolejny guard odmówiłby
    // tak samo (pętla), a user wielotenantowy dopiero po przelogowaniu
    // dostanie claim wskazujący jego drugą, wciąż ważną organizację.
    if (error.code === "membership_revoked") {
      redirect(await localePath("/dostep-cofniety"));
    }
    // Zwykły zalogowany bez organizacji (albo inna odmowa) → strona główna
    // panelu, która pokieruje dalej (założenie organizacji).
    redirect(await localePath("/"));
  }
}
