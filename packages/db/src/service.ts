/**
 * OSOBNY entrypoint: `@rental/db/service`.
 *
 * Klient service-role OMIJA RLS — wolno go importować wyłącznie w
 * `apps/*\/app/api/webhooks/**` i `apps/*\/src/jobs/**` (wymuszane regułą
 * ESLint `no-restricted-imports` w konfiguracjach aplikacji). Nigdy w
 * ścieżkach per-tenant ani w kodzie trafiającym do przeglądarki.
 */
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireEnv } from "./env";

export function createServiceClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
