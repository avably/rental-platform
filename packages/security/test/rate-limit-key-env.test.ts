/**
 * Rate-limit × warstwa kluczy ADR-142 — dowód behawioralny na ścieżce
 * produkcyjnej: checkRateLimit z wstrzykniętym fetchFn pokazuje, KTÓRYM
 * kluczem adapter DB podpisuje wywołanie app.check_rate_limit.
 *
 * Kontrakt: nowa nazwa działa · legacy działa · obie → nowa wygrywa ·
 * SUPABASE_LOCAL_ANON_KEY (harness CI job `rls`) zostaje OSTATNIM fallbackiem.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMemoryRateLimitForTests, checkRateLimit } from "../src/rate-limit";

const OPTS = { limit: 3, windowSeconds: 60, prefix: "test-rl-env" };
const DB_URL = "http://db.example.test";

const KEY_ENV_NAMES = [
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_LOCAL_ANON_KEY",
] as const;

const NEW_KEY = "sb_publishable_rl_test";
const LEGACY_KEY = "legacy-anon-rl-test";
const LOCAL_KEY = "local-anon-rl-test";

beforeEach(() => {
  __resetMemoryRateLimitForTests();
  // Izolacja od env procesu — jak w rate-limit.test.ts.
  for (const name of KEY_ENV_NAMES) vi.stubEnv(name, "");
  vi.stubEnv("SUPABASE_LOCAL_API_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", DB_URL);
  vi.stubEnv("VERCEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function fetchOk() {
  return vi.fn(async () => new Response(JSON.stringify([{ success: true, remaining: 2 }]), { status: 200 }));
}

async function apikeyUsed(fetchFn: ReturnType<typeof fetchOk>): Promise<string | undefined> {
  await checkRateLimit("k", { ...OPTS, fetchFn });
  expect(fetchFn, "adapter DB w ogóle nie zawołał PostgREST").toHaveBeenCalledTimes(1);
  const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
  return (init.headers as Record<string, string>).apikey;
}

describe("adapter DB rate-limitu — klucz publikowalny z warstwy ADR-142", () => {
  it("nowa nazwa działa sama", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", NEW_KEY);
    expect(await apikeyUsed(fetchOk())).toBe(NEW_KEY);
  });

  it("legacy działa sama", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", LEGACY_KEY);
    expect(await apikeyUsed(fetchOk())).toBe(LEGACY_KEY);
  });

  it("obie → wygrywa nowa", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", NEW_KEY);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", LEGACY_KEY);
    expect(await apikeyUsed(fetchOk())).toBe(NEW_KEY);
  });

  it("harness lokalny (SUPABASE_LOCAL_ANON_KEY) zostaje fallbackiem za oboma", async () => {
    vi.stubEnv("SUPABASE_LOCAL_ANON_KEY", LOCAL_KEY);
    expect(await apikeyUsed(fetchOk())).toBe(LOCAL_KEY);

    __resetMemoryRateLimitForTests();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", NEW_KEY);
    const fetchFn = fetchOk();
    expect(await apikeyUsed(fetchFn)).toBe(NEW_KEY);
  });

  it("brak wszystkich nazw → degradacja in-memory (fail-closed bez sieci)", async () => {
    const fetchFn = fetchOk();
    const result = await checkRateLimit("k", { ...OPTS, fetchFn });
    expect(result.success).toBe(true);
    expect(fetchFn, "bez klucza adapter DB nie ma prawa wołać PostgREST").not.toHaveBeenCalled();
  });
});
