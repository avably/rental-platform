/**
 * R17 / migracja 0064 (ADR-132) — domknięcie zapisu public.subscriptions.
 *
 * Czego dowodzi ten plik:
 *   1. owner WŁASNEGO tenanta nie wstawi, nie zmieni i nie skasuje
 *      subskrypcji (przed 0064 surowy INSERT przez PostgREST ustawiał
 *      plan 'max' + status 'active' bez superadmina i bez płatności);
 *   2. owner CUDZEGO tenanta odbija się tak samo (kontrola izolacji —
 *      0064 niczego w niej nie poluzowało);
 *   3. service_role przechodzi (ścieżka przyszłego webhooka billingu);
 *   4. superadmin przechodzi ZAPROJEKTOWANĄ ścieżką app.superadmin_set_plan
 *      i zostawia wpis w audit_log;
 *   5. nie-superadmin wołający RPC dostaje odmowę Z JAWNEJ BRAMKI
 *      (42501, 'Brak uprawnień superadmina.'), a NIE — jak przed 0064 —
 *      z RLS audit_log na końcu funkcji, już po zapisie subskrypcji.
 *
 * KLUCZOWE dla wiarygodności: każda odmowa jest klasyfikowana PO ODCZYCIE
 * TRWAŁEGO STANU klientem service-role (omija RLS), nie po samym kodzie
 * błędu — trigger/CHECK potrafi oddać inny kod i zamaskować dziurę
 * fałszywą zielenią. Sonda „gołego" UPDATE bez WHERE idzie bezpośrednim
 * połączeniem Postgres (jak w rls-isolation.test.ts), bo ścieżka PostgREST
 * z filtrem angażuje politykę SELECT i nie widzi zepsutej polityki UPDATE.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";
import { cleanupSeeded, createAdminClient, seedTwoTenants, type TenantCtx } from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const PG_INSUFFICIENT_PRIVILEGE = "42501";
// Komunikat jawnej bramki z 0064 — asercja na TREŚĆ, nie tylko kod:
// 42501 potrafi też przyjść z RLS (np. audit_log), a cały sens R17 polega
// na tym, że odmowa pochodzi z zaprojektowanej bramki, nie z przypadku.
const GATE_MESSAGE = "Brak uprawnień superadmina";

// Plany z katalogu 0004 — zasiew idempotentny, obecny na każdej bazie
// po migracjach; test nie tworzy własnego planu, żeby nie dublować
// współdzielonego wiersza 'rls-test-plan' z harnessu macierzy.
const PLAN_A = "start";
const PLAN_B = "pro";

const TEST_PASSWORD = "RlsTest!12345678";
const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

describe.skipIf(!hasEnv)("R17: domknięcie zapisu subscriptions (0064)", () => {
  let admin: SupabaseClient;
  let sql: ReturnType<typeof postgres>;
  let a: TenantCtx;
  let b: TenantCtx;
  let superadminClient: SupabaseClient;
  let superadminUserId: string;
  const extraUserIds: string[] = [];

  beforeAll(async () => {
    admin = createAdminClient();
    sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    ({ a, b } = await seedTwoTenants());

    // Superadmin: wiersz w app.superadmins PRZED logowaniem — claim wchodzi
    // do JWT przez custom_access_token (0003), a predykat LIVE
    // app.is_current_superadmin() i tak pyta tabelę przy każdym wywołaniu.
    const email = `r17-super-${randomUUID()}@test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser(superadmin): ${error?.message}`);
    superadminUserId = data.user.id;
    extraUserIds.push(superadminUserId);
    await sql`insert into app.superadmins (user_id) values (${superadminUserId})`;

    superadminClient = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...realtimeTransport,
    });
    const { error: signInError } = await superadminClient.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    if (signInError) throw new Error(`signIn(superadmin): ${signInError.message}`);
  }, 60_000);

  afterEach(async () => {
    // Każdy test zaczyna od czystego stanu subskrypcji obu tenantów —
    // wiersze zasiane w teście albo (przy regresji) wstawione przez atak
    // nie mogą przeciekać do następnego przypadku.
    const { error } = await admin
      .from("subscriptions")
      .delete()
      .in("tenant_id", [a.tenantId, b.tenantId]);
    if (error) throw new Error(`Czyszczenie subscriptions: ${error.message}`);
  });

  afterAll(async () => {
    await sql`delete from public.audit_log where subject in (${a.tenantId}, ${b.tenantId})`;
    await sql`delete from app.superadmins where user_id = ${superadminUserId}`;
    for (const id of extraUserIds) await admin.auth.admin.deleteUser(id);
    await cleanupSeeded(admin);
    await sql.end({ timeout: 5 });
  }, 60_000);

  /** Trwały stan subskrypcji tenanta — odczyt service-role (omija RLS). */
  async function subscriptionState(
    tenantId: string,
  ): Promise<{ plan_id: string; status: string }[]> {
    const { data, error } = await admin
      .from("subscriptions")
      .select("plan_id, status")
      .eq("tenant_id", tenantId);
    if (error) throw new Error(`Odczyt stanu subscriptions: ${error.message}`);
    return data ?? [];
  }

  async function seedSubscription(tenantId: string): Promise<void> {
    const { error } = await admin
      .from("subscriptions")
      .insert({ tenant_id: tenantId, plan_id: PLAN_A, status: "trialing" });
    if (error) throw new Error(`Zasiew subscriptions: ${error.message}`);
  }

  // --- 1. Owner własnego tenanta: zapis odebrany ---

  it("owner NIE wstawi subskrypcji własnemu tenantowi (42501; wiersz nie powstaje)", async () => {
    const { error } = await a.ownerClient
      .from("subscriptions")
      .insert({ tenant_id: a.tenantId, plan_id: "max", status: "active" });
    expect(error, "INSERT ownera powinien zostać odrzucony").not.toBeNull();
    expect(
      error?.code,
      `odmowa powinna pochodzić z RLS/GRANT (42501): ${error?.message}`,
    ).toBe(PG_INSUFFICIENT_PRIVILEGE);
    expect(
      await subscriptionState(a.tenantId),
      "mimo odmowy w bazie stoi wiersz subskrypcji — wektor R17 otwarty",
    ).toEqual([]);
  });

  it("owner NIE zmieni własnej subskrypcji przez PostgREST (stan nietknięty)", async () => {
    await seedSubscription(a.tenantId);
    // Z grantem UPDATE i bez polityki PostgREST oddaje sukces na 0 wierszach
    // — dlatego jedyną uczciwą asercją jest odczyt trwałego stanu.
    await a.ownerClient
      .from("subscriptions")
      .update({ plan_id: "max", status: "active" })
      .eq("tenant_id", a.tenantId);
    expect(
      await subscriptionState(a.tenantId),
      "owner podniósł sobie plan przez PostgREST — wektor R17 otwarty",
    ).toEqual([{ plan_id: PLAN_A, status: "trialing" }]);
  });

  it("owner NIE zmieni własnej subskrypcji gołym UPDATE bez WHERE (rola authenticated)", async () => {
    await seedSubscription(a.tenantId);
    // Bez WHERE polityka SELECT nie maskuje braku polityki UPDATE — o
    // zasięgu decyduje wyłącznie USING (wzorzec z rls-isolation.test.ts).
    const jwt = JSON.stringify({
      sub: a.ownerUserId,
      role: "authenticated",
      app_metadata: { tenant_id: a.tenantId, role: "owner" },
    });
    let stateDuringProbe: { plan_id: string; status: string }[] = [];
    class Rollback extends Error {}
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${jwt}, true)`;
        await tx`set local role authenticated`;
        await tx`update public.subscriptions set plan_id = 'max', status = 'active'`;
        await tx`reset role`;
        stateDuringProbe = await tx<{ plan_id: string; status: string }[]>`
          select plan_id, status from public.subscriptions where tenant_id = ${a.tenantId}
        `;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(
      stateDuringProbe,
      "goła mutacja ownera dosięgła własnej subskrypcji — brak polityki nie chroni",
    ).toEqual([{ plan_id: PLAN_A, status: "trialing" }]);
  });

  it("owner NIE skasuje własnej subskrypcji (42501 z odebranego GRANT-u; wiersz zostaje)", async () => {
    await seedSubscription(a.tenantId);
    const { error } = await a.ownerClient
      .from("subscriptions")
      .delete()
      .eq("tenant_id", a.tenantId);
    expect(error, "DELETE ownera powinien zostać odrzucony").not.toBeNull();
    expect(
      error?.code,
      `0064 odebrało authenticated GRANT delete — oczekiwano 42501: ${error?.message}`,
    ).toBe(PG_INSUFFICIENT_PRIVILEGE);
    expect(await subscriptionState(a.tenantId), "wiersz subskrypcji zniknął").toEqual([
      { plan_id: PLAN_A, status: "trialing" },
    ]);
  });

  // --- 2. Kontrola izolacji: owner cudzego tenanta ---

  it("owner tenanta A nie wstawi ani nie zmieni subskrypcji tenanta B", async () => {
    const { error: insertError } = await a.ownerClient
      .from("subscriptions")
      .insert({ tenant_id: b.tenantId, plan_id: "max", status: "active" });
    expect(insertError?.code, `INSERT cross-tenant: ${insertError?.message}`).toBe(
      PG_INSUFFICIENT_PRIVILEGE,
    );
    expect(await subscriptionState(b.tenantId), "cross-tenant INSERT przeszedł").toEqual([]);

    await seedSubscription(b.tenantId);
    await a.ownerClient
      .from("subscriptions")
      .update({ plan_id: "max", status: "active" })
      .eq("tenant_id", b.tenantId);
    expect(
      await subscriptionState(b.tenantId),
      "cross-tenant UPDATE zmienił stan tenanta B — wyciek izolacji",
    ).toEqual([{ plan_id: PLAN_A, status: "trialing" }]);
  });

  // --- 3. service_role — ścieżka przyszłego webhooka ---

  it("service_role wstawia i aktualizuje subskrypcję (ścieżka webhooka billingu)", async () => {
    const { error: insertError } = await admin
      .from("subscriptions")
      .insert({ tenant_id: a.tenantId, plan_id: PLAN_A, status: "trialing" });
    expect(insertError, `INSERT service_role: ${insertError?.message}`).toBeNull();

    const { error: updateError } = await admin
      .from("subscriptions")
      .update({ plan_id: PLAN_B, status: "active" })
      .eq("tenant_id", a.tenantId);
    expect(updateError, `UPDATE service_role: ${updateError?.message}`).toBeNull();
    expect(await subscriptionState(a.tenantId)).toEqual([{ plan_id: PLAN_B, status: "active" }]);
  });

  // --- 4. Superadmin — zaprojektowana ścieżka ---

  it("superadmin ustawia plan przez app.superadmin_set_plan i zostawia ślad w audit_log", async () => {
    const { error } = await superadminClient.schema("app").rpc("superadmin_set_plan", {
      p_tenant_id: a.tenantId,
      p_plan_id: PLAN_B,
    });
    expect(error, `superadmin_set_plan: ${error?.message}`).toBeNull();
    expect(await subscriptionState(a.tenantId)).toEqual([{ plan_id: PLAN_B, status: "active" }]);

    const auditRows = await sql<{ action: string }[]>`
      select action from public.audit_log
      where subject = ${a.tenantId} and action = 'superadmin.tenant.plan'
    `;
    expect(auditRows.length, "brak wpisu audytu po zmianie planu").toBeGreaterThan(0);
  });

  it("polityki superadmin_insert/superadmin_update przeżyły drop polityk ownera (bezpośredni UPDATE)", async () => {
    await seedSubscription(a.tenantId);
    // Ścieżka ręcznej korekty z 0004 — superadmin zwykłą sesją, bramką RLS.
    const { error } = await superadminClient
      .from("subscriptions")
      .update({ status: "active" })
      .eq("tenant_id", a.tenantId);
    expect(error, `UPDATE superadmina: ${error?.message}`).toBeNull();
    expect(await subscriptionState(a.tenantId)).toEqual([{ plan_id: PLAN_A, status: "active" }]);
  });

  // --- 5. Sonda negatywna: odmowa Z BRAMKI, nie z RLS audit_log ---

  it("nie-superadmin dostaje odmowę z JAWNEJ BRAMKI (42501 + komunikat), stan nietknięty", async () => {
    const { error } = await a.ownerClient.schema("app").rpc("superadmin_set_plan", {
      p_tenant_id: a.tenantId,
      p_plan_id: "max",
    });
    expect(error, "RPC dla nie-superadmina powinno odmówić").not.toBeNull();
    expect(error?.code, `oczekiwano 42501 z bramki: ${error?.message}`).toBe(
      PG_INSUFFICIENT_PRIVILEGE,
    );
    // Sedno R17: odmowa jest ZAPROJEKTOWANA. Przed 0064 wyjątek przychodził
    // z RLS audit_log ('new row violates row-level security policy for table
    // "audit_log"') już PO zapisie subskrypcji — asercja na treść komunikatu
    // odróżnia bramkę od tamtej przypadkowej ochrony. Dowód mutacyjny:
    // przywrócenie definicji funkcji bez bramki pali ten test.
    expect(
      error?.message,
      "odmowa nie pochodzi z jawnej bramki superadmina",
    ).toContain(GATE_MESSAGE);
    expect(
      error?.message,
      "odmowa oparła się o RLS audit_log — ochrona znów przypadkowa",
    ).not.toMatch(/audit_log/);
    expect(
      await subscriptionState(a.tenantId),
      "RPC bez uprawnień zostawiło wiersz subskrypcji",
    ).toEqual([]);
  });

  it("anon w ogóle nie wykona superadmin_set_plan (brak EXECUTE po zdjęciu PUBLIC)", async () => {
    const anonClient = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...realtimeTransport,
    });
    const { error } = await anonClient.schema("app").rpc("superadmin_set_plan", {
      p_tenant_id: a.tenantId,
      p_plan_id: "max",
    });
    expect(error, "anon nie powinien wykonać RPC").not.toBeNull();
    expect(error?.code, `oczekiwano odmowy uprawnień: ${error?.message}`).toBe(
      PG_INSUFFICIENT_PRIVILEGE,
    );
    expect(await subscriptionState(a.tenantId)).toEqual([]);
  });
});
