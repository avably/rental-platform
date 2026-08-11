/**
 * Tablica przejść billingu SaaS — app.apply_saas_subscription_state
 * (migracja 0067, ADR-136) na ŻYWYM lokalnym Supabase.
 *
 * DLACZEGO NA ŻYWEJ BAZIE: przedmiotem testu są własności BAZY — tablica
 * przejść w plpgsql, CHECK statusu (W9), unikaty częściowe identyfikatorów
 * dostawcy, ACL funkcji (EXECUTE tylko service_role) i nietykalność polityk
 * z 0064. Atrapa odpowiadałaby to, co sami byśmy jej kazali.
 *
 * OSIE (lustro briefu J2 fazy 2a):
 *   1. tablica przejść: trialing|active→active, past_due→past_due,
 *      unpaid→suspended, canceled/incomplete/incomplete_expired/paused →
 *      projekcja TAK, tenant BEZ zmiany,
 *   2. PĘTLE WŁASNE są normą (zasada 6): comiesięczne active→active
 *      i powtórki past_due→past_due przechodzą bez wyjątku,
 *   3. suspended_at: ustawiane przy PIERWSZYM wejściu w suspended, pętla
 *      własna go NIE przesuwa, powrót do active CZYŚCI (zasada 5),
 *   4. superadmin_locked i cancelled NIENARUSZALNE — zapłata nie zdejmuje
 *      blokady platformowej ani nie reanimuje zamkniętej organizacji,
 *   5. bramka podmiany: druga ŻYWA subskrypcja → P0012; po zamkniętej
 *      (canceled) podmiana legalna (reaktywacja),
 *   6. CHECK W9: status spoza słownika (w słowniku JEST 'paused') → 23514,
 *   7. izolacja: cudze sub_ nie wejdzie drugiemu tenantowi (unikat 23505),
 *      anon/authenticated nie wykonają funkcji (42501), owner nadal nie
 *      zapisze subscriptions wprost (regresja R17/0064),
 *   8. reseed plans: standard/premium aktywne z kwotami stałej,
 *      start/pro/max zgaszone.
 */
import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = ["SUPABASE_LOCAL_URL"] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const sql = hasEnv ? postgres(env("SUPABASE_LOCAL_URL"), { max: 1 }) : null;

const createdTenantIds: string[] = [];

