/**
 * Middleware panelu (Next 16: `proxy.ts`, dawne `middleware.ts`). Dwa zadania:
 *
 * 1. Odświeżenie sesji Supabase (refresh token) przy każdym żądaniu — wzorzec
 *    @supabase/ssr dla App Routera. Bez tego access token wygasałby w trakcie
 *    sesji przeglądarki mimo ważnego refresh tokenu (cookies nie są
 *    odświeżane automatycznie poza requestem HTTP).
 * 2. Nagłówki bezpieczeństwa (Zadanie 7): CSP z nonce (bez 'unsafe-inline'),
 *    HSTS, nosniff, Referrer-Policy, Permissions-Policy — polityka wspólna z
 *    storefrontem, patrz @avably/security.
 *
 * Nie egzekwuje tu autoryzacji per-trasa — guardy (`requireMember`,
 * `requireSuperadmin`, patrz lib/supabase-server.ts) działają w Server
 * Components/Route Handlers/Server Actions, bliżej danych.
 */
import { type NextRequest, NextResponse } from "next/server";

import { createServerClient } from "@avably/db";
import {
  applySecurityHeaders,
  generateNonce,
  requestWithNonce,
  type CspOptions,
} from "@avably/security";

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp: CspOptions = {
    dev: process.env.NODE_ENV !== "production",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };

  let response = NextResponse.next({ request: requestWithNonce(request, nonce, csp) });

  const supabase = createServerClient({
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet) => {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }
      // Odpowiedź budowana od nowa na ZAKTUALIZOWANYM żądaniu (świeże cookies
      // sesji + ten sam nonce — inny nonce w żądaniu i w odpowiedzi
      // zablokowałby bootstrap Next.js).
      response = NextResponse.next({ request: requestWithNonce(request, nonce, csp) });
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
    },
  });

  // Wywołanie WYMAGANE, żeby biblioteka miała okazję odświeżyć token przed
  // wygaśnięciem i zapisać nowe cookies przez setAll powyżej.
  await supabase.auth.getClaims();

  return applySecurityHeaders(response, nonce, csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
