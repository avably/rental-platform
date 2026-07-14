/**
 * Odświeża sesję Supabase (refresh token) przy każdym żądaniu — wzorzec
 * @supabase/ssr dla Next.js App Router. Bez tego access token wygasałby w
 * trakcie sesji przeglądarki mimo ważnego refresh tokenu (cookies nie są
 * odświeżane automatycznie poza requestem HTTP).
 *
 * Nie egzekwuje tu autoryzacji per-trasa — guardy (`requireMember`,
 * `requireSuperadmin`, patrz lib/supabase-server.ts) działają w Server
 * Components/Route Handlers/Server Actions, bliżej danych.
 */
import { type NextRequest, NextResponse } from "next/server";

import { createServerClient } from "@rental/db";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient({
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet) => {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
    },
  });

  // Wywołanie WYMAGANE, żeby biblioteka miała okazję odświeżyć token przed
  // wygaśnięciem i zapisać nowe cookies przez setAll powyżej.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
