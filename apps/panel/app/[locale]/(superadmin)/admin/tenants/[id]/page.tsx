import { formatMoney } from "@avably/core";
import { getLocale } from "next-intl/server";
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
  // Locale steruje ZAPISEM kwoty, waluta (kolumna planu) — symbolem.
  const locale = await getLocale();
  const locked = isLocked(tenant);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link className="text-sm text-status-neutral-fg hover:underline" href="/admin/tenants">
          ← Organizacje
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{tenant.name}</h1>
        <p className="text-sm text-muted-foreground">{tenant.slug}</p>
      </div>

      {blad && (
        <p className="rounded-md border border-status-problem-border bg-status-problem-bg px-4 py-3 text-sm text-destructive">
          {blad}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Status</dt>
          <dd>{tenant.status}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Plan</dt>
          <dd>{tenant.plan_id ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Subskrypcja</dt>
          <dd>{tenant.subscription_status ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Identyfikator</dt>
          <dd className="tabular-nums text-xs break-all">{tenant.id}</dd>
        </div>
      </dl>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Dostęp organizacji</h2>
        {locked ? (
          <form action={unlockTenantAction} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="tenantId" value={tenant.id} />
            <p className="text-sm text-muted-foreground">
              Organizacja jest zablokowana. Odblokowanie przywróci status sprzed blokady
              {tenant.status_before_lock ? ` („${tenant.status_before_lock}")` : ""}.
            </p>
            <button
              className="w-fit rounded-md bg-primary px-4 py-2 text-sm text-white"
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
                className="rounded-md border border-border px-3 py-2"
                maxLength={500}
                name="reason"
                type="text"
              />
            </label>
            <button
              className="w-fit rounded-md bg-destructive px-4 py-2 text-sm text-white"
              type="submit"
            >
              Zablokuj organizację
            </button>
          </form>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Plan (zmiana ręczna)</h2>
        <form action={setPlanAction} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <label className="flex flex-col gap-1 text-sm">
            Plan
            <select
              className="rounded-md border border-border px-3 py-2"
              defaultValue={tenant.plan_id ?? ""}
              name="planId"
            >
              <option disabled value="">
                Wybierz plan
              </option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — {formatMoney(plan.price_grosze, plan.currency, locale)}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-md bg-primary px-4 py-2 text-sm text-white" type="submit">
            Zapisz plan
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Podgląd danych organizacji</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Wsparcie: wejście w kontekst organizacji w trybie tylko do odczytu. Wejście i wyjście są
          zapisywane w dzienniku zdarzeń.
        </p>
        <form action={startTenantViewAction} className="mt-3">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <button className="rounded-md border border-border px-4 py-2 text-sm" type="submit">
            Wejdź w podgląd
          </button>
        </form>
      </section>
    </div>
  );
}
