import Link from "next/link";

import { listTenants, requireSuperadminPage } from "@/lib/superadmin";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  trialing: "okres próbny",
  active: "aktywna",
  past_due: "zaległa płatność",
  suspended: "zawieszona",
  cancelled: "anulowana",
  superadmin_locked: "zablokowana przez superadmina",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(new Date(value));
}

export default async function TenantsPage() {
  const ctx = await requireSuperadminPage("/admin/tenants");
  const tenants = await listTenants(ctx);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Organizacje</h1>
        <p className="text-sm text-gray-600">
          {tenants.length} {tenants.length === 1 ? "organizacja" : "organizacji"} w systemie.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Nazwa</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Utworzona</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <tr key={tenant.id} className="border-b border-gray-100 last:border-b-0">
                <td className="px-4 py-3 font-mono">
                  <Link className="text-blue-700 hover:underline" href={`/admin/tenants/${tenant.id}`}>
                    {tenant.slug}
                  </Link>
                </td>
                <td className="px-4 py-3">{tenant.name}</td>
                <td className="px-4 py-3">{STATUS_LABELS[tenant.status] ?? tenant.status}</td>
                <td className="px-4 py-3">{tenant.plan_id ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600">{formatDate(tenant.created_at)}</td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-gray-500" colSpan={5}>
                  Brak organizacji.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
