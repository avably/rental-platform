/**
 * ZERO EGZEKWOWANIA TRIALA (J2 faza 1, ADR-135) — test na żywym Supabase.
 *
 * Obietnica LP jest kontraktem: „trial 14 dni bez karty" i „po czternastu
 * dniach nic się samo nie zdarzy". Faza 1 daje zegar (tenants.trial_ends_at)
 * i ekran stanu — i NIC poza tym. Pułapka K3 ze spike'u J2 (guard triala
 * robiący pętlę i zamykający drogę do zapłaty) ma nie mieć prawa zaistnieć,
 * bo guarda NIE MA. Ten plik przypina to zachowanie:
 *
 *   1. tenant z trial_ends_at W PRZESZŁOŚCI przechodzi przez
 *      requireMemberWithClient jak dotąd (to jedyna bramka wszystkich tras
 *      panelu — strony przez requireMemberPage, akcje i handlery przez
 *      requireMember; obie owijki delegują do tego rdzenia),
 *   2. tor akcji działa: mutacja PO guardzie wchodzi do bazy (kontrast
 *      z suspended w auth.test.ts, gdzie identyczna próba jest ucinana),
 *   3. świeży tenant z app.create_tenant dostaje zegar (panelowa strona
 *      dowodu z 0066; sam kształt zegara pilnuje packages/db),
 *   4. izolacja: członek nie odczyta trial_ends_at CUDZEGO tenanta tą samą
 *      ścieżką, którą ekran /organizacja czyta własny.
 *
 * SYMULACJA REGRESJI PRZYSZŁOŚCI (dowód mutacyjny c): dopisanie do
 * requireMemberWithClient odmowy dla trialu w przeszłości pali punkty 1-2.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { requireMemberWithClient } from "@/lib/auth";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "TrialZeroTest!12345678";
const createdUserIds: string[] = [];

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

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}) failed: ${error.message}`);
  return client;
}

describe.skipIf(!hasEnv)("zero egzekwowania triala (J2 faza 1, ADR-135)", () => {
  const admin = hasEnv ? createAdminClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdUserIds.length = 0;
  });

  /** User + własny tenant przez app.create_tenant (produkcyjna ścieżka onboardingu). */
  async function createMemberWithTenant(label: string): Promise<{
    tenantId: string;
    client: SupabaseClient;
  }> {
    const email = `trialzero-${label}-${randomUUID()}@test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
    createdUserIds.push(data.user.id);

    const bootstrap = await signIn(email);
    const slug = `trialzero-${randomUUID()}`.slice(0, 39);
    const { data: tenantId, error: rpcError } = await rpcCreateTenant(bootstrap, {
      p_slug: slug,
      p_name: `Trial zero (${label})`,
    });
    if (rpcError) throw new Error(`create_tenant(${label}): ${rpcError.message}`);
    return { tenantId: tenantId as string, client: await signIn(email) };
  }

  it("świeży tenant z app.create_tenant ma zegar triala (trial_ends_at ustawione)", async () => {
    const member = await createMemberWithTenant("clock");
    const { data, error } = await admin
      .from("tenants")
      .select("trial_ends_at, created_at, status")
      .eq("id", member.tenantId)
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe("trialing");
    expect(data!.trial_ends_at).not.toBeNull();
    // Dokładnie +14 dni: obie wartości z now() tej samej transakcji.
    const deltaMs = new Date(data!.trial_ends_at!).getTime() - new Date(data!.created_at).getTime();
    expect(deltaMs).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("trial w przeszłości: guard przepuszcza, tor akcji pisze do bazy — jak dotąd", async () => {
    const member = await createMemberWithTenant("expired");

    // Zegar 30 dni w przeszłości; status zostaje 'trialing' (nic go nie zmienia).
    const { error: updateError } = await admin
      .from("tenants")
      .update({ trial_ends_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() })
      .eq("id", member.tenantId);
    expect(updateError).toBeNull();

    // 1. Jedyna bramka wszystkich tras panelu przepuszcza bez odmowy.
    const ctx = await requireMemberWithClient(member.client);
    expect(ctx.tenantId).toBe(member.tenantId);
    expect(ctx.tenantStatus).toBe("trialing");

    // 2. Tor akcji: mutacja PO guardzie WCHODZI (kontrast z suspended,
    //    gdzie identyczna próba w auth.test.ts kończy się odmową i zerem
    //    wierszy). Klasyfikacja po TRWAŁYM stanie, nie po braku błędu.
    const { error: insertError } = await ctx.supabase.from("customers").insert({
      tenant_id: ctx.tenantId,
      email: "klient-po-trialu@test.local",
    });
    expect(insertError).toBeNull();
    const { count } = await admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", member.tenantId);
    expect(count).toBe(1);
  });

  it("izolacja: członek nie odczyta trial_ends_at cudzego tenanta (ścieżka ekranu /organizacja)", async () => {
    const alice = await createMemberWithTenant("iso-a");
    const mallory = await createMemberWithTenant("iso-b");

    // Własny odczyt działa (to czyta ekran /organizacja)…
    const { data: own, error: ownError } = await alice.client
      .from("tenants")
      .select("trial_ends_at")
      .eq("id", alice.tenantId)
      .maybeSingle();
    expect(ownError).toBeNull();
    expect(own?.trial_ends_at).not.toBeNull();

    // …cudzy jest nieodróżnialny od nieistniejącego (RLS own_select).
    const { data: foreign, error: foreignError } = await mallory.client
      .from("tenants")
      .select("trial_ends_at")
      .eq("id", alice.tenantId)
      .maybeSingle();
    expect(foreignError).toBeNull();
    expect(foreign).toBeNull();
  });
});
