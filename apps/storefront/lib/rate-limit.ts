/**
 * Rate-limit dla akcji publicznych storefrontu (waitlista) — Upstash Redis,
 * jeśli skonfigurowane zmienne środowiskowe (`UPSTASH_REDIS_REST_URL` +
 * `UPSTASH_REDIS_REST_TOKEN`), w przeciwnym razie fallback in-memory.
 *
 * Odpowiednik apps/panel/lib/rate-limit.ts — ta sama mechanika, inny prefiks
 * (storefront-public-rl), żeby limity publiczne i limity auth panelu nie
 * dzieliły przestrzeni kluczy.
 *
 * TODO(dług): ta implementacja jest bliźniacza do panelowej. Rate-limit jest
 * prymitywem security-krytycznym, a projekt ma już zasadę, że takie prymitywy
 * mieszkają w pakiecie, nie w lib/ każdej apki (patrz docblock
 * packages/security/src/index.ts o CSP). Wyodrębnienie do @avably/security
 * wymaga przepisania 4 wywołań w panelu — świadomie poza zakresem tego PR-a
 * (backend waitlisty), do zrobienia osobno.
 *
 * TODO(infra): dodać UPSTASH_REDIS_REST_URL/TOKEN po stronie hostingu — do
 * tego czasu fallback in-memory działa lokalnie i w CI, ale NIE jest
 * współdzielony między instancjami/regionami. W produkcji wielo-instancyjnej
 * (Vercel) limit per instancja ≠ limit globalny.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
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

function getUpstashLimiter(limit: number, windowSeconds: number): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const cacheKey = `${limit}:${windowSeconds}`;
  const cached = upstashLimiters.get(cacheKey);
  if (cached) return cached;

  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix: "storefront-public-rl",
  });
  upstashLimiters.set(cacheKey, limiter);
  return limiter;
}

/**
 * @param key np. `waitlist:ip:<ip>` — segmentowany per akcja, żeby limit
 *   jednej ścieżki publicznej nie blokował innych.
 */
export async function checkPublicRateLimit(
  key: string,
  opts: { limit: number; windowSeconds: number },
): Promise<RateLimitResult> {
  const limiter = getUpstashLimiter(opts.limit, opts.windowSeconds);
  if (limiter) {
    const { success, remaining } = await limiter.limit(key);
    return { success, remaining };
  }
  return memoryRateLimit(key, opts.limit, opts.windowSeconds * 1000);
}

/** Reset stanu in-memory — WYŁĄCZNIE do testów. */
export function __resetMemoryRateLimitForTests(): void {
  memoryStore.clear();
}
