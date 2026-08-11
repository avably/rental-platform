/**
 * Zegar triala w app.create_tenant (migracja 0066, ADR-135 — J2 faza 1).
 *
 * Obietnica LP („trial 14 dni bez karty") dostaje w bazie JEDEN lokalny
 * zegar: tenants.trial_ends_at, ustawiany wyłącznie w app.create_tenant na
 * now() + 14 dni. Ten plik dowodzi czterech rzeczy:
 *
 *   1. świeży tenant ma trial_ends_at DOKŁADNIE created_at + 14 dni (obie
 *      wartości z now() tej samej transakcji — rozjazd oznacza, że zegar
 *      wyszedł poza transakcję albo ktoś liczy go drugi raz),
 *   2. zegar NICZEGO nie egzekwuje w SQL: trial_ends_at w przeszłości nie
 *      zmienia wyniku predykatu komercyjnego (ADR-134) — sklep tenanta
 *      'trialing' po dacie działa jak przed datą (kontrola pozytywna
 *      + kontrast z suspended),
 *   3. kolumna jest nullable Z KONSTRUKCJI: wiersz spoza app.create_tenant
 *      (service-role, np. fabryki RLS) nie ma zegara i to jest legalne,
 *   4. status świeżego tenanta to wciąż default 'trialing' — 0066 nie rusza
 *      statusów ani CHECK-ów (twarda granica fazy 1).
 *
 * DOWÓD MUTACYJNY (a): zdjęcie trial_ends_at z INSERT-u w create_tenant
 * (redefinicja funkcji bez zegara) pali punkt 1. Restore = aplikacja bloku
 * z PLIKU 0066.
 *
 * Wymaga lokalnego Supabase (SUPABASE_LOCAL_*); bez nich pomijany JAWNIE
 * (helpers/integration-env.ts).
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "TrialClockTest!12345678";
const createdUserIds: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const sql = hasEnv ? postgres(env("SUPABASE_LOCAL_URL"), { max: 1 }) : null;

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

/** Świeży, potwierdzony użytkownik zalogowany kluczem anon. */
async function signedInUser(admin: SupabaseClient): Promise<SupabaseClient> {
  const email = `trialclock-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  createdUserIds.push(data.user.id);

  const client = createAnonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);
  return client;
}

describe.skipIf(!hasEnv)("zegar triala — app.create_tenant (0066, ADR-135)", () => {
  const admin = hasEnv ? createAdminClient() : (null as unknown as SupabaseClient);
  const createdTenantIds: string[] = [];

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdUserIds.length > 0) {
      const rows = await sql!<{ tenant_id: string }[]>`
        select distinct tenant_id from public.members where user_id = any(${sql!.array(createdUserIds)}::uuid[])
      `;
      for (const id of [...new Set([...createdTenantIds, ...rows.map((r) => r.tenant_id)])]) {
        await admin.from("tenants").delete().eq("id", id);
      }
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdUserIds.length = 0;
    await sql?.end({ timeout: 5 });
  });

  async function createTenant(client: SupabaseClient): Promise<string> {
    const slug = `trialclock-${randomUUID()}`.slice(0, 39);
    const { data, error } = await client.schema("app").rpc("create_tenant", {
      p_slug: slug,
      p_name: "Trial clock test",
    });
    if (error) throw new Error(`create_tenant: ${error.message}`);
    const tenantId = data as string;
    createdTenantIds.push(tenantId);
    return tenantId;
  }

  it("świeży tenant: trial_ends_at = created_at + DOKŁADNIE 14 dni, status default 'trialing'", async () => {
    const client = await signedInUser(admin);
    const tenantId = await createTenant(client);

    const rows = await sql!<
      { status: string; exact_14: boolean; trial_ends_at: string | null }[]
    >`
      select status,
             trial_ends_at = created_at + interval '14 days' as exact_14,
             trial_ends_at
      from public.tenants where id = ${tenantId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trial_ends_at).not.toBeNull();
    expect(rows[0]!.exact_14).toBe(true);
    expect(rows[0]!.status).toBe("trialing");
  });

  it("zegar w przeszłości NIE zmienia decyzji komercyjnej (predykat ADR-134 czyta status, nie datę)", async () => {
    const client = await signedInUser(admin);
    const tenantId = await createTenant(client);

    // Publiczna powierzchnia PRZED przeterminowaniem…
    const before = await sql!<{ id: string | null }[]>`
      select app.resolve_tenant_by_slug((select slug from public.tenants where id = ${tenantId})) as id
    `;
    expect(before[0]!.id).toBe(tenantId);

    // …zegar 30 dni w przeszłości, status nietknięty…
    await sql!`
      update public.tenants
         set trial_ends_at = now() - interval '30 days'
       where id = ${tenantId}
    `;

    // …i publiczna powierzchnia PO: identyczna. Kontrast (kontrola, że ta
    // ścieżka w ogóle umie odmawiać): suspended gasi sklep.
    const after = await sql!<{ id: string | null }[]>`
      select app.resolve_tenant_by_slug((select slug from public.tenants where id = ${tenantId})) as id
    `;
    expect(after[0]!.id).toBe(tenantId);

    await sql!`update public.tenants set status = 'suspended' where id = ${tenantId}`;
    const suspended = await sql!<{ id: string | null }[]>`
      select app.resolve_tenant_by_slug((select slug from public.tenants where id = ${tenantId})) as id
    `;
    expect(suspended[0]!.id).toBeNull();
  });

  it("wiersz spoza app.create_tenant (service-role) legalnie nie ma zegara — kolumna nullable", async () => {
    const slug = `trialclock-sr-${randomUUID()}`.slice(0, 39);
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: "Trial clock service-role" })
      .select("id, trial_ends_at, status")
      .single();
    expect(error).toBeNull();
    createdTenantIds.push(data!.id);
    expect(data!.trial_ends_at).toBeNull();
    expect(data!.status).toBe("trialing");
  });
});
