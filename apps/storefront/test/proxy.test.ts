/**
 * Smoke-test middleware'u storefrontu: każde żądanie wychodzi z CSP (nonce,
 * bez 'unsafe-inline') i HSTS. Bramka CI dla nagłówków bezpieczeństwa —
 * usunięcie proxy.ts albo rozjazd polityki robi tu czerwony build.
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "../proxy";

describe("proxy storefrontu — nagłówki bezpieczeństwa", () => {
  for (const route of ["page.tsx", "privacy/page.tsx"]) {
    it(`renderuje ${route} dynamicznie, żeby Next nadał nonce własnym skryptom`, () => {
      const page = readFileSync(new URL(`../app/[locale]/${route}`, import.meta.url), "utf8");

      expect(page).toContain('export const dynamic = "force-dynamic"');
    });
  }

  it("odpowiedź ma CSP z nonce i HSTS", () => {
    const response = proxy(new NextRequest("https://najemca.example/"));

    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp, "brak nagłówka CSP").not.toBe("");
    expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);
    expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/);

    expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(response.headers.get("Strict-Transport-Security")).toContain("preload");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
  });
});

describe("proxy storefrontu — routing locale", () => {
  it("goły / przekierowuje na prefiks locale", () => {
    const response = proxy(new NextRequest("https://najemca.example/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/en");
  });

  it("Accept-Language wybiera locale", () => {
    const response = proxy(
      new NextRequest("https://najemca.example/", {
        headers: { "Accept-Language": "pl" },
      }),
    );

    expect(response.headers.get("location")).toContain("/pl");
  });

  it("strona pod prefiksem wychodzi z hreflang i zachowuje CSP", () => {
    const response = proxy(new NextRequest("https://najemca.example/en"));

    // Nagłówek Link z alternatywnymi wersjami — bez niego wyszukiwarki nie
    // wiedzą, że /en i /pl to ta sama strona w dwóch językach.
    const link = response.headers.get("Link") ?? "";
    expect(link).toContain('hreflang="en"');
    expect(link).toContain('hreflang="pl"');

    // Nagłówki bezpieczeństwa muszą przeżyć złożenie z routingiem locale.
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
  });
});
