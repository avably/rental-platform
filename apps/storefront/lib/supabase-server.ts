/**
 * Klient Supabase server-side dla storefrontu (RSC/Server Actions) — anon key
 * osadzony w cookies żądania (wzorzec: apps/panel/lib/supabase-server.ts).
 *
 * Storefront nie ma dziś sesji użytkownika: ścieżki publiczne (checkout,
 * kontakt) są w pełni anonimowe. Adapter cookies jest tu mimo to, bo klient `@supabase/ssr` go
 * wymaga, a przyszłe ścieżki z sesją (koszyk najemcy) nie będą przez to
 * musiały przepisywać tego pliku.
 *
 * ŚWIADOMIE bez service-role: konwencja projektu mówi, że bramką jest RLS, a
 * nie klucz omijający RLS (patrz nagłówek 0004_superadmin.sql). Klucz
 * service-role w runtimie publicznej apki znosiłby całą wartość polityk z
 * migracji 0006 — publiczna ścieżka zapisu idzie anon keyem przez RPC.
 */
import { cookies } from "next/headers";

import { createServerClient } from "@avably/db";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient({
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      try {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      } catch {
        // Wywołane z Server Component (odczyt) — zapis cookies jest tam
        // no-opem. Publiczne ścieżki storefrontu i tak nie ustawiają cookies.
      }
    },
  });
}
