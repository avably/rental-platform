/**
 * Middleware panelu (Next 16: `proxy.ts`, dawne `middleware.ts`). Trzy zadania:
 *
 * 1. Odświeżenie sesji Supabase (refresh token) przy każdym żądaniu — wzorzec
 *    @supabase/ssr dla App Routera. Bez tego access token wygasałby w trakcie
 *    sesji przeglądarki mimo ważnego refresh tokenu (cookies nie są
 *    odświeżane automatycznie poza requestem HTTP).
 * 2. Routing locale (next-intl): `/` -> `/en` lub `/pl`, plus nagłówek `Link`
 *    z alternatywnymi wersjami językowymi (hreflang).
 * 3. Nagłówki bezpieczeństwa (Zadanie 7): CSP z nonce (bez 'unsafe-inline'),
 *    HSTS, nosniff, Referrer-Policy, Permissions-Policy — polityka wspólna z
 *    storefrontem, patrz @avably/security.
 *
 * KOLEJNOŚĆ JEST ISTOTNA. next-intl buduje swoją odpowiedź z nagłówków i
 * cookies ŻĄDANIA, dlatego nonce i odświeżone cookies muszą trafić do żądania
 * ZANIM zawoła się routing locale — inaczej rewrite poniósłby stare cookies, a
 * render nie zobaczyłby nonce.
 *
 * Nie egzekwuje tu autoryzacji per-trasa — guardy (`requireMember`,
 * `requireSuperadmin`, patrz lib/supabase-server.ts) działają w Server
 * Components/Route Handlers/Server Actions, bliżej danych.
 */
import { createServerClient } from "@avably/db";
import { applySecurityHeaders, buildCsp, generateNonce, type CspOptions } from "@avably/security";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "@/i18n/routing";

const handleI18n = createIntlMiddleware(routing);

/**
 * Ścieżki obsługiwane maszynowo (route handlery, webhooki) — nie mają wersji
 * językowych i prefiks locale by je zepsuł. Nagłówki bezpieczeństwa dostają
 * tak samo jak strony.
 */
function isNonLocalizedPath(pathname: string): boolean {
  return pathname.startsWith("/api") || pathname.startsWith("/auth");
}

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp: CspOptions = {
    dev: process.env.NODE_ENV !== "production",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };

  // Kanał, którym Next.js dostaje nonce do własnych tagów <script>. Ustawiane
  // na ŻĄDANIU, bo next-intl przepisze te nagłówki dalej do rewrite'u.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", buildCsp(nonce, csp));

  const cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[] = [];

  const supabase = createServerClient({
    getAll: () => request.cookies.getAll(),
    setAll: (updated) => {
      for (const { name, value, options } of updated) {
        // Żądanie dostaje świeże cookies od razu — to z niego next-intl
        // zbuduje odpowiedź, a render zobaczy już odświeżoną sesję.
        request.cookies.set(name, value);
        cookiesToSet.push({ name, value, options: options as Record<string, unknown> });
      }
    },
  });

  // Wywołanie WYMAGANE, żeby biblioteka miała okazję odświeżyć token przed
  // wygaśnięciem i zapisać nowe cookies przez setAll powyżej.
  await supabase.auth.getClaims();

  const response = isNonLocalizedPath(request.nextUrl.pathname)
    ? NextResponse.next({ request: { headers: request.headers } })
    : handleI18n(request);

  // Cookies sesji dokładane na odpowiedź NIEZALEŻNIE od tego, czy next-intl
  // zwrócił rewrite czy redirect — inaczej odświeżony token przepadałby przy
  // przekierowaniu na prefiks locale i użytkownik wracałby do logowania.
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, options);
  }

  return applySecurityHeaders(response, nonce, csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
