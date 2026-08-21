"use server";

import { knownFavoriteIds } from "@/lib/shell/nav";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Zapis ULUBIONYCH nawigacji (ADR-232).
 *
 * CAŁA lista, jednym wywołaniem (przypięcie/odpięcie/zmiana kolejności składają
 * najpierw nową listę po stronie klienta, potem ją utrwalają). Bramka izolacji
 * NIE siedzi tutaj, tylko w `app.set_nav_favorites` (SECURITY DEFINER, 0094):
 * user pochodzi z `auth.uid()`, nie z żadnego argumentu — zapis cudzych
 * ulubionych jest niewyrażalny. Nigdy nie ufamy samej liście z klienta:
 * `knownFavoriteIds` przycina ją do ZNANYCH pozycji (walidacja „znany ekran"
 * jest w UI — baza trzyma nieprzezroczyste id), a RPC pilnuje kształtu (tablica
 * + rozmiar).
 *
 * Zwraca `{ ok }` — klient trzyma stan optymistycznie i COFA przy `ok:false`
 * (jak pigułka terminu / przełącznik organizacji). Wnętrzności Postgresa nie
 * trafiają na ekran; kod błędu idzie do logu.
 */
export interface SetNavFavoritesResult {
  ok: boolean;
}

export async function setNavFavoritesAction(
  favorites: string[],
): Promise<SetNavFavoritesResult> {
  if (!Array.isArray(favorites)) return { ok: false };

  // Defense in depth: przycinamy do znanych id (kolejność, bez duplikatów)
  // zanim cokolwiek utrwalimy — baza i tak zwaliduje kształt, ale nie zapiszemy
  // śmieci nawet przy niewłaściwym wywołaniu akcji.
  const clean = knownFavoriteIds(favorites);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .schema("app")
    .rpc("set_nav_favorites", { p_favorites: clean });

  if (error) {
    console.error(
      "[nav:ulubione] set_nav_favorites",
      JSON.stringify({ code: error.code ?? null, message: error.message ?? null }),
    );
    return { ok: false };
  }

  return { ok: true };
}
