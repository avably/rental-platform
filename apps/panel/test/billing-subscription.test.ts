/**
 * Zmiana planu i reaktywacja żywej subskrypcji (J2 faza 3, ADR-152) na ŻYWYM
 * lokalnym Supabase — status tenanta i wiersz projekcji są tu DANYMI testu,
 * a nie atrapami: obie bramki czytają je przez RLS klientem sesji właściciela.
 *
 * Trzy obietnice, każda sprawdzona z obu stron:
 *
 *   1. JEDEN TOR ZAPISU. Obie ścieżki kończą się JEDNYM żądaniem do dostawcy
 *      i nie dotykają `public.subscriptions` — projekcję zapisuje webhook
 *      z odczytu (ADR-136). Testy asertują też stan wiersza PO akcji:
 *      `plan_id`/`cancel_at_period_end` mają zostać nietknięte.
 *   2. REAKTYWACJA NIE OMIJA ZAWIESZENIA (sonda bezpieczeństwa). Zamknięta
 *      jest DWIEMA niezależnymi bramkami: statusem subskrypcji u dostawcy
 *      (`unpaid` odpada) i statusem tenanta (`suspended` odpada) — bo te
 *      dwa stany potrafią się legalnie rozjechać (`app.superadmin_set_plan`
 *      pisze subskrypcję, nie tenanta).
 *   3. ZMIANA PLANU NIE RESETUJE ZEGARA TRIALA. Ścieżka nie ma czym go
 *      zresetować: port zmiany ceny nie przyjmuje pola trialu, a subskrypcja
 *      `trialing` przechodzi zmianę planu bez dotykania okresu próbnego
 *      (parytet kształtu żądania pilnuje packages/core/src/stripe/billing.test.ts).
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SaasSubscriptionRead } from "@avably/core";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import {
  changeSaasPlan,
  reactivateSaasSubscription,
  FOREIGN_SUBSCRIPTION,
  NOTHING_TO_RESUME,
  NO_SUBSCRIPTION,
  PLAN_ALREADY_ACTIVE,
  PLAN_ITEM_MISSING,
  SUBSCRIPTION_NOT_MANAGEABLE,
  type BillingSubscriptionClient,
} from "@/lib/billing-subscription";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "BillingSubTest!12345678";
const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

describe.skipIf(!hasEnv)("zmiana planu i reaktywacja — ADR-152", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  async function signIn(email: string): Promise<SupabaseClient> {
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (error) throw new Error(`signIn(${email}) failed: ${error.message}`);
    return client;
  }

  async function createOwnerWithTenant(label: string): Promise<{
    tenantId: string;
    supabase: SupabaseClient;
  }> {
    const email = `subman-${label}-${randomUUID()}@test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
    createdUserIds.push(data.user.id);

    const bootstrap = await signIn(email);
    const slug = `subman${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
      p_slug: slug,
      p_name: `Subskrypcja (${label})`,
    });
    if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
    createdTenantIds.push(tenantId as string);
    return { tenantId: tenantId as string, supabase: await signIn(email) };
  }

  async function setTenantStatus(tenantId: string, status: string): Promise<void> {
    const { error } = await admin.from("tenants").update({ status }).eq("id", tenantId);
    if (error) throw new Error(`setTenantStatus: ${error.message}`);
  }

  /** Wiersz projekcji — adres subskrypcji i stan, który po akcji ma ZOSTAĆ. */
  async function seedSubscription(
    tenantId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const subscriptionId = `sub_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    const { error } = await admin.from("subscriptions").insert({
      tenant_id: tenantId,
      plan_id: "standard",
      status: "active",
      stripe_customer_id: `cus_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      stripe_subscription_id: subscriptionId,
      cancel_at_period_end: false,
      ...overrides,
    });
    if (error) throw new Error(`seedSubscription: ${error.message}`);
    return subscriptionId;
  }

  async function readProjection(
    tenantId: string,
  ): Promise<{ plan_id: string; cancel_at_period_end: boolean }> {
    const { data, error } = await admin
      .from("subscriptions")
      .select("plan_id, cancel_at_period_end")
      .eq("tenant_id", tenantId)
      .single();
    if (error) throw new Error(`readProjection: ${error.message}`);
    return data as { plan_id: string; cancel_at_period_end: boolean };
  }

  interface FakeBilling extends BillingSubscriptionClient {
    calls: { method: string; args: unknown[] }[];
  }

  function subscriptionRead(
    subscriptionId: string,
    overrides: Partial<SaasSubscriptionRead> = {},
  ): SaasSubscriptionRead {
    return {
      subscriptionId,
      customerId: "cus_read",
      status: "active",
      tenantIdFromMetadata: null,
      priceLookupKey: "saas_standard_monthly",
      itemId: "si_read",
      currentPeriodStart: new Date(Date.now() - 86_400_000).toISOString(),
      currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000).toISOString(),
      cancelAtPeriodEnd: false,
      ...overrides,
    };
  }

  function fakeBilling(read: (id: string) => SaasSubscriptionRead): FakeBilling {
    const calls: { method: string; args: unknown[] }[] = [];
    return {
      calls,
      readSaasSubscription: async (subscriptionId: string) => {
        calls.push({ method: "readSaasSubscription", args: [subscriptionId] });
        return read(subscriptionId);
      },
      findPriceIdByLookupKey: async (lookupKey: string) => {
        calls.push({ method: "findPriceIdByLookupKey", args: [lookupKey] });
        return `price_for_${lookupKey}`;
      },
      updateSubscriptionPrice: async (payload) => {
        calls.push({ method: "updateSubscriptionPrice", args: [payload] });
        return { subscriptionId: payload.subscriptionId };
      },
      resumeSubscription: async (payload) => {
        calls.push({ method: "resumeSubscription", args: [payload] });
        return { subscriptionId: payload.subscriptionId };
      },
    };
  }

  // ------------------------------------------------------------------
  // Zmiana planu
  // ------------------------------------------------------------------

  it("zmiana planu: podmiana ceny NA ISTNIEJĄCEJ POZYCJI, cena po lookup_key zamiaru", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("change");
    const subscriptionId = await seedSubscription(tenantId);
    const billing = fakeBilling((id) =>
      subscriptionRead(id, { tenantIdFromMetadata: tenantId, itemId: "si_first" }),
    );

    const outcome = await changeSaasPlan(
      { supabase, billing },
      { tenantId, planId: "premium", interval: "yearly" },
    );

    expect(outcome).toEqual({ ok: true });
    expect(
      billing.calls.find((c) => c.method === "findPriceIdByLookupKey")?.args[0],
    ).toBe("saas_premium_yearly");
    const update = billing.calls.find((c) => c.method === "updateSubscriptionPrice");
    expect(update?.args[0]).toEqual({
      subscriptionId,
      itemId: "si_first",
      priceId: "price_for_saas_premium_yearly",
    });

    // JEDEN TOR ZAPISU: projekcja czeka na webhooka, akcja jej nie dotyka.
    expect(await readProjection(tenantId)).toMatchObject({ plan_id: "standard" });
  });

  it("ten sam plan i interwał → odmowa nazwana, ZERO żądań zmiany", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("noop");
    await seedSubscription(tenantId);
    const billing = fakeBilling((id) =>
      subscriptionRead(id, {
        tenantIdFromMetadata: tenantId,
        priceLookupKey: "saas_standard_monthly",
      }),
    );

    const outcome = await changeSaasPlan(
      { supabase, billing },
      { tenantId, planId: "standard", interval: "monthly" },
    );

    expect(outcome).toEqual({ error: PLAN_ALREADY_ACTIVE });
    expect(billing.calls.map((c) => c.method)).not.toContain("updateSubscriptionPrice");
  });

  it("odczyt bez pozycji subskrypcji → odmowa GŁOŚNA zamiast żądania, które dołożyłoby drugi plan", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("noitem");
    await seedSubscription(tenantId);
    const billing = fakeBilling((id) =>
      subscriptionRead(id, { tenantIdFromMetadata: tenantId, itemId: null }),
    );

    const outcome = await changeSaasPlan(
      { supabase, billing },
      { tenantId, planId: "premium", interval: "monthly" },
    );

    expect(outcome).toEqual({ error: PLAN_ITEM_MISSING });
    expect(billing.calls.map((c) => c.method)).not.toContain("updateSubscriptionPrice");
  });

  it("brak wiersza projekcji (okres próbny) → odmowa, dostawca NIEPYTANY", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("trial");
    const billing = fakeBilling((id) => subscriptionRead(id));

    const outcome = await changeSaasPlan(
      { supabase, billing },
      { tenantId, planId: "premium", interval: "monthly" },
    );

    expect(outcome).toEqual({ error: NO_SUBSCRIPTION });
    expect(billing.calls).toHaveLength(0);
  });

  it("SONDA: cudza subskrypcja w naszym wierszu → odmowa po ODCZYCIE, zero zmian", async () => {
    const a = await createOwnerWithTenant("ident-a");
    const b = await createOwnerWithTenant("ident-b");
    await seedSubscription(a.tenantId);
    // Odczyt u dostawcy mówi, że subskrypcja należy do INNEGO najemcy.
    const billing = fakeBilling((id) =>
      subscriptionRead(id, { tenantIdFromMetadata: b.tenantId }),
    );

    const outcome = await changeSaasPlan(
      { supabase: a.supabase, billing },
      { tenantId: a.tenantId, planId: "premium", interval: "monthly" },
    );

    expect(outcome).toEqual({ error: FOREIGN_SUBSCRIPTION });
    expect(billing.calls.map((c) => c.method)).toEqual(["readSaasSubscription"]);
  });

  it("SONDA: podstawienie cudzego tenanta → RLS nic nie oddaje, zero wywołań dostawcy", async () => {
    const a = await createOwnerWithTenant("cross-a");
    const b = await createOwnerWithTenant("cross-b");
    await seedSubscription(b.tenantId);
    const billing = fakeBilling((id) =>
      subscriptionRead(id, { tenantIdFromMetadata: b.tenantId }),
    );

    const outcome = await changeSaasPlan(
      { supabase: a.supabase, billing },
      { tenantId: b.tenantId, planId: "premium", interval: "monthly" },
    );

    expect(outcome).toEqual({ error: SUBSCRIPTION_NOT_MANAGEABLE });
    expect(billing.calls).toHaveLength(0);
    expect(await readProjection(b.tenantId)).toMatchObject({ plan_id: "standard" });
  });

  it("ZEGAR TRIALA: subskrypcja trialing zmienia plan, a żądanie niesie WYŁĄCZNIE pozycję i cenę", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("trialclock");
    await setTenantStatus(tenantId, "trialing");
    await seedSubscription(tenantId, { status: "trialing" });
    const billing = fakeBilling((id) =>
      subscriptionRead(id, { tenantIdFromMetadata: tenantId, status: "trialing" }),
    );

    const outcome = await changeSaasPlan(
      { supabase, billing },
      { tenantId, planId: "premium", interval: "monthly" },
    );

    expect(outcome).toEqual({ ok: true });
    const payload = billing.calls.find((c) => c.method === "updateSubscriptionPrice")!
      .args[0] as Record<string, unknown>;
    // Najpierw dowód, że żądanie W OGÓLE powstało (kontrola po pustym zbiorze),
    // potem asercja o tym, czego w nim nie ma.
    expect(Object.keys(payload).sort()).toEqual(["itemId", "priceId", "subscriptionId"]);
    expect(JSON.stringify(payload)).not.toMatch(/trial/i);
  });

  // ------------------------------------------------------------------
  // Reaktywacja
  // ------------------------------------------------------------------

  it("reaktywacja: cofnięcie anulowania jednym żądaniem, projekcja NIETKNIĘTA", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("resume");
    const subscriptionId = await seedSubscription(tenantId, { cancel_at_period_end: true });
    const billing = fakeBilling((id) =>
      subscriptionRead(id, { tenantIdFromMetadata: tenantId, cancelAtPeriodEnd: true }),
    );

    const outcome = await reactivateSaasSubscription({ supabase, billing }, { tenantId });

    expect(outcome).toEqual({ ok: true });
    expect(billing.calls.find((c) => c.method === "resumeSubscription")?.args[0]).toEqual({
      subscriptionId,
    });
    // Flagę zdejmie webhook z odczytu, nie ta akcja.
    expect(await readProjection(tenantId)).toMatchObject({ cancel_at_period_end: true });
  });

  it("abonament bez anulowania → odmowa nazwana zamiast pustego sukcesu", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("nothing");
    await seedSubscription(tenantId);
    const billing = fakeBilling((id) =>
      subscriptionRead(id, { tenantIdFromMetadata: tenantId, cancelAtPeriodEnd: false }),
    );

    const outcome = await reactivateSaasSubscription({ supabase, billing }, { tenantId });

    expect(outcome).toEqual({ error: NOTHING_TO_RESUME });
    expect(billing.calls.map((c) => c.method)).not.toContain("resumeSubscription");
  });

  it("SONDA BEZPIECZEŃSTWA: subskrypcja unpaid — reaktywacja NIE omija zawieszenia", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("unpaid");
    await setTenantStatus(tenantId, "suspended");
    await seedSubscription(tenantId, { status: "unpaid", cancel_at_period_end: true });
    const billing = fakeBilling((id) =>
      subscriptionRead(id, {
        tenantIdFromMetadata: tenantId,
        status: "unpaid",
        cancelAtPeriodEnd: true,
      }),
    );

    const outcome = await reactivateSaasSubscription({ supabase, billing }, { tenantId });

    expect(outcome).toEqual({ error: SUBSCRIPTION_NOT_MANAGEABLE });
    expect(billing.calls.map((c) => c.method)).not.toContain("resumeSubscription");
  });

  it("SONDA BEZPIECZEŃSTWA: tenant suspended przy subskrypcji active (rozjazd) — droga też zamknięta", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("divergent");
    // Stan legalny: app.superadmin_set_plan pisze subskrypcję `active`,
    // NIE dotykając statusu tenanta. Bramka statusu subskrypcji tego nie łapie.
    await setTenantStatus(tenantId, "suspended");
    await seedSubscription(tenantId, { status: "active", cancel_at_period_end: true });
    const billing = fakeBilling((id) =>
      subscriptionRead(id, {
        tenantIdFromMetadata: tenantId,
        status: "active",
        cancelAtPeriodEnd: true,
      }),
    );

    const outcome = await reactivateSaasSubscription({ supabase, billing }, { tenantId });

    expect(outcome).toEqual({ error: SUBSCRIPTION_NOT_MANAGEABLE });
    expect(billing.calls).toHaveLength(0);
  });

  it("okno domykania: tenant past_due nie zmienia planu — droga prowadzi przez zapłatę", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("pastdue");
    await setTenantStatus(tenantId, "past_due");
    await seedSubscription(tenantId, { status: "past_due" });
    const billing = fakeBilling((id) =>
      subscriptionRead(id, { tenantIdFromMetadata: tenantId, status: "past_due" }),
    );

    const outcome = await changeSaasPlan(
      { supabase, billing },
      { tenantId, planId: "premium", interval: "monthly" },
    );

    expect(outcome).toEqual({ error: SUBSCRIPTION_NOT_MANAGEABLE });
    expect(billing.calls).toHaveLength(0);
  });
});
