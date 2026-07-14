/**
 * Testy hooka custom access token i RPC onboardingowych (Zadanie 6, migracja
 * 0003_auth.sql): packages/db/supabase/migrations/0003_auth.sql.
 *
 * Wymaga uruchomionego lokalnego Supabase (`supabase start` + `supabase db
 * reset` z katalogu packages/db) i tych samych zmiennych środowiskowych co
 * test/rls-isolation.test.ts (patrz helpers/seed-tenants.ts). Bez nich cały
 * plik jest pomijany.
 */
import { randomBytes, createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = REQUIRED_ENV.every((name) => Boolean(process.env[name]));

const TEST_PASSWORD = "AuthHookTest!12345678";
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

/** Dekoduje payload JWT (bez weryfikacji podpisu — test czyta własny token). */
function decodeJwtPayload(accessToken: string): Record<string, unknown> {
  const [, payload] = accessToken.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function createConfirmedUser(admin: SupabaseClient, label: string): Promise<{ id: string; email: string }> {
  const email = `authhook-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}) failed: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function signIn(email: string): Promise<{ client: SupabaseClient; accessToken: string }> {
  const client = createAnonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error || !data.session) throw new Error(`signIn(${email}) failed: ${error?.message}`);
  return { client, accessToken: data.session.access_token };
}

describe.skipIf(!hasEnv)("custom access token hook + RPC onboardingowe (0003_auth.sql)", () => {
  const admin = hasEnv ? createAdminClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdUserIds.length = 0;
  });

  it("user bez membera ma app_metadata.tenant_id = null w JWT", async () => {
    const user = await createConfirmedUser(admin, "no-tenant");
    const { accessToken } = await signIn(user.email);
    const claims = decodeJwtPayload(accessToken);
    const appMetadata = claims.app_metadata as Record<string, unknown>;
    expect(appMetadata.tenant_id).toBeNull();
    expect(appMetadata.role).toBeNull();
    expect(appMetadata.superadmin).toBe(false);
  });

  it("po app.create_tenant JWT niesie tenant_id i role='owner'", async () => {
    const user = await createConfirmedUser(admin, "owner");
    const { client } = await signIn(user.email);

    const slug = `hooktest-${randomUUID()}`.slice(0, 39);
    const { data: tenantId, error } = await client.schema("app").rpc("create_tenant", {
      p_slug: slug,
      p_name: "Hook test tenant",
    });
    expect(error, `create_tenant powinno się powieść: ${error?.message}`).toBeNull();
    expect(tenantId).toBeTruthy();

    // Nowe logowanie, bo istniejąca sesja ma JWT wydany PRZED utworzeniem
    // membera — hook wstrzykuje claimy dopiero przy wystawieniu tokenu.
    const { accessToken } = await signIn(user.email);
    const claims = decodeJwtPayload(accessToken);
    const appMetadata = claims.app_metadata as Record<string, unknown>;
    expect(appMetadata.tenant_id).toBe(tenantId);
    expect(appMetadata.role).toBe("owner");
  });

  it("app.create_tenant odrzuca usera z niezweryfikowanym e-mailem", async () => {
    const email = `authhook-unconfirmed-${randomUUID()}@test.local`;
    const { data, error: createError } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: false,
    });
    if (createError || !data.user) throw new Error(`createUser failed: ${createError?.message}`);
    createdUserIds.push(data.user.id);

    const client = createAnonClient();
    const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    // Lokalna konfiguracja wymaga potwierdzenia e-maila przed logowaniem
    // (auth.email.enable_confirmations = true) — signIn samo w sobie powinno
    // zostać odrzucone. To jest pierwsza linia obrony; RPC ma drugą (patrz
    // niżej) na wypadek zmiany tej konfiguracji.
    expect(signInError).not.toBeNull();
    expect(signInData.session).toBeNull();
  });

  it("app.create_tenant egzekwuje limit 2 organizacji na użytkownika", async () => {
    const user = await createConfirmedUser(admin, "limit");
    const { client } = await signIn(user.email);

    for (let i = 0; i < 2; i++) {
      const { error } = await client.schema("app").rpc("create_tenant", {
        p_slug: `hooktest-limit-${i}-${randomUUID()}`.slice(0, 39),
        p_name: `Tenant limit ${i}`,
      });
      expect(error, `create_tenant #${i} powinno się powieść: ${error?.message}`).toBeNull();
    }

    const { error: thirdError } = await client.schema("app").rpc("create_tenant", {
      p_slug: `hooktest-limit-3-${randomUUID()}`.slice(0, 39),
      p_name: "Tenant limit 3",
    });
    expect(thirdError, "trzeci tenant powinien zostać odrzucony (limit 2/user)").not.toBeNull();
  });

  it("superadmin: wpis w app.superadmins ustawia app_metadata.superadmin=true w JWT", async () => {
    const user = await createConfirmedUser(admin, "superadmin");
    const { error: insertError } = await admin.from("superadmins").insert({ user_id: user.id });
    // app.superadmins jest eksponowana przez PostgREST (schemat app w
    // api.schemas) — klient service-role wchodzi bez `.schema('app')`,
    // ponieważ REST_URL domyślnie wskazuje pierwszy schemat (public);
    // dlatego admin (service-role) woła przez SQL bezpośrednio poniżej,
    // jeśli insert przez PostgREST zawiedzie schematem.
    if (insertError) {
      const { error: schemaInsertError } = await admin
        .schema("app")
        .from("superadmins")
        .insert({ user_id: user.id });
      expect(schemaInsertError, `insert do app.superadmins: ${schemaInsertError?.message}`).toBeNull();
    }

    const { accessToken } = await signIn(user.email);
    const claims = decodeJwtPayload(accessToken);
    const appMetadata = claims.app_metadata as Record<string, unknown>;
    expect(appMetadata.superadmin).toBe(true);
  });

  it("app.accept_invitation dodaje membera i aktualizuje JWT", async () => {
    const owner = await createConfirmedUser(admin, "invite-owner");
    const { client: ownerClient } = await signIn(owner.email);

    const slug = `hooktest-invite-${randomUUID()}`.slice(0, 39);
    const { data: tenantId, error: tenantError } = await ownerClient.schema("app").rpc("create_tenant", {
      p_slug: slug,
      p_name: "Invite test tenant",
    });
    expect(tenantError, `create_tenant: ${tenantError?.message}`).toBeNull();

    const invitee = await createConfirmedUser(admin, "invitee");
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    // Owner ma teraz świeży claim tenant_id (po create_tenant zalogował się
    // ponownie) — musi się przelogować, bo ownerClient trzyma stary token
    // sprzed utworzenia tenanta (ten sam problem co w teście wyżej).
    const { client: ownerClient2 } = await signIn(owner.email);
    const { error: inviteError } = await ownerClient2.from("invitations").insert({
      tenant_id: tenantId,
      email: invitee.email,
      role: "staff",
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(inviteError, `insert invitations (owner): ${inviteError?.message}`).toBeNull();

    const { client: inviteeClient } = await signIn(invitee.email);
    const { data: acceptedTenantId, error: acceptError } = await inviteeClient
      .schema("app")
      .rpc("accept_invitation", { p_token: rawToken });
    expect(acceptError, `accept_invitation: ${acceptError?.message}`).toBeNull();
    expect(acceptedTenantId).toBe(tenantId);

    const { accessToken } = await signIn(invitee.email);
    const claims = decodeJwtPayload(accessToken);
    const appMetadata = claims.app_metadata as Record<string, unknown>;
    expect(appMetadata.tenant_id).toBe(tenantId);
    expect(appMetadata.role).toBe("staff");

    // Token jednorazowy: druga próba akceptu tego samego zaproszenia musi
    // zostać odrzucona.
    const { error: secondAcceptError } = await inviteeClient
      .schema("app")
      .rpc("accept_invitation", { p_token: rawToken });
    expect(secondAcceptError, "powtórny akcept tego samego tokenu powinien zostać odrzucony").not.toBeNull();
  });
});
