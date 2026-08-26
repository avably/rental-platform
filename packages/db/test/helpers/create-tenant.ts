/**
 * Testowe wywołanie app.create_tenant ODPORNE NA TWARDE WYMUSZENIE REGULAMINU
 * (0070, ADR-141, decyzja D5).
 *
 * Od 0070 create_tenant przy istniejącej OBOWIĄZUJĄCEJ wersji regulaminu
 * platformy odmawia (P0003), dopóki wołający nie wskaże dokładnie tej wersji.
 * Dziś lokalna baza ma wyłącznie placeholder-szkic v0 (nic nie obowiązuje),
 * więc goły rpc("create_tenant") przechodzi — ale migracja-następnik z treścią
 * od prawnika opublikuje v1 i uzbroi wymuszenie TAKŻE lokalnie. Ten helper
 * jest jedyną legalną drogą zakładania tenanta w testach: rozwiązuje bieżącą
 * wersję tym samym RPC, którego używa produkcyjny formularz
 * (app.get_platform_terms), i dokłada p_terms_version_id wyłącznie wtedy,
 * gdy jakaś wersja faktycznie obowiązuje.
 *
 * Zwraca surowe `{ data, error }` PostgREST — call site'y traktują go
 * dokładnie jak dotychczasowe `client.schema("app").rpc("create_tenant", …)`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CreateTenantArgs {
  p_slug: string;
  p_name: string;
  /**
   * ADR-234 (0098) — OPCJONALNY. Większość wywołań tego helpera zakłada
   * tenanta jako fixture dla funkcji niezwiązanych z onboardingiem, więc
   * domyślnie NIC się nie zmienia (p_nip pominięty = zachowanie sprzed
   * 0098). Testy SAME weryfikujące ścieżkę NIP (packages/db/test/
   * nip-lookup-cache.test.ts, manual-company-identity.test.ts) podają go
   * jawnie.
   */
  p_nip?: string;
  /**
   * ADR-276 (0114) — WARIANT RĘCZNY. Trafiają do `tenants` WYŁĄCZNIE wtedy,
   * gdy dla `p_nip` NIE MA wiersza w `app.nip_lookup_cache`; przy trafionym
   * cache'u RPC je ignoruje na rzecz danych z rejestru. Bez `p_nip` RPC je
   * ODRZUCA (22023).
   */
  p_legal_name?: string | null;
  p_regon?: string | null;
}

export async function rpcCreateTenant(
  client: SupabaseClient,
  args: CreateTenantArgs,
): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
  const { data: terms } = await client.schema("app").rpc("get_platform_terms");
  const versionId =
    terms && typeof terms === "object" && "version_id" in terms
      ? ((terms as { version_id?: string }).version_id ?? null)
      : null;

  const { data, error } = await client
    .schema("app")
    .rpc("create_tenant", versionId ? { ...args, p_terms_version_id: versionId } : args);
  return { data, error };
}
