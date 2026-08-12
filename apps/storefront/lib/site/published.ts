/**
 * Publiczny odczyt opublikowanej strony tenanta (Zadanie 2.3a, ADR-041) —
 * WARSTWA DANYCH dla renderu 2.3b (komponenty powstają osobno).
 *
 * Jedyna ścieżka: app.get_published_site (0019, SECURITY DEFINER — wzorzec
 * ADR-039). Anonimowy odwiedzający nie ma grantów na sites/site_sections;
 * RPC zwraca WYŁĄCZNIE opublikowany stan (template, published_at, sekcje
 * enabled z content_published, posortowane po position) i NULL dla tenanta
 * nieaktywnego / strony nieopublikowanej — nieodróżnialnie od nieistniejącej.
 *
 * Odpowiedź jest parsowana schematami @avably/core/site: powłoka fail-closed,
 * sekcje degradują się indywidualnie (parsePublishedSite) — zła sekcja znika,
 * nie kładzie sklepu.
 *
 * Cache: trasa tenancka jest dziś force-dynamic (CSP nonce, patrz store/page),
 * więc odczyt idzie świeżo per żądanie. Tag tenanta (tenantCacheTag) emitowany
 * przez publikację w panelu to przygotowany seam pod ISR/data-cache (2.4/2.6)
 * — wpis cache owinięty tym tagiem będzie unieważniany bez zmiany kontraktu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  HOME_PAGE_SLUG,
  parsePublishedSite,
  resolveSiteStyle,
  type PublishedSite,
  type ResolvedSiteStyle,
} from "@avably/core/site";

import { createSupabaseServerClient } from "@/lib/supabase-server";

export type { PublishedSite, PublishedSection } from "@avably/core/site";

/**
 * Opublikowana strona tenanta albo null (brak strony / nieopublikowana /
 * tenant nieaktywny / odpowiedź w nieznanym kształcie — fail-closed).
 * `client` wstrzykiwalny dla testów; produkcyjnie klient anon z cookies.
 */
export async function getPublishedSite(
  tenantId: string,
  client?: SupabaseClient,
): Promise<PublishedSite | null> {
  return getPublishedPage(tenantId, HOME_PAGE_SLUG, client);
}

/**
 * Opublikowana strona najemcy POD WSKAZANYM ADRESEM (Faza 2, 0074, ADR-158).
 *
 * Pusty slug to strona główna — i to jest jedyna różnica między tą funkcją
 * a `getPublishedSite`, która od Fazy 2 jest właśnie jej wywołaniem. Jedna
 * droga odczytu, jeden kształt parsowania: druga kopia tego ciała rozjechałaby
 * się z pierwszą przy najbliższej zmianie koperty, a koperta jest `.strict()`.
 *
 * IZOLACJA. `app.get_published_page` jest SECURITY DEFINER, więc RLS jej nie
 * dotyczy — bramką są jawne argumenty. `tenantId` przychodzi WYŁĄCZNIE
 * z nagłówka wstrzykniętego przez proxy z rozwiązania server-side po hoście
 * (lib/tenant/headers.ts zdejmuje przychodzące nagłówki bezwarunkowo), więc
 * slug podany przez odwiedzającego nie ma jak dosięgnąć cudzego najemcy.
 */
export async function getPublishedPage(
  tenantId: string,
  slug: string,
  client?: SupabaseClient,
): Promise<PublishedSite | null> {
  const supabase = client ?? (await createSupabaseServerClient());

  const { data, error } = await supabase
    .schema("app")
    .rpc("get_published_page", { p_tenant_id: tenantId, p_slug: slug });

  // Fail-closed: błąd transportu/API jest dla odwiedzającego tym samym, czym
  // brak strony — storefront pokaże 404/pustkę, nie stacktrace.
  if (error || data == null) return null;

  return parsePublishedSite(data);
}

/**
 * STYL STRONY w postaci, w której posługuje się nim render (K5, ADR-090):
 * szablon, akcent i para fontów uzupełnione o wartości domyślne.
 *
 * Rozstrzygnięcie stoi TUTAJ, a nie w komponencie trasy, z trzech powodów:
 *
 *   1. SZABLON MA OD K5 DWA ŹRÓDŁA. `sites.template` jest kolumną ZASTANĄ —
 *      strona sprzed ADR-090 nie ma zapisanego stylu, więc kolumna zostaje
 *      jedynym źródłem; strona, która przeszła przez panel stylu, niesie
 *      szablon w jsonb i to on obowiązuje. Dwa niezależne odczyty rozjechałyby
 *      się dokładnie w dniu, w którym operator zmieni szablon w kreatorze —
 *      i to jest ten rodzaj rozjazdu, który widać dopiero u klienta.
 *   2. BRAK STRONY MA MIEĆ STYL. `null` (nieopublikowana / tenant nieaktywny)
 *      dostaje styl domyślny zamiast zmuszać każdą trasę do własnego `?:`.
 *   3. TESTOWALNOŚĆ SZWU. Cały tor „koperta RPC → tokeny na korzeniu strony"
 *      da się przejechać bez nagłówków żądania i bez bazy (test site-style).
 *
 * Fail-soft jest w `resolveSiteStyle`: styl w nieznanym kształcie znaczy
 * „strona wygląda domyślnie", a nie „strona nie wygląda wcale".
 */
export function publishedSiteStyle(site: PublishedSite | null): ResolvedSiteStyle {
  return resolveSiteStyle(site?.style, site?.template);
}
