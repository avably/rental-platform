import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCachedLookup, isFreshEnough, putCachedLookup } from "./cache";
import type { CompanyLookupFound, NipLookupCacheData } from "./types";

function fakeSupabase(rpcImpl: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>) {
  return { schema: () => ({ rpc: rpcImpl }) } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("getCachedLookup", () => {
  it("zwraca wiersz, gdy RPC oddaje jeden rekord", async () => {
    const row = { data: { legalName: "ORLEN SA" }, source: "mf", request_id: "x", fetched_at: "2026-08-24T00:00:00Z" };
    const supabase = fakeSupabase(async () => ({ data: [row], error: null }));
    expect(await getCachedLookup(supabase, "7740001454")).toEqual(row);
  });

  it("zwraca null, gdy brak wiersza (pusta tablica)", async () => {
    const supabase = fakeSupabase(async () => ({ data: [], error: null }));
    expect(await getCachedLookup(supabase, "7740001454")).toBeNull();
  });

  it("zwraca null (fail-closed), gdy RPC zwraca błąd — nie wywala się", async () => {
    const supabase = fakeSupabase(async () => ({ data: null, error: { message: "boom" } }));
    expect(await getCachedLookup(supabase, "7740001454")).toBeNull();
  });
});

describe("isFreshEnough", () => {
  it("świeży wiersz (poniżej 72h) → true", () => {
    const row = { data: {} as NipLookupCacheData, source: "mf" as const, request_id: null, fetched_at: new Date().toISOString() };
    expect(isFreshEnough(row, new Date())).toBe(true);
  });

  it("stary wiersz (powyżej 72h) → false", () => {
    const fetchedAt = new Date("2026-08-01T00:00:00Z");
    const now = new Date("2026-08-24T00:00:00Z");
    const row = { data: {} as NipLookupCacheData, source: "mf" as const, request_id: null, fetched_at: fetchedAt.toISOString() };
    expect(isFreshEnough(row, now)).toBe(false);
  });

  it("dokładnie na granicy 72h → false (< nie <=)", () => {
    const fetchedAt = new Date("2026-08-21T00:00:00.000Z");
    const now = new Date("2026-08-24T00:00:00.000Z"); // dokładnie 72h później
    const row = { data: {} as NipLookupCacheData, source: "mf" as const, request_id: null, fetched_at: fetchedAt.toISOString() };
    expect(isFreshEnough(row, now)).toBe(false);
  });
});

describe("putCachedLookup", () => {
  const ORIGINAL_SECRET = process.env.REGISTRY_CACHE_WRITE_SECRET;

  beforeEach(() => {
    process.env.REGISTRY_CACHE_WRITE_SECRET = "test-write-secret";
  });
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.REGISTRY_CACHE_WRITE_SECRET;
    else process.env.REGISTRY_CACHE_WRITE_SECRET = ORIGINAL_SECRET;
  });

  it("woła RPC z rozpakowanymi danymi + p_write_secret (bez ok/nip w p_data) — luka z recenzji, 0099", async () => {
    const rpcImpl = vi.fn(async () => ({ data: null, error: null }));
    const supabase = fakeSupabase(rpcImpl);
    const result: CompanyLookupFound = {
      ok: true,
      nip: "7740001454",
      legalName: "ORLEN SA",
      regon: "610188201",
      krs: "0000028860",
      address: { street: "Chemików 7", zip: "09-411", city: "Płock" },
      statusVat: "Czynny",
      source: "mf",
      fetchedAt: "2026-08-24T00:00:00Z",
      requestId: "abc",
    };

    await putCachedLookup(supabase, result);

    expect(rpcImpl).toHaveBeenCalledWith("nip_lookup_cache_put", {
      p_nip: "7740001454",
      p_data: {
        legalName: "ORLEN SA",
        regon: "610188201",
        krs: "0000028860",
        address: { street: "Chemików 7", zip: "09-411", city: "Płock" },
        statusVat: "Czynny",
        source: "mf",
        fetchedAt: "2026-08-24T00:00:00Z",
        requestId: "abc",
      },
      p_source: "mf",
      p_request_id: "abc",
      p_write_secret: "test-write-secret",
    });
  });

  it("nie rzuca, gdy RPC zwraca błąd (best-effort)", async () => {
    const supabase = fakeSupabase(async () => ({ data: null, error: { message: "boom" } }));
    const result: CompanyLookupFound = {
      ok: true,
      nip: "7740001454",
      legalName: "ORLEN SA",
      regon: null,
      krs: null,
      address: { street: "", zip: "", city: "" },
      statusVat: null,
      source: "gus",
      fetchedAt: "2026-08-24T00:00:00Z",
      requestId: null,
    };
    await expect(putCachedLookup(supabase, result)).resolves.toBeUndefined();
  });

  it("brak REGISTRY_CACHE_WRITE_SECRET → RPC i tak wołane (best-effort, prefill nietknięty), ale bez sekretu + ostrzeżenie w logu", async () => {
    delete process.env.REGISTRY_CACHE_WRITE_SECRET;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpcImpl = vi.fn(async (_fn: string, _args: unknown) => ({
      data: null,
      error: { message: "brak uprawnień do zapisu w rejestrze", code: "42501" },
    }));
    const supabase = fakeSupabase(rpcImpl);
    const result: CompanyLookupFound = {
      ok: true,
      nip: "7740001454",
      legalName: "ORLEN SA",
      regon: null,
      krs: null,
      address: { street: "", zip: "", city: "" },
      statusVat: null,
      source: "mf",
      fetchedAt: "2026-08-24T00:00:00Z",
      requestId: null,
    };

    await putCachedLookup(supabase, result);

    const call = rpcImpl.mock.calls[0]![1] as { p_write_secret?: string };
    expect(call?.p_write_secret).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("REGISTRY_CACHE_WRITE_SECRET"));
    warn.mockRestore();
  });
});
