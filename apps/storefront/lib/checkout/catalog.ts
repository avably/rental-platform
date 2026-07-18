/**
 * Publiczny odczyt katalogu i dostępności storefrontu (Zadanie 2.4a) —
 * WARSTWA DANYCH dla katalogu/koszyka 2.4b (komponenty powstają osobno).
 *
 * Jedyne ścieżki: app.get_public_catalog / app.get_public_availability (0020,
 * SECURITY DEFINER — wzorzec ADR-039/041). Anonimowy odwiedzający nie ma grantów
 * na products/product_units/... — RPC zwracają jawnie wybrane kolumny (bez
 * credentiali, bez numerów seryjnych, bez danych zamówień) i NULL dla tenanta
 * nieaktywnego / produktu nieosiągalnego. Fail-closed: błąd transportu = NULL.
 *
 * `client` wstrzykiwalny dla testów; produkcyjnie klient anon z cookies.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase-server";

import type { PublicAvailability, PublicCatalog } from "./contract";

export async function getPublicCatalog(
  tenantId: string,
  client?: SupabaseClient,
): Promise<PublicCatalog | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .schema("app")
    .rpc("get_public_catalog", { p_tenant_id: tenantId });

  if (error || data == null) return null;
  return data as PublicCatalog;
}

export async function getPublicAvailability(
  tenantId: string,
  productId: string,
  startDate: string,
  endDate: string,
  client?: SupabaseClient,
): Promise<PublicAvailability | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.schema("app").rpc("get_public_availability", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || data == null) return null;
  return data as PublicAvailability;
}
