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

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

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

/** app_metadata z JWT wystawionego przy świeżym logowaniu (przeliczonego przez hook). */
async function appMetadataAfterLogin(email: string): Promise<Record<string, unknown>> {
  const { accessToken } = await signIn(email);
  return decodeJwtPayload(accessToken).app_metadata as Record<string, unknown>;
}

/** Świeży tenant (service-role, bez create_tenant) — kontrolujemy skład członkostw sami. */
async function seedTenant(admin: SupabaseClient, label: string): Promise<string> {
  const slug = `l7-${label}-${randomUUID()}`.slice(0, 39).toLowerCase();
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: `L7 ${label}` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedTenant(${label}) failed: ${error?.message}`);
  return data.id as string;
}

/**
 * Członkostwo z JAWNYM created_at — sterujemy „najstarsze/najnowsze" wprost,
 * niezależnie od zegara (default now() dawałby wiersze nie do odróżnienia).
 */
async function seedMembership(
  admin: SupabaseClient,
  tenantId: string,
  userId: string,
  role: "owner" | "staff",
  createdAtIso: string,
): Promise<void> {
  const { error } = await admin
    .from("members")
    .insert({ tenant_id: tenantId, user_id: userId, role, created_at: createdAtIso });
  if (error) throw new Error(`seedMembership(${role}) failed: ${error.message}`);
}

/** Preferencja aktywnej org — seedowana service-rolem (omija bramkę członkostwa, jak stała preferencja). */
async function setPreference(admin: SupabaseClient, userId: string, tenantId: string): Promise<void> {
  const { error } = await admin
    .schema("app")
    .from("user_active_tenant")
    .upsert({ user_id: userId, tenant_id: tenantId }, { onConflict: "user_id" });
  if (error) throw new Error(`setPreference failed: ${error.message}`);
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
    const { data: tenantId, error } = await rpcCreateTenant(client, {
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
      const { error } = await rpcCreateTenant(client, {
        p_slug: `hooktest-limit-${i}-${randomUUID()}`.slice(0, 39),
        p_name: `Tenant limit ${i}`,
      });
      expect(error, `create_tenant #${i} powinno się powieść: ${error?.message}`).toBeNull();
    }

    const { error: thirdError } = await rpcCreateTenant(client, {
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
    const { data: tenantId, error: tenantError } = await rpcCreateTenant(ownerClient, {
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

  // -------------------------------------------------------------------
  // L7 — aktywna organizacja użytkownika wielotenantowego (0092, ADR-224)
  // -------------------------------------------------------------------

  it("dwa członkostwa bez preferencji → claim = NAJNOWSZE (nie najstarsze)", async () => {
    const user = await createConfirmedUser(admin, "multi-default");
    const older = await seedTenant(admin, "older");
    const newer = await seedTenant(admin, "newer");
    await seedMembership(admin, older, user.id, "staff", "2020-01-01T00:00:00Z");
    await seedMembership(admin, newer, user.id, "owner", "2024-01-01T00:00:00Z");

    const appMetadata = await appMetadataAfterLogin(user.email);
    // DEFAULT = najnowsze członkostwo (created_at desc). To jest oś naprawy L7:
    // przed nią hook wybierał „najstarsze" i więził usera na older (cudzej org).
    expect(appMetadata.tenant_id, "domyślnie ląduje na najnowszym członkostwie").toBe(newer);
    expect(appMetadata.tenant_id).not.toBe(older);
    expect(appMetadata.role).toBe("owner");
  });

  it("preferencja aktywnej org wygrywa nad domyślnym najnowszym", async () => {
    const user = await createConfirmedUser(admin, "multi-pref");
    const older = await seedTenant(admin, "pref-older");
    const newer = await seedTenant(admin, "pref-newer");
    await seedMembership(admin, older, user.id, "staff", "2020-01-01T00:00:00Z");
    await seedMembership(admin, newer, user.id, "owner", "2024-01-01T00:00:00Z");

    // Preferencja wskazuje STARSZĄ org — hook ma ją uszanować mimo że default
    // to najnowsza. Rola idzie z wiersza members preferowanej org.
    await setPreference(admin, user.id, older);
    const appMetadata = await appMetadataAfterLogin(user.email);
    expect(appMetadata.tenant_id, "preferencja wygrywa nad default").toBe(older);
    expect(appMetadata.role).toBe("staff");
  });

  it("NIEZMIENNIK IZOLACJI: preferencja na org NIECZŁONKOWSKĄ jest ignorowana (fallback, claim NIE niesie C)", async () => {
    const user = await createConfirmedUser(admin, "iso");
    const memberOrg = await seedTenant(admin, "iso-member");
    const foreignOrg = await seedTenant(admin, "iso-foreign"); // org C — user NIE jest tu członkiem
    await seedMembership(admin, memberOrg, user.id, "owner", "2022-01-01T00:00:00Z");

    // Preferencja wskazuje org C, w której user NIE ma członkostwa (stała po
    // odebraniu członkostwa albo spreparowana). Hook MUSI ją zignorować i
    // wpaść na członkowską — org C NIGDY nie może trafić do claimu.
    await setPreference(admin, user.id, foreignOrg);
    const appMetadata = await appMetadataAfterLogin(user.email);
    expect(appMetadata.tenant_id, "claim wraca na org członkowską").toBe(memberOrg);
    expect(
      appMetadata.tenant_id,
      "OŚ IZOLACJI: preferencja na org nieczłonkowską NIGDY nie wpada do claimu (cross-tenant)",
    ).not.toBe(foreignOrg);
    expect(appMetadata.role).toBe("owner");
  });

  it("stała preferencja bez ŻADNEGO żywego członkostwa → tenant_id null (GoTrue nie crashuje)", async () => {
    const user = await createConfirmedUser(admin, "pref-no-member");
    const ghostOrg = await seedTenant(admin, "ghost");
    // Preferencja istnieje, ale user nie jest członkiem nigdzie — JOIN gasi
    // preferencję, fallback nie ma czego wybrać, coalesce'y chronią GoTrue.
    await setPreference(admin, user.id, ghostOrg);
    const appMetadata = await appMetadataAfterLogin(user.email);
    expect(appMetadata.tenant_id).toBeNull();
    expect(appMetadata.role).toBeNull();
    expect(appMetadata.superadmin).toBe(false);
  });

  it("przełącznik member-verified: org członkowska OK + nowy claim; org nieczłonkowska ODMOWA, preferencja niezmieniona", async () => {
    const user = await createConfirmedUser(admin, "switch");
    const orgA = await seedTenant(admin, "switch-a");
    const orgB = await seedTenant(admin, "switch-b");
    const orgForeign = await seedTenant(admin, "switch-foreign");
    await seedMembership(admin, orgA, user.id, "owner", "2021-01-01T00:00:00Z");
    await seedMembership(admin, orgB, user.id, "staff", "2023-01-01T00:00:00Z");

    const { client } = await signIn(user.email);

    // Przełączenie na org członkowską B → sukces, zwraca B.
    const { data: switched, error: switchError } = await client
      .schema("app")
      .rpc("set_active_tenant", { p_tenant_id: orgB });
    expect(switchError, `set_active_tenant(member) powinno się powieść: ${switchError?.message}`).toBeNull();
    expect(switched).toBe(orgB);
    expect((await appMetadataAfterLogin(user.email)).tenant_id, "po przełączeniu claim = B").toBe(orgB);

    // Przełączenie na org NIECZŁONKOWSKĄ → odmowa u źródła (bramka członkostwa
    // w set_active_tenant), preferencja zostaje na B (input nigdy nie ustawia
    // org nieczłonkowskiej).
    const { data: denied, error: denyError } = await client
      .schema("app")
      .rpc("set_active_tenant", { p_tenant_id: orgForeign });
    expect(denyError, "przełączenie na org nieczłonkowską musi zostać odrzucone").not.toBeNull();
    expect(denied, "odmowa nie zwraca tenant_id").toBeNull();
    expect(
      (await appMetadataAfterLogin(user.email)).tenant_id,
      "odmowa nie zmienia preferencji — claim nadal B",
    ).toBe(orgB);
  });

  it("regresja single-membership: jedna org → claim = ta org", async () => {
    const user = await createConfirmedUser(admin, "single");
    const only = await seedTenant(admin, "single-only");
    await seedMembership(admin, only, user.id, "owner", "2022-01-01T00:00:00Z");
    const appMetadata = await appMetadataAfterLogin(user.email);
    expect(appMetadata.tenant_id).toBe(only);
    expect(appMetadata.role).toBe("owner");
  });

  it("create_tenant ustawia świeżo założoną org jako AKTYWNĄ preferencję (nie starą)", async () => {
    const user = await createConfirmedUser(admin, "create-pref");

    // Pierwsza org — create_tenant ustawia preferencję = A.
    const { client: clientA } = await signIn(user.email);
    const { data: tenantA, error: errorA } = await rpcCreateTenant(clientA, {
      p_slug: `l7a-${randomUUID()}`.slice(0, 39),
      p_name: "L7 create A",
    });
    expect(errorA, `create_tenant A: ${errorA?.message}`).toBeNull();
    expect((await appMetadataAfterLogin(user.email)).tenant_id, "po założeniu A preferencja = A").toBe(tenantA);

    // Druga org — gdyby create_tenant NIE ustawiał preferencji, zostałaby na A
    // (członkowskiej), więc hook wybrałby A. Claim = B dowodzi, że create_tenant
    // przełączył preferencję na świeżo założoną org.
    const { client: clientB } = await signIn(user.email);
    const { data: tenantB, error: errorB } = await rpcCreateTenant(clientB, {
      p_slug: `l7b-${randomUUID()}`.slice(0, 39),
      p_name: "L7 create B",
    });
    expect(errorB, `create_tenant B: ${errorB?.message}`).toBeNull();
    expect(tenantB).not.toBe(tenantA);
    expect((await appMetadataAfterLogin(user.email)).tenant_id, "twórca ląduje na świeżej org B").toBe(tenantB);
  });
});
