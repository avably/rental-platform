/**
 * Middleware storefrontu (Zadanie 7 + i18n). Storefront nie ma sesji
 * użytkownika do odświeżania, więc zostają dwa zadania:
 *
 * 1. Routing locale (next-intl): `/` -> `/en` lub `/pl` + nagłówek `Link`
 *    z hreflang.
 * 2. CSP z nonce (nonce trafia też w nagłówki żądania, skąd czyta go Next.js
 *    dla własnych tagów <script>), HSTS, nosniff, Referrer-Policy
 *    i Permissions-Policy.
 *
 * Nonce ustawiany na ŻĄDANIU przed routingiem locale — next-intl przenosi
 * nagłówki żądania do rewrite'u, więc kolejność jest warunkiem działania CSP.
 *
 * Polityka mieszka w @avably/security — wspólna z panelem, żeby CSP obu
 * aplikacji nie rozjechało się po cichu.
 */
import { applySecurityHeaders, buildCsp, generateNonce, type CspOptions } from "@avably/security";
import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, type NextResponse } from "next/server";

import { routing } from "@/i18n/routing";

const handleI18n = createIntlMiddleware(routing);

export function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const csp: CspOptions = {
    dev: process.env.NODE_ENV !== "production",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    // Dyrektywy dla challenges.cloudflare.com tylko gdy widget faktycznie
    // ma się renderować (ten sam warunek co w components/waitlist-form).
    turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  };

  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", buildCsp(nonce, csp));

  return applySecurityHeaders(handleI18n(request), nonce, csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
