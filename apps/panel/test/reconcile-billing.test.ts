/**
 * Rekoncyliacja subskrypcji SaaS (J2 faza 2a, ADR-136) — siatka na zgubiony
 * webhook, na ŻYWYM lokalnym Supabase z wstrzykniętym odczytem u dostawcy.
 *
 * KLUCZOWA OŚ (dowód mutacyjny (d) briefu, krawędź odczytu): stan zmienia
 * się U DOSTAWCY bez dostarczonego zdarzenia (zgubiony webhook / ręczna
 * zmiana w sandboksie) → przebieg rekoncyliacji WYKRYWA drift i naprawia
 * `tenants.status` tą samą funkcją, którą pisze webhook. Zero własnego
 * zegara: pętla nie liczy dni, tylko czyta prawdę (zasada 1 dunningu).
 *
 * Osie pozostałe: przebieg bez driftu = no-opy (pętle własne); rozjazd
 * metadata↔projekcja = anomalia raportowana, nigdy „naprawiana"; wiersze
 * bez stripe_subscription_id (comp superadmina) poza pętlą; awaria odczytu
 * jednej subskrypcji nie gasi pozostałych.
 */
import { randomUUID } from "node:crypto";

import type { SaasSubscriptionRead } from "@avably/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { reconcileBilling } from "@/src/jobs/reconcile-billing";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = ["SUPABASE_LOCAL_API_URL", "SUPABASE_LOCAL_SERVICE_ROLE_KEY"] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const adminClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

const createdTenantIds: string[] = [];

function read(overrides: Partial<SaasSubscriptionRead>): SaasSubscriptionRead {
  return {
    subscriptionId: "sub_x",
    customerId: `cus_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    status: "active",
    tenantIdFromMetadata: null,
    priceLookupKey: "saas_standard_monthly",
    currentPeriodStart: new Date(Date.now() - 86_400_000).toISOString(),
    currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000).toISOString(),
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe.skipIf(!hasEnv)("rekoncyliacja billingu — ADR-136", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
  });

  async function seedSubscribedTenant(input: {
    tenantStatus: string;
    subStatus: string;
  }): Promise<{ tenantId: string; subId: string; customerId: string }> {
    const slug = `brec${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: "Billing recon test", status: input.tenantStatus })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const tenantId = (data as { id: string }).id;
    createdTenantIds.push(tenantId);

    const subId = `sub_rec_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const customerId = `cus_rec_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const { error: subError } = await admin.from("subscriptions").insert({
      tenant_id: tenantId,
      plan_id: "standard",
      status: input.subStatus,
      stripe_customer_id: customerId,
      stripe_subscription_id: subId,
    });
    if (subError) throw new Error(subError.message);
    return { tenantId, subId, customerId };
  }

  it("DOWÓD (d): zmiana stanu u dostawcy BEZ zdarzenia → drift wykryty i naprawiony", async () => {
    // Projekcja i tenant mówią „active"; u dostawcy subskrypcja jest już
    // unpaid (webhook zgubiony). Rekoncyliacja ma to wykryć.
    const fixture = await seedSubscribedTenant({ tenantStatus: "active", subStatus: "active" });

    const result = await reconcileBilling({
      db: admin,
      readSubscription: async (subId) =>
        read({
          subscriptionId: subId,
          customerId: fixture.customerId,
          status: "unpaid",
          tenantIdFromMetadata: fixture.tenantId,
        }),
      limit: 500,
    });

    const entry = result.entries.find((e) => e.tenantId === fixture.tenantId);
    expect(entry?.outcome).toBe("drift-repaired");

    const { data: tenant } = await admin
      .from("tenants")
      .select("status, suspended_at")
      .eq("id", fixture.tenantId)
      .single();
    expect((tenant as { status: string }).status).toBe("suspended");
    expect((tenant as { suspended_at: string | null }).suspended_at).not.toBeNull();
    const { data: sub } = await admin
      .from("subscriptions")
      .select("status")
      .eq("tenant_id", fixture.tenantId)
      .single();
    expect((sub as { status: string }).status).toBe("unpaid");
  });

  it("bez driftu = no-op (pętla własna), nie zdarzenie", async () => {
    const fixture = await seedSubscribedTenant({ tenantStatus: "active", subStatus: "active" });
    const result = await reconcileBilling({
      db: admin,
      readSubscription: async (subId) =>
        read({
          subscriptionId: subId,
          customerId: fixture.customerId,
          status: "active",
          tenantIdFromMetadata: fixture.tenantId,
        }),
      limit: 500,
    });
    const entry = result.entries.find((e) => e.tenantId === fixture.tenantId);
    expect(entry?.outcome).toBe("ok");
  });

  it("rozjazd metadata↔projekcja = anomalia raportowana, stan NIEDOTKNIĘTY", async () => {
    const fixture = await seedSubscribedTenant({ tenantStatus: "active", subStatus: "active" });
    const result = await reconcileBilling({
      db: admin,
      readSubscription: async (subId) =>
        read({
          subscriptionId: subId,
          status: "unpaid",
          // Metadane wskazują KOGOŚ INNEGO niż wiersz projekcji.
          tenantIdFromMetadata: randomUUID(),
        }),
      limit: 500,
    });
    const entry = result.entries.find((e) => e.tenantId === fixture.tenantId);
    expect(entry?.outcome).toBe("failed");
    const { data: tenant } = await admin
      .from("tenants")
      .select("status")
      .eq("id", fixture.tenantId)
      .single();
    expect((tenant as { status: string }).status).toBe("active");
  });

  it("awaria odczytu jednej subskrypcji nie gasi pozostałych", async () => {
    const broken = await seedSubscribedTenant({ tenantStatus: "active", subStatus: "active" });
    const healthy = await seedSubscribedTenant({ tenantStatus: "active", subStatus: "active" });

    const result = await reconcileBilling({
      db: admin,
      readSubscription: async (subId) => {
        if (subId === broken.subId) throw new Error("dostawca niedostępny");
        return read({
          subscriptionId: subId,
          customerId: healthy.customerId,
          status: "past_due",
          tenantIdFromMetadata: healthy.tenantId,
        });
      },
      limit: 500,
    });

    expect(result.entries.find((e) => e.tenantId === broken.tenantId)?.outcome).toBe("failed");
    expect(result.entries.find((e) => e.tenantId === healthy.tenantId)?.outcome).toBe(
      "drift-repaired",
    );
    const { data: tenant } = await admin
      .from("tenants")
      .select("status")
      .eq("id", healthy.tenantId)
      .single();
    expect((tenant as { status: string }).status).toBe("past_due");
  });

  it("wiersz bez stripe_subscription_id (comp superadmina) poza pętlą", async () => {
    const slug = `brecc${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: "Comp test" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const tenantId = (data as { id: string }).id;
    createdTenantIds.push(tenantId);
    await admin
      .from("subscriptions")
      .insert({ tenant_id: tenantId, plan_id: "premium", status: "active" });

    const result = await reconcileBilling({
      db: admin,
      readSubscription: async () => {
        throw new Error("nie powinno być wołane dla wiersza bez sub_");
      },
      limit: 500,
    });
    expect(result.entries.find((e) => e.tenantId === tenantId)).toBeUndefined();
  });
});
