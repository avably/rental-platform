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

import { parsePublishedSite, type PublishedSite } from "@avably/core/site";

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
  const supabase = client ?? (await createSupabaseServerClient());

  const { data, error } = await supabase
    .schema("app")
    .rpc("get_published_site", { p_tenant_id: tenantId });

  // Fail-closed: błąd transportu/API jest dla odwiedzającego tym samym, czym
  // brak strony — storefront pokaże 404/pustkę, nie stacktrace.
  if (error || data == null) return null;

  return parsePublishedSite(data);
}
