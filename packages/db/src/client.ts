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
 *
 * Odczyt musi być statyczny (process.env.NEXT_PUBLIC_X, nie
 * process.env[name]) — Turbopack inlinuje NEXT_PUBLIC_* do bundla klienta
 * tylko przy dostępie statycznym; dynamiczny odczyt kompiluje się do
 * pustego shima w przeglądarce.
 */
export function createBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) {
    throw new Error(
      "Brak zmiennej środowiskowej NEXT_PUBLIC_SUPABASE_URL — uzupełnij .env.local (patrz README).",
    );
  }
  if (!anonKey) {
    throw new Error(
      "Brak zmiennej środowiskowej NEXT_PUBLIC_SUPABASE_ANON_KEY — uzupełnij .env.local (patrz README).",
    );
  }
  return createSsrBrowserClient(url, anonKey);
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
