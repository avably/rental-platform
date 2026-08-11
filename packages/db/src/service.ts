/**
 * OSOBNY entrypoint: `@avably/db/service`.
 *
 * Klient service-role OMIJA RLS — wolno go importować wyłącznie w
 * `apps/*\/app/api/webhooks/**` i `apps/*\/src/jobs/**` (wymuszane regułą
 * ESLint `no-restricted-imports` w konfiguracjach aplikacji). Nigdy w
 * ścieżkach per-tenant ani w kodzie trafiającym do przeglądarki.
 *
 * TEN plik jest JEDYNYM miejscem, które zna nazwy env klucza sekretnego
 * (ADR-142; egzekwują to scripts/audit-service-role.sh i bramka jedyności
 * packages/core/src/supabase-env-single-source.test.ts). Nowa nazwa
 * SUPABASE_SECRET_KEY (sb_secret_…) z fallbackiem na legacy
 * SUPABASE_SERVICE_ROLE_KEY; gdy są obie, wygrywa nowa; pusty string = brak.
 * Klucz sekretny żyje wyłącznie w runtime serwera (nie jest NEXT_PUBLIC_*),
 * więc nie podlega wmurowaniu w build — zmiana env wymaga tylko redeployu.
 */
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireEnv } from "./env";

/** Fail-honest: brak OBU nazw = twardy błąd mówiący, które env ustawić. */
function requireSupabaseSecretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "Brak klucza sekretnego Supabase — ustaw SUPABASE_SECRET_KEY (klucz sb_secret_… " +
        "z sekcji API Keys projektu Supabase). Do czasu wyłączenia kluczy legacy działa " +
        "też SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return key;
}

export function createServiceClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireSupabaseSecretKey(),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
