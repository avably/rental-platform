/**
 * JEDYNE miejsce, które zna nazwy zmiennych środowiskowych klucza
 * PUBLIKOWALNEGO Supabase (ADR-142; bramka jedyności:
 * packages/core/src/supabase-env-single-source.test.ts).
 *
 * Migracja na klucze nowego typu (`sb_publishable_…`) idzie w twardej
 * kolejności: najpierw KOD z fallbackiem dwu-nazwowym (ten plik), potem env
 * w Vercelu + przebudowa, na końcu wyłączenie kluczy legacy w Supabase
 * (runbook właściciela). Dopóki legacy żyje, obie nazwy działają; gdy są
 * obie, WYGRYWA nowa.
 *
 * ODCZYT MUSI BYĆ STATYCZNY (`process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
 * nie `process.env[name]`) — Turbopack wmurowuje zmienne publiczne do bundla
 * klienta I MIDDLEWARE'U wyłącznie przy dostępie statycznym; dynamiczny
 * odczyt kompiluje się do pustego shima (incydent uploadu zdjęć — bramka
 * scripts/audit-browser-env-inlining.sh). Konsekwencja build-time: po
 * zmianie env restart NIE wystarcza, aplikację trzeba PRZEBUDOWAĆ.
 *
 * Pusty string traktujemy jak brak — `VAR=""` to w praktyce „wyłączone",
 * a fallback ma wtedy przejąć (ten sam wybór co w @avably/security).
 *
 * Klucz SEKRETNY (sb_secret_… / legacy service_role) ŚWIADOMIE nie mieszka
 * tutaj: jego jedynym legalnym miejscem jest fabryka
 * packages/db/src/service.ts (inwariant ADR-099 — pilnują go
 * scripts/audit-service-role.sh i bramka jedyności ADR-142).
 */

/** Nazwa kanoniczna (nowy klucz publikowalny) — do komunikatów dla operatora. */
export const SUPABASE_PUBLISHABLE_KEY_ENV = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

/** Nazwa legacy (anon key JWT) — działa do wyłączenia legacy w Supabase. */
export const SUPABASE_PUBLISHABLE_KEY_LEGACY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

function firstNonEmpty(preferred?: string, legacy?: string): string | undefined {
  if (preferred) return preferred;
  if (legacy) return legacy;
  return undefined;
}

/**
 * Klucz publikowalny Supabase: nowa nazwa → fallback legacy → undefined.
 * Dla ścieżek fail-closed (middleware storefrontu, rate-limit), które przy
 * braku konfiguracji degradują się same zamiast rzucać.
 */
export function readSupabasePublishableKey(): string | undefined {
  return firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Jak wyżej, ale FAIL-HONEST: brak obu nazw = twardy błąd z instrukcją,
 * KTÓRE env ustawić — dla fabryk klientów, bez których aplikacja i tak
 * nie ma czego robić.
 */
export function requireSupabasePublishableKey(): string {
  const key = readSupabasePublishableKey();
  if (!key) {
    throw new Error(
      "Brak klucza publikowalnego Supabase — ustaw NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
        "(klucz sb_publishable_… z sekcji API Keys projektu Supabase). Do czasu wyłączenia " +
        "kluczy legacy działa też NEXT_PUBLIC_SUPABASE_ANON_KEY. UWAGA: NEXT_PUBLIC_* jest " +
        "wmurowywane w build — po zmianie env przebuduj aplikację (restart nie wystarcza).",
    );
  }
  return key;
}
