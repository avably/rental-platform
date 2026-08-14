/**
 * CACHE MIĘDZYŻĄDANIOWY KATALOGU PUBLICZNEGO (faza 4a, ADR-185).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * `loadStorefrontContext` woła `getPublicCatalog` przez `cache` z Reacta, czyli
 * DEDUPLIKACJĘ W OBRĘBIE JEDNEGO ŻĄDANIA. Drugi odwiedzający płaci od nowa,
 * i trzeci, i każdy kolejny. Zmierzone na katalogu 200 pozycji: 227 019 bajtów
 * na każdą odsłonę każdej trasy, która czyta katalog (`/store`, strona
 * treściowa, koszyk, kasa, widget, sitemapa).
 *
 * ==================== UNIEWAŻNIANIE JEST JAWNE, NIE PO CZASIE ====================
 *
 * Sam TTL znaczyłby „klient widzi nieaktualną cenę przez N sekund po zmianie
 * w panelu" — czyli kłamstwo interfejsu tej samej klasy, którą zamykały
 * ADR-171/172. Dlatego pierwszym mechanizmem jest SKASOWANIE WPISU przez ten
 * sam panel, który zmienił dane (`apps/panel/lib/catalog-cache.ts`), pod
 * kluczem z rdzenia (`publicCatalogCacheKey`) — jednym dla obu stron kontraktu.
 *
 * TTL ZOSTAJE JAKO ZABEZPIECZENIE OSTATNIEJ SZANSY i tylko w tej roli.
 * Odpowiada za dokładnie dwa stany, w których skasowanie nie dochodzi:
 *   1. panel nie ma skonfigurowanego magazynu współdzielonego (`UPSTASH_*`) —
 *      wtedy sklep trzyma wpis w pamięci INSTANCJI, a panel nie ma czym w nią
 *      trafić;
 *   2. skasowanie się nie powiodło (błąd sieci do magazynu).
 * Błąd sieci panel wypisuje do logu zawsze, brak konfiguracji — wyłącznie na
 * produkcji, gdzie jest wadą wdrożenia (w dev i CI to stan normalny, a log przy
 * każdej mutacji uczyłby zespół przewijać błędy). Patrz nagłówek
 * `apps/panel/lib/catalog-cache.ts`.
 *
 * ==================== CZEGO TEN CACHE NIE OBEJMUJE ====================
 *
 * DOSTĘPNOŚCI. Ani `get_public_availability`, ani `_days`, ani
 * `_catalog_availability` (0081) nie przechodzą tędy i nie mają prawa przejść:
 * dostępność liczy się per termin i zmienia przy każdej rezerwacji, więc
 * zbuforowana dostępność to podwójny wynajem. Ten plik dotyka WYŁĄCZNIE
 * koperty katalogu — nazw, cen, zdjęć, progów i definicji pól.
 */
import { Redis } from "@upstash/redis";

import { publicCatalogCacheKey } from "@avably/core/site";

import type { PublicCatalog } from "@/lib/checkout/contract";

/**
 * TTL wpisu. Równy `PAGES_TTL_SECONDS` rejestru adresów stron i z tego samego
 * powodu: to jest górna granica NIEŚWIEŻOŚCI w razie nieskutecznego
 * unieważnienia, a nie planowane okno nieaktualności. Przy działającym
 * kasowaniu z panelu klient widzi zmianę natychmiast.
 */
export const CATALOG_TTL_SECONDS = 60;

/**
 * TTL dla „ten najemca nie ma katalogu" (nieaktywny / błąd odczytu). Krótki,
 * bo `null` jest u nas stanem GASZĄCYM sklep — świeżo aktywowany najemca nie
 * może być niewidoczny dłużej niż chwilę.
 */
export const CATALOG_NEGATIVE_TTL_SECONDS = 15;

interface MemoryEntry {
  entry: PublicCatalog | null;
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

export interface CatalogCacheDeps {
  getCache: (tenantId: string) => Promise<{ entry: PublicCatalog | null } | undefined>;
  setCache: (tenantId: string, entry: PublicCatalog | null, ttlSeconds: number) => Promise<void>;
  lookup: (tenantId: string) => Promise<PublicCatalog | null>;
}

/**
 * Katalog najemcy: cache → pudło → baza. Logika CZYSTA, zależności
 * wstrzykiwane — dzięki temu test izolacji może policzyć, ile razy naprawdę
 * poszliśmy do bazy, zamiast wierzyć, że poszliśmy.
 *
 * `tenantId` jedzie do KAŻDEJ z trzech zależności osobno i nigdy nie jest
 * domyślny: to on, a nie kolejność wywołań, decyduje, czyj katalog wraca.
 */
export async function resolvePublicCatalog(
  tenantId: string,
  deps: CatalogCacheDeps,
): Promise<PublicCatalog | null> {
  const cached = await deps.getCache(tenantId);
  if (cached !== undefined) return cached.entry;

  const catalog = await deps.lookup(tenantId);
  await deps.setCache(
    tenantId,
    catalog,
    catalog ? CATALOG_TTL_SECONDS : CATALOG_NEGATIVE_TTL_SECONDS,
  );
  return catalog;
}

export async function getCachedCatalog(
  tenantId: string,
): Promise<{ entry: PublicCatalog | null } | undefined> {
  const key = publicCatalogCacheKey(tenantId);
  const redis = getRedis();
  if (redis) {
    const value = await redis.get<{ entry: PublicCatalog | null }>(key);
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

export async function setCachedCatalog(
  tenantId: string,
  entry: PublicCatalog | null,
  ttlSeconds: number,
): Promise<void> {
  const key = publicCatalogCacheKey(tenantId);
  const redis = getRedis();
  if (redis) {
    await redis.set(key, { entry }, { ex: ttlSeconds });
    return;
  }
  memoryStore.set(key, { entry, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/** Reset stanu in-memory — WYŁĄCZNIE do testów. */
export function __resetCatalogCacheForTests(): void {
  memoryStore.clear();
  cachedRedis = undefined;
}
