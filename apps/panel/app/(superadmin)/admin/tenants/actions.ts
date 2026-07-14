"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  clearTenantViewCookie,
  requireSuperadminPage,
  setTenantViewCookie,
} from "@/lib/superadmin";
import {
  lockTenantSchema,
  setPlanSchema,
  tenantViewSchema,
  unlockTenantSchema,
} from "@/lib/validation";

/**
 * Akcje superadmina. Każda:
 * - przechodzi przez `requireSuperadminPage()` (claim superadmin + aal2),
 * - waliduje wejście Zodem,
 * - wykonuje RPC w schemacie `app`, które w JEDNEJ transakcji zmienia stan i
 *   dopisuje wpis do audit_log (patrz 0004_superadmin.sql). Nie ma tu ścieżki,
 *   którą dałoby się zmienić stan tenanta bez śladu w dzienniku.
 *
 * RPC są SECURITY INVOKER, więc ostatecznym strażnikiem jest RLS
 * (app.is_superadmin()) — nie te guardy. Guardy dają czytelny UX, baza daje
 * bezpieczeństwo.
 */

function backToTenant(tenantId: string, error?: string): never {
  const suffix = error ? `?blad=${encodeURIComponent(error)}` : "";
  revalidatePath(`/admin/tenants/${tenantId}`);
  redirect(`/admin/tenants/${tenantId}${suffix}`);
}

export async function lockTenantAction(formData: FormData): Promise<void> {
  const parsed = lockTenantSchema.safeParse({
    tenantId: formData.get("tenantId"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) redirect("/admin/tenants");

  const ctx = await requireSuperadminPage();
  const { error } = await ctx.supabase.schema("app").rpc("superadmin_lock_tenant", {
    p_tenant_id: parsed.data.tenantId,
    p_reason: parsed.data.reason ?? null,
  });

  backToTenant(parsed.data.tenantId, error?.message);
}

export async function unlockTenantAction(formData: FormData): Promise<void> {
  const parsed = unlockTenantSchema.safeParse({ tenantId: formData.get("tenantId") });
  if (!parsed.success) redirect("/admin/tenants");

  const ctx = await requireSuperadminPage();
  const { error } = await ctx.supabase.schema("app").rpc("superadmin_unlock_tenant", {
    p_tenant_id: parsed.data.tenantId,
  });

  backToTenant(parsed.data.tenantId, error?.message);
}

export async function setPlanAction(formData: FormData): Promise<void> {
  const parsed = setPlanSchema.safeParse({
    tenantId: formData.get("tenantId"),
    planId: formData.get("planId"),
  });
  if (!parsed.success) redirect("/admin/tenants");

  const ctx = await requireSuperadminPage();
  const { error } = await ctx.supabase.schema("app").rpc("superadmin_set_plan", {
    p_tenant_id: parsed.data.tenantId,
    p_plan_id: parsed.data.planId,
  });

  backToTenant(parsed.data.tenantId, error?.message);
}

/**
 * Wejście w podgląd tenanta (impersonacja read-only, ADR-010). Wpis do
 * audit_log jest warunkiem wejścia: dopiero po nim ustawiamy ciasteczko
 * podglądu, którego brak zawraca ze strony podglądu.
 */
export async function startTenantViewAction(formData: FormData): Promise<void> {
  const parsed = tenantViewSchema.safeParse({ tenantId: formData.get("tenantId") });
  if (!parsed.success) redirect("/admin/tenants");

  const ctx = await requireSuperadminPage();
  const { error } = await ctx.supabase.schema("app").rpc("superadmin_log", {
    p_tenant_id: parsed.data.tenantId,
    p_action: "superadmin.tenant.view.start",
    p_details: {},
  });
  if (error) backToTenant(parsed.data.tenantId, error.message);

  await setTenantViewCookie(parsed.data.tenantId);
  redirect(`/admin/tenants/${parsed.data.tenantId}/podglad`);
}

export async function endTenantViewAction(formData: FormData): Promise<void> {
  const parsed = tenantViewSchema.safeParse({ tenantId: formData.get("tenantId") });
  if (!parsed.success) redirect("/admin/tenants");

  const ctx = await requireSuperadminPage();
  await ctx.supabase.schema("app").rpc("superadmin_log", {
    p_tenant_id: parsed.data.tenantId,
    p_action: "superadmin.tenant.view.end",
    p_details: {},
  });

  // Ciasteczko czyścimy BEZ WZGLĘDU na wynik zapisu audytu — wyjście z
  // podglądu nigdy nie może się nie udać.
  await clearTenantViewCookie();
  backToTenant(parsed.data.tenantId);
}
