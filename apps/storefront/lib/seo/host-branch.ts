/**
 * Rozgałęzienie po hoście DLA TRAS PLIKOWYCH (sitemap.xml, robots.txt) —
 * Zadanie 2.7, ADR-044.
 *
 * DLACZEGO OSOBNO OD MIDDLEWARE. Matcher proxy brzmi
 * `/((?!_next/static|_next/image|favicon.ico|.*\.[\w]+$).*)` — wyklucza KAŻDĄ
 * ścieżkę z rozszerzeniem, więc `/sitemap.xml` i `/robots.txt` NIE przechodzą
 * przez middleware i nie dostają wstrzykniętego `x-tenant-id`. Te trasy muszą
 * więc rozstrzygnąć hosta same, tą samą klasyfikacją i tym samym rozwiązaniem
 * slug→tenant_id (`classifyHost` + `resolveTenant`, ADR-039) — czytamy je,
 * nie zmieniamy.
 *
 * BEZPIECZEŃSTWO. Ta ścieżka NIE ufa żadnemu nagłówkowi tenanta przyniesionemu
 * przez klienta — bierze WYŁĄCZNIE `Host` i rozwiązuje go server-side przez
 * `app.resolve_tenant_by_slug` (SECURITY DEFINER). Bramka anty-spoofingu
 * middleware'u zostaje nietknięta; tu po prostu nie ma czego spoofować, bo
 * `x-tenant-id` nie jest w ogóle czytany.
 *
 * Wynik `not-found` (nieznany/nieaktywny/malformed slug) wołający zamienia na
 * neutralne 404 — spójnie z ADR-039: odpowiedź jest identyczna dla tenanta
 * nieistniejącego i zawieszonego.
 */
import { getCachedTenant, setCachedTenant } from "@/lib/tenant/cache";
import { classifyHost } from "@/lib/tenant/host";
import { lookupTenantIdBySlug } from "@/lib/tenant/lookup";
import { resolveTenant } from "@/lib/tenant/resolve";

export type HostBranch =
  | { kind: "marketing" }
  | { kind: "tenant"; slug: string; tenantId: string }
  | { kind: "not-found" };

/**
 * Rozwiązywanie wstrzykiwane (wzorzec `ProxyDeps`) — trasy dają się testować
 * bez sieci i bez bazy.
 */
export interface HostBranchDeps {
  resolveTenant: (host: string, slug: string) => Promise<{ tenantId: string } | null>;
}

export const defaultHostBranchDeps: HostBranchDeps = {
  resolveTenant: (host, slug) =>
    resolveTenant(host, slug, {
      getCache: getCachedTenant,
      setCache: setCachedTenant,
      lookup: lookupTenantIdBySlug,
    }),
};

export async function resolveHostBranch(
  host: string | null | undefined,
  deps: HostBranchDeps = defaultHostBranchDeps,
): Promise<HostBranch> {
  const classification = classifyHost(host);
  if (classification.kind !== "tenant") return classification;

  const resolved = await deps.resolveTenant(host ?? "", classification.slug);
  if (!resolved) return { kind: "not-found" };

  return { kind: "tenant", slug: classification.slug, tenantId: resolved.tenantId };
}
