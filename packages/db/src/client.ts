import {
  createBrowserClient as createSsrBrowserClient,
  createServerClient as createSsrServerClient,
  type CookieMethodsServer,
} from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireEnv } from "./env";

/**
 * Klient przeglądarkowy — zawsze anon key + sesja użytkownika.
 * Izolację tenantów wymusza RLS (app.tenant_id() z custom claim w JWT).
 */
export function createBrowserClient(): SupabaseClient {
  return createSsrBrowserClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}

/**
 * Klient serwerowy (RSC / route handlers / server actions) — anon key +
 * sesja z cookies żądania. Adapter cookies przekazuje warstwa aplikacji
 * (Next.js: `cookies()` z `next/headers` opakowane w getAll/setAll),
 * dzięki czemu pakiet nie zależy od Next.js.
 */
export function createServerClient(cookies: CookieMethodsServer): SupabaseClient {
  return createSsrServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { cookies },
  );
}

export type { CookieMethodsServer };
