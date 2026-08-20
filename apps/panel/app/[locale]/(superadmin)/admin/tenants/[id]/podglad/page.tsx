import { notFound, redirect } from "next/navigation";

import type { Invitation, Member } from "@avably/db";

import { getTenant, getTenantViewCookie, requireSuperadminPage } from "@/lib/superadmin";
import { localePath } from "@/lib/navigation";
import { tenantIdSchema } from "@/lib/validation";

import { endTenantViewAction } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * Podgląd tenanta — impersonacja w wariancie TYLKO DO ODCZYTU (ADR-010).
 *
 * Superadmin nie dostaje tu tokenu tenanta ani jego uprawnień: strona czyta
 * dane WŁASNĄ sesją superadmina, przez polityki RLS z klauzulą
 * `or app.is_superadmin()`. Nie ma więc czym eskalować, a wylogowanie kończy
 * podgląd razem z sesją. Warunkiem wejścia jest ciasteczko ustawione przez
 * akcję, która zapisała wpis w audit_log — bez niego wracamy na szczegóły
 * organizacji, żeby nie dało się oglądać danych bez śladu w dzienniku.
 */
export default async function TenantViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsedId = tenantIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const tenantId = parsedId.data;

  const ctx = await requireSuperadminPage(`/admin/tenants/${tenantId}/podglad`);

  if ((await getTenantViewCookie()) !== tenantId) {
    redirect(await localePath(`/admin/tenants/${tenantId}`));
  }

  const tenant = await getTenant(ctx, tenantId);
  if (!tenant) notFound();

  const [{ data: members }, { data: invitations }] = await Promise.all([
    ctx.supabase
      .from("members")
      .select("tenant_id, user_id, role, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
    ctx.supabase
      .from("invitations")
      .select("id, tenant_id, email, role, expires_at, accepted_at, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-attention-border bg-status-attention-bg px-4 py-3">
        <p className="text-sm text-status-attention-fg">
          Działasz jako <b>{tenant.name}</b> - podgląd tylko do odczytu. Wejście zostało zapisane w
          dzienniku zdarzeń.
        </p>
        <form action={endTenantViewAction}>
          <input type="hidden" name="tenantId" value={tenant.id} />
          <button className="rounded-md bg-status-attention-fg px-4 py-2 text-sm text-white" type="submit">
            Wróć do panelu superadmina
          </button>
        </form>
      </div>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Członkowie ({members?.length ?? 0})</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
          {((members ?? []) as Member[]).map((member) => (
            <li key={member.user_id} className="tabular-nums text-xs">
              {member.user_id} - {member.role}
            </li>
          ))}
          {(members?.length ?? 0) === 0 && <li className="text-muted-foreground">Brak członków.</li>}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Zaproszenia ({invitations?.length ?? 0})</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
          {((invitations ?? []) as Invitation[]).map((invitation) => (
            <li key={invitation.id}>
              {invitation.email} - {invitation.role} -{" "}
              {invitation.accepted_at ? "przyjęte" : "oczekuje"}
            </li>
          ))}
          {(invitations?.length ?? 0) === 0 && <li className="text-muted-foreground">Brak zaproszeń.</li>}
        </ul>
      </section>
    </div>
  );
}
