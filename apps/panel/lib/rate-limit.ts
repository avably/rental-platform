/**
 * Rate-limit dla akcji auth (register/login/reset) — Upstash Redis, jeśli
 * skonfigurowane zmienne środowiskowe (`UPSTASH_REDIS_REST_URL` +
 * `UPSTASH_REDIS_REST_TOKEN`), w przeciwnym razie fallback in-memory.
 *
 * TODO(Task 3 infra): dodać UPSTASH_REDIS_REST_URL/TOKEN po stronie
 * hostingu — do tego czasu fallback in-memory działa lokalnie i w CI, ale
 * NIE jest współdzielony między instancjami/regionami w produkcji
 * wielo-instancyjnej.
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
    prefix: "panel-auth-rl",
  });
  upstashLimiters.set(cacheKey, limiter);
  return limiter;
}

/**
 * @param key np. `register:<ip>` albo `login:<email>` — segmentowane per
 *   akcja, żeby limit jednej ścieżki nie blokował innych.
 */
export async function checkAuthRateLimit(
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
