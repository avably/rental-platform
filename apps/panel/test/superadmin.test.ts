/**
 * Testy integracyjne panelu superadmina (Zadanie 7) na żywym, lokalnym
 * Supabase. Wzorzec jak w test/auth.test.ts: describe.skipIf(!env), realne
 * logowanie, realne TOTP (bez mockowania aal2).
 *
 * Weryfikują to, co musi być prawdą NIEZALEŻNIE od kodu panelu — bo egzekwuje
 * to RLS, a nie guardy w Next.js:
 *   1. zwykły user nie odczyta cudzych tenantów ani dziennika i nie wykona
 *      RPC superadmina (nawet wołając je wprost, z pominięciem panelu),
 *   2. superadmin z aal2 blokuje/odblokowuje tenanta i zmienia plan,
 *   3. KAŻDA taka akcja zostawia wpis w audit_log (mutacja i audyt w jednej
 *      transakcji),
 *   4. audit_log jest append-only: nikt (też superadmin) nie zmieni ani nie
 *      usunie wpisu,
 *   5. wpisu audytu nie da się podpisać cudzym actor_user_id.
 */
import { createHmac, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { AuthError, requireSuperadminWithClient } from "@/lib/auth";

import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "SuperadminTest!12345678";
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

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

async function createUser(admin: SupabaseClient, label: string): Promise<{ id: string; email: string }> {
  const email = `sa-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

// TOTP (RFC 6238) — minimalna implementacja, wyłącznie po to, żeby REALNIE
// przejść wyzwanie MFA Supabase i dostać sesję aal2 (jak w test/auth.test.ts).
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value === -1) continue;
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function generateTotp(secretBase32: string): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (binCode % 1_000_000).toString().padStart(6, "0");
}

/** Podnosi sesję klienta do aal2: enroll + challenge + verify TOTP. */
async function stepUpToAal2(client: SupabaseClient): Promise<void> {
  const { data: enrollData, error: enrollError } = await client.auth.mfa.enroll({ factorType: "totp" });
  if (enrollError || !enrollData) throw new Error(`mfa.enroll: ${enrollError?.message}`);

  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
    factorId: enrollData.id,
  });
  if (challengeError || !challenge) throw new Error(`mfa.challenge: ${challengeError?.message}`);

  const { error: verifyError } = await client.auth.mfa.verify({
    factorId: enrollData.id,
    challengeId: challenge.id,
    code: generateTotp(enrollData.totp.secret),
  });
  if (verifyError) throw new Error(`mfa.verify: ${verifyError.message}`);
}

async function auditEntries(admin: SupabaseClient, tenantId: string) {
  const { data, error } = await admin
    .from("audit_log")
    .select("action, actor_user_id, details")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`odczyt audit_log: ${error.message}`);
  return data ?? [];
}

describe.skipIf(!hasEnv)("panel superadmina (RLS + audyt)", () => {
  let admin: SupabaseClient;
  let superadmin: { id: string; email: string };
  let superadminClient: SupabaseClient;
  let tenantOwner: { id: string; email: string };
  let tenantId: string;

  beforeAll(async () => {
    admin = createAdminClient();

    // Zwykły user z własną organizacją — obiekt akcji superadmina.
    tenantOwner = await createUser(admin, "owner");
    const ownerClient = await signIn(tenantOwner.email);
    const { data, error } = await ownerClient.schema("app").rpc("create_tenant", {
      p_slug: `sa-test-${randomUUID()}`.slice(0, 39),
      p_name: "Organizacja testowa superadmina",
    });
    if (error) throw new Error(`create_tenant: ${error.message}`);
    tenantId = data as string;
    createdTenantIds.push(tenantId);

    // Superadmin: wiersz w app.superadmins + świeża sesja (claim z hooka) + aal2.
    superadmin = await createUser(admin, "root");
    const { error: insertError } = await admin
      .schema("app")
      .from("superadmins")
      .insert({ user_id: superadmin.id });
    if (insertError) throw new Error(`insert app.superadmins: ${insertError.message}`);

    superadminClient = await signIn(superadmin.email);
    await stepUpToAal2(superadminClient);
  }, 60_000);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  }, 60_000);

  it("superadmin z aal2 przechodzi guard i widzi wszystkie organizacje", async () => {
    const ctx = await requireSuperadminWithClient(superadminClient);
    expect(ctx.superadmin).toBe(true);
    expect(ctx.aal).toBe("aal2");

    const { data, error } = await superadminClient.from("tenants").select("id");
    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.id as string)).toContain(tenantId);
  });

  it("zwykły user: guard 403 i RLS nie wpuszcza go do RPC superadmina", async () => {
    const client = await signIn(tenantOwner.email);

    await expect(requireSuperadminWithClient(client)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<AuthError>);

    // Wywołanie RPC z pominięciem panelu — bramką jest RLS, nie guard.
    const { error } = await client.schema("app").rpc("superadmin_lock_tenant", {
      p_tenant_id: tenantId,
      p_reason: "próba bez uprawnień",
    });
    expect(error, "RPC blokady wykonane przez zwykłego usera").not.toBeNull();

    const { data: tenant } = await client.from("tenants").select("status").eq("id", tenantId).single();
    expect(tenant?.status, "status organizacji zmieniony przez usera bez uprawnień").not.toBe(
      "superadmin_locked",
    );
  });

  it("blokada i odblokowanie: status wraca do stanu sprzed blokady, oba zdarzenia w audycie", async () => {
    const { data: before } = await admin
      .from("tenants")
      .select("status")
      .eq("id", tenantId)
      .single();
    const statusBefore = before?.status as string;

    const { error: lockError } = await superadminClient.schema("app").rpc("superadmin_lock_tenant", {
      p_tenant_id: tenantId,
      p_reason: "test blokady",
    });
    expect(lockError, `superadmin_lock_tenant: ${lockError?.message}`).toBeNull();

    const { data: locked } = await admin
      .from("tenants")
      .select("status, status_before_lock")
      .eq("id", tenantId)
      .single();
    expect(locked?.status).toBe("superadmin_locked");
    expect(locked?.status_before_lock).toBe(statusBefore);

    const { error: unlockError } = await superadminClient
      .schema("app")
      .rpc("superadmin_unlock_tenant", { p_tenant_id: tenantId });
    expect(unlockError, `superadmin_unlock_tenant: ${unlockError?.message}`).toBeNull();

    const { data: unlocked } = await admin
      .from("tenants")
      .select("status, status_before_lock")
      .eq("id", tenantId)
      .single();
    expect(unlocked?.status).toBe(statusBefore);
    expect(unlocked?.status_before_lock).toBeNull();

    const entries = await auditEntries(admin, tenantId);
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain("superadmin.tenant.lock");
    expect(actions).toContain("superadmin.tenant.unlock");
    expect(entries.every((entry) => entry.actor_user_id === superadmin.id)).toBe(true);
  });

  it("zmiana planu: zakłada subskrypcję, gdy jej nie ma, i pisze wpis do audytu", async () => {
    const { error } = await superadminClient.schema("app").rpc("superadmin_set_plan", {
      p_tenant_id: tenantId,
      p_plan_id: "pro",
    });
    expect(error, `superadmin_set_plan: ${error?.message}`).toBeNull();

    const { data: subscription } = await admin
      .from("subscriptions")
      .select("plan_id, status")
      .eq("tenant_id", tenantId)
      .single();
    expect(subscription?.plan_id).toBe("pro");

    const planEntries = (await auditEntries(admin, tenantId)).filter(
      (entry) => entry.action === "superadmin.tenant.plan",
    );
    expect(planEntries).toHaveLength(1);
    expect(planEntries[0]?.details).toMatchObject({ plan_po: "pro" });
  });

  it("podgląd tenanta: wejście i wyjście zapisane w dzienniku", async () => {
    for (const action of ["superadmin.tenant.view.start", "superadmin.tenant.view.end"]) {
      const { error } = await superadminClient.schema("app").rpc("superadmin_log", {
        p_tenant_id: tenantId,
        p_action: action,
        p_details: {},
      });
      expect(error, `superadmin_log(${action}): ${error?.message}`).toBeNull();
    }

    const actions = (await auditEntries(admin, tenantId)).map((entry) => entry.action);
    expect(actions).toContain("superadmin.tenant.view.start");
    expect(actions).toContain("superadmin.tenant.view.end");
  });

  it("superadmin_log nie przyjmuje dowolnej akcji (whitelista)", async () => {
    const { error } = await superadminClient.schema("app").rpc("superadmin_log", {
      p_tenant_id: tenantId,
      p_action: "superadmin.tenant.lock",
      p_details: {},
    });
    expect(error, "RPC audytu przyjęło akcję spoza whitelisty").not.toBeNull();
  });

  it("audit_log jest append-only i nie da się podpisać wpisu cudzym actor_user_id", async () => {
    // Podszycie się pod innego wykonawcę — polityka wymaga actor_user_id = auth.uid().
    const { error: forgeError } = await superadminClient.from("audit_log").insert({
      tenant_id: tenantId,
      actor_user_id: tenantOwner.id,
      action: "superadmin.forged",
      subject: tenantId,
    });
    expect(forgeError?.code, "wpis audytu podpisany cudzym actor_user_id").toBe("42501");

    // Zacieranie śladów: UPDATE i DELETE na dzienniku (brak polityk i GRANT-ów).
    const before = await auditEntries(admin, tenantId);

    await superadminClient.from("audit_log").update({ action: "zatarte" }).eq("tenant_id", tenantId);
    await superadminClient.from("audit_log").delete().eq("tenant_id", tenantId);

    expect(
      await auditEntries(admin, tenantId),
      "superadmin zmienił lub usunął wpisy w dzienniku — audyt nie jest append-only",
    ).toEqual(before);
  });
});
