/**
 * REJESTR ADRESÓW STRON NAJEMCY dla proxy sklepu (Faza 2, ADR-158).
 *
 * ==================== PO CO REJESTR W MIDDLEWARE ====================
 *
 * Trasy `app/(tenant)/[slug]` NIE DA SIĘ dodać obok `app/[locale]` — Next 16
 * rzuca twardy błąd builda przy dwóch różnych nazwach parametru na tym samym
 * poziomie ścieżki. Adres strony musi więc zostać rozstrzygnięty ZANIM Next
 * dopasuje trasę, czyli w proxy. A proxy, żeby odróżnić `/kontakt` najemcy od
 * przypadkowego śmiecia w pasku adresu, potrzebuje listy jego adresów.
 *
 * ==================== KLUCZ CACHE'U NIESIE NAJEMCĘ ====================
 *
 * To jest klasyczne miejsce na wyciek między najemcami: cache trafiany kluczem
 * bez tożsamości najemcy oddaje CUDZY rejestr, a wtedy adres `/cennik` najemcy
 * A zaczyna się rozstrzygać na hoście najemcy B. Bramka RLS tego nie złapie —
 * rejestr jest czytany funkcją SECURITY DEFINER, poza RLS-em, a wyciek dzieje
 * się w warstwie, do której baza nie sięga. Dlatego klucz zawiera `tenantId`,
 * a pilnuje tego osobny test (`test/tenant-pages.test.ts`).
 *
 * Cache rozwiązywania hosta (`./cache`) jest ŚWIADOMIE OSOBNY: tamten mapuje
 * host→najemca i jest kluczowany hostem, ten mapuje najemca→adresy i jest
 * kluczowany najemcą. Wspólny magazyn z dwoma prefiksami wyglądałby na
 * oszczędność, a byłby jedną literówką od zamiany znaczeń kluczy.
 */
import { Redis } from "@upstash/redis";

import {
  SUPABASE_PUBLISHABLE_KEY_ENV,
  readSupabasePublishableKey,
} from "@avably/core/supabase-env";

/** Adresy żywych stron + historia adresów (0075). */
export interface TenantPageRegistry {
  /** Slugi ŻYWYCH stron. Pusty string = strona główna. */
  pages: string[];
  /** Stare adresy → adres bieżący; 308. Pusta lista do 0075 (ADR-159). */
  redirects: { from: string; to: string }[];
}

/**
 * TTL rejestru. Krótszy niż pozytywny TTL rozwiązywania hosta (300 s), bo
 * rejestr zmienia się przy KAŻDEJ publikacji, a najemca po opublikowaniu
 * nowej strony ma ją zobaczyć od razu, nie za pięć minut. Nadal na tyle długi,
 * żeby zdjąć z bazy jedno zapytanie na każde żądanie sklepu.
 */
export const PAGES_TTL_SECONDS = 60;

/**
 * TTL dla „ten najemca nie ma stron / nie istnieje". Krótki z tego samego
 * powodu, co negatywny TTL rozwiązywania hosta: świeżo opublikowany sklep nie
 * może być niewidoczny dłużej niż chwilę.
 */
export const PAGES_NEGATIVE_TTL_SECONDS = 15;

const KEY_PREFIX = "tenant-pages:tenant:";

/**
 * Klucz cache'u rejestru. WYDZIELONY I EKSPORTOWANY WYŁĄCZNIE PO TO, ŻEBY DAŁO
 * SIĘ GO PRZYPIĄĆ TESTEM — klucz bez `tenantId` jest wyciekiem, a wyciek
 * w wyrażeniu wklejonym w dwóch miejscach naprawia się w jednym z nich.
 */
export function tenantPagesCacheKey(tenantId: string): string {
  return `${KEY_PREFIX}${tenantId}`;
}

interface MemoryEntry {
  entry: TenantPageRegistry | null;
  expiresAt: number;
}
const memoryStore = new Map<string, MemoryEntry>();

let cachedRedis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (cachedRedis !== undefined) return cachedRedis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  cachedRedis = url && token ? new Redis({ url, token }) : null;
  return cachedRedis;
}

