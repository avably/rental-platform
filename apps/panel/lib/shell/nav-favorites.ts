/**
 * Odczyt ULUBIONYCH nawigacji (ADR-232) — jeden fail-silent odczyt shella.
 *
 * ŹRÓDŁO: `app.user_nav_favorites` (RLS SELECT tylko własnego wiersza, 0094).
 * Klient z sesji operatora widzi WYŁĄCZNIE swój wiersz — izolacja jest w RLS,
 * nie w tym module. Jak reszta odczytów layoutu (rozliczenia, organizacje,
 * przewodnik uruchomienia) jest FAIL-SILENT: każdy błąd (transport, wyjątek
 * klienta, wiersza brak) → pusta lista, pasek ulubionych i gwiazdki po prostu
 * gasną. Layout NIE jest guardem.
 *
 * Filtruje surowe id do ZNANYCH pozycji już przy odczycie (`knownFavoriteIds`)
 * — baza trzyma nieprzezroczyste stringi, a UI pokazuje tylko te, które nadal
 * mapują się na istniejący ekran (odporność na usunięty ekran).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { knownFavoriteIds } from "./nav";

export async function readNavFavorites(supabase: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .schema("app")
      .from("user_nav_favorites")
      .select("favorites")
      .maybeSingle();

    if (error || !data) return [];

    const raw = (data as { favorites: unknown }).favorites;
    if (!Array.isArray(raw)) return [];

    // Baza jest agnostyczna wobec treści — bierzemy tylko stringi i tylko te,
    // które nadal są znaną pozycją nav (kolejność zachowana, duplikaty usunięte).
    return knownFavoriteIds(raw.filter((value): value is string => typeof value === "string"));
  } catch {
    return [];
  }
}
