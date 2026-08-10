/**
 * Bramka endpointów przeglądu w panelu (ADR-071): REVIEW_MODE=1 + sesja
 * z claimem SUPERADMINA. Świadomie BEZ wymogu aal2 (MFA), inaczej niż guard
 * `/admin`.
 *
 * DLACZEGO BEZ aal2. Nakładkę przeglądu montuje layout `(panel)` na sam claim
 * superadmina (`ctx.superadmin`), bez wyzwania MFA. Gdyby endpoint wymagał
 * aal2, zapis i odczyt uwag zwracałyby 404 mimo widocznej nakładki — dokładnie
 * to się działo. Endpoint musi wpuszczać tę samą tożsamość, którą wpuszcza
 * montaż nakładki. Bramka i tak jest wielowarstwowa: REVIEW_MODE (kill-switch
 * gaszący całość na go-live) + claim superadmina (`app.superadmins`) + RLS
 * migracji 0033 na tabelach i buckecie. `/admin` (dane platformy) zachowuje
 * pełny wymóg aal2 — to narzędzie przeglądu go nie potrzebuje.
 *
 * Każdy inny przypadek (tryb wyłączony, brak sesji, nie-superadmin) → 404,
 * nie 403 — narzędzie wewnętrzne nie zdradza swojego istnienia (wzorzec /admin).
 *
 * ŻYWY ODCZYT SUPERADMINA (R12b/H-01, ADR-127). Ta bramka stoi na
 * `getAuthContext` (claim), a NIE na `requireSuperadminWithClient`, więc bez
 * dodatkowego sprawdzenia odebrany superadmin zachowałby endpointy przeglądu
 * do wygaśnięcia tokenu. Dane i tak chroni RLS 0033 z predykatami live (R12a),
 * ale samą DOSTĘPNOŚĆ endpointu domykamy tu: po claimie superadmina dokładamy
 * żywy odczyt `app.superadmins` (własny wiersz — RLS `own_or_superadmin_select`
 * z 0003). Brak wiersza albo błąd odczytu → 404, spójnie z resztą bramki
 * (fail-closed, bez zdradzania istnienia narzędzia).
 */
import { getAuthContext, type AuthContext } from "./auth";
import { createSupabaseServerClient } from "./supabase-server";

export async function reviewGuard(): Promise<AuthContext | Response> {
  if (process.env.REVIEW_MODE !== "1") return new Response("Not Found", { status: 404 });
  let ctx: AuthContext | null;
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
    ctx = await getAuthContext(supabase);
  } catch {
    // Poza żądaniem Next (`cookies()` rzuca) — fail-closed.
    return new Response("Not Found", { status: 404 });
  }
  if (!ctx || !ctx.superadmin) return new Response("Not Found", { status: 404 });

  // Żywy odczyt — claim superadmina nie wystarcza (R12b). Błąd odczytu też
  // zamyka bramkę: to narzędzie wewnętrzne, fail-closed jest tu tańsze niż
  // ryzyko przepuszczenia odebranego superadmina przy czkawce bazy.
  const { data: superadminRow, error } = await supabase
    .schema("app")
    .from("superadmins")
    .select("user_id")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error || !superadminRow) return new Response("Not Found", { status: 404 });

  return ctx;
}
