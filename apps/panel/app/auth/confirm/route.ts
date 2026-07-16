/**
 * Callback linku z e-maila (potwierdzenie rejestracji ORAZ reset hasła —
 * szablony packages/db/supabase/templates/{confirmation,recovery}.html
 * linkują tu z `token_hash` i `type` zamiast domyślnego
 * `{{ .ConfirmationURL }}`, żeby przepływ szedł przez naszą aplikację, nie
 * bezpośrednio przez GoTrue).
 *
 * `verifyOtp` ustanawia sesję (cookies) — dla `type=signup`/`email` user
 * trafia do onboardingu (`/organizacja/nowa`), dla `type=recovery` do
 * ekranu ustawienia nowego hasła (`/reset/confirm`).
 */
import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { createServerClient, type CookieMethodsServer } from "@avably/db";
import type { EmailOtpType } from "@supabase/supabase-js";

import { clearPostAuthNextOnResponse, readPostAuthNext } from "@/lib/post-auth-next";

type CookiesToSet = Parameters<NonNullable<CookieMethodsServer["setAll"]>>[0];

export async function GET(request: NextRequest): Promise<NextResponse> {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", request.url));
  }

  const cookieStore = await cookies();
  const pendingCookies: CookiesToSet = [];
  const supabase = createServerClient({
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      pendingCookies.push(...cookiesToSet);
    },
  });

  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  // `next` z rejestracji (np. /zaproszenie/<token>) — odczytujemy zawsze, żeby
  // móc je skasować (poniżej, na zwracanej odpowiedzi), ale kierujemy tam
  // tylko przy udanym potwierdzeniu e-maila (nie recovery — tam user musi
  // najpierw ustawić hasło).
  const { next: postAuthNext, hadCookie } = readPostAuthNext(cookieStore);

  const destination = error
    ? "/login?error=link_expired"
    : type === "recovery"
      ? "/reset/confirm"
      : (postAuthNext ?? "/organizacja/nowa");

  const response = NextResponse.redirect(new URL(destination, request.url));
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
  // Budujemy własną odpowiedź redirect, więc kasowanie cookie musi trafić na
  // NIĄ (mutacja cookieStore z next/headers nie dotyczy tej odpowiedzi).
  if (hadCookie) {
    clearPostAuthNextOnResponse(response);
  }
  return response;
}
