/**
 * Rate-limit — JEDNO źródło prawdy dla panelu i storefrontu. Upstash Redis,
 * jeśli skonfigurowane zmienne środowiskowe (`UPSTASH_REDIS_REST_URL` +
 * `UPSTASH_REDIS_REST_TOKEN`), w przeciwnym razie fallback in-memory.
 *
 * Mieszka w pakiecie z tego samego powodu co polityka CSP (patrz docblock
 * src/index.ts): rate-limit jest prymitywem security-krytycznym, a cichy
 * rozjazd jego mechaniki między apkami byłby regresją niewidoczną w code
 * review. Wcześniej istniał jako dwie bliźniacze kopie w `lib/` obu apek.
 *
 * OSOBNY entrypoint: `@avably/security/rate-limit`. Reszta pakietu opiera się
 * o `next/server`, a limit nie potrzebuje Next.js — import z korzenia
 * wciągałby framework do modułu, który go nie używa (wzorzec: `@avably/db/service`).
 *
 * TODO(infra): dodać UPSTASH_REDIS_REST_URL/TOKEN po stronie hostingu — do
 * tego czasu fallback in-memory działa lokalnie i w CI, ale NIE jest
 * współdzielony między instancjami/regionami. W produkcji wielo-instancyjnej
 * (Vercel) limit per instancja ≠ limit globalny.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Prefiksy przestrzeni kluczy. Limity publiczne i limity auth panelu NIE mogą
 * ich dzielić — inaczej ruch anonima na storefroncie zjadałby budżet logowania
 * do panelu. Stałe stoją tutaj, a nie przy wywołaniach, żeby wartość prefiksu
 * nie mogła rozjechać się między call site'ami.
 */
export const PANEL_AUTH_RATE_LIMIT_PREFIX = "panel-auth-rl";
export const STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX = "storefront-public-rl";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
}

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  /** Przestrzeń kluczy — patrz stałe *_RATE_LIMIT_PREFIX. */
  prefix: string;
}

interface MemoryEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();

function memoryRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: Math.max(0, limit - 1) };
  }
  entry.count += 1;
  return { success: entry.count <= limit, remaining: Math.max(0, limit - entry.count) };
}

const upstashLimiters = new Map<string, Ratelimit>();

function getUpstashLimiter(opts: RateLimitOptions): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const cacheKey = `${opts.prefix}:${opts.limit}:${opts.windowSeconds}`;
  const cached = upstashLimiters.get(cacheKey);
  if (cached) return cached;

  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(opts.limit, `${opts.windowSeconds} s`),
    prefix: opts.prefix,
  });
  upstashLimiters.set(cacheKey, limiter);
  return limiter;
}

/**
 * @param key np. `login:ip:<ip>` albo `waitlist:ip:<ip>` — segmentowany per
 *   akcja, żeby limit jednej ścieżki nie blokował innych.
 *
 * Prefiks wchodzi do klucza in-memory, nie tylko do Upstasha. Dopóki to były
 * dwa moduły w dwóch apkach, każdy miał własną mapę i prefiks liczył się
 * wyłącznie po stronie Redisa; po scaleniu mapa jest jedna, więc bez prefiksu
 * w kluczu fallback zlewałby obie przestrzenie w jedną.
 */
export async function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const limiter = getUpstashLimiter(opts);
  if (limiter) {
    const { success, remaining } = await limiter.limit(key);
    return { success, remaining };
  }
  return memoryRateLimit(`${opts.prefix}:${key}`, opts.limit, opts.windowSeconds * 1000);
}

/** Reset stanu in-memory — WYŁĄCZNIE do testów. */
export function __resetMemoryRateLimitForTests(): void {
  memoryStore.clear();
}
