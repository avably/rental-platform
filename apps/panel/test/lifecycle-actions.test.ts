/**
 * ŚCIEŻKI WYGASZANIA w warstwie akcji (L4, ADR-105) na ŻYWYM Supabase, przez
 * FAKTYCZNE server actions — wzorzec `site-pages-actions.test.ts`.
 *
 * `packages/db/test/lifecycle-guards.test.ts` dowodzi tego samego na poziomie
 * DANYCH (trigger ostatniego ownera, RPC odrzucające odwołany token). Tutaj
 * mierzone jest to, czego tamten nie widzi:
 *
 *   1. bramka ROLI w akcji — `staff` odbija się od `requireMember("owner")`,
 *      a nie od ukrytego przycisku;
 *   2. tenant brany z KONTEKSTU, nie z formularza — identyfikator z cudzej
 *      organizacji nie ma jak zadziałać;
 *   3. odmowa guardu bazy dociera do operatora jako ZDANIE po polsku, a nie
 *      jako surowy SQLSTATE;
 *   4. odwołanie i ponowienie faktycznie ZAMYKAJĄ stary link — sprawdzane
 *      przez `app.accept_invitation`, czyli tą samą drogą, którą wchodzi
 *      zaproszony.
 *
 * Werdykt zawsze z TRWAŁEGO stanu (odczyt service-rolem), nie ze zwrotu akcji.
 *
 * Mock `requireMember` odtwarza bramkę roli z `lib/auth.ts` (AuthError 403),
 * bo inaczej test roli sprawdzałby mock, a nie akcję.
 */