async function createTenant(): Promise<string> {
  const slug = `bill${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const rows = await sql!`
    insert into public.tenants (slug, name) values (${slug}, 'Billing test')
    returning id
  `;
  const id = (rows[0] as { id: string }).id;
  createdTenantIds.push(id);
  return id;
}

interface ApplyResult {
  tenant_status_before: string;
  tenant_status_after: string;
  tenant_changed: boolean;
  subscription_status: string;
}

/** Wywołanie JAK W PRODUKCJI: rolą service_role (EXECUTE tylko dla niej). */
async function apply(
  tenantId: string,
  subStatus: string,
  options: { subId?: string; customerId?: string; planId?: string } = {},
): Promise<ApplyResult> {
  const subId = options.subId ?? `sub_test_${tenantId.slice(0, 8)}`;
  const customerId = options.customerId ?? `cus_test_${tenantId.slice(0, 8)}`;
  const planId = options.planId ?? "standard";
  return sql!.begin(async (tx) => {
    await tx`set local role service_role`;
    const rows = await tx`
      select app.apply_saas_subscription_state(
        ${tenantId}::uuid, ${customerId}, ${subId}, ${subStatus}, ${planId},
        now() - interval '1 day', now() + interval '29 days', false
      ) as result
    `;
    return (rows[0] as { result: ApplyResult }).result;
  });
}

async function tenantState(
  tenantId: string,
): Promise<{ status: string; suspended_at: string | null }> {
  const rows = await sql!`
    select status, suspended_at from public.tenants where id = ${tenantId}::uuid
  `;
  return rows[0] as { status: string; suspended_at: string | null };
}

async function subscriptionRow(tenantId: string): Promise<Record<string, unknown> | undefined> {
  const rows = await sql!`
    select * from public.subscriptions where tenant_id = ${tenantId}::uuid
  `;
  return rows[0] as Record<string, unknown> | undefined;
}

afterAll(async () => {
  if (!sql) return;
  for (const id of createdTenantIds) {
    await sql`delete from public.tenants where id = ${id}::uuid`;
  }
  await sql.end();
});

describe.skipIf(!hasEnv)("0067 — tablica przejść billingu", () => {
  it("trialing|active → active; past_due → past_due; unpaid → suspended", async () => {
    for (const [subStatus, expected] of [
      ["trialing", "active"],
      ["active", "active"],
      ["past_due", "past_due"],
      ["unpaid", "suspended"],
    ] as const) {
      const tenantId = await createTenant();
      const result = await apply(tenantId, subStatus);
      expect(result.tenant_status_after, subStatus).toBe(expected);
      expect((await tenantState(tenantId)).status, subStatus).toBe(expected);
      // Projekcja trzyma SUROWY status dostawcy, nie przetłumaczony.
      expect((await subscriptionRow(tenantId))?.["status"], subStatus).toBe(subStatus);
    }
  });

  it("canceled / incomplete / incomplete_expired / paused: projekcja TAK, tenant BEZ zmiany", async () => {
    for (const subStatus of ["canceled", "incomplete", "incomplete_expired", "paused"]) {
      const tenantId = await createTenant();
      const result = await apply(tenantId, subStatus);
      expect(result.tenant_changed, subStatus).toBe(false);
      expect((await tenantState(tenantId)).status, subStatus).toBe("trialing");
      expect((await subscriptionRow(tenantId))?.["status"], subStatus).toBe(subStatus);
    }
  });

  it("PĘTLE WŁASNE: active→active i past_due→past_due przechodzą bez wyjątku (zasada 6)", async () => {
    const tenantId = await createTenant();
    await apply(tenantId, "active");
    const second = await apply(tenantId, "active"); // comiesięczne invoice.paid
    expect(second.tenant_changed).toBe(false);
    expect(second.tenant_status_after).toBe("active");

    await apply(tenantId, "past_due");
    const retry = await apply(tenantId, "past_due"); // powtórka dunningowa
    expect(retry.tenant_changed).toBe(false);
    expect((await tenantState(tenantId)).status).toBe("past_due");
  });

  it("suspended_at: PIERWSZE wejście ustawia, pętla własna NIE przesuwa, zapłata CZYŚCI (zasada 5)", async () => {
    const tenantId = await createTenant();
    expect((await tenantState(tenantId)).suspended_at).toBeNull();

    await apply(tenantId, "unpaid");
    const first = (await tenantState(tenantId)).suspended_at;
    expect(first).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));
    await apply(tenantId, "unpaid"); // ponowna dostawa / kolejna faktura
    expect((await tenantState(tenantId)).suspended_at).toStrictEqual(first);

    await apply(tenantId, "active"); // zapłata — powrót natychmiastowy
    const after = await tenantState(tenantId);
    expect(after.status).toBe("active");
    expect(after.suspended_at).toBeNull();
  });

  it("past_due NIE dotyka suspended_at (zegar okna 2b nie jest resetowany bocznymi drzwiami)", async () => {
    const tenantId = await createTenant();
    await apply(tenantId, "unpaid");
    const stamp = (await tenantState(tenantId)).suspended_at;
    await apply(tenantId, "past_due");
    expect((await tenantState(tenantId)).suspended_at).toStrictEqual(stamp);
  });

  it("superadmin_locked NIENARUSZALNY: zapłata nie zdejmuje blokady, projekcja idzie dalej", async () => {
    const tenantId = await createTenant();
    await apply(tenantId, "unpaid");
    const stamp = (await tenantState(tenantId)).suspended_at;

    await sql!`
      update public.tenants
         set status = 'superadmin_locked', status_before_lock = 'suspended'
       where id = ${tenantId}::uuid
    `;
    const result = await apply(tenantId, "active");
    expect(result.tenant_changed).toBe(false);

    const state = await tenantState(tenantId);
    expect(state.status).toBe("superadmin_locked");
    // suspended_at też nietknięte — okno 2b liczy się od starej daty.
    expect(state.suspended_at).toStrictEqual(stamp);
    // Projekcja MA świeży status — superadmin widzi prawdę o subskrypcji.
    expect((await subscriptionRow(tenantId))?.["status"]).toBe("active");
  });

  it("cancelled NIENARUSZALNY przez przejścia billingowe", async () => {
    const tenantId = await createTenant();
    await apply(tenantId, "active");
    await sql!`update public.tenants set status = 'cancelled' where id = ${tenantId}::uuid`;
    const result = await apply(tenantId, "active");
    expect(result.tenant_changed).toBe(false);
    expect((await tenantState(tenantId)).status).toBe("cancelled");
  });

  it("bramka podmiany: druga ŻYWA subskrypcja → P0012; po canceled podmiana legalna", async () => {
    const tenantId = await createTenant();
    await apply(tenantId, "active", { subId: "sub_pierwsza_" + tenantId.slice(0, 8) });

    await expect(
      apply(tenantId, "active", { subId: "sub_druga_" + tenantId.slice(0, 8) }),
    ).rejects.toMatchObject({ code: "P0012" });

    // Stara subskrypcja umiera (canceled) → nowa z checkoutu reaktywacyjnego.
    await apply(tenantId, "canceled", { subId: "sub_pierwsza_" + tenantId.slice(0, 8) });
    const result = await apply(tenantId, "active", {
      subId: "sub_druga_" + tenantId.slice(0, 8),
    });
    expect(result.tenant_status_after).toBe("active");
  });

  it("CHECK W9: status spoza słownika → 23514; 'paused' JEST w słowniku", async () => {
    const tenantId = await createTenant();
    await expect(apply(tenantId, "zmyslony_status")).rejects.toMatchObject({ code: "23514" });
    // Kontrola pozytywna W9: paused przechodzi (webhook się nie mrozi).
    const result = await apply(tenantId, "paused");
    expect(result.subscription_status).toBe("paused");
  });

  it("izolacja: cudze sub_ nie wejdzie drugiemu tenantowi (unikat częściowy, 23505)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const sharedSub = "sub_wspolna_" + tenantA.slice(0, 8);
    await apply(tenantA, "active", { subId: sharedSub, customerId: "cus_a_" + tenantA.slice(0, 8) });
    await expect(
      apply(tenantB, "active", { subId: sharedSub, customerId: "cus_b_" + tenantB.slice(0, 8) }),
    ).rejects.toMatchObject({ code: "23505" });
    // Tenant B nietknięty — zdarzenie cudzego obiektu nie zmienia jego stanu.
    expect((await tenantState(tenantB)).status).toBe("trialing");
    expect(await subscriptionRow(tenantB)).toBeUndefined();
  });

  it("nieistniejący tenant → P0011", async () => {
    await expect(apply(randomUUID(), "active")).rejects.toMatchObject({ code: "P0011" });
  });

  it("ACL: anon i authenticated NIE wykonają funkcji (42501)", async () => {
    const tenantId = await createTenant();
    for (const role of ["anon", "authenticated"]) {
      await expect(
        sql!.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`
            select app.apply_saas_subscription_state(
              ${tenantId}::uuid, 'cus_x', 'sub_x', 'active', 'standard',
              now(), now() + interval '30 days', false
            )
          `;
        }),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("regresja R17/0064: authenticated nadal nie zapisze subscriptions wprost", async () => {
    const tenantId = await createTenant();
    await expect(
      sql!.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`
          insert into public.subscriptions (tenant_id, plan_id, status)
          values (${tenantId}::uuid, 'premium', 'active')
        `;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("reseed plans: standard/premium aktywne z kwotami stałej, placeholdery zgaszone", async () => {
    const plans = await sql!`
      select id, price_grosze, currency, active from public.plans order by id
    `;
    const byId = new Map(plans.map((row) => [row["id"] as string, row]));
    expect(byId.get("standard")).toMatchObject({ price_grosze: 19900, currency: "PLN", active: true });
    expect(byId.get("premium")).toMatchObject({ price_grosze: 39900, currency: "PLN", active: true });
    for (const placeholder of ["start", "pro", "max"]) {
      expect(byId.get(placeholder)?.["active"], placeholder).toBe(false);
    }
  });

  it("wpis audit_log przy realnym przejściu, bez wpisu przy pętli własnej", async () => {
    const tenantId = await createTenant();
    await apply(tenantId, "active");
    await apply(tenantId, "active"); // pętla własna — bez drugiego wpisu
    const entries = await sql!`
      select details from public.audit_log
      where tenant_id = ${tenantId}::uuid and action = 'billing.tenant.status'
    `;
    expect(entries).toHaveLength(1);
    expect((entries[0] as { details: { status_po: string } }).details.status_po).toBe("active");
  });
});
