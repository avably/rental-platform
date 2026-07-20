/**
 * public.account_email_logs (ADR-054, migracja 0025) — RLS i strażnicy schematu
 * na żywym, lokalnym Supabase.
 *
 * Tabela PLATFORMOWA (bez tenant_id): oś izolacji to publiczność (anon) vs
 * platforma (superadmin), jak waitlist_signups (0006). Automatyczna macierz
 * per-tenant jej nie obejmuje; bramka „każda tabela public ma RLS"
 * (listPlatformTablesWithoutRls) obejmuje — tu dokładamy DOWÓD ZACHOWANIA
 * przez prawdziwe RLS: kto czyta, kto nie, i że nikt poza service-rolem nie
 * zapisze ani nie ruszy wiersza (append-only).
 *
 * Dowody czytają PRAWDZIWE RLS (klienci anon/authenticated/superadmin +
 * gołe mutacje rolą authenticated), nie atrapy — brief D4.
 */
import { createHmac, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_CHECK_VIOLATION = "23514";
const TEST_PASSWORD = "AcctLogRls!12345678";
const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

/** 64-hex pseudonim jak w produkcji, ale na potrzeby zasiewu — dowolny adres. */
function seedHash(seed: string): string {
  return createHmac("sha256", "test-pepper").update(seed).digest("hex");
}

// Klasa-sygnał do wymuszenia ROLLBACK sondy gołych mutacji.
class Rollback extends Error {}

describe.skipIf(!hasEnv)("account_email_logs — RLS i strażnicy schematu (ADR-054)", () => {
  let admin: SupabaseClient;
  let sql: ReturnType<typeof postgres>;
  let superadmin: SupabaseClient;
  let superadminUserId: string;
  let userClient: SupabaseClient;
  let userUserId: string;
  let seededHash: string;

  const createdUserIds: string[] = [];

  async function createUser(label: string): Promise<{ id: string; email: string }> {
    const email = `acctlog-${label}-${randomUUID()}@test.local`;
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
    const client = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...realtimeTransport,
    });
    const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (error) throw new Error(`signIn(${email}): ${error.message}`);
    return client;
  }

  beforeAll(async () => {
    admin = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...realtimeTransport,
    });
    sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });

    // Zwykły authenticated (bez claimu superadmin).
    const user = await createUser("plain");
    userUserId = user.id;
    userClient = await signIn(user.email);

    // Superadmin: wpis do app.superadmins PRZED logowaniem (claim wchodzi do
    // JWT przez custom_access_token przy wydaniu tokenu — 0003).
    const sa = await createUser("super");
    superadminUserId = sa.id;
    await sql`insert into app.superadmins (user_id) values (${superadminUserId})`;
    superadmin = await signIn(sa.email);
  }, 60_000);

  beforeEach(async () => {
    // Zasiew wiersza service-rolem (jedyna rola z INSERT) — dane DO testu.
    seededHash = seedHash(randomUUID());
    await sql`
      insert into public.account_email_logs (action, status, recipient_hash, reason)
      values ('signup', 'failed', ${seededHash}, 'zasiany powód testowy')
    `;
  });

  afterEach(async () => {
    await sql`delete from public.account_email_logs where recipient_hash = ${seededHash}`;
  });

  afterAll(async () => {
    await sql`delete from app.superadmins where user_id = ${superadminUserId}`;
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    await sql.end({ timeout: 5 });
  }, 60_000);

  // --- RLS: kto czyta (mutation proof D) ---

  it("anon NIE odczyta dziennika (odmowa na GRANCIE, zanim RLS dojdzie do głosu)", async () => {
    const { data, error } = await anonClient().from("account_email_logs").select("*");
    expect(data ?? [], "anon zobaczył wiersze dziennika kont").toEqual([]);
    expect(error?.code, `anon dostał odpowiedź inną niż odmowa uprawnień: ${error?.message}`).toBe(
      PG_INSUFFICIENT_PRIVILEGE,
    );
  });

  it("zwykły authenticated NIE czyta dziennika (pusta lista — maskowanie 404, nie błąd)", async () => {
    const { data, error } = await userClient.from("account_email_logs").select("*");
    expect(error, `SELECT jako zwykły user: nieoczekiwany błąd`).toBeNull();
    expect(data ?? [], "zwykły authenticated zobaczył wiersze dziennika kont").toHaveLength(0);
  });

  it("superadmin ODCZYTUJE dziennik (widzi zasiany wiersz)", async () => {
    const { data, error } = await superadmin
      .from("account_email_logs")
      .select("recipient_hash, action, status")
      .eq("recipient_hash", seededHash);
    expect(error, `SELECT jako superadmin: ${error?.message}`).toBeNull();
    expect(
      (data ?? []).map((r) => r.recipient_hash as string),
      "superadmin nie zobaczył zasianego wiersza — odczyt platformowy zepsuty",
    ).toContain(seededHash);
  });

  // --- Append-only: nikt poza service-role nie zmieni/nie skasuje ---

  it("zwykły authenticated NIE wstawi wiersza wprost do tabeli", async () => {
    const { error } = await userClient
      .from("account_email_logs")
      .insert({ action: "signup", status: "sent", recipient_hash: seedHash("intruz"), reason: null });
    expect(error?.code, `authenticated wstawił wiersz wprost: ${error?.message}`).toBe(
      PG_INSUFFICIENT_PRIVILEGE,
    );
  });

  it.each([
    { role: "anon", superadminClaim: false },
    { role: "authenticated", superadminClaim: false },
    { role: "authenticated", superadminClaim: true },
  ])(
    "$role (superadmin=$superadminClaim) nie zmieni ani nie skasuje wiersza (gołe mutacje bez WHERE)",
    async ({ role, superadminClaim }) => {
      const sub = superadminClaim ? superadminUserId : userUserId;
      const jwt =
        role === "anon"
          ? null
          : JSON.stringify({
              sub,
              role: "authenticated",
              app_metadata: superadminClaim ? { superadmin: true } : {},
            });

      const baseline = await sql<{ recipient_hash: string }[]>`
        select recipient_hash from public.account_email_logs where recipient_hash = ${seededHash}
      `;
      expect(baseline, "brak zasianego wiersza — test nie ma czego bronić").toHaveLength(1);

      async function mutationReaches(statement: string): Promise<boolean> {
        let reached = false;
        try {
          await sql.begin(async (tx) => {
            if (jwt) await tx`select set_config('request.jwt.claims', ${jwt}, true)`;
            await tx.unsafe(`set local role ${role}`);
            try {
              await tx.unsafe(statement);
            } catch {
              throw new Rollback(); // odmowa (brak grantu / polityka) = brak wycieku
            }
            await tx`reset role`;
            const rows = await tx<{ recipient_hash: string }[]>`
              select recipient_hash from public.account_email_logs where recipient_hash = ${seededHash}
            `;
            reached = JSON.stringify(rows) !== JSON.stringify(baseline);
            throw new Rollback();
          });
        } catch (error) {
          if (!(error instanceof Rollback)) throw error;
        }
        return reached;
      }

      expect(
        await mutationReaches(`update public.account_email_logs set status = 'sent', reason = null`),
        `${role}/superadmin=${superadminClaim}: goła mutacja UPDATE dosięgła wiersza — wyciek/append-only złamane`,
      ).toBe(false);
      expect(
        await mutationReaches(`delete from public.account_email_logs`),
        `${role}/superadmin=${superadminClaim}: goła mutacja DELETE usunęła wiersz — append-only złamane`,
      ).toBe(false);
    },
  );

  // --- Strażnicy schematu (CHECK-i obowiązują niezależnie od RLS) ---

  it("failed BEZ powodu jest odrzucone (CHECK pary status↔reason)", async () => {
    await expect(
      sql`insert into public.account_email_logs (action, status, recipient_hash, reason)
          values ('signup', 'failed', ${seedHash("no-reason")}, null)`,
    ).rejects.toMatchObject({ code: PG_CHECK_VIOLATION });
  });

  it("sent Z powodem jest odrzucone (CHECK pary status↔reason)", async () => {
    await expect(
      sql`insert into public.account_email_logs (action, status, recipient_hash, reason)
          values ('signup', 'sent', ${seedHash("sent-with-reason")}, 'powód mimo sukcesu')`,
    ).rejects.toMatchObject({ code: PG_CHECK_VIOLATION });
  });

  it("recipient_hash w postaci adresu jawnego jest NIEREPREZENTOWALNY (CHECK 64-hex)", async () => {
    // To druga bramka prywatności: gdyby aplikacja pomyliła hash z adresem,
    // baza i tak odrzuci plaintext (zawiera '@', nie jest 64-hex).
    await expect(
      sql`insert into public.account_email_logs (action, status, recipient_hash, reason)
          values ('signup', 'sent', 'ofiara@example.com', null)`,
    ).rejects.toMatchObject({ code: PG_CHECK_VIOLATION });
  });

  it("nieznany action jest odrzucony (CHECK domeny)", async () => {
    await expect(
      sql`insert into public.account_email_logs (action, status, recipient_hash, reason)
          values ('magiclink', 'sent', ${seedHash("bad-action")}, null)`,
    ).rejects.toMatchObject({ code: PG_CHECK_VIOLATION });
  });

  it("nieznany status jest odrzucony (CHECK domeny)", async () => {
    await expect(
      sql`insert into public.account_email_logs (action, status, recipient_hash, reason)
          values ('signup', 'queued', ${seedHash("bad-status")}, null)`,
    ).rejects.toMatchObject({ code: PG_CHECK_VIOLATION });
  });
});
