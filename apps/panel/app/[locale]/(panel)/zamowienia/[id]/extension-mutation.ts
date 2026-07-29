/**
 * Zapis dopłat przedłużenia NA POZYCJE zamówienia — I/O oddzielone od czystej
 * wyceny (`extension-pricing.ts`) i od akcji serwerowej (`extension-actions.ts`).
 *
 * DLACZEGO OSOBNY MODUŁ, A NIE FUNKCJA W AKCJI: `extension-actions.ts` jest
 * `"use server"` — każdy jego eksport musi być serializowalną akcją serwerową,
 * a `SupabaseClient` nie przechodzi przez tę granicę. Trzymając zapis tutaj,
 * ten SAM kod woła i akcja (klient z sesją członka), i test integracyjny
 * (klient członka na żywym Supabase) — dowód mutacyjny wyłącza dokładnie tę
 * jedną pętlę i test sum robi się czerwony.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExtensionItemRentalUpdate } from "./extension-pricing";

/**
 * Dopisuje przeliczone kwoty najmu do pozycji. Osobne UPDATE-y na pozycję:
 * PostgREST nie daje transakcji przez wiele żądań (jak `recalcOrderTotals`).
 * Zmiana samego `rental_grosze` NIE rusza przypisania, więc bramka 0010
 * (`order_items_assignment_gate`) ją przepuszcza short-circuitem — żadnej
 * fałszywej kolizji egzemplarza.
 *
 * Filtr `tenant_id` trzyma zapis w tenancie sesji (RLS to drugie zabezpieczenie),
 * a `.select("id")` odróżnia realny zapis od chybienia: zero wierszy = pozycja
 * zniknęła/zmieniła się między odczytem a zapisem — zwracamy błąd, żeby rozjazd
 * był widoczny, nie cichy. Zwraca `null` gdy komplet się zapisał.
 */
export async function writeExtensionItemRentals(
  supabase: SupabaseClient,
  tenantId: string,
  updates: readonly ExtensionItemRentalUpdate[],
): Promise<{ error: string } | null> {
  for (const { itemId, rentalGrosze } of updates) {
    const { data, error } = await supabase
      .from("order_items")
      .update({ rental_grosze: rentalGrosze })
      .eq("tenant_id", tenantId)
      .eq("id", itemId)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return { error: `pozycja ${itemId} zmieniła się w międzyczasie` };
    }
  }
  return null;
}