/**
 * Odczyt rejestru z bazy — surowy `fetch` do PostgREST, jak przy rozwiązywaniu
 * najemcy (`./lookup`): middleware biega w runtime brzegowym, a klient
 * `@supabase/ssr` ciągnie adapter cookies, którego odczyt anonimowy nie ma
 * i nie potrzebuje.
 *
 * FAIL-CLOSED: każdy błąd (transport, nie-2xx, nieznany kształt) → `null`,
 * czyli proxy zachowa się jak dla najemcy bez stron i odda neutralne 404.
 * Świadomie wybieramy „chwilowo nie ma podstron" ponad „przepuszczamy ścieżkę,
 * o której nic nie wiemy".
 */
export async function lookupTenantPages(tenantId: string): Promise<TenantPageRegistry | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = readSupabasePublishableKey();
  if (!baseUrl || !anonKey) {
    console.error(
      `[tenant] brak NEXT_PUBLIC_SUPABASE_URL/${SUPABASE_PUBLISHABLE_KEY_ENV} — nie mogę odczytać rejestru stron`,
    );
    return null;
  }

  try {
    const res = await fetch(`${baseUrl}/rest/v1/rpc/get_tenant_pages`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Profile": "app",
      },
      body: JSON.stringify({ p_tenant_id: tenantId }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[tenant] get_tenant_pages zwróciło ${res.status}`);
      return null;
    }
    return parseRegistry(await res.json());
  } catch (error) {
    console.error("[tenant] odczyt rejestru stron nie powiódł się", error);
    return null;
  }
}

/**
 * Parsowanie koperty rejestru — FAIL-CLOSED co do kształtu, TOLERANCYJNE co do
 * nadmiaru. Nieznany klucz nie może wywrócić middleware'u: koperta rozszerza
 * się w 0075 o wypełnione `redirects`, a migracja wchodzi na produkcję PRZED
 * kodem. Odwrotny wybór (schemat `.strict()`) zamieniłby okno wdrożeniowe
 * w okno awarii CAŁEGO sklepu, a nie jednej strony.
 */
export function parseRegistry(payload: unknown): TenantPageRegistry | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = payload as Record<string, unknown>;
  if (!Array.isArray(raw.pages)) return null;

  const pages = raw.pages.filter((slug): slug is string => typeof slug === "string");
  const redirects = Array.isArray(raw.redirects)
    ? raw.redirects.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const entry = item as Record<string, unknown>;
        return typeof entry.from === "string" && typeof entry.to === "string"
          ? [{ from: entry.from, to: entry.to }]
          : [];
      })
    : [];

  return { pages, redirects };
}

export interface TenantPagesDeps {
  getCache: (tenantId: string) => Promise<{ entry: TenantPageRegistry | null } | undefined>;
  setCache: (
    tenantId: string,
    entry: TenantPageRegistry | null,
    ttlSeconds: number,
  ) => Promise<void>;
  lookup: (tenantId: string) => Promise<TenantPageRegistry | null>;
}

/** Rejestr adresów najemcy: cache → miss → baza. Logika czysta, zależności wstrzykiwane. */
export async function resolveTenantPages(
  tenantId: string,
  deps: TenantPagesDeps,
): Promise<TenantPageRegistry | null> {
  const cached = await deps.getCache(tenantId);
  if (cached !== undefined) return cached.entry;

  const registry = await deps.lookup(tenantId);
  await deps.setCache(
    tenantId,
    registry,
    registry ? PAGES_TTL_SECONDS : PAGES_NEGATIVE_TTL_SECONDS,
  );
  return registry;
}

export async function getCachedTenantPages(
  tenantId: string,
): Promise<{ entry: TenantPageRegistry | null } | undefined> {
  const key = tenantPagesCacheKey(tenantId);
  const redis = getRedis();
  if (redis) {
    const value = await redis.get<{ entry: TenantPageRegistry | null }>(key);
    return value ?? undefined;
  }
  const hit = memoryStore.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return undefined;
  }
  return { entry: hit.entry };
}

export async function setCachedTenantPages(
  tenantId: string,
  entry: TenantPageRegistry | null,
  ttlSeconds: number,
): Promise<void> {
  const key = tenantPagesCacheKey(tenantId);
  const redis = getRedis();
  if (redis) {
    await redis.set(key, { entry }, { ex: ttlSeconds });
    return;
  }
  memoryStore.set(key, { entry, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/** Reset stanu in-memory — WYŁĄCZNIE do testów. */
export function __resetTenantPagesCacheForTests(): void {
  memoryStore.clear();
  cachedRedis = undefined;
}
