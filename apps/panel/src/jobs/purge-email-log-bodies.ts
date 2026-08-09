import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@avably/db/service";

/**
 * Retencja treści wysłanych wiadomości (C2b/R3, ADR-116, migracja 0056).
 *
 * `email_logs.body` (0035/0037) to pełny HTML wiadomości — imię, adres, telefon
 * i kwoty — czyli DRUGA kopia danych osobowych klienta, dotąd bezterminowa.
 * Ten job kasuje same TREŚCI starsze niż okres retencji; metadane wysyłki
 * (kto, co, kiedy, z jakim skutkiem) zostają, bo bez nich najemca traci dowód
 * obsługi reklamacji.
 *
 * CAŁA PRACA DZIEJE SIĘ W BAZIE (`app.purge_email_log_bodies`): przebieg
 * przekracza granicę najemcy, więc nie może opierać się na sesji ani na RLS.
 * Funkcja ma grant WYŁĄCZNIE dla `service_role` — i to jest powód, dla którego
 * ten moduł mieszka w `src/jobs/**`, jedynym miejscu w panelu, gdzie klucz
 * omijający RLS jest dopuszczony (ADR-067/ADR-115).
 *
 * HARMONOGRAMU CELOWO NIE MA — patrz trasa `/api/jobs/email-log-retention`
 * i nota o limicie planu hostingu (ADR-116, wzorzec L11/ADR-104).
 */

/** Domyślny okres retencji treści wiadomości (ADR-116). */
export const EMAIL_LOG_BODY_RETENTION_DAYS = 90;

/**
 * Wielkość porcji jednego przebiegu. Retencja czyta `for update skip locked`,
 * więc porcja ogranicza czas trzymania blokad, a nie poprawność — zaległość
 * większa niż porcja domyka się kolejnym wywołaniem.
 */
export const EMAIL_LOG_PURGE_BATCH = 5_000;

export interface EmailLogRetentionResult {
  /** Liczba wierszy, którym skasowano treść w tym przebiegu. */
  purged: number;
  /** Zastosowany okres retencji w dniach. */
  days: number;
}

export async function purgeEmailLogBodies(options?: {
  days?: number;
  limit?: number;
  db?: SupabaseClient;
}): Promise<EmailLogRetentionResult> {
  const days = options?.days ?? EMAIL_LOG_BODY_RETENTION_DAYS;
  const limit = options?.limit ?? EMAIL_LOG_PURGE_BATCH;
  const db = options?.db ?? createServiceClient();

  const { data, error } = await db
    .schema("app")
    .rpc("purge_email_log_bodies", { p_days: days, p_limit: limit });

  if (error) throw new Error(error.message);

  const result = (data ?? {}) as { purged?: number; days?: number };
  return { purged: result.purged ?? 0, days: result.days ?? days };
}
