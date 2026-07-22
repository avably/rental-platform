/**
 * Bramka endpointów przeglądu w panelu (ADR-071): REVIEW_MODE=1 + sesja
 * SUPERADMINA. Każdy inny przypadek (tryb wyłączony, brak sesji,
 * nie-superadmin) → 404, nie 403 — narzędzie wewnętrzne nie zdradza swojego
 * istnienia (ten sam wzorzec co /admin). Egzekucja danych i tak siedzi w RLS
 * migracji 0033 — ta bramka tylko gasi endpoint, zanim cokolwiek się policzy.
 */
import { AuthError, type AuthContext } from "./auth";
import { requireSuperadmin } from "./supabase-server";

export async function reviewGuard(): Promise<AuthContext | Response> {
  if (process.env.REVIEW_MODE !== "1") return new Response("Not Found", { status: 404 });
  try {
    return await requireSuperadmin();
  } catch (error) {
    if (error instanceof AuthError) return new Response("Not Found", { status: 404 });
    throw error;
  }
}
