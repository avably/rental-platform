/**
 * Lista organizacji zalogowanego użytkownika dla pickera powłoki (L7,
 * ADR-224).
 *
 * ŹRÓDŁO: RPC `app.my_organizations()` (SECURITY DEFINER, 0092) — zwraca
 * WYŁĄCZNIE członkostwa `auth.uid()`. Zwykły odczyt `public.members`/
 * `public.tenants` NIE wystarcza: RLS z predykatami live (0060) wystawia
 * tylko organizację z BIEŻĄCEGO claimu `tenant_id`, więc pozostałych org
 * użytkownika by nie zwrócił. To NIE jest bramka dostępu — twardą izolacją
 * jest RLS + bramka członkostwa w hooku/`set_active_tenant`; lista jest
 * wyłącznie nawigacją powłoki, więc odczyt jest fail-silent (pusta lista przy
 * błędzie, jak reszta odczytów layoutu, patrz readTenantBillingState).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Role } from "@avably/db";

export interface PanelOrganization {
  tenantId: string;
  name: string;
  slug: string;
  role: Role;
}

interface MyOrganizationRow {
  tenant_id: string;
  name: string;
  slug: string;
  role: Role;
  created_at: string;
}

export async function readMyOrganizations(
  supabase: SupabaseClient,
): Promise<PanelOrganization[]> {
  const { data, error } = await supabase.schema("app").rpc("my_organizations");
  if (error || !Array.isArray(data)) return [];

  return (data as MyOrganizationRow[]).map((row) => ({
    tenantId: row.tenant_id,
    name: row.name,
    slug: row.slug,
    role: row.role,
  }));
}
