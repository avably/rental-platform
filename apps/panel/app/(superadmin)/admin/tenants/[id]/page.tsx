import Link from "next/link";
import { notFound } from "next/navigation";

import { getTenant, isLocked, listPlans, requireSuperadminPage } from "@/lib/superadmin";
import { tenantIdSchema } from "@/lib/validation";

import {
  lockTenantAction,
  setPlanAction,
  startTenantViewAction,
  unlockTenantAction,
} from "../actions";

export const dynamic = "force-dynamic";

function formatPrice(grosze: number): string {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(grosze / 100);
}

export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ blad?: string }>;
}) {
  const { id } = await params;
  const { blad } = await searchParams;

  const parsedId = tenantIdSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const ctx = await requireSuperadminPage(`/admin/tenants/${parsedId.data}`);
  const tenant = await getTenant(ctx, parsedId.data);
  if (!tenant) notFound();

  const plans = await listPlans(ctx);
  const locked = isLocked(tenant);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link className="text-sm text-blue-700 hover:underline" href="/admin/tenants">
          ← Organizacje
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{tenant.name}</h1>
        <p className="font-mono text-sm text-gray-600">{tenant.slug}</p>
      </div>

      {blad && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {blad}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase text-gray-500">Status</dt>
          <dd>{tenant.status}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Plan</dt>
          <dd>{tenant.plan_id ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Subskrypcja</dt>
          <dd>{tenant.subscription_status ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Identyfikator</dt>
          <dd className="font-mono text-xs break-all">{tenant.id}</dd>
        </div>
      </dl>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Dostęp organizacji</h2>
        {locked ? (
          <form action={unlockTenantAction} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="tenantId" value={tenant.id} />
            <p className="text-sm text-gray-600">
              Organizacja jest zablokowana. Odblokowanie przywróci status sprzed blokady
              {tenant.status_before_lock ? ` („${tenant.status_before_lock}")` : ""}.
            </p>
            <button
              className="w-fit rounded-md bg-gray-900 px-4 py-2 text-sm text-white"
              type="submit"
            >
              Odblokuj organizację
            </button>
          </form>
        ) : (
          <form action={lockTenantAction} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="tenantId" value={tenant.id} />
            <label className="flex flex-col gap-1 text-sm">
              Powód blokady (trafia do dziennika zdarzeń)
              <input
                className="rounded-md border border-gray-300 px-3 py-2"
                maxLength={500}
                name="reason"
                type="text"
              />
            </label>
            <button
              className="w-fit rounded-md bg-red-700 px-4 py-2 text-sm text-white"
              type="submit"
            >
              Zablokuj organizację
            </button>
          </form>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Plan (zmiana ręczna)</h2>
        <form action={setPlanAction} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <label className="flex flex-col gap-1 text-sm">
            Plan
            <select
              className="rounded-md border border-gray-300 px-3 py-2"
              defaultValue={tenant.plan_id ?? ""}
              name="planId"
            >
              <option disabled value="">
                Wybierz plan
              </option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — {formatPrice(plan.price_grosze)}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white" type="submit">
            Zapisz plan
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Podgląd danych organizacji</h2>
        <p className="mt-1 text-sm text-gray-600">
          Wsparcie: wejście w kontekst organizacji w trybie tylko do odczytu. Wejście i wyjście są
          zapisywane w dzienniku zdarzeń.
        </p>
        <form action={startTenantViewAction} className="mt-3">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <button className="rounded-md border border-gray-300 px-4 py-2 text-sm" type="submit">
            Wejdź w podgląd
          </button>
        </form>
      </section>
    </div>
  );
}
