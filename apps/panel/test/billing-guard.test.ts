/**
 * Guard akcji rozliczeń + rdzeń checkoutu (J2 faza 2a, ADR-136) na ŻYWYM
 * lokalnym Supabase.
 *
 * K1 — sedno guardu: `suspended` PRZECHODZI (właśnie po to guard istnieje —
 * zawieszony właściciel MUSI mieć jak zapłacić; zapłata wraca do active
 * natychmiast, zasada 5), a `superadmin_locked` i `cancelled` odpadają
 * (blokada platformowa nie jest stanem rozliczeniowym; checkout w locku
 * byłby pobraniem pieniędzy bez zwrotu dostępu). Staff odpada zawsze —
 * abonament podpisuje właściciel.
 *
 * W6 — rdzeń checkoutu z wstrzykniętym klientem rozliczeń:
 *   * żywa subskrypcja w PROJEKCJI → odmowa bez jednego wywołania dostawcy,
 *   * żywa subskrypcja U DOSTAWCY (projekcja pusta — okno K3 po powrocie
 *     z Checkoutu) → odmowa,
 *   * otwarte sesje Checkoutu wygaszane PRZED utworzeniem nowej,
 *   * dwuklik/wyścig tego samego zamiaru → TEN SAM Idempotency-Key
 *     (dostawca odtwarza pierwotną sesję — dwie karty nie robią dwóch
 *     subskrypcji), klucz z zamiaru, nie z losowości.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/lib/auth";
import {
  startSaasCheckout,
  type BillingCheckoutClient,
  type StartSaasCheckoutInput,
} from "@/lib/billing-checkout";
import { BILLING_CLOSED_STATUSES, requireBillingOwnerWithClient } from "@/lib/billing-guard";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "BillingGuardTest!12345678";

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

function createAdminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

function createAnonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}) failed: ${error.message}`);
  return client;
}

describe.skipIf(!hasEnv)("guard rozliczeń + rdzeń checkoutu — ADR-136", () => {
  const admin = hasEnv ? createAdminClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  async function createUser(label: string): Promise<{ userId: string; email: string }> {
    const email = `billguard-${label}-${randomUUID()}@test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
    createdUserIds.push(data.user.id);
    return { userId: data.user.id, email };
  }

  /** Owner + tenant produkcyjną ścieżką (app.create_tenant). */
  async function createOwnerWithTenant(label: string): Promise<{
    tenantId: string;
    ownerEmail: string;
  }> {
    const { email } = await createUser(label);
    const bootstrap = await signIn(email);
    const slug = `billg${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const { data: tenantId, error } = await rpcCreateTenant(bootstrap, {
      p_slug: slug,
      p_name: `Billing guard (${label})`,
    });
    if (error) throw new Error(`create_tenant(${label}): ${error.message}`);
    createdTenantIds.push(tenantId as string);
    return { tenantId: tenantId as string, ownerEmail: email };
  }

  async function setTenantStatus(tenantId: string, status: string): Promise<void> {
    const { error } = await admin.from("tenants").update({ status }).eq("id", tenantId);
    if (error) throw new Error(error.message);
  }

  it("owner przechodzi dla trialing / past_due / SUSPENDED (K1 — droga zapłaty)", async () => {
    const { tenantId, ownerEmail } = await createOwnerWithTenant("open");
    for (const status of ["trialing", "past_due", "suspended"]) {
      await setTenantStatus(tenantId, status);
      const ctx = await requireBillingOwnerWithClient(await signIn(ownerEmail));
      expect(ctx.tenantId, status).toBe(tenantId);
      expect(ctx.tenantStatus, status).toBe(status);
      expect(ctx.role, status).toBe("owner");
    }
  });

  it("cancelled i superadmin_locked odpadają — zbiór zamknięty guardu", async () => {
    const { tenantId, ownerEmail } = await createOwnerWithTenant("closed");
    for (const status of BILLING_CLOSED_STATUSES) {
      await setTenantStatus(tenantId, status);
      const client = await signIn(ownerEmail);
      await expect(requireBillingOwnerWithClient(client)).rejects.toMatchObject({
        name: "AuthError",
        status: 403,
      });
    }
  });

  it("staff odpada — abonament podpisuje właściciel", async () => {
    const { tenantId } = await createOwnerWithTenant("staffcase");
    const staff = await createUser("staff");
    const { error } = await admin
      .from("members")
      .insert({ tenant_id: tenantId, user_id: staff.userId, role: "staff" });
    expect(error).toBeNull();
    const client = await signIn(staff.email);
    await expect(requireBillingOwnerWithClient(client)).rejects.toThrowError(AuthError);
  });

  it("anonim → 401", async () => {
    await expect(requireBillingOwnerWithClient(createAnonClient())).rejects.toMatchObject({
      status: 401,
    });
  });

  // ------------------------------------------------------------------
  // Rdzeń checkoutu (W6) — wstrzyknięty klient rozliczeń
  // ------------------------------------------------------------------

  interface FakeBilling extends BillingCheckoutClient {
    calls: { method: string; args: unknown[] }[];
  }

  function fakeBilling(
    overrides: Partial<BillingCheckoutClient> = {},
  ): FakeBilling {
    const calls: { method: string; args: unknown[] }[] = [];
    const record =
      <T>(method: string, impl: (...args: never[]) => Promise<T>) =>
      async (...args: never[]) => {
        calls.push({ method, args });
        return impl(...args);
      };
    return {
      calls,
      findCustomerByTenant: record("findCustomerByTenant", async () => null),
      createCustomer: record("createCustomer", async () => "cus_fake"),
      listSubscriptions: record("listSubscriptions", async () => []),
      listOpenCheckoutSessionIds: record("listOpenCheckoutSessionIds", async () => []),
      expireCheckoutSession: record("expireCheckoutSession", async () => undefined),
      findPriceIdByLookupKey: record("findPriceIdByLookupKey", async () => "price_fake"),
      createSubscriptionCheckoutSession: record(
        "createSubscriptionCheckoutSession",
        async () => ({ sessionId: "cs_fake", url: "https://checkout.stripe.com/c/pay/cs_fake" }),
      ),
      ...overrides,
    };
  }

  function checkoutInput(tenantId: string): StartSaasCheckoutInput {
    return {
      tenantId,
      userEmail: "owner@test.local",
      planId: "standard",
      interval: "monthly",
      locale: "pl",
      successUrl: "https://panel.test/pl/organizacja?checkout=sukces",
      cancelUrl: "https://panel.test/pl/organizacja?checkout=anulowano",
    };
  }

  it("żywa subskrypcja w PROJEKCJI → odmowa bez wywołań dostawcy", async () => {
    const { tenantId, ownerEmail } = await createOwnerWithTenant("proj");
    const { error } = await admin.from("subscriptions").insert({
      tenant_id: tenantId,
      plan_id: "standard",
      status: "active",
      stripe_customer_id: `cus_proj_${randomUUID().slice(0, 8)}`,
      stripe_subscription_id: `sub_proj_${randomUUID().slice(0, 8)}`,
    });
    expect(error).toBeNull();

    const billing = fakeBilling();
    const outcome = await startSaasCheckout(
      { supabase: await signIn(ownerEmail), billing },
      checkoutInput(tenantId),
    );
    expect(outcome).toMatchObject({ error: expect.stringContaining("aktywną subskrypcję") });
    expect(billing.calls).toHaveLength(0);
  });

  it("żywa subskrypcja U DOSTAWCY przy pustej projekcji (okno K3) → odmowa", async () => {
    const { tenantId, ownerEmail } = await createOwnerWithTenant("k3");
    const billing = fakeBilling({
      findCustomerByTenant: async () => "cus_istnieje",
      listSubscriptions: async () => [{ id: "sub_zywa", status: "active" }],
    });
    const outcome = await startSaasCheckout(
      { supabase: await signIn(ownerEmail), billing },
      checkoutInput(tenantId),
    );
    expect(outcome).toMatchObject({ error: expect.stringContaining("aktywną subskrypcję") });
    expect(
      billing.calls.map((c) => c.method),
    ).not.toContain("createSubscriptionCheckoutSession");
  });

  it("otwarte sesje Checkoutu wygaszane PRZED nową (dwie karty ≠ dwie sesje)", async () => {
    const { tenantId, ownerEmail } = await createOwnerWithTenant("expire");
    const billing = fakeBilling({
      findCustomerByTenant: async () => "cus_expire",
      listOpenCheckoutSessionIds: async () => ["cs_stara_1", "cs_stara_2"],
    });
    const outcome = await startSaasCheckout(
      { supabase: await signIn(ownerEmail), billing },
      checkoutInput(tenantId),
    );
    expect(outcome).toHaveProperty("url");
    const methods = billing.calls.map((c) => c.method);
    const expireCalls = billing.calls.filter((c) => c.method === "expireCheckoutSession");
    expect(expireCalls.map((c) => c.args[0])).toEqual(["cs_stara_1", "cs_stara_2"]);
    expect(methods.indexOf("expireCheckoutSession")).toBeLessThan(
      methods.indexOf("createSubscriptionCheckoutSession"),
    );
  });

  it("WYŚCIG dwukliku: ten sam zamiar = TEN SAM Idempotency-Key (W6)", async () => {
    const { tenantId, ownerEmail } = await createOwnerWithTenant("race");
    const billing = fakeBilling({ findCustomerByTenant: async () => "cus_race" });
    const supabase = await signIn(ownerEmail);

    const [first, second] = await Promise.all([
      startSaasCheckout({ supabase, billing }, checkoutInput(tenantId)),
      startSaasCheckout({ supabase, billing }, checkoutInput(tenantId)),
    ]);
    expect(first).toHaveProperty("url");
    expect(second).toHaveProperty("url");

    const sessionCalls = billing.calls.filter(
      (c) => c.method === "createSubscriptionCheckoutSession",
    );
    expect(sessionCalls).toHaveLength(2);
    const keys = sessionCalls.map(
      (c) => (c.args[0] as { idempotencyKey: string }).idempotencyKey,
    );
    // Klucz z ZAMIARU: obie próby identyczne → dostawca odtwarza pierwotną
    // sesję zamiast tworzyć drugą (pamięta klucz ~24 h).
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(`saas-checkout-${tenantId}-standard-monthly`);

    // Klucz customera też deterministyczny (K2).
    const customerCalls = billing.calls.filter((c) => c.method === "createCustomer");
    for (const call of customerCalls) {
      expect((call.args[0] as { idempotencyKey: string }).idempotencyKey).toBe(
        `saas-customer-${tenantId}`,
      );
    }
  });

  it("inny zamiar = inny klucz (zmiana planu w 24h nie dostaje starej sesji)", async () => {
    const { tenantId, ownerEmail } = await createOwnerWithTenant("intent");
    const billing = fakeBilling({ findCustomerByTenant: async () => "cus_intent" });
    const supabase = await signIn(ownerEmail);

    await startSaasCheckout({ supabase, billing }, checkoutInput(tenantId));
    await startSaasCheckout(
      { supabase, billing },
      { ...checkoutInput(tenantId), planId: "premium", interval: "yearly" },
    );
    const keys = billing.calls
      .filter((c) => c.method === "createSubscriptionCheckoutSession")
      .map((c) => (c.args[0] as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("cena resolwowana po lookup_key zamiaru — zero kwot w ścieżce", async () => {
    const { tenantId, ownerEmail } = await createOwnerWithTenant("lookup");
    const lookupSpy = vi.fn(async () => "price_l");
    const billing = fakeBilling({ findPriceIdByLookupKey: lookupSpy });
    await startSaasCheckout(
      { supabase: await signIn(ownerEmail), billing },
      { ...checkoutInput(tenantId), planId: "premium", interval: "yearly" },
    );
    expect(lookupSpy).toHaveBeenCalledWith("saas_premium_yearly");
  });
});
