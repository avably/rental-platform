/**
 * Szew klienta service_role całej BRAMY REVIEW (ADR-099/ADR-115/ADR-206):
 * jedyne miejsce, w którym trasy przeglądu dotykają fabryki service_role.
 *
 * Dwóch konsumentów, obaj w panelu:
 *  - ingest uwag od relaya storefrontu (app/api/review/ingest/**, ADR-115),
 *  - publiczny ZAPIS uwag z nakładki (app/api/review/comments/**, ADR-206 —
 *    zapis przestał wymagać superadmina, więc nie może już jechać klientem
 *    sesyjnym przez RLS; RLS 0033 zostaje superadminowe jako obrona w głąb,
 *    a kontrolowaną drogą zapisu jest ten klucz za bramką
 *    lib/review-write-guard.ts).
 *
 * Osobny moduł (nie-route, JEDYNY wpis review w allowliście
 * scripts/audit-service-role.sh — węziej niż dawny katalog ingest/**)
 * istnieje po to, żeby testy bramek mogły podstawić atrapę POD WŁASNĄ NAZWĄ
 * i dowieść braku pracy bez wymieniania nazw zastrzeżonych dla ścieżek
 * produkcyjnych.
 */
import { createServiceClient } from "@avably/db/service";
import type { SupabaseClient } from "@supabase/supabase-js";

export function reviewServiceClient(): SupabaseClient {
  return createServiceClient();
}
