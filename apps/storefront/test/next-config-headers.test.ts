/**
 * L-01 (audyt bezpieczeństwa 2026-08-09, ADR-124) — bramka CI dla nagłówków
 * bazowych z `next.config.ts`. `proxy.ts` (i jego test) pilnuje nagłówków na
 * trasach, które middleware WIDZI; ten plik pilnuje PODŁOGI pod trasami, o
 * których matcher `proxy.ts` (`"/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"`)
 * nawet nie wie — 404, `robots.txt`, `sitemap.xml`, `security.txt`, zasoby
 * statyczne. Dowód behawioralny na żywym `next start` (curl przed/po) jest
 * w raporcie zadania; ten test jest bramką REGRESJI dla CI, gdzie serwer na
 * żywo nie stoi.
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

/** Odpowiedź referencyjna — bez frameAncestors, czyli DOMYŚLNA polityka (reszta site'u poza embedem). */
function referenceHeaders() {
  return applySecurityHeaders(NextResponse.next(), "test-nonce");
}

describe("storefront next.config headers() — podłoga L-01 pod proxy.ts", () => {
  it("zwraca dokładnie trzy bloki: bazowy (wszystkie ścieżki), XFO (bez /embed/**) i cache statyków szablonu", async () => {
    const rules = await headerRules();
    expect(rules).toHaveLength(3);
    expect(rules[0]?.source).toBe("/:path*");
  });

  it("blok bazowy niesie nosniff, Referrer-Policy, Permissions-Policy i HSTS — WARTOŚCI IDENTYCZNE z applySecurityHeaders", async () => {
    const rules = await headerRules();
    const baseline = Object.fromEntries(rules[0]!.headers.map((h) => [h.key, h.value]));
    const reference = referenceHeaders();

    for (const key of [
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
    ]) {
      expect(baseline[key], `next.config.headers() nie ustawia ${key}`).toBeTruthy();
      expect(baseline[key], `${key} rozjechał się z applySecurityHeaders`).toBe(
        reference.headers.get(key),
      );
    }
  });

  it("blok bazowy NIE niesie CSP ani X-Frame-Options — te zostają wyłącznie w proxy.ts (nonce per żądanie)", async () => {
    const rules = await headerRules();
    const keys = rules[0]!.headers.map((h) => h.key);
    expect(keys).not.toContain("Content-Security-Policy");
    expect(keys).not.toContain("X-Frame-Options");
  });

  it("blok bazowy nie wyklucza żadnej ścieżki — embed dostaje też nosniff/HSTS/referrer/permissions", async () => {
    const rules = await headerRules();
    expect(rules[0]!.source).not.toContain("embed");
  });

  it("drugi blok ustawia X-Frame-Options: DENY — ta sama wartość co domyślna (nie-embed) applySecurityHeaders", async () => {
    const rules = await headerRules();
    const xfo = rules[1]!.headers.find((h) => h.key === "X-Frame-Options");
    const reference = referenceHeaders();
    expect(xfo?.value).toBe(reference.headers.get("X-Frame-Options"));
    expect(rules[1]!.headers).toHaveLength(1);
  });

  it("drugi blok WYKLUCZA /embed/** — wzorzec zawiera negative lookahead na 'embed/'", () => {
    // Dopasowanie regexu na żywym serwerze (curl /embed/loader i /embed/widget:
    // brak X-Frame-Options, frame-ancestors 'self' https' nienaruszone) jest w
    // raporcie zadania L-01 — tu pilnujemy, żeby SAM WZORZEC wykluczenia nie
    // zniknął przy refaktorze (np. ktoś zamieni source na gołe "/:path*").
    return headerRules().then((rules) => {
      expect(rules[1]!.source).toContain("embed/");
      expect(rules[1]!.source).toContain("(?!");
    });
  });

  /**
   * CACHE STATYKÓW SZABLONU (spike webflow.js, krok 1). Bez tego bloku Vercel
   * serwuje `public/` z `max-age=0, must-revalidate` — każda wizyta
   * rewaliduje ~1,5 MB minifikatu. Nazwy plików nie niosą hasha, więc
   * `immutable` byłoby kłamstwem: po deployu przeglądarka NIGDY nie
   * zapytałaby o nową wersję. Ostrożny kompromis: doba świeżości + tydzień
   * stale-while-revalidate.
   */
  it("trzeci blok: /forerunner/** dostaje długi cache BEZ immutable (nazwy bez hasha)", async () => {
    const rules = await headerRules();
    expect(rules[2]!.source).toBe("/forerunner/:path*");
    const cache = rules[2]!.headers.find((h) => h.key === "Cache-Control");
    expect(cache?.value).toBe("public, max-age=86400, stale-while-revalidate=604800");
    expect(cache?.value).not.toContain("immutable");
    expect(rules[2]!.headers).toHaveLength(1);
  });

  it("blok cache nie dotyka niczego poza /forerunner/** — HTML stron dalej rewaliduje", async () => {
    const rules = await headerRules();
    // Tylko blok [2] niesie Cache-Control; bazowy i XFO zostają bez cache.
    for (const index of [0, 1]) {
      expect(rules[index]!.headers.map((h) => h.key)).not.toContain("Cache-Control");
    }
  });
});
