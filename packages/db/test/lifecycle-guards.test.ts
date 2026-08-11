/**
 * Ścieżki wygaszania cyklu życia w BAZIE (L4, migracja 0051_lifecycle_paths.sql):
 *
 *   1. guard ostatniego ownera — `public.members` nie może zostać bez ownera,
 *      egzekwowane triggerem, więc surowe API na kluczu użytkownika (z pominięciem
 *      server action) też się o niego rozbija;
 *   2. odwołanie zaproszenia — `invitations.revoked_at` i, co ważniejsze,
 *      `app.accept_invitation` ODRZUCAJĄCE odwołany token. Kolumna bez zmiany RPC
 *      byłaby „odwołaniem, które nie odwołuje".
 *
 * Testy są celowo prowadzone DWOMA kanałami: PostgREST (tak wchodzi panel)
 * i gołym SQL-em w kontekście roli `authenticated` z podstawionym claimem JWT
 * (tak wszedłby ktoś z samym kluczem anon i tokenem użytkownika). Guard, który
 * broni tylko pierwszego kanału, nie jest guardem.
 *
 * Wymaga uruchomionego lokalnego Supabase — jak test/auth-hook.test.ts.
 */
import { randomBytes, createHash, randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import { rpcCreateTenant } from "./helpers/create-tenant";
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

const TEST_PASSWORD = "LifecycleTest!12345678";
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

async function createConfirmedUser(
  admin: SupabaseClient,
  label: string,
): Promise<{ id: string; email: string }> {
  const email = `lifecycle-${label}-${randomUUID()}@test.local`;
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
  const { data, error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error || !data.session) throw new Error(`signIn(${email}): ${error?.message}`);
  return client;
}

/** Tenant z ownerem — ścieżką produkcyjną (app.create_tenant), nie insertem. */
async function createTenantWithOwner(
  admin: SupabaseClient,
  label: string,
): Promise<{ tenantId: string; owner: { id: string; email: string }; ownerClient: SupabaseClient }> {
  const owner = await createConfirmedUser(admin, label);
  const bootstrapClient = await signIn(owner.email);
  const { data: tenantId, error } = await rpcCreateTenant(bootstrapClient, {
    p_slug: `lifecycle-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Lifecycle ${label}`,
  });
  if (error || !tenantId) throw new Error(`create_tenant(${label}): ${error?.message}`);
  createdTenantIds.push(tenantId as string);
  // Ponowne logowanie: claim tenant_id wchodzi do JWT dopiero przy wydaniu
  // nowego tokenu (hook custom_access_token).
  return { tenantId: tenantId as string, owner, ownerClient: await signIn(owner.email) };
}

/** Dokłada członka do tenanta service-rolem (omija RLS — to jest seed, nie test). */
async function addMember(
  admin: SupabaseClient,
  tenantId: string,
  label: string,
  role: "owner" | "staff",
): Promise<{ id: string; email: string }> {
  const user = await createConfirmedUser(admin, label);
  const { error } = await admin.from("members").insert({
    tenant_id: tenantId,
    user_id: user.id,
    role,
  });
  if (error) throw new Error(`insert members(${label}): ${error.message}`);
  return user;
}

/** Zaproszenie z surowym tokenem (hash liczony tak samo jak w panelu). */
async function seedInvitation(
  admin: SupabaseClient,
  tenantId: string,
  email: string,
  patch: Record<string, unknown> = {},
): Promise<{ id: string; rawToken: string }> {
  const rawToken = randomBytes(32).toString("hex");
  const { data, error } = await admin
    .from("invitations")
    .insert({
      tenant_id: tenantId,
      email,
      role: "staff",
      token_hash: createHash("sha256").update(rawToken).digest("hex"),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ...patch,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insert invitations: ${error?.message}`);
  return { id: data.id as string, rawToken };
}

describe.skipIf(!hasEnv)("ścieżki wygaszania w bazie (0051_lifecycle_paths.sql)", () => {
  let admin: SupabaseClient;
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    admin = createAdminClient();
    sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
  });

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", id);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdTenantIds.length = 0;
    createdUserIds.length = 0;
    await sql.end({ timeout: 5 });
  });

  /**
   * Goła mutacja w kontekście konkretnego użytkownika: rola `authenticated`
   * + claim JWT podstawiony ręcznie. Tak wygląda żądanie kogoś, kto ma sam
   * token i klucz anon — bez naszego kodu serwerowego po drodze.
   */
  async function asUser<T>(
    claims: { sub: string; tenantId: string; role: "owner" | "staff" },
    run: (tx: ReturnType<typeof postgres>) => Promise<T>,
  ): Promise<{ value?: T; errorCode?: string; errorMessage?: string }> {
    const jwt = JSON.stringify({
      sub: claims.sub,
      role: "authenticated",
      app_metadata: { tenant_id: claims.tenantId, role: claims.role },
    });
    try {
      const value = await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${jwt}, true)`;
        await tx`set local role authenticated`;
        return await run(tx);
      });
      return { value: value as T };
    } catch (error) {
      const err = error as { code?: string; message?: string };
      return { errorCode: err.code, errorMessage: err.message };
    }
  }

  // -------------------------------------------------------------------
  // 1. Guard ostatniego ownera
  // -------------------------------------------------------------------

  it("nie pozwala usunąć OSTATNIEGO ownera — surowym zapytaniem, z pominięciem server action", async () => {
    const { tenantId, owner } = await createTenantWithOwner(admin, "last-owner");

    const result = await asUser({ sub: owner.id, tenantId, role: "owner" }, async (tx) => {
      await tx`delete from public.members where tenant_id = ${tenantId} and user_id = ${owner.id}`;
    });

    expect(
      result.errorCode,
      `usunięcie ostatniego ownera powinno zostać odrzucone przez bazę, a nie przejść: ${result.errorMessage}`,
    ).toBe("23514");

    // Stan po próbie, nie sam kod błędu: wiersz MUSI dalej istnieć.
    const { data: rows } = await admin
      .from("members")
      .select("user_id, role")
      .eq("tenant_id", tenantId);
    expect(rows).toHaveLength(1);
    expect((rows ?? [])[0]?.role).toBe("owner");
  });

  it("pozwala usunąć ownera, gdy tenant ma drugiego — i blokuje dopiero tego ostatniego", async () => {
    const { tenantId, owner } = await createTenantWithOwner(admin, "two-owners");
    const second = await addMember(admin, tenantId, "second-owner", "owner");

    const first = await asUser({ sub: owner.id, tenantId, role: "owner" }, async (tx) => {
      await tx`delete from public.members where tenant_id = ${tenantId} and user_id = ${second.id}`;
    });
    expect(first.errorCode, `usunięcie jednego z dwóch ownerów: ${first.errorMessage}`).toBeUndefined();

    const secondAttempt = await asUser({ sub: owner.id, tenantId, role: "owner" }, async (tx) => {
      await tx`delete from public.members where tenant_id = ${tenantId} and user_id = ${owner.id}`;
    });
    expect(secondAttempt.errorCode).toBe("23514");

    const { data: rows } = await admin.from("members").select("user_id").eq("tenant_id", tenantId);
    expect(rows).toHaveLength(1);
  });

  it("guard obejmuje też ZBIORCZE usunięcie wszystkich członków jednym zapytaniem", async () => {
    const { tenantId, owner } = await createTenantWithOwner(admin, "bulk-delete");
    await addMember(admin, tenantId, "bulk-staff", "staff");

    const result = await asUser({ sub: owner.id, tenantId, role: "owner" }, async (tx) => {
      await tx`delete from public.members where tenant_id = ${tenantId}`;
    });
    expect(result.errorCode, `zbiorcze usunięcie: ${result.errorMessage}`).toBe("23514");

    const { data: rows } = await admin.from("members").select("user_id").eq("tenant_id", tenantId);
    expect(rows).toHaveLength(2);
  });

  it("nie pozwala ZDEGRADOWAĆ ostatniego ownera do staff (obejście usunięcia)", async () => {
    const { tenantId, owner } = await createTenantWithOwner(admin, "demote");

    const result = await asUser({ sub: owner.id, tenantId, role: "owner" }, async (tx) => {
      await tx`update public.members set role = 'staff' where tenant_id = ${tenantId} and user_id = ${owner.id}`;
    });
    expect(result.errorCode, `degradacja ostatniego ownera: ${result.errorMessage}`).toBe("23514");

    const { data: rows } = await admin
      .from("members")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", owner.id);
    expect((rows ?? [])[0]?.role).toBe("owner");
  });

  it("usunięcie STAFFA przez ownera przechodzi (guard dotyczy wyłącznie ostatniego ownera)", async () => {
    const { tenantId, owner } = await createTenantWithOwner(admin, "remove-staff");
    const staff = await addMember(admin, tenantId, "staff-to-remove", "staff");

    const result = await asUser({ sub: owner.id, tenantId, role: "owner" }, async (tx) => {
      await tx`delete from public.members where tenant_id = ${tenantId} and user_id = ${staff.id}`;
    });
    expect(result.errorCode, `usunięcie staffa: ${result.errorMessage}`).toBeUndefined();

    const { data: rows } = await admin.from("members").select("user_id").eq("tenant_id", tenantId);
    expect(rows).toHaveLength(1);
  });

  it("guard NIE blokuje kaskad: usunięcie tenanta i usunięcie konta ownera nadal działa", async () => {
    const cascadeTenant = await createTenantWithOwner(admin, "cascade-tenant");
    const { error: tenantDeleteError } = await admin
      .from("tenants")
      .delete()
      .eq("id", cascadeTenant.tenantId);
    expect(
      tenantDeleteError,
      `usunięcie tenanta kaskaduje na members — guard nie ma prawa tego blokować: ${tenantDeleteError?.message}`,
    ).toBeNull();

    const cascadeUser = await createTenantWithOwner(admin, "cascade-user");
    const { error: userDeleteError } = await admin.auth.admin.deleteUser(cascadeUser.owner.id);
    expect(
      userDeleteError,
      `usunięcie konta ostatniego ownera kaskaduje na members — guard nie ma prawa tego blokować: ${userDeleteError?.message}`,
    ).toBeNull();
    createdUserIds.splice(createdUserIds.indexOf(cascadeUser.owner.id), 1);
  });

  it("staff nie usuwa nikogo, a owner tenanta A nie usuwa członka tenanta B", async () => {
    const a = await createTenantWithOwner(admin, "iso-a");
    const b = await createTenantWithOwner(admin, "iso-b");
    const staffA = await addMember(admin, a.tenantId, "iso-staff", "staff");
    const victimB = await addMember(admin, b.tenantId, "iso-victim", "staff");

    // staff własnego tenanta: polityka tenant_delete wymaga roli owner —
    // zapytanie nie dosięga żadnego wiersza (RLS filtruje, nie rzuca).
    const staffAttempt = await asUser(
      { sub: staffA.id, tenantId: a.tenantId, role: "staff" },
      async (tx) => {
        const rows = await tx`delete from public.members where tenant_id = ${a.tenantId} returning user_id`;
        return rows.length;
      },
    );
    expect(staffAttempt.value ?? 0).toBe(0);
    const { data: aRows } = await admin.from("members").select("user_id").eq("tenant_id", a.tenantId);
    expect(aRows).toHaveLength(2);

    // owner A celujący wprost w wiersz tenanta B.
    const crossAttempt = await asUser(
      { sub: a.owner.id, tenantId: a.tenantId, role: "owner" },
      async (tx) => {
        const rows = await tx`
          delete from public.members
          where tenant_id = ${b.tenantId} and user_id = ${victimB.id}
          returning user_id
        `;
        return rows.length;
      },
    );
    expect(crossAttempt.value ?? 0).toBe(0);
    const { data: bRows } = await admin.from("members").select("user_id").eq("tenant_id", b.tenantId);
    expect(bRows).toHaveLength(2);
  });

  // -------------------------------------------------------------------
  // 2. Odwołanie zaproszenia
  // -------------------------------------------------------------------

  it("app.accept_invitation ODRZUCA zaproszenie odwołane — i nie tworzy członkostwa", async () => {
    const { tenantId } = await createTenantWithOwner(admin, "revoked-invite");
    const invitee = await createConfirmedUser(admin, "revoked-invitee");
    const invitation = await seedInvitation(admin, tenantId, invitee.email, {
      revoked_at: new Date().toISOString(),
    });

    const inviteeClient = await signIn(invitee.email);
    const { error } = await inviteeClient
      .schema("app")
      .rpc("accept_invitation", { p_token: invitation.rawToken });

    expect(
      error,
      "odwołane zaproszenie nie może wpuścić nikogo do tenanta — inaczej odwołanie niczego nie odwołuje",
    ).not.toBeNull();

    const { data: members } = await admin
      .from("members")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", invitee.id);
    expect(members ?? []).toHaveLength(0);
  });

  it("zaproszenie NIEodwołane nadal wpuszcza (guard nie jest za szeroki)", async () => {
    const { tenantId } = await createTenantWithOwner(admin, "live-invite");
    const invitee = await createConfirmedUser(admin, "live-invitee");
    const invitation = await seedInvitation(admin, tenantId, invitee.email);

    const inviteeClient = await signIn(invitee.email);
    const { data, error } = await inviteeClient
      .schema("app")
      .rpc("accept_invitation", { p_token: invitation.rawToken });
    expect(error, `akcept żywego zaproszenia: ${error?.message}`).toBeNull();
    expect(data).toBe(tenantId);
  });

  it("odwołanie zaproszenia: owner tenanta A nie tyka zaproszenia tenanta B, anon nie tyka niczego", async () => {
    const a = await createTenantWithOwner(admin, "rev-iso-a");
    const b = await createTenantWithOwner(admin, "rev-iso-b");
    const invitationB = await seedInvitation(admin, b.tenantId, "victim@test.local");

    const crossAttempt = await asUser(
      { sub: a.owner.id, tenantId: a.tenantId, role: "owner" },
      async (tx) => {
        const rows = await tx`
          update public.invitations set revoked_at = now() where id = ${invitationB.id} returning id
        `;
        return rows.length;
      },
    );
    expect(crossAttempt.value ?? 0).toBe(0);

    const anonClient = createAnonClient();
    const { data: anonUpdated } = await anonClient
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", invitationB.id)
      .select("id");
    expect(anonUpdated ?? []).toHaveLength(0);

    const { data: after } = await admin
      .from("invitations")
      .select("revoked_at")
      .eq("id", invitationB.id)
      .single();
    expect(
      after?.revoked_at,
      "zaproszenie tenanta B zostało odwołane z zewnątrz — wyciek izolacji",
    ).toBeNull();
  });

  it("staff nie odwołuje zaproszeń własnego tenanta (granica ról w bazie)", async () => {
    const { tenantId } = await createTenantWithOwner(admin, "rev-staff");
    const staff = await addMember(admin, tenantId, "rev-staff-member", "staff");
    const invitation = await seedInvitation(admin, tenantId, "pending@test.local");

    const attempt = await asUser({ sub: staff.id, tenantId, role: "staff" }, async (tx) => {
      const rows = await tx`
        update public.invitations set revoked_at = now() where id = ${invitation.id} returning id
      `;
      return rows.length;
    });
    expect(attempt.value ?? 0).toBe(0);

    const { data: after } = await admin
      .from("invitations")
      .select("revoked_at")
      .eq("id", invitation.id)
      .single();
    expect(after?.revoked_at).toBeNull();
  });
});
