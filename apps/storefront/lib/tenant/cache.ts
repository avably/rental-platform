/**
 * Cache rozwiązywania host→tenant_id (Zadanie 2.1, ADR-039). Upstash Redis,
 * jeśli skonfigurowane zmienne (`UPSTASH_REDIS_REST_URL` +
 * `UPSTASH_REDIS_REST_TOKEN`), w przeciwnym razie fallback in-memory.
 *
 * Ten sam wzorzec, co rate-limit (@avably/security/rate-limit): jeden klient
 * Upstash z fallbackiem, bo produkcja wielo-instancyjna (Vercel) potrzebuje
 * współdzielonego stanu, a dev/CI mają działać bez Upstasha. Fallback
 * in-memory NIE jest współdzielony między instancjami — w produkcji bez
 * Upstasha każda instancja miałaby własny cache (poprawnościowo bezpieczne,
 * tylko mniej skuteczne). Dlatego wpis żyje tu, a nie jako druga kopia gdzie
 * indziej.
 *
 * Przechowuje `TenantCacheEntry`: `{ tenantId: string }` (pozytywny) albo
 * `{ tenantId: null }` (NEGATYWNY — zapamiętana nieobecność). Rozróżnienie
 * miss vs cache-negatywny: brak klucza → `undefined`, wpis `{tenantId:null}`
 * → zwracany. Bez tego rozróżnienia cache negatywny nie chroniłby bazy.
 */
import { Redis } from "@upstash/redis";

import type { TenantCacheEntry } from "./resolve";

const KEY_PREFIX = "tenant-resolve:host:";

interface MemoryEntry {
  entry: TenantCacheEntry;
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

export async function getCachedTenant(host: string): Promise<TenantCacheEntry | undefined> {
  const key = `${KEY_PREFIX}${host}`;
  const redis = getRedis();
  if (redis) {
    // @upstash/redis zwraca zdeserializowany obiekt, a `null` gdy klucza brak.
    const value = await redis.get<TenantCacheEntry>(key);
    return value ?? undefined;
  }

  const hit = memoryStore.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return undefined;
  }
  return hit.entry;
}

export async function setCachedTenant(
  host: string,
  entry: TenantCacheEntry,
  ttlSeconds: number,
): Promise<void> {
  const key = `${KEY_PREFIX}${host}`;
  const redis = getRedis();
  if (redis) {
    await redis.set(key, entry, { ex: ttlSeconds });
    return;
  }
  memoryStore.set(key, { entry, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/** Reset stanu in-memory — WYŁĄCZNIE do testów. */
export function __resetTenantCacheForTests(): void {
  memoryStore.clear();
  cachedRedis = undefined;
}
