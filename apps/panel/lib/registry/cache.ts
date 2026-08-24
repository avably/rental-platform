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
 *
 * SEKRET ZAPISU (0099, LUKA Z RECENZJI PRZED MERGE). Schemat `app` jest
 * wystawiony przez PostgREST, więc `nip_lookup_cache_put` bez dodatkowej
 * bramki byłoby osiągalne WPROST z konsoli przeglądarki byle jakim ważnym
 * JWT-em `authenticated` — user mógłby sam sobie „zweryfikować" dowolny NIP
 * fabrykując `legalName`/`regon`. `REGISTRY_CACHE_WRITE_SECRET` (serwerowy,
 * NIGDY `NEXT_PUBLIC_`) jest jedynym dowodem dla bazy, że wołający to NASZ
 * serwer, nie przeglądarka usera — baza porównuje SHA-256 tej wartości
 * z hashem w `app.registry_config` (0099). Brak env → `putCachedLookup`
 * i tak wywoła RPC (best-effort, patrz niżej) i dostanie 42501 — zapis nie
 * powstanie, ale PREFILL dla usera nadal zadziała (dane z MF/GUS, nie z
 * cache'a); zablokowane jest wyłącznie ZAŁOŻENIE ORGANIZACJI (fail-closed
 * w `create_tenant`, 0098), nie samo wyszukiwanie.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CompanyLookupFound, NipLookupCacheData } from "./types";

const CACHE_TTL_MS = 72 * 60 * 60 * 1000;

let warnedNoWriteSecret = false;

/**
 * Czytany per wywołanie (nie w stałej modułu) — ten sam powód co
 * `firstNonEmptyEnv` w `@avably/security/rate-limit`: testy zmieniają env
 * w trakcie procesu. Ostrzeżenie leci RAZ na proces, nie per żądanie
 * (gorąca ścieżka „Pobierz dane"), żeby nie zalać logów.
 */
function registryCacheWriteSecret(): string | undefined {
  const secret = process.env.REGISTRY_CACHE_WRITE_SECRET;
  if (secret) return secret;
  if (!warnedNoWriteSecret) {
    console.warn(
      "[registry:cache] brak REGISTRY_CACHE_WRITE_SECRET — zapis do app.nip_lookup_cache będzie odrzucany " +
        "(42501), więc app.create_tenant nigdy nie znajdzie dowodu weryfikacji NIP. Prefill dla użytkownika " +
        "nadal działa, zakładanie organizacji przez NIP nie.",
    );
    warnedNoWriteSecret = true;
  }
  return undefined;
}

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
    p_write_secret: registryCacheWriteSecret(),
  });
  if (error) console.error("[registry:cache] nip_lookup_cache_put", error);
}
