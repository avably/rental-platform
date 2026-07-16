/**
 * Nagłówki bezpieczeństwa storefrontu (Zadanie 7). Storefront nie ma sesji
 * użytkownika do odświeżania — całe zadanie middleware'u to CSP z nonce
 * (nonce trafia też w nagłówki żądania, skąd czyta go Next.js dla własnych
 * tagów <script>), HSTS, nosniff, Referrer-Policy i Permissions-Policy.
 *
 * Polityka mieszka w @avably/security — wspólna z panelem, żeby CSP obu
 * aplikacji nie rozjechało się po cichu.
 */
import { type NextRequest, type NextResponse } from "next/server";

import { securityHeadersResponse } from "@avably/security";

export function proxy(request: NextRequest): NextResponse {
  return securityHeadersResponse(request, {
    dev: process.env.NODE_ENV !== "production",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
