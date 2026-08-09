/**
 * Szew klienta tras ingest (ADR-099/ADR-115): jedyne miejsce, w którym
 * droga ingest dotyka fabryki service_role. Osobny moduł (nie-route w
 * katalogu ingest, objęty allowlistą audit-service-role.sh) istnieje po to,
 * żeby test bramek mógł podstawić atrapę POD WŁASNĄ NAZWĄ i dowieść braku
 * pracy bez wymieniania nazw zastrzeżonych dla ścieżek produkcyjnych.
 */
import { createServiceClient } from "@avably/db/service";
import type { SupabaseClient } from "@supabase/supabase-js";

export function reviewIngestClient(): SupabaseClient {
  return createServiceClient();
}
