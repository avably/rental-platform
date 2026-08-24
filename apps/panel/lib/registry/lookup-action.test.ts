import { beforeEach, describe, expect, it, vi } from "vitest";

const FAKE_SUPABASE = { schema: () => ({ rpc: async () => ({ data: null, error: null }) }) };

let authCtx: { user: { id: string; email: string | null } } | null = { user: { id: "user-1", email: "a@b.pl" } };
let rateLimitSuccess = true;

vi.mock("@/lib/auth", () => ({ getAuthContext: async () => authCtx }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseServerClient: async () => FAKE_SUPABASE }));
vi.mock("@avably/security/rate-limit", () => ({
  NIP_LOOKUP_RATE_LIMIT_PREFIX: "nip-lookup-rl",
  checkRateLimit: async () => ({ success: rateLimitSuccess, remaining: rateLimitSuccess ? 5 : 0 }),
}));

const cacheGetMock = vi.fn();
const cachePutMock = vi.fn();
vi.mock("./cache", () => ({
  getCachedLookup: (...args: unknown[]) => cacheGetMock(...args),
  isFreshEnough: (row: { fetched_at: string }, now: Date = new Date()) =>
    now.getTime() - new Date(row.fetched_at).getTime() < 72 * 60 * 60 * 1000,
  putCachedLookup: (...args: unknown[]) => cachePutMock(...args),
}));

const lookupMock = vi.fn();
vi.mock("./lookup", () => ({ lookupCompanyByNip: (...args: unknown[]) => lookupMock(...args) }));

const { lookupCompanyByNipAction } = await import("./lookup-action");

const FOUND_RESULT = {
  ok: true as const,
  nip: "7740001454",
  legalName: "ORLEN SA",
  regon: "610188201",
  krs: "0000028860",
  address: { street: "Chemików 7", zip: "09-411", city: "Płock" },
  statusVat: "Czynny",
  source: "mf" as const,
  fetchedAt: "2026-08-24T00:00:00Z",
  requestId: "abc",
};

describe("lookupCompanyByNipAction", () => {
  beforeEach(() => {
    authCtx = { user: { id: "user-1", email: "a@b.pl" } };
    rateLimitSuccess = true;
    cacheGetMock.mockReset().mockResolvedValue(null);
    cachePutMock.mockReset().mockResolvedValue(undefined);
    lookupMock.mockReset();
  });

  it("niezalogowany → unavailable, ZERO wywołań rate-limit/cache/lookup (auth-only, brief SPEC B)", async () => {
    authCtx = null;
    const result = await lookupCompanyByNipAction("7740001454");
    expect(result).toEqual({ ok: false, reason: "unavailable", message: "Wymagane zalogowanie." });
    expect(cacheGetMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("zły checksum → invalid_checksum PRZED rate-limitem i cache'em (nie zjada budżetu)", async () => {
    const result = await lookupCompanyByNipAction("1234567890");
    expect(result).toEqual({ ok: false, reason: "invalid_checksum", message: "Nieprawidłowy NIP." });
    expect(cacheGetMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rate limit przekroczony → unavailable, lookup NIE wołany", async () => {
    rateLimitSuccess = false;
    const result = await lookupCompanyByNipAction("7740001454");
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe("unavailable");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("cache świeży (< 72h) → wynik z cache'a, MF/GUS NIE wołane", async () => {
    cacheGetMock.mockResolvedValue({
      data: { legalName: "ORLEN SA", regon: "610188201", krs: null, address: { street: "", zip: "", city: "" }, statusVat: null, source: "mf", fetchedAt: new Date().toISOString(), requestId: null },
      source: "mf",
      request_id: null,
      fetched_at: new Date().toISOString(),
    });
    const result = await lookupCompanyByNipAction("7740001454");
    expect(result.ok).toBe(true);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("cache stary (> 72h) → hybryda wołana od nowa, wynik dopisany do cache", async () => {
    cacheGetMock.mockResolvedValue({
      data: {},
      source: "mf",
      request_id: null,
      fetched_at: new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(),
    });
    lookupMock.mockResolvedValue(FOUND_RESULT);

    const result = await lookupCompanyByNipAction("7740001454");
    expect(result).toEqual(FOUND_RESULT);
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(cachePutMock).toHaveBeenCalledTimes(1);
  });

  it("brak w cache → hybryda wołana, sukces zapisany do cache", async () => {
    lookupMock.mockResolvedValue(FOUND_RESULT);
    const result = await lookupCompanyByNipAction("774-000-14-54");
    expect(result).toEqual(FOUND_RESULT);
    expect(cachePutMock).toHaveBeenCalledWith(FAKE_SUPABASE, FOUND_RESULT);
  });

  it("hybryda zwraca not_found → NIC nie zapisuje do cache", async () => {
    lookupMock.mockResolvedValue({ ok: false, reason: "not_found", message: "Nie znaleźliśmy firmy o tym NIP." });
    const result = await lookupCompanyByNipAction("7740001454");
    expect(result.ok).toBe(false);
    expect(cachePutMock).not.toHaveBeenCalled();
  });
});
