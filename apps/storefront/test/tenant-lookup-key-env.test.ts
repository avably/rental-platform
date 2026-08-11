/**
 * Rozwiązywanie tenanta (middleware) × warstwa kluczy ADR-142 — dowód
 * behawioralny na ścieżce produkcyjnej: lookupTenantIdBySlug woła PostgREST
 * i ten test patrzy, KTÓRYM kluczem podpisuje żądanie (apikey + Bearer).
 *
 * To jest ścieżka z lekcji build-time: lookup biega w proxy.ts, więc env
 * jest wmurowywany w build — warstwa trzyma odczyt STATYCZNY, a bramka
 * scripts/audit-browser-env-inlining.sh pilnuje wmurowania po stronie
 * skompilowanego artefaktu. Tu pilnujemy fallbacku dwu-nazwowego i
 * fail-closed przy braku obu nazw.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { lookupTenantIdBySlug } from "@/lib/tenant/lookup";

const URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const NEW_ENV = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
const LEGACY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

const NEW_KEY = "sb_publishable_lookup_test";
const LEGACY_KEY = "legacy-anon-lookup-test";
const TENANT_ID = "11111111-2222-3333-4444-555555555555";

function stubEnv(newValue: string, legacyValue: string) {
  vi.stubEnv(URL_ENV, "http://sb.example.test");
  vi.stubEnv(NEW_ENV, newValue);
  vi.stubEnv(LEGACY_ENV, legacyValue);
}

function fetchTenant() {
  return vi.fn(async () => new Response(JSON.stringify(TENANT_ID), { status: 200 }));
}

async function keyUsed(fetchFn: ReturnType<typeof fetchTenant>): Promise<string> {
  vi.stubGlobal("fetch", fetchFn);
  const resolved = await lookupTenantIdBySlug("sklep-testowy");
  expect(resolved, "lookup nie zwrócił tenanta mimo 200 z RPC").toBe(TENANT_ID);
  const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  // Ten sam klucz w obu pozycjach — tak podpisuje się anonimowe RPC.
  expect(headers.Authorization).toBe(`Bearer ${headers.apikey}`);
  return headers.apikey;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("lookup tenanta — klucz publikowalny z warstwy ADR-142", () => {
  it("nowa nazwa działa sama", async () => {
    stubEnv(NEW_KEY, "");
    expect(await keyUsed(fetchTenant())).toBe(NEW_KEY);
  });

  it("legacy działa sama", async () => {
    stubEnv("", LEGACY_KEY);
    expect(await keyUsed(fetchTenant())).toBe(LEGACY_KEY);
  });

  it("obie → wygrywa nowa", async () => {
    stubEnv(NEW_KEY, LEGACY_KEY);
    expect(await keyUsed(fetchTenant())).toBe(NEW_KEY);
  });

  it("brak obu → fail-closed: null bez żadnego żądania, log nazywa env", async () => {
    stubEnv("", "");
    const fetchFn = fetchTenant();
    vi.stubGlobal("fetch", fetchFn);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await lookupTenantIdBySlug("sklep-testowy")).toBeNull();
      expect(fetchFn, "bez klucza lookup nie ma prawa wołać PostgREST").not.toHaveBeenCalled();
      expect(
        error.mock.calls.flat().join(" "),
        "log ma mówić operatorowi, KTÓRE env ustawić",
      ).toContain(NEW_ENV);
    } finally {
      error.mockRestore();
    }
  });
});
