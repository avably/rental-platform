/**
 * Owijka cache'a NIP (`app.nip_lookup_cache`, 0097, ADR-234) na SECURITY
 * DEFINER RPC — `app.nip_lookup_cache_get`/`_put`. ŚWIADOMIE nie klient
 * service-role: `scripts/audit-service-role.sh` (ADR-099/115/206) zakazuje
 * go w panelu poza webhookami/jobami/reviewem, więc jedyna droga do tabeli
 * bez tenant-owej osi izolacji jest przez te dwie funkcje, dokładnie jak
 * `app.check_rate_limit` (0052) i `app.my_organizations` (0092).
 *
 * TTL ~72h (brief SPEC B — limit MF 100 wyszukiwań/dobę) jest egzekwowany
 * TUTAJ, po stronie aplikacji: wiersz starszy niż TTL jest traktowany jak
 * „brak" dla DECYZJI o ponownym strzale do MF/GUS, ale NIE jest usuwany —
 * nadal jest ważnym dowodem „NIP kiedyś zweryfikowany" dla `app.create_tenant`
 * (0098), które nie sprawdza świeżości, tylko obecność wiersza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CompanyLookupFound, NipLookupCacheData } from "./types";

const CACHE_TTL_MS = 72 * 60 * 60 * 1000;

interface CacheRow {
  data: NipLookupCacheData;
  source: "mf" | "gus";
  request_id: string | null;
  fetched_at: string;
}

/** `null` gdy brak wiersza (lub błąd transportu — fail-closed: traktuj jak brak). */
export async function getCachedLookup(supabase: SupabaseClient, nip: string): Promise<CacheRow | null> {
  const { data, error } = await supabase.schema("app").rpc("nip_lookup_cache_get", { p_nip: nip });
  if (error) {
    console.error("[registry:cache] nip_lookup_cache_get", error);
    return null;
  }
  const row = Array.isArray(data) ? (data[0] as CacheRow | undefined) : undefined;
  return row ?? null;
}

/** `true`, gdy wiersz istnieje i jest młodszy niż TTL — jedyny przypadek, w którym POMIJAMY MF/GUS. */
export function isFreshEnough(row: CacheRow, now: Date = new Date()): boolean {
  return now.getTime() - new Date(row.fetched_at).getTime() < CACHE_TTL_MS;
}

/**
 * Zapisuje udany wynik (MF albo GUS) do cache'a. Best-effort: błąd zapisu
 * NIE wywraca lookupu — użytkownik i tak dostaje świeży wynik, cache jest
 * tylko optymalizacją/dowodem, jego chwilowa awaria nie może zablokować
 * onboardingu (ten sam odruch co `registerDomainSafely`, ADR-033/036).
 */
export async function putCachedLookup(supabase: SupabaseClient, result: CompanyLookupFound): Promise<void> {
  const { ok: _ok, nip, ...data } = result;
  const { error } = await supabase.schema("app").rpc("nip_lookup_cache_put", {
    p_nip: nip,
    p_data: data,
    p_source: result.source,
    p_request_id: result.requestId,
  });
  if (error) console.error("[registry:cache] nip_lookup_cache_put", error);
}