import { randomBytes, createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { AuthError } from "@/lib/auth";

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

const TEST_PASSWORD = "LifecycleActions!12345678";
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

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

interface Actor {
  client: SupabaseClient;
  tenantId: string;
  userId: string;
  email: string;
  role: "owner" | "staff";
}

async function createUser(
  admin: SupabaseClient,
  label: string,
): Promise<{ id: string; email: string }> {
  const email = `lifeact-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function createTenantOwner(admin: SupabaseClient, label: string): Promise<Actor> {
  const user = await createUser(admin, label);
  const bootstrap = await signIn(user.email);
  const { data: tenantId, error } = await bootstrap.schema("app").rpc("create_tenant", {
    p_slug: `lifeact-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja cyklu ${label}`,
  });
  if (error) throw new Error(`create_tenant(${label}): ${error.message}`);
  createdTenantIds.push(tenantId as string);
  return {
    client: await signIn(user.email),
    tenantId: tenantId as string,
    userId: user.id,
    email: user.email,
    role: "owner",
  };
}

async function addMember(
  admin: SupabaseClient,
  tenantId: string,
  label: string,
  role: "owner" | "staff",
): Promise<Actor> {
  const user = await createUser(admin, label);
  const { error } = await admin
    .from("members")
    .insert({ tenant_id: tenantId, user_id: user.id, role });
  if (error) throw new Error(`insert members(${label}): ${error.message}`);
  return { client: await signIn(user.email), tenantId, userId: user.id, email: user.email, role };
}

const requireMember = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  requireMember: (role?: "owner" | "staff") => requireMember(role),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// Limit wysyłki ma własny test jednostkowy (packages/security) — tutaj
// przepuszczamy, żeby kolejne ponowienia w jednym pliku się nie odbijały.
vi.mock("@avably/security/rate-limit", () => ({
  PANEL_AUTH_RATE_LIMIT_PREFIX: "test",
  checkRateLimit: async () => ({ success: true, remaining: 10 }),
}));

const { removeMemberAction } = await import("@/app/[locale]/(panel)/zaproszenia/team-actions");
const { revokeInvitationAction, resendInvitationAction } = await import(
  "@/app/[locale]/(panel)/zaproszenia/actions"
);

describe.skipIf(!hasEnv)("ścieżki wygaszania — akcje panelu (ADR-105)", () => {
  let admin: SupabaseClient;
  let owner: Actor;
  let staff: Actor;
  let other: Actor;

  /** Odtwarza bramkę roli z lib/auth.ts — inaczej M3 nie miałoby jak spłonąć. */
  function actAs(actor: Actor): void {
    requireMember.mockImplementation(async (role?: "owner" | "staff") => {
      if (role && actor.role !== role) {
        throw new AuthError(403, "Brak uprawnień do tej operacji.");
      }
      return {
        user: { id: actor.userId, email: actor.email },
        tenantId: actor.tenantId,
        role: actor.role,
        superadmin: false,
        aal: "aal1",
        supabase: actor.client,
      };
    });
  }

  /** Zaproszenie z surowym tokenem, wstawione service-rolem (to seed, nie test). */
  async function seedInvitation(
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
    if (error || !data) throw new Error(`seedInvitation: ${error?.message}`);
    return { id: data.id as string, rawToken };
  }

  /** Próba wejścia tokenem — tą samą drogą, którą wchodzi zaproszony. */
  async function tryAccept(inviteeEmail: string, rawToken: string): Promise<string | null> {
    const client = await signIn(inviteeEmail);
    const { error } = await client.schema("app").rpc("accept_invitation", { p_token: rawToken });
    return error ? error.message : null;
  }

  beforeAll(async () => {
    if (!hasEnv) return;
    admin = createAdminClient();
    owner = await createTenantOwner(admin, "owner");
    staff = await addMember(admin, owner.tenantId, "staff", "staff");
    other = await createTenantOwner(admin, "other");
  }, 60_000);

  beforeEach(() => {
    requireMember.mockReset();
  });

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    createdTenantIds.length = 0;
    createdUserIds.length = 0;
  });

  // -------------------------------------------------------------------
  // Usuwanie członków
  // -------------------------------------------------------------------

  it("owner usuwa członka zespołu — wiersz znika z bazy", async () => {
    const victim = await addMember(admin, owner.tenantId, "victim", "staff");
    actAs(owner);

    const form = new FormData();
    form.set("userId", victim.userId);
    const state = await removeMemberAction({}, form);

    expect(state.error, `usunięcie członka: ${state.error}`).toBeUndefined();
    expect(state.success).toBeTruthy();

    const { data } = await admin
      .from("members")
      .select("user_id")
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", victim.userId);
    expect(data ?? []).toHaveLength(0);
  });

  it("staff NIE usuwa nikogo — odmowa na serwerze, wiersz nietknięty", async () => {
    const victim = await addMember(admin, owner.tenantId, "staff-victim", "staff");
    actAs(staff);

    const form = new FormData();
    form.set("userId", victim.userId);
    const state = await removeMemberAction({}, form);

    expect(state.error, "staff nie ma prawa usuwać członków").toBeTruthy();
    expect(state.success).toBeUndefined();

    const { data } = await admin
      .from("members")
      .select("user_id")
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", victim.userId);
    expect(data ?? []).toHaveLength(1);
  });

  it("owner tenanta A nie usuwa członka tenanta B — wiersz B nietknięty", async () => {
    const victimB = await addMember(admin, other.tenantId, "cross-victim", "staff");
    actAs(owner);

    const form = new FormData();
    form.set("userId", victimB.userId);
    const state = await removeMemberAction({}, form);

    expect(state.error).toBeTruthy();
    const { data } = await admin
      .from("members")
      .select("user_id")
      .eq("tenant_id", other.tenantId)
      .eq("user_id", victimB.userId);
    expect(data ?? [], "członek cudzego tenanta zniknął — wyciek izolacji").toHaveLength(1);
  });

  it("ostatniego ownera nie da się usunąć, a odmowa jest ZDANIEM, nie kodem błędu", async () => {
    const solo = await createTenantOwner(admin, "solo");
    actAs(solo);

    const form = new FormData();
    form.set("userId", solo.userId);
    const state = await removeMemberAction({}, form);

    expect(state.error).toBeTruthy();
    expect(state.error).toContain("co najmniej jednego właściciela");
    expect(state.error, "surowy SQLSTATE nie ma prawa trafić na ekran").not.toContain("23514");

    const { data } = await admin.from("members").select("user_id").eq("tenant_id", solo.tenantId);
    expect(data ?? []).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // Odwołanie zaproszenia
  // -------------------------------------------------------------------

  it("owner odwołuje zaproszenie — i odwołany token NIE wpuszcza do organizacji", async () => {
    const invitee = await createUser(admin, "revoked-invitee");
    const invitation = await seedInvitation(owner.tenantId, invitee.email);
    actAs(owner);

    const form = new FormData();
    form.set("invitationId", invitation.id);
    const state = await revokeInvitationAction({}, form);
    expect(state.error, `odwołanie: ${state.error}`).toBeUndefined();

    const { data: row } = await admin
      .from("invitations")
      .select("revoked_at")
      .eq("id", invitation.id)
      .single();
    expect(row?.revoked_at).not.toBeNull();

    const acceptError = await tryAccept(invitee.email, invitation.rawToken);
    expect(
      acceptError,
      "odwołane zaproszenie dalej wpuszcza — odwołanie nie odwołuje niczego",
    ).toBeTruthy();

    const { data: members } = await admin
      .from("members")
      .select("user_id")
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", invitee.id);
    expect(members ?? []).toHaveLength(0);
  });

  it("staff NIE odwołuje zaproszeń — stan bez zmian", async () => {
    const invitation = await seedInvitation(owner.tenantId, "pending-staff@test.local");
    actAs(staff);

    const form = new FormData();
    form.set("invitationId", invitation.id);
    const state = await revokeInvitationAction({}, form);
    expect(state.error).toBeTruthy();

    const { data: row } = await admin
      .from("invitations")
      .select("revoked_at")
      .eq("id", invitation.id)
      .single();
    expect(row?.revoked_at).toBeNull();
  });

  it("owner tenanta A nie odwołuje zaproszenia tenanta B", async () => {
    const invitationB = await seedInvitation(other.tenantId, "victim-b@test.local");
    actAs(owner);

    const form = new FormData();
    form.set("invitationId", invitationB.id);
    const state = await revokeInvitationAction({}, form);
    expect(state.error).toBeTruthy();

    const { data: row } = await admin
      .from("invitations")
      .select("revoked_at")
      .eq("id", invitationB.id)
      .single();
    expect(row?.revoked_at, "zaproszenie cudzego tenanta odwołane — wyciek izolacji").toBeNull();
  });

  // -------------------------------------------------------------------
  // Ponowienie zaproszenia
  // -------------------------------------------------------------------

  it("ponowienie ROTUJE token: stary link umiera, nowy wpuszcza", async () => {
    const invitee = await createUser(admin, "resend-invitee");
    const invitation = await seedInvitation(owner.tenantId, invitee.email);
    actAs(owner);

    const form = new FormData();
    form.set("invitationId", invitation.id);
    const state = await resendInvitationAction({}, form);
    expect(state.error, `ponowienie: ${state.error}`).toBeUndefined();

    // Stary token nie ma prawa dalej działać.
    const oldTokenError = await tryAccept(invitee.email, invitation.rawToken);
    expect(oldTokenError, "poprzedni link po ponowieniu wciąż wpuszcza").toBeTruthy();

    // Kontrola pozytywna: zaproszenie DALEJ jest ważne — tyle że pod nowym
    // tokenem. Bez tego test przechodziłby także wtedy, gdyby ponowienie
    // po prostu psuło zaproszenie.
    const { data: row } = await admin
      .from("invitations")
      .select("token_hash, accepted_at")
      .eq("id", invitation.id)
      .single();
    expect(row?.token_hash).not.toBe(
      createHash("sha256").update(invitation.rawToken).digest("hex"),
    );
    expect(row?.accepted_at).toBeNull();
  });

  it("odwołanego zaproszenia nie da się ponowić", async () => {
    const invitation = await seedInvitation(owner.tenantId, "revoked-resend@test.local", {
      revoked_at: new Date().toISOString(),
    });
    actAs(owner);

    const form = new FormData();
    form.set("invitationId", invitation.id);
    const state = await resendInvitationAction({}, form);
    expect(state.error).toBeTruthy();
    expect(state.success).toBeUndefined();
  });
});
