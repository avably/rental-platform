/**
 * Testy integracyjne guardów auth panelu (Zadanie 6): lib/auth.ts na
 * żywym, lokalnym Supabase. Wzorzec identyczny jak
 * packages/db/test/rls-isolation.test.ts — describe.skipIf(!env), env z
 * `supabase status -o env` (patrz packages/db/supabase, `supabase start`
 * musi być uruchomiony z tego katalogu).
 *
 * `requireMemberWithClient`/`requireSuperadminWithClient` przyjmują gotowego
 * klienta Supabase (nie next/headers), więc są testowalne tu bez serwera
 * Next.js — to jedyny powód, dla którego rdzeń guardów jest wydzielony z
 * `requireMember`/`requireSuperadmin` (patrz lib/supabase-server.ts).
 */
import { createHmac, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { AuthError, getAuthContext, requireMemberWithClient, requireSuperadminWithClient } from "@/lib/auth";

import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "PanelAuthTest!12345678";
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

async function createConfirmedUser(admin: SupabaseClient, label: string): Promise<{ id: string; email: string }> {
  const email = `panelauth-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}) failed: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}) failed: ${error.message}`);
  return client;
}

// --- TOTP (RFC 6238) minimalna implementacja — WYŁĄCZNIE do testów, żeby
// móc realnie przejść wyzwanie MFA zwrócone przez Supabase (enroll → sekret
// base32 → wygenerowany kod → challenge → verify), zamiast mockować aal2. ---

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotp(secretBase32: string): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binCode % 1_000_000).toString().padStart(6, "0");
}

describe.skipIf(!hasEnv)("guardy auth panelu (lib/auth.ts)", () => {
  const admin = hasEnv ? createAdminClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdUserIds.length = 0;
  });

  it("requireMemberWithClient: brak sesji → 401", async () => {
    const anon = createAnonClient();
    await expect(requireMemberWithClient(anon)).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<AuthError>);
  });

  it("user bez membera: app_metadata.tenant_id=null i requireMemberWithClient → 403", async () => {
    const user = await createConfirmedUser(admin, "no-tenant");
    const client = await signIn(user.email);

    const ctx = await getAuthContext(client);
    expect(ctx?.tenantId).toBeNull();

    await expect(requireMemberWithClient(client)).rejects.toMatchObject({ status: 403 });
  });

  it("owner tenanta: requireMemberWithClient zwraca tenantId/role, rola niezgodna → 403", async () => {
    const user = await createConfirmedUser(admin, "owner");
    const client = await signIn(user.email);

    const slug = `panelauth-${randomUUID()}`.slice(0, 39);
    const { data: tenantId, error } = await client.schema("app").rpc("create_tenant", {
      p_slug: slug,
      p_name: "Panel auth test tenant",
    });
    expect(error, `create_tenant: ${error?.message}`).toBeNull();

    // Nowa sesja — JWT z hooka po utworzeniu membera.
    const client2 = await signIn(user.email);
    const result = await requireMemberWithClient(client2);
    expect(result.tenantId).toBe(tenantId);
    expect(result.role).toBe("owner");

    await expect(requireMemberWithClient(client2, "staff")).rejects.toMatchObject({ status: 403 });
    await expect(requireMemberWithClient(client2, "owner")).resolves.toMatchObject({ role: "owner" });
  });

  it("requireSuperadminWithClient: user zwykły → 403, superadmin bez aal2 → 403, po weryfikacji TOTP → OK", async () => {
    const user = await createConfirmedUser(admin, "superadmin");
    const client = await signIn(user.email);

    await expect(requireSuperadminWithClient(client)).rejects.toMatchObject({ status: 403 });

    const { error: superadminInsertError } = await admin
      .schema("app")
      .from("superadmins")
      .insert({ user_id: user.id });
    expect(superadminInsertError, `insert app.superadmins: ${superadminInsertError?.message}`).toBeNull();

    // Nowa sesja z claimem superadmin=true, ale wciąż aal1 (bez MFA) → 403.
    const clientSuperadminAal1 = await signIn(user.email);
    await expect(requireSuperadminWithClient(clientSuperadminAal1)).rejects.toMatchObject({ status: 403 });

    // Enroll + challenge + verify TOTP → aal2.
    const { data: enrollData, error: enrollError } = await clientSuperadminAal1.auth.mfa.enroll({
      factorType: "totp",
    });
    expect(enrollError, `mfa.enroll: ${enrollError?.message}`).toBeNull();
    const factorId = enrollData!.id;
    const secret = enrollData!.totp.secret;

    const { data: challengeData, error: challengeError } = await clientSuperadminAal1.auth.mfa.challenge({
      factorId,
    });
    expect(challengeError, `mfa.challenge: ${challengeError?.message}`).toBeNull();

    const { error: verifyError } = await clientSuperadminAal1.auth.mfa.verify({
      factorId,
      challengeId: challengeData!.id,
      code: generateTotp(secret),
    });
    expect(verifyError, `mfa.verify: ${verifyError?.message}`).toBeNull();

    // mfa.verify() aktualizuje sesję klienta w miejscu — ten sam klient ma
    // teraz aal2, bez potrzeby ponownego logowania.
    const superadminCtx = await requireSuperadminWithClient(clientSuperadminAal1);
    expect(superadminCtx.superadmin).toBe(true);
    expect(superadminCtx.aal).toBe("aal2");
  });
});
