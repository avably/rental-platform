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
import { lookupTenantIdByDomain, lookupTenantIdBySlug } from "@/lib/tenant/lookup";
import { resolveTenant, resolveTenantByDomain } from "@/lib/tenant/resolve";

/**
 * `slug` jest OPCJONALNY od 2.6 (ADR-046): własna domena najemcy rozwiązuje się
 * po hoście i zwraca sam `tenant_id`. Wołający (sitemap/robots) używają
 * wyłącznie `tenantId` oraz hosta żądania — slug był tu poglądowy.
 */
export type HostBranch =
  | { kind: "marketing" }
  | { kind: "tenant"; slug?: string; tenantId: string }
  | { kind: "not-found" };

/**
 * Rozwiązywanie wstrzykiwane (wzorzec `ProxyDeps`) — trasy dają się testować
 * bez sieci i bez bazy.
 */
export interface HostBranchDeps {
  resolveTenant: (host: string, slug: string) => Promise<{ tenantId: string } | null>;
  resolveTenantByDomain: (host: string) => Promise<{ tenantId: string } | null>;
}

export const defaultHostBranchDeps: HostBranchDeps = {
  resolveTenant: (host, slug) =>
    resolveTenant(host, slug, {
      getCache: getCachedTenant,
      setCache: setCachedTenant,
      lookup: lookupTenantIdBySlug,
    }),
  resolveTenantByDomain: (host) =>
    resolveTenantByDomain(host, {
      getCache: getCachedTenant,
      setCache: setCachedTenant,
      lookup: lookupTenantIdByDomain,
    }),
};

export async function resolveHostBranch(
  host: string | null | undefined,
  deps: HostBranchDeps = defaultHostBranchDeps,
): Promise<HostBranch> {
  const classification = classifyHost(host);

  /*
   * WŁASNA DOMENA NAJEMCY (2.6, ADR-046). Bez tej gałęzi sklep na własnej
   * domenie serwowałby pod nią sitemapę i robots.txt OSI MARKETINGOWEJ — czyli
   * wpuszczał kanon `www.avably.io` do indeksu z cudzego hosta.
   *
   * BRAK TRAFIENIA → `not-found`, TAK JAK W PROXY (ADR-131, domknięte w Fazie 2).
   *
   * Do tej poprawki stał tu `{ kind: "marketing" }` z komentarzem „dokładnie jak
   * w middleware" — a middleware od ADR-131 oddaje na tej gałęzi neutralne 404.
   * Rozjazd był UTRWALONY TESTEM („nierozwiązany obcy host → marketing (…),
   * nie 404"), więc zielona bramka pilnowała WADY: dowolny obcy host wycelowany
   * w nasz deployment dostawał 404 na `/`, ale pełną sitemapę kanonu Avably pod
   * `/sitemap.xml`. To jest ta sama wyrocznia, którą ADR-131 zamknął na osi
   * dokumentów HTML, tylko wystawiona plikiem, którego roboty szukają same.
   *
   * Naprawa idzie U ŹRÓDŁA: zmienia się zachowanie, a test, który je utrwalał,
   * zmienia stronę. Obejście (np. wyjątek w trasie sitemapy) zostawiłoby dwie
   * sprzeczne prawdy o tej samej granicy — dokładnie stan, który tu naprawiamy.
   */
  if (classification.kind === "foreign") {
    const resolved = await deps.resolveTenantByDomain(classification.host);
    return resolved ? { kind: "tenant", tenantId: resolved.tenantId } : { kind: "not-found" };
  }

  if (classification.kind !== "tenant") return classification;

  const resolved = await deps.resolveTenant(host ?? "", classification.slug);
  if (!resolved) return { kind: "not-found" };

  return { kind: "tenant", slug: classification.slug, tenantId: resolved.tenantId };
}
