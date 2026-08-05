/**
 * Smoke-test nagłówków bezpieczeństwa (bramka CI dla CSP/HSTS, Zadanie 7).
 *
 * Testuje realne obiekty NextRequest/NextResponse (nie atrapy), więc mierzy
 * dokładnie to, co trafi do przeglądarki z middleware'u obu aplikacji.
 * Regresja typu „ktoś dopisał 'unsafe-inline' do script-src" albo „zniknął
 * HSTS" robi tu czerwony build.
 */
import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import {
  applySecurityHeaders,
  buildCsp,
  generateNonce,
  securityHeadersResponse,
} from "../src/index";

function directive(csp: string, name: string): string {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  if (!found) throw new Error(`Brak dyrektywy „${name}" w CSP: ${csp}`);
  return found;
}

describe("buildCsp", () => {
  it("script-src ma nonce i strict-dynamic, bez unsafe-inline", () => {
    const csp = buildCsp("abc123");
    const scriptSrc = directive(csp, "script-src");

    expect(scriptSrc).toContain("'nonce-abc123'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("produkcja: bez unsafe-eval; dev: z unsafe-eval (HMR)", () => {
    expect(directive(buildCsp("n", { dev: false }), "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(buildCsp("n", { dev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  it("blokuje osadzanie w ramce, base-uri i object-src", () => {
    const csp = buildCsp("n");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
  });

  it("connect-src dopuszcza API Supabase, gdy podane", () => {
    const csp = buildCsp("n", { supabaseUrl: "https://xyz.supabase.co" });
    expect(directive(csp, "connect-src")).toContain("https://xyz.supabase.co");
  });

  it("img-src dopuszcza Storage Supabase, gdy podany (zdjęcia produktów storefrontu)", () => {
    const csp = buildCsp("n", { supabaseUrl: "https://xyz.supabase.co" });
    expect(directive(csp, "img-src")).toContain("https://xyz.supabase.co");
    // bez supabaseUrl img-src zostaje przy self/data/blob/unsplash (żadnego innego obcego origin)
    const bare = buildCsp("n");
    expect(directive(bare, "img-src")).not.toContain("supabase");
  });

  it("img-src dopuszcza images.unsplash.com zawsze (K3, ADR-086: hotlink zdjęć w pickerze i na opublikowanych stronach)", () => {
    // Host wchodzi bez konfiguracji tenanta — wyszukiwanie idzie server-side,
    // więc connect-src go NIE potrzebuje (sprawdzone niżej).
    const csp = buildCsp("n");
    expect(directive(csp, "img-src")).toContain("https://images.unsplash.com");
    expect(directive(csp, "connect-src")).not.toContain("unsplash");
  });

  it("turnstile: true dodaje challenges.cloudflare.com do script/connect/frame-src", () => {
    const csp = buildCsp("n", { turnstile: true });
    expect(directive(csp, "script-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(csp, "connect-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(csp, "frame-src")).toBe("frame-src https://challenges.cloudflare.com");
  });

  it("bez turnstile CSP nie zna Cloudflare — dyrektywy nie otwierają się na zawsze", () => {
    const csp = buildCsp("n");
    expect(csp).not.toContain("challenges.cloudflare.com");
    // Brak frame-src = ramki tnie default-src 'self' (stan sprzed Turnstile).
    expect(csp).not.toContain("frame-src");
  });

  /*
   * MAPA DOJAZDU (E5, ADR-096) — źródło RAMKI i wyłącznie ramki.
   *
   * Test ma dwa zdania, bo są dwa sposoby zepsucia tej decyzji: źródło może
   * ZNIKNĄĆ (sklep przestaje pokazywać mapę — objaw: pusta ramka i błąd
   * w konsoli, którego nikt nie ogląda) albo TRAFIĆ NIE TAM (dostawca w
   * `script-src` mógłby wykonać kod w naszym kontekście, w `connect-src` —
   * przyjmować dane z naszej strony). Sprawdzamy więc obecność w `frame-src`
   * i NIEOBECNOŚĆ w każdej innej dyrektywie.
   */
  it("maps: true dodaje źródło ramki dostawcy map do frame-src", () => {
    const csp = buildCsp("n", { maps: true });
    expect(directive(csp, "frame-src")).toBe("frame-src https://www.google.com");
  });

  it("maps: źródło NIE trafia do żadnej innej dyrektywy", () => {
    const csp = buildCsp("n", { maps: true, supabaseUrl: "https://xyz.supabase.co" });
    for (const name of ["script-src", "connect-src", "img-src", "style-src", "font-src", "default-src"]) {
      expect(directive(csp, name), `dostawca map w dyrektywie ${name}`).not.toContain("google");
    }
  });

  it("maps współżyje z pozostałymi osadzanymi — frame-src jest JEDNĄ dyrektywą", () => {
    const csp = buildCsp("n", { maps: true, turnstile: true, stripe: true });
    const frameSrc = directive(csp, "frame-src");
    expect(frameSrc).toContain("https://www.google.com");
    expect(frameSrc).toContain("https://challenges.cloudflare.com");
    expect(frameSrc).toContain("https://js.stripe.com");
    // Druga deklaracja tej samej dyrektywy po cichu nadpisałaby pierwszą.
    expect(csp.split(";").filter((part) => part.trim().startsWith("frame-src "))).toHaveLength(1);
  });

  it("bez maps polityka NIE zna dostawcy map (panel: ta flaga nie jest podawana)", () => {
    // Panel renderuje tę samą sekcję, ale mapy nie osadza (render dostaje
    // `mapEmbed={false}`) — powierzchnia edycyjna z sesją najemcy nie jest
    // miejscem na obce ramki.
    const csp = buildCsp("n", { supabaseUrl: "https://xyz.supabase.co" });
    expect(csp).not.toContain("google");
  });

  it("upgrade-insecure-requests tylko poza devem", () => {
    expect(buildCsp("n", { dev: false })).toContain("upgrade-insecure-requests");
    expect(buildCsp("n", { dev: true })).not.toContain("upgrade-insecure-requests");
  });
});

describe("generateNonce", () => {
  it("jest inny dla każdego żądania", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(nonces.size).toBe(50);
  });
});

describe("applySecurityHeaders / securityHeadersResponse", () => {
  it("odpowiedź niesie CSP, HSTS, nosniff, Referrer-Policy i Permissions-Policy", () => {
    const response = securityHeadersResponse(new NextRequest("https://example.test/"));

    const csp = response.headers.get("Content-Security-Policy");
    expect(csp, "brak nagłówka CSP").toBeTruthy();
    expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);

    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains; preload",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Permissions-Policy")).toContain("geolocation=()");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("nonce z nagłówka odpowiedzi jest tym samym, który dostaje Next.js w żądaniu", () => {
    // Kanał dla Next.js: nonce jedzie w nagłówku ŻĄDANIA (x-nonce + CSP),
    // framework czyta go stamtąd i wstrzykuje w swoje tagi <script>.
    // Rozjazd między nonce w żądaniu a w odpowiedzi = zablokowany bootstrap.
    const nonce = generateNonce();
    const response = applySecurityHeaders(NextResponse.next(), nonce);
    expect(response.headers.get("Content-Security-Policy")).toContain(`'nonce-${nonce}'`);
  });
});
