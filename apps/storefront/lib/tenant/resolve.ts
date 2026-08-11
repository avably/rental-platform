/**
 * Orkiestracja rozwiązywania host→tenant_id (Zadanie 2.1, ADR-039): cache →
 * miss → baza, z cache'em POZYTYWNYM i NEGATYWNYM. Logika czysta, zależności
 * (cache, odczyt z bazy) wstrzykiwane — testowalna bez sieci (wzorzec:
 * lib/checkout/core.ts).
 *
 * Cache negatywny (zapamiętanie „ten host NIE rozwiązuje się na tenanta") jest
 * bramką przeciw dobijaniu Postgresa: bez niego skrypt walący w losowe
 * subdomeny `*.avably.io` generowałby zapytanie do bazy na KAŻDE żądanie.
 * TTL negatywny jest KRÓTKI (świeżo utworzony/aktywowany tenant ma się pojawić
 * szybko), pozytywny dłuższy (slug→id jest w praktyce niezmienny).
 */

/** TTL pozytywny — slug→id jest stabilne; 5 min jak w briefie. */
export const POSITIVE_TTL_SECONDS = 300;
/**
 * TTL negatywny — krótki. Zapamiętanie „nie ma takiego tenanta" chroni bazę,
 * ale nie może opóźniać widoczności nowo aktywowanego sklepu o pełne 5 minut.
 */
export const NEGATIVE_TTL_SECONDS = 30;

/** Wpis cache'u: `tenantId: null` to zapamiętana NIEOBECNOŚĆ (cache negatywny). */
export interface TenantCacheEntry {
  tenantId: string | null;
}

export interface ResolveTenantDeps {
  /** Odczyt z cache. `undefined` = brak wpisu (miss); wpis może nieść null. */
  getCache: (host: string) => Promise<TenantCacheEntry | undefined>;
  setCache: (host: string, entry: TenantCacheEntry, ttlSeconds: number) => Promise<void>;
  /** Odczyt z bazy przez app.resolve_tenant_by_slug. Zwraca id albo null. */
  lookup: (slug: string) => Promise<string | null>;
}

/**
 * Zwraca `{ tenantId }` dla osiągalnego tenanta, albo `null` (nieznany/
 * nieaktywny → wołający daje neutralne 404). Klucz cache = host (zgodnie z
 * briefem): dwa hosty tego samego tenanta (`acme.avably.io`, `acme.localhost`)
 * to osobne wpisy wskazujące na to samo id — bez znaczenia dla poprawności.
 */
export async function resolveTenant(
  host: string,
  slug: string,
  deps: ResolveTenantDeps,
): Promise<{ tenantId: string } | null> {
  const cached = await deps.getCache(host);
  if (cached !== undefined) {
    return cached.tenantId ? { tenantId: cached.tenantId } : null;
  }

  const tenantId = await deps.lookup(slug);
  if (tenantId) {
    await deps.setCache(host, { tenantId }, POSITIVE_TTL_SECONDS);
    return { tenantId };
  }

  await deps.setCache(host, { tenantId: null }, NEGATIVE_TTL_SECONDS);
  return null;
}

/**
 * Rozwiązanie WŁASNEJ domeny najemcy (Zadanie 2.6, ADR-046). Host jest zarazem
 * kluczem cache'u i kluczem odczytu (`app.resolve_tenant_by_domain(p_host)`),
 * więc obsługuje je ta sama reguła co subdomeny — z cache'em pozytywnym
 * i NEGATYWNYM włącznie. Osobna funkcja zamiast wołania `resolveTenant(host, host)`
 * u wołającego: nazwa mówi, KTÓRA oś hostów jest rozwiązywana, a `deps.lookup`
 * ma tu być `lookupTenantIdByDomain` (0022), nigdy odczyt po slugu.
 *
 * Cache negatywny ma tu WIĘKSZE znaczenie niż przy subdomenach: od 2.6 każdy
 * nierozpoznany host jest kandydatem na domenę najemcy, a nagłówek `Host` niesie
 * klient i może być czymkolwiek. Bez zapamiętanej nieobecności skrypt walący
 * losowymi hostami generowałby zapytanie do bazy na KAŻDE żądanie.
 */
export async function resolveTenantByDomain(
  host: string,
  deps: ResolveTenantDeps,
): Promise<{ tenantId: string } | null> {
  return resolveTenant(host, host, deps);
}
