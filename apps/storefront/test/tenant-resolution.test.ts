/**
 * Orkiestracja cache → baza (lib/tenant/resolve.ts, Zadanie 2.1). Zależności
 * wstrzyknięte — dowodzimy logiki cache'u (pozytywnego i NEGATYWNEGO) bez sieci.
 */
import { describe, expect, it, vi } from "vitest";

import {
  NEGATIVE_TTL_SECONDS,
  POSITIVE_TTL_SECONDS,
  resolveTenant,
  type ResolveTenantDeps,
} from "@/lib/tenant/resolve";

function deps(overrides: Partial<ResolveTenantDeps> = {}): ResolveTenantDeps {
  return {
    getCache: vi.fn(async () => undefined),
    setCache: vi.fn(async () => {}),
    lookup: vi.fn(async () => null),
    ...overrides,
  };
}

describe("resolveTenant — cache → baza", () => {
  it("trafienie pozytywne w cache zwraca id i NIE odpytuje bazy", async () => {
    const d = deps({ getCache: vi.fn(async () => ({ tenantId: "cached-id" })) });

    const result = await resolveTenant("acme.avably.io", "acme", d);

    expect(result).toEqual({ tenantId: "cached-id" });
    expect(d.lookup).not.toHaveBeenCalled();
    expect(d.setCache).not.toHaveBeenCalled();
  });

  it("trafienie NEGATYWNE w cache zwraca null i NIE odpytuje bazy", async () => {
    const d = deps({ getCache: vi.fn(async () => ({ tenantId: null })) });

    const result = await resolveTenant("ghost.avably.io", "ghost", d);

    expect(result).toBeNull();
    expect(d.lookup).not.toHaveBeenCalled();
  });

  it("miss → baza zwraca id → wynik i cache POZYTYWNY z długim TTL", async () => {
    const setCache = vi.fn(async () => {});
    const d = deps({ lookup: vi.fn(async () => "db-id"), setCache });

    const result = await resolveTenant("acme.avably.io", "acme", d);

    expect(result).toEqual({ tenantId: "db-id" });
    expect(setCache).toHaveBeenCalledWith("acme.avably.io", { tenantId: "db-id" }, POSITIVE_TTL_SECONDS);
  });

  it("miss → baza zwraca null → wynik null i cache NEGATYWNY z krótkim TTL", async () => {
    const setCache = vi.fn(async () => {});
    const d = deps({ lookup: vi.fn(async () => null), setCache });

    const result = await resolveTenant("ghost.avably.io", "ghost", d);

    expect(result).toBeNull();
    expect(setCache).toHaveBeenCalledWith("ghost.avably.io", { tenantId: null }, NEGATIVE_TTL_SECONDS);
    expect(NEGATIVE_TTL_SECONDS).toBeLessThan(POSITIVE_TTL_SECONDS);
  });
});
