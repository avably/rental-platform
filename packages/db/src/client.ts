import { requireSupabasePublishableKey } from "@avably/core/supabase-env";
import {
  createBrowserClient as createSsrBrowserClient,
  createServerClient as createSsrServerClient,
  type CookieMethodsServer,
} from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireEnv } from "./env";

/**
 * Klient przeglądarkowy — zawsze klucz publikowalny + sesja użytkownika.
 * Izolację tenantów wymusza RLS (app.tenant_id() z custom claim w JWT).
 *
 * Odczyt URL musi być statyczny (process.env.NEXT_PUBLIC_SUPABASE_URL, nie
 * process.env[name]) — Turbopack inlinuje zmienne publiczne do bundla
 * klienta tylko przy dostępie statycznym; dynamiczny odczyt kompiluje się
 * do pustego shima w przeglądarce. Klucz idzie z warstwy
 * @avably/core/supabase-env (ADR-142: nowa nazwa sb_publishable_… z
 * fallbackiem legacy), która trzyma ten sam statyczny kontrakt odczytu.
 */
export function createBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error(
      "Brak zmiennej środowiskowej NEXT_PUBLIC_SUPABASE_URL — uzupełnij .env.local (patrz README).",
    );
  }
  return createSsrBrowserClient(url, requireSupabasePublishableKey());
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
    requireSupabasePublishableKey(),
    { cookies },
  );
}

export type { CookieMethodsServer };
