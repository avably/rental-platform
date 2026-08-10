/**
 * L-01 (audyt bezpieczeństwa 2026-08-09, ADR-124) — bramka CI dla nagłówków
 * bazowych z `next.config.ts`. `proxy.ts` (i jego test) pilnuje nagłówków na
 * trasach, które middleware WIDZI; ten plik pilnuje PODŁOGI pod trasami, o
 * których matcher `proxy.ts` (`"/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"`)
 * nawet nie wie — 404 i zasoby statyczne. Dowód behawioralny na żywym
 * `next start` (curl przed/po) jest w raporcie zadania; ten test jest bramką
 * REGRESJI dla CI, gdzie serwer na żywo nie stoi.
 *
 * Panel (w odróżnieniu od storefrontu) nie ma żadnej trasy embedowalnej
 * (ADR-120 dotyczy wyłącznie `apps/storefront`) — jeden blok, bez wyjątków
 * ścieżkowych, X-Frame-Options: DENY globalnie.
 *
 * Wartości są porównywane WPROST z `applySecurityHeaders` (nie przepisane
 * literały) — rozjazd między next.config a @avably/security pali tu, zanim
 * ktokolwiek zobaczy to na produkcji.
 */
import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import { applySecurityHeaders } from "@avably/security";

import nextConfig from "../next.config";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function headerRules(): Promise<HeaderRule[]> {
  const headersFn = nextConfig.headers;
  if (!headersFn) throw new Error("next.config.ts stracił headers() — L-01 wraca otwarte");
  return (await headersFn()) as HeaderRule[];
}

describe("panel next.config headers() — podłoga L-01 pod proxy.ts", () => {
  it("zwraca dokładnie jeden blok obejmujący WSZYSTKIE ścieżki", async () => {
    const rules = await headerRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe("/:path*");
  });

  it("niesie nosniff, Referrer-Policy, Permissions-Policy, HSTS i XFO — WARTOŚCI IDENTYCZNE z applySecurityHeaders", async () => {
    const rules = await headerRules();
    const baseline = Object.fromEntries(rules[0]!.headers.map((h) => [h.key, h.value]));
    const reference = applySecurityHeaders(NextResponse.next(), "test-nonce");

    for (const key of [
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
      "X-Frame-Options",
    ]) {
      expect(baseline[key], `next.config.headers() nie ustawia ${key}`).toBeTruthy();
      expect(baseline[key], `${key} rozjechał się z applySecurityHeaders`).toBe(
        reference.headers.get(key),
      );
    }
  });

  it("NIE niesie CSP — ta zostaje wyłącznie w proxy.ts (nonce per żądanie)", async () => {
    const rules = await headerRules();
    const keys = rules[0]!.headers.map((h) => h.key);
    expect(keys).not.toContain("Content-Security-Policy");
  });
});
