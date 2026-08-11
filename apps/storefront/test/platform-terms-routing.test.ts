/**
 * Routing /terms: marketing-host vs tenant-host (0070, ADR-141).
 *
 * Spike przewidział kolizję i kazał ją PRZYPIĄĆ testem: oś tenancka ma
 * literał `(tenant)/terms` (alias → /regulamin najemcy), a oś marketingowa
 * dostaje `[locale]/terms` (regulamin PLATFORMY). Rozstrzyga proxy po
 * hoście — dokładnie ten sam mechanizm, który od 0063 rozdziela parę
 * `(tenant)/privacy` / `[locale]/privacy`. Osobny plik obok proxy.test.ts:
 * tamten pilnuje nagłówków bezpieczeństwa i należy do równoległego pasa.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy, runProxy, type ProxyDeps } from "../proxy";

const ACME_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const fakeDeps: ProxyDeps = {
  resolveTenant: async (_host, slug) => (slug === "acme" ? { tenantId: ACME_ID } : null),
  resolveTenantByDomain: async () => null,
};

describe("routing /terms — dwie osie, jeden segment", () => {
  it("marketing-host: goły /terms dostaje prefiks locale (redirect i18n, zero kontekstu tenanta)", async () => {
    const request = new NextRequest("https://www.avably.io/terms", {
      headers: { "Accept-Language": "pl" },
    });
    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/pl/terms");
    expect(request.headers.get("x-tenant-id")).toBeNull();
  });

  it("marketing-host: /pl/terms przechodzi gałęzią marketingową (hreflang, CSP, bez rewrite tenanckiego)", async () => {
    const response = await proxy(new NextRequest("https://www.avably.io/pl/terms"));

    const link = response.headers.get("Link") ?? "";
    expect(link).toContain('hreflang="pl"');
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
    expect(response.headers.get("x-middleware-rewrite") ?? "").not.toContain("/store");
  });

  it("tenant-host: /terms zostaje na osi tenanckiej (rewrite z zachowaną ścieżką + x-tenant-id)", async () => {
    const request = new NextRequest("https://acme.avably.io/terms");
    const response = await runProxy(request, fakeDeps);

    const rewrite = response.headers.get("x-middleware-rewrite") ?? "";
    expect(rewrite, "tenant-host /terms nie zachował ścieżki").toContain("/terms");
    expect(rewrite).not.toContain("/pl/");
    expect(request.headers.get("x-tenant-id")).toBe(ACME_ID);
  });

  it("tenant-host: permalink /terms/w/2 również zostaje na osi tenanckiej", async () => {
    const request = new NextRequest("https://acme.avably.io/terms/w/2");
    const response = await runProxy(request, fakeDeps);

    expect(response.headers.get("x-middleware-rewrite") ?? "").toContain("/terms/w/2");
    expect(request.headers.get("x-tenant-id")).toBe(ACME_ID);
  });

  it("marketing-host: permalink /pl/terms/w/1 idzie gałęzią marketingową bez śladu tenanta", async () => {
    const request = new NextRequest("https://www.avably.io/pl/terms/w/1");
    const response = await proxy(request);

    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
    expect(request.headers.get("x-tenant-id")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite") ?? "").not.toContain("/store");
  });
});
