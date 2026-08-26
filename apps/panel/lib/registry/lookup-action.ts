"use server";

/**
 * Akcja serwerowa za przyciskiem „Pobierz dane" (ADR-234, brief SPEC B/D).
 * JEDYNY punkt wejścia z klienta do hybrydy MF/GUS — komponenty (formularz
 * onboardingu, bonus w ustawieniach umów) wołają WYŁĄCZNIE tę funkcję,
 * nigdy `lookupCompanyByNip` bezpośrednio (ten moduł nie jest oznaczony
 * "use server" i importowanie go w komponencie klienckim wciągnęłoby klucze/
 * URL-e MF-GUS do bundla).
 *
 * WSZYSTKIE eksporty tego pliku MUSZĄ być funkcjami async — Next.js "use
 * server" traktuje inny eksport (stałą, typ) jako awarię CAŁEGO modułu
 * ("no exports at all", łapane dopiero przy buildzie). Typy/stałe importowane
 * tu, nie deklarowane.
 *
 * KOLEJNOŚĆ BRAM (brief SPEC B): auth-only → rate-limit per-user →
 * cache (świeży wpis omija sieć) → hybryda MF→GUS → zapis do cache.
 */
import { isValidNipChecksum, normalizeNip } from "@avably/core";
import { checkRateLimit, NIP_LOOKUP_RATE_LIMIT_PREFIX } from "@avably/security/rate-limit";

import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import { getCachedLookup, isFreshEnough, putCachedLookup } from "./cache";
import { lookupCompanyByNip } from "./lookup";
import type { CompanyLookupResult } from "./types";

export async function lookupCompanyByNipAction(rawNip: string): Promise<CompanyLookupResult> {
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) {
    return { ok: false, reason: "unavailable", message: "Wymagane zalogowanie." };
  }

  // Checksum PRZED wyjściem na zewnątrz (brief SPEC B) — PRZED rate-limitem
  // i cache'em też: garbage input nie ma prawa zjeść ani budżetu prób, ani
  // zapytania do bazy. `lookupCompanyByNip` powtarza to samo sprawdzenie
  // (obrona w głąb — patrz jej docblock), więc podwójna walidacja jest
  // ŚWIADOMA, nie duplikatem przez nieuwagę.
  if (!isValidNipChecksum(rawNip)) {
    return { ok: false, reason: "invalid_checksum", message: "Nieprawidłowy NIP." };
  }

  // Limit per-user (brief SPEC B) — chroni budżet 100 wyszukiwań/dobę MF
  // przed jednym rozklikanym formularzem. Klucz po user.id, NIE po tenant_id:
  // w onboardingu (/organizacja/nowa) użytkownik jeszcze NIE MA organizacji.
  const rateLimit = await checkRateLimit(`nip-lookup:${ctx.user.id}`, {
    limit: 20,
    windowSeconds: 600,
    prefix: NIP_LOOKUP_RATE_LIMIT_PREFIX,
  });
  if (!rateLimit.success) {
    // ADR-276: własny powód, nie `unavailable`. Formularz pokazuje komunikat
    // ZE SŁOWNIKA (nie `message` stąd), więc do ADR-276 wyczerpanie limitu
    // wyświetlało się jako „Rejestr chwilowo niedostępny" — zrzucając na
    // rejestr coś, co jest naszą bramką i mija samo po kilku minutach.
    return {
      ok: false,
      reason: "rate_limited",
      message: "Zbyt wiele prób wyszukiwania NIP w krótkim czasie. Spróbuj ponownie za chwilę.",
    };
  }

  const nip = normalizeNip(rawNip);
  const cached = await getCachedLookup(supabase, nip);
  if (cached && isFreshEnough(cached)) {
    return { ok: true, nip, ...cached.data };
  }

  const result = await lookupCompanyByNip(rawNip);
  if (result.ok) {
    await putCachedLookup(supabase, result);
  }
  return result;
}
