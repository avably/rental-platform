/**
 * Rate-limit (src/rate-limit.ts, ADR-106): backend to Postgres
 * (app.check_rate_limit przez PostgREST), a in-memory jest WYŁĄCZNIE
 * degradacją (brak env bazy albo błąd transportu). Testy jednostkowe kryją
 * obie warstwy bez sieci: adapter DB dostaje wstrzyknięty `fetchFn`, a
 * mechanika progu/segmentacji jedzie po fallbacku (env bazy wyczyszczony).
 * Dowód WSPÓŁDZIELENIA licznika między instancjami żyje w teście
 * integracyjnym packages/db/test/auth-rate-limit.test.ts (żywa baza).
 *
 * Niecichy sygnał braku konfiguracji NA VERCELU (aneks ADR-039/ADR-106,
 * 2026-08-10) ma własny opisany niżej.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PANEL_AUTH_RATE_LIMIT_PREFIX,
  STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX,
  __resetMemoryRateLimitForTests,
  checkRateLimit,
} from "../src/rate-limit";

const OPTS = { limit: 3, windowSeconds: 60, prefix: "test-rl" };

const DB_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
] as const;

beforeEach(() => {
  __resetMemoryRateLimitForTests();
  // Izolacja od env procesu (lokalny Supabase, CI job rls): testy jednostkowe
  // mechaniki fallbacku nie mogą po cichu bić w prawdziwą bazę.
  for (const key of DB_ENV_KEYS) vi.stubEnv(key, "");
  // Izolacja od platformy: bez tego dowolny test tego pliku uruchomiony
  // PRZYPADKIEM z VERCEL=1 w środowisku (np. lokalny `vercel dev`) zacząłby
  // po cichu zaliczać gałąź "produkcja bez bazy" i psuć niepowiązane testy.
  vi.stubEnv("VERCEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("adapter DB (env bazy ustawiony)", () => {
  const DB_URL = "http://db.example.test";
  const ANON = "anon-key-x";

  function stubDbEnv() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", DB_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON);
  }

  function fetchRow(success: boolean, remaining: number) {
    return vi.fn(
      async () => new Response(JSON.stringify([{ success, remaining }]), { status: 200 }),
    );
  }

  it("woła app.check_rate_limit przez PostgREST z prefiksowanym kluczem", async () => {
    stubDbEnv();
    const fetchFn = fetchRow(true, 2);

    const result = await checkRateLimit("login:ip:198.51.100.7", { ...OPTS, fetchFn });

    expect(result).toEqual({ success: true, remaining: 2 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${DB_URL}/rest/v1/rpc/check_rate_limit`);
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Profile"], "funkcja żyje w schemacie app").toBe("app");
    expect(headers.apikey).toBe(ANON);
    expect(JSON.parse(init.body as string)).toEqual({
      p_key: "test-rl:login:ip:198.51.100.7",
      p_limit: 3,
      p_window_seconds: 60,
    });
    expect(init.signal, "brak timeoutu — wisząca baza wiesza logowanie").toBeInstanceOf(
      AbortSignal,
    );
  });

  it("odmowa z bazy przechodzi 1:1 (success:false)", async () => {
    stubDbEnv();
    expect(await checkRateLimit("k", { ...OPTS, fetchFn: fetchRow(false, 0) })).toEqual({
      success: false,
      remaining: 0,
    });
  });

  it("błąd transportu → degradacja do licznika in-memory (limit dalej działa)", async () => {
    stubDbEnv();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(async () => {
      throw new Error("db down");
    });

    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await checkRateLimit("ip:203.0.113.5", { ...OPTS, fetchFn }));
    }

    // Fallback nadal odcina po progu — awaria bazy nie wyłącza limitu.
    expect(results.map((r) => r.success)).toEqual([true, true, true, false, false]);
    warn.mockRestore();
  });

  it("nie-2xx z PostgREST → degradacja, nie wyjątek", async () => {
    stubDbEnv();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(async () => new Response("boom", { status: 500 }));

    expect((await checkRateLimit("k2", { ...OPTS, fetchFn })).success).toBe(true);
    warn.mockRestore();
  });

  it("niespodziewany kształt odpowiedzi → degradacja, nie błędna zgoda", async () => {
    stubDbEnv();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(async () => new Response('{"nie":"tablica"}', { status: 200 }));

    // Degradacja = licznik in-memory, więc pierwsze wywołanie przechodzi.
    expect((await checkRateLimit("k3", { ...OPTS, fetchFn })).success).toBe(true);
    warn.mockRestore();
  });
});

describe("fallback in-memory: próg limitu", () => {
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

describe("fallback in-memory: segmentacja", () => {
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

describe("niecichy sygnał: produkcja (Vercel) bez konfiguracji bazy (aneks ADR-039/ADR-106)", () => {
  it("VERCEL=1 + brak env bazy → jeden console.warn, mimo wielu wywołań", async () => {
    vi.stubEnv("VERCEL", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await checkRateLimit("ip:198.51.100.20", OPTS);
    await checkRateLimit("ip:198.51.100.21", OPTS);
    await checkRateLimit("ip:198.51.100.22", OPTS);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/Vercel|in-memory|nie chroni globalnie/i);
    warn.mockRestore();
  });

  it("VERCEL=1 + brak env bazy → limit dalej realnie działa (in-memory, nie fail-open)", async () => {
    vi.stubEnv("VERCEL", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await checkRateLimit("ip:198.51.100.23", OPTS));
    }

    expect(results.map((r) => r.success)).toEqual([true, true, true, false, false]);
    warn.mockRestore();
  });

  it("VERCEL=1 + baza SKONFIGUROWANA → brak ostrzeżenia, używa bazy", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://db.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-x");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify([{ success: true, remaining: 2 }]), { status: 200 }),
    );

    const result = await checkRateLimit("ip:198.51.100.24", { ...OPTS, fetchFn });

    expect(result).toEqual({ success: true, remaining: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("kontrola pozytywna — BEZ VERCEL (dev/test/lokalny build): brak env bazy zostaje CICHY", async () => {
    // VERCEL już wyczyszczony w globalnym beforeEach — jawne powtórzenie dla
    // czytelności intencji tego testu.
    vi.stubEnv("VERCEL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await checkRateLimit("ip:198.51.100.25", OPTS);

    expect(result).toEqual({ success: true, remaining: 2 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
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
