import Link from "next/link";

import type { AuditLogEntry } from "@avably/db";

import { listTenants, requireSuperadminPage } from "@/lib/superadmin";
import { auditFilterSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Warsaw",
  }).format(new Date(value));
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; action?: string; page?: string }>;
}) {
  const raw = await searchParams;
  const ctx = await requireSuperadminPage("/admin/audit");

  // Filtry z URL-a przechodzą przez Zoda: niepoprawne (np. tenantId, który nie
  // jest UUID-em) są po prostu ignorowane, a nie wstrzykiwane do zapytania.
  const parsed = auditFilterSchema.safeParse({
    tenantId: raw.tenantId || undefined,
    action: raw.action || undefined,
    page: raw.page || 1,
  });
  const filters = parsed.success ? parsed.data : { page: 1 as number, tenantId: undefined, action: undefined };

  const from = (filters.page - 1) * PAGE_SIZE;

  let query = ctx.supabase
    .from("audit_log")
    .select("id, tenant_id, actor_user_id, action, subject, details, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (filters.tenantId) query = query.eq("tenant_id", filters.tenantId);
  if (filters.action) query = query.ilike("action", `%${filters.action}%`);

  const { data, count, error } = await query;
  if (error) throw new Error(`Nie udało się pobrać dziennika zdarzeń: ${error.message}`);

  const entries = (data ?? []) as AuditLogEntry[];
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tenants = await listTenants(ctx);

  function pageHref(page: number): string {
    const params = new URLSearchParams();
    if (filters.tenantId) params.set("tenantId", filters.tenantId);
    if (filters.action) params.set("action", filters.action);
    params.set("page", String(page));
    return `/admin/audit?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Dziennik zdarzeń</h1>
        <p className="text-sm text-gray-600">
          {total} {total === 1 ? "wpis" : "wpisów"} · strona {filters.page} z {lastPage}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <label className="flex flex-col gap-1 text-sm">
          Organizacja
          <select
            className="rounded-md border border-gray-300 px-3 py-2"
            defaultValue={filters.tenantId ?? ""}
            name="tenantId"
          >
            <option value="">wszystkie</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.slug}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Akcja (fragment)
          <input
            className="rounded-md border border-gray-300 px-3 py-2"
            defaultValue={filters.action ?? ""}
            name="action"
            placeholder="superadmin.tenant"
            type="text"
          />
        </label>
        <button className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white" type="submit">
          Filtruj
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Kiedy</th>
              <th className="px-4 py-3">Akcja</th>
              <th className="px-4 py-3">Organizacja</th>
              <th className="px-4 py-3">Wykonawca</th>
              <th className="px-4 py-3">Szczegóły</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-gray-100 last:border-b-0 align-top">
                <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                  {formatDate(entry.created_at)}
                </td>
                <td className="px-4 py-3 text-xs">{entry.action}</td>
                <td className="px-4 py-3 tabular-nums text-xs">{entry.tenant_id ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums text-xs">{entry.actor_user_id ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  {entry.details ? JSON.stringify(entry.details) : "—"}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-gray-500" colSpan={5}>
                  Brak wpisów dla wybranych filtrów.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <nav className="flex items-center gap-4 text-sm">
        {filters.page > 1 && (
          <Link className="text-blue-700 hover:underline" href={pageHref(filters.page - 1)}>
            ← Poprzednia
          </Link>
        )}
        {filters.page < lastPage && (
          <Link className="text-blue-700 hover:underline" href={pageHref(filters.page + 1)}>
            Następna →
          </Link>
        )}
      </nav>
    </div>
  );
}
