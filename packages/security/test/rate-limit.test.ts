/**
 * Testy jadą po ścieżce fallbacku in-memory: bez UPSTASH_REDIS_REST_URL/TOKEN
 * `checkRateLimit` nigdy nie sięga po sieć, więc mechanikę progu i segmentacji
 * da się sprawdzić bez mockowania Redisa. Ścieżka Upstasha to cienki adapter
 * nad `@upstash/ratelimit` — testujemy tu regułę, nie cudzą bibliotekę.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PANEL_AUTH_RATE_LIMIT_PREFIX,
  STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX,
  __resetMemoryRateLimitForTests,
  checkRateLimit,
} from "../src/rate-limit";

const OPTS = { limit: 3, windowSeconds: 60, prefix: "test-rl" };

beforeEach(() => {
  __resetMemoryRateLimitForTests();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("próg limitu", () => {
  it("przepuszcza dokładnie do progu i odcina powyżej", async () => {
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await checkRateLimit("ip:203.0.113.7", OPTS));
    }

    expect(results.map((r) => r.success)).toEqual([true, true, true, false, false]);
  });

  it("raportuje malejące `remaining`, nigdy poniżej zera", async () => {
    const remaining = [];
    for (let i = 0; i < 5; i += 1) {
      remaining.push((await checkRateLimit("ip:203.0.113.8", OPTS)).remaining);
    }

    expect(remaining).toEqual([2, 1, 0, 0, 0]);
  });

  it("otwiera limit ponownie po wygaśnięciu okna", async () => {
    vi.useFakeTimers();

    for (let i = 0; i < 3; i += 1) await checkRateLimit("ip:203.0.113.9", OPTS);
    expect((await checkRateLimit("ip:203.0.113.9", OPTS)).success).toBe(false);

    vi.advanceTimersByTime(60_000 + 1);

    expect((await checkRateLimit("ip:203.0.113.9", OPTS)).success).toBe(true);
  });
});

describe("segmentacja", () => {
  it("liczy każdy klucz osobno w obrębie prefiksu", async () => {
    for (let i = 0; i < 3; i += 1) await checkRateLimit("login:a@example.com", OPTS);
    expect((await checkRateLimit("login:a@example.com", OPTS)).success).toBe(false);

    // Wyczerpanie limitu jednego użytkownika nie może zamknąć drogi innemu.
    expect((await checkRateLimit("login:b@example.com", OPTS)).success).toBe(true);
  });

  it("nie dzieli przestrzeni kluczy między prefiksy", async () => {
    // Regresja realna od scalenia obu kopii w jeden moduł: mapa in-memory jest
    // teraz JEDNA, więc gdyby prefiks nie wchodził do klucza, ruch anonima na
    // storefroncie zjadałby budżet logowania do panelu przy tym samym `key`.
    const key = "ip:203.0.113.10";
    const publicOpts = { ...OPTS, prefix: STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX };
    const authOpts = { ...OPTS, prefix: PANEL_AUTH_RATE_LIMIT_PREFIX };

    for (let i = 0; i < 3; i += 1) await checkRateLimit(key, publicOpts);
    expect((await checkRateLimit(key, publicOpts)).success).toBe(false);

    expect((await checkRateLimit(key, authOpts)).success).toBe(true);
  });

  it("trzyma rozłączne prefiksy dla limitów publicznych i auth", () => {
    expect(STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX).not.toBe(PANEL_AUTH_RATE_LIMIT_PREFIX);
  });

  it("rozróżnia okna/limity o tym samym kluczu przez własny licznik", async () => {
    for (let i = 0; i < 3; i += 1) await checkRateLimit("ip:203.0.113.11", OPTS);

    // Ten sam klucz i prefiks przy innym limicie dalej widzi ten sam licznik —
    // limit jest własnością wywołania, a nie osobną przestrzenią kluczy.
    expect((await checkRateLimit("ip:203.0.113.11", { ...OPTS, limit: 10 })).success).toBe(true);
  });
});

describe("__resetMemoryRateLimitForTests", () => {
  it("czyści licznik", async () => {
    for (let i = 0; i < 4; i += 1) await checkRateLimit("ip:203.0.113.12", OPTS);
    expect((await checkRateLimit("ip:203.0.113.12", OPTS)).success).toBe(false);

    __resetMemoryRateLimitForTests();

    expect((await checkRateLimit("ip:203.0.113.12", OPTS)).success).toBe(true);
  });
});
