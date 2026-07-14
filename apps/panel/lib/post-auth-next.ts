/**
 * Nośnik docelowej ścieżki (`next`) przez rundę weryfikacji e-mail. Przy
 * rejestracji z linku zaproszenia parametr `next` musi przetrwać: rejestracja
 * → e-mail → klik w link → /auth/confirm → cel. Link potwierdzający pochodzi
 * ze statycznego szablonu GoTrue (packages/db/supabase/templates), który nie
 * przenosi własnych parametrów — dlatego `next` chowamy w krótkotrwałym,
 * httpOnly cookie ustawianym przy rejestracji i konsumowanym w /auth/confirm.
 */
import type { NextResponse } from "next/server";
import type { cookies } from "next/headers";

import { safeNextPath } from "./validation";

export const POST_AUTH_NEXT_COOKIE = "post_auth_next";
const MAX_AGE_SECONDS = 60 * 60; // 1h — tyle, ile żyje token potwierdzenia

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export function setPostAuthNext(store: CookieStore, next: string): void {
  const safe = safeNextPath(next);
  if (!safe) return;
  store.set(POST_AUTH_NEXT_COOKIE, safe, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/**
 * Odczyt cookie bez kasowania (kasowanie odbywa się na zwracanej odpowiedzi
 * przez clearPostAuthNextOnResponse, bo /auth/confirm buduje własny redirect).
 * `hadCookie` mówi, czy w ogóle istniało (żeby nie ustawiać zbędnego
 * kasującego cookie, gdy go nie było).
 */
export function readPostAuthNext(store: CookieStore): { next: string | null; hadCookie: boolean } {
  const raw = store.get(POST_AUTH_NEXT_COOKIE)?.value;
  return { next: safeNextPath(raw), hadCookie: raw !== undefined };
}

export function clearPostAuthNextOnResponse(response: NextResponse): void {
  response.cookies.set(POST_AUTH_NEXT_COOKIE, "", { path: "/", maxAge: 0 });
}
