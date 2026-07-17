/**
 * Sanityzacja nagłówków tenanta (lib/tenant/headers.ts, Zadanie 2.1). Jednostka
 * bramki anty-spoofingu — dowód proxy-level jest w proxy.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  TENANT_ID_HEADER,
  TENANT_SLUG_HEADER,
  setResolvedTenant,
  stripInboundTenantHeaders,
} from "@/lib/tenant/headers";

describe("nagłówki tenanta", () => {
  it("stripInboundTenantHeaders usuwa oba nagłówki (case-insensitive)", () => {
    const headers = new Headers({
      "X-Tenant-Id": "attacker",
      "x-tenant-slug": "attacker-slug",
      "x-nonce": "zostaje",
    });

    stripInboundTenantHeaders(headers);

    expect(headers.get(TENANT_ID_HEADER)).toBeNull();
    expect(headers.get(TENANT_SLUG_HEADER)).toBeNull();
    expect(headers.get("x-nonce"), "usunięto niepowiązany nagłówek").toBe("zostaje");
  });

  it("setResolvedTenant nadpisuje wartościami server-side", () => {
    const headers = new Headers({ [TENANT_ID_HEADER]: "attacker" });

    setResolvedTenant(headers, { id: "resolved-id", slug: "acme" });

    expect(headers.get(TENANT_ID_HEADER)).toBe("resolved-id");
    expect(headers.get(TENANT_SLUG_HEADER)).toBe("acme");
  });
});
