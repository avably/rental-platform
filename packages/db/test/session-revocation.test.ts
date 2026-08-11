/**
 * Unieważnianie SESJI przy odebraniu roli (R12b, obrona w głąb H-01, ADR-127,
 * migracja 0061_revoke_sessions_on_role_removal.sql) — na żywym lokalnym
 * Supabase. Wymaga uruchomionego stacku (jak auth-hook / lifecycle-guards).
 *
 * Co jest tu dowiedzione:
 *   1. Wyzwalacz AFTER DELETE na members i app.superadmins kasuje sesje
 *      użytkownika z OLD wiersza (odebranemu członkowi/superadminowi lecą
 *      refresh tokeny).
 *   2. CEL Z OLD, NIGDY Z WEJŚCIA: app.revoke_user_sessions nie jest wykonywalna
 *      dla roli `authenticated` (brak prymitywu „wyloguj dowolnego"), a
 *      spreparowany DELETE cudzego wiersza odbija się o RLS — więc nie da się
 *      unieważnić sesji użytkownika, którego wiersza nie wolno usunąć.
 *   3. UCZCIWA GRANICA R12b vs R12a: unieważnienie sesji ≠ unieważnienie
 *      tokenu. Po odebraniu członkostwa surowy, wciąż WAŻNY access token
 *      odbija się o RLS (predykaty live z R12a/0060) — czyli dziura z audytu
 *      jest zamknięta ŁĄCZNIE, a nie samym 0061.
 *   4. Kaskady (usunięcie tenanta / konta) są nieszkodliwe.
 *   5. Wyzwalacz jest AFTER: gdy BEFORE-owy guard ostatniego ownera (0051)
 *      blokuje usunięcie, sesja NIE jest unieważniana (usunięcie nie zaszło).
 *   6. Samousunięcie ownera (jest drugi) unieważnia jego własną sesję.
 *
 * Test punktu 3 zakłada obecność migracji 0060 (R12a) na lokalnej bazie —
 * predykaty `app.is_current_tenant_member()`. Jeśli ich brak, ten JEDEN test
 * sam się pominie z czytelnym powodem (współdzielony lokalny Supabase, nigdy
 * `db reset`); pozostałe (1,2,4,5,6) zależą wyłącznie od 0061.
 */
import { randomUUID } from "node:crypto";

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

const TEST_PASSWORD = "SessionRevoke!12345678";
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
    // autoRefreshToken: false jest KLUCZOWE dla dowodu łącznego (pkt 3): klient
    // ma trzymać wydany access token i NIE próbować go odświeżać — dokładnie tak
    // wygląda surowy, wciąż ważny JWT w rękach odebranego członka.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function createConfirmedUser(admin: SupabaseClient, label: string): Promise<{ id: string; email: string }> {
  const email = `sessrev-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

/** Logowanie hasłem — tworzy wiersz w auth.sessions (to jest ta sesja, którą testujemy). */
async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error || !data.session) throw new Error(`signIn(${email}): ${error?.message}`);
  return client;
}

async function createTenantWithOwner(
  admin: SupabaseClient,
  label: string,
): Promise<{ tenantId: string; owner: { id: string; email: string } }> {
  const owner = await createConfirmedUser(admin, label);
  const bootstrap = await signIn(owner.email);
  const { data: tenantId, error } = await rpcCreateTenant(bootstrap, {
    p_slug: `sessrev-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Sesje ${label}`,
  });
  if (error || !tenantId) throw new Error(`create_tenant(${label}): ${error?.message}`);
  createdTenantIds.push(tenantId as string);
  return { tenantId: tenantId as string, owner };
}

async function addMember(
  admin: SupabaseClient,
  tenantId: string,
  label: string,
  role: "owner" | "staff",
): Promise<{ id: string; email: string }> {
  const user = await createConfirmedUser(admin, label);
  const { error } = await admin.from("members").insert({ tenant_id: tenantId, user_id: user.id, role });
  if (error) throw new Error(`insert members(${label}): ${error.message}`);
  return user;
}

describe.skipIf(!hasEnv)("unieważnianie sesji przy odebraniu roli (0061)", () => {
  let admin: SupabaseClient;
  let sql: ReturnType<typeof postgres>;
  let hasLivePredicates = false;

  async function sessionCount(userId: string): Promise<number> {
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from auth.sessions where user_id = ${userId}
    `;
    return rows[0]?.n ?? 0;
  }

  beforeAll(async () => {
    if (!hasEnv) return;
    admin = createAdminClient();
    sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    const live = await sql<{ present: boolean }[]>`
      select exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'is_current_tenant_member'
      ) as present
    `;
    hasLivePredicates = live[0]?.present ?? false;
  }, 60_000);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    createdTenantIds.length = 0;
    createdUserIds.length = 0;
    await sql.end({ timeout: 5 });
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Wyzwalacz kasuje sesje odebranego członka / superadmina
  // -------------------------------------------------------------------

  it("odebranie CZŁONKOSTWA kasuje sesje tego użytkownika", async () => {
    const { tenantId } = await createTenantWithOwner(admin, "member-del");
    const staff = await addMember(admin, tenantId, "member-del-staff", "staff");
    await signIn(staff.email);

    // Kontrola pozytywna: sesja ISTNIEJE przed odebraniem.
    expect(await sessionCount(staff.id), "staff powinien mieć sesję po zalogowaniu").toBeGreaterThan(0);

    const { error } = await admin.from("members").delete().eq("tenant_id", tenantId).eq("user_id", staff.id);
    expect(error, `usunięcie członka: ${error?.message}`).toBeNull();

    expect(
      await sessionCount(staff.id),
      "wyzwalacz nie unieważnił sesji odebranego członka",
    ).toBe(0);
  });

  it("odebranie SUPERADMINA kasuje sesje (panel nie ma tej ścieżki — łapie wyzwalacz)", async () => {
    const sa = await createConfirmedUser(admin, "sa-del");
    const { error: insErr } = await admin.schema("app").from("superadmins").insert({ user_id: sa.id });
    expect(insErr, `insert superadmin: ${insErr?.message}`).toBeNull();
    await signIn(sa.email);

    expect(await sessionCount(sa.id)).toBeGreaterThan(0);

    const { error } = await admin.schema("app").from("superadmins").delete().eq("user_id", sa.id);
    expect(error, `usunięcie superadmina: ${error?.message}`).toBeNull();

    expect(await sessionCount(sa.id), "wyzwalacz nie unieważnił sesji odebranego superadmina").toBe(0);
  });

  // -------------------------------------------------------------------
  // 2. Cel z OLD, nigdy z wejścia — brak prymitywu „wyloguj dowolnego"
  // -------------------------------------------------------------------

  it("app.revoke_user_sessions NIE jest wykonywalna dla roli authenticated (brak prymitywu)", async () => {
    const victim = await createConfirmedUser(admin, "revoke-victim");
    await signIn(victim.email);
    expect(await sessionCount(victim.id)).toBeGreaterThan(0);

    // Rola authenticated + próba zawołania funkcji wprost z cudzym user_id.
    let errorCode: string | undefined;
    try {
      await sql.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`select app.revoke_user_sessions(${victim.id}::uuid)`;
      });
    } catch (error) {
      errorCode = (error as { code?: string }).code;
    }
    // 42501 = insufficient_privilege (brak EXECUTE). Bez względu na kod: sesja
    // ofiary MUSI przeżyć — kontrola pozytywna twardsza niż sam SQLSTATE.
    expect(errorCode, "authenticated nie ma prawa wołać revoke_user_sessions").toBe("42501");
    expect(
      await sessionCount(victim.id),
      "sesja ofiary zniknęła mimo braku uprawnień — prymityw wylogowania cudzego",
    ).toBeGreaterThan(0);
  });

  it("spreparowany DELETE cudzego wiersza odbija się o RLS → sesja ofiary przeżywa", async () => {
    const a = await createTenantWithOwner(admin, "cross-a");
    const b = await createTenantWithOwner(admin, "cross-b");
    const victimB = await addMember(admin, b.tenantId, "cross-victim", "staff");
    await signIn(victimB.email);
    expect(await sessionCount(victimB.id)).toBeGreaterThan(0);

    // Owner A celuje wprost w wiersz members tenanta B (raw SQL, kontekst usera A).
    const jwt = JSON.stringify({
      sub: a.owner.id,
      role: "authenticated",
      app_metadata: { tenant_id: a.tenantId, role: "owner" },
    });
    let deletedRows = -1;
    await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${jwt}, true)`;
      await tx`set local role authenticated`;
      const rows = await tx`
        delete from public.members
        where tenant_id = ${b.tenantId} and user_id = ${victimB.id}
        returning user_id
      `;
      deletedRows = rows.length;
    });
    expect(deletedRows, "owner A nie ma prawa usunąć członka tenanta B (RLS)").toBe(0);
    expect(
      await sessionCount(victimB.id),
      "sesja członka tenanta B zniknęła z zewnątrz — wyciek",
    ).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------
  // 3. Uczciwa granica R12b vs R12a — surowy token odbija się o RLS
  // -------------------------------------------------------------------

  it("po unieważnieniu sesji surowy WCIĄŻ WAŻNY token odbija się o RLS (łączny dowód z R12a)", async () => {
    if (!hasLivePredicates) {
      // Współdzielony lokalny Supabase bez migracji 0060 (R12a) — nie da się
      // pokazać łącznego dowodu; NIGDY `db reset`. Pomijamy JAWNIE.
      expect(hasLivePredicates, "brak app.is_current_tenant_member (0060/R12a) — test pominięty świadomie").toBe(false);
      return;
    }

    const { tenantId } = await createTenantWithOwner(admin, "combined");
    await addMember(admin, tenantId, "combined-coowner", "owner"); // drugi owner: guard 0051 przepuści usunięcie
    const staff = await addMember(admin, tenantId, "combined-staff", "staff");
    const staffClient = await signIn(staff.email);

    // Baza wyjściowa: członek WIDZI wiersze members swojego tenanta.
    const before = await staffClient.from("members").select("user_id").eq("tenant_id", tenantId);
    expect(before.error, `odczyt przed odebraniem: ${before.error?.message}`).toBeNull();
    expect((before.data ?? []).length, "członek powinien widzieć zespół przed odebraniem").toBeGreaterThan(0);

    // Odebranie członkostwa (przez ownera). Wyzwalacz unieważnia sesję staffa,
    // ale jego access token (w pamięci klienta) jest WCIĄŻ WAŻNY do exp i klient
    // go nie odświeża (autoRefreshToken:false).
    const del = await admin.from("members").delete().eq("tenant_id", tenantId).eq("user_id", staff.id);
    expect(del.error, `odebranie członkostwa: ${del.error?.message}`).toBeNull();
    expect(await sessionCount(staff.id), "sesja staffa powinna być unieważniona").toBe(0);

    // Ten sam, wciąż ważny token — teraz odbija się o RLS (predykat live z R12a):
    // ZERO wierszy, mimo że token technicznie nie wygasł. To jest dowód, że
    // dziura z audytu H-01 jest zamknięta ŁĄCZNIE (R12a odcina dane, R12b sesję).
    const after = await staffClient.from("members").select("user_id").eq("tenant_id", tenantId);
    expect(after.error, `odczyt po odebraniu nie powinien rzucać, tylko zwrócić pustkę: ${after.error?.message}`).toBeNull();
    expect(
      (after.data ?? []).length,
      "surowy token po odebraniu wciąż czyta dane tenanta — dziura H-01 OTWARTA",
    ).toBe(0);
  });

  // -------------------------------------------------------------------
  // 4. Kaskady nieszkodliwe
  // -------------------------------------------------------------------

  it("usunięcie TENANTA kaskaduje na members i wyzwalacz jest nieszkodliwy (bez błędu)", async () => {
    const { tenantId } = await createTenantWithOwner(admin, "cascade-tenant");
    await addMember(admin, tenantId, "cascade-tenant-staff", "staff");
    const { error } = await admin.from("tenants").delete().eq("id", tenantId);
    expect(error, `usunięcie tenanta z aktywnym wyzwalaczem sesji: ${error?.message}`).toBeNull();
    createdTenantIds.splice(createdTenantIds.indexOf(tenantId), 1);
  });

  it("usunięcie KONTA kaskaduje na members/superadmins/sessions i wyzwalacz jest nieszkodliwy", async () => {
    const { owner } = await createTenantWithOwner(admin, "cascade-user");
    const { error } = await admin.auth.admin.deleteUser(owner.id);
    expect(error, `usunięcie konta z aktywnym wyzwalaczem sesji: ${error?.message}`).toBeNull();
    createdUserIds.splice(createdUserIds.indexOf(owner.id), 1);
  });

  // -------------------------------------------------------------------
  // 5. AFTER — guard ostatniego ownera (0051) ma pierwszeństwo
  // -------------------------------------------------------------------

  it("gdy guard ostatniego ownera BLOKUJE usunięcie, sesja NIE jest unieważniana", async () => {
    const { tenantId, owner } = await createTenantWithOwner(admin, "last-owner");
    await signIn(owner.email);
    expect(await sessionCount(owner.id)).toBeGreaterThan(0);

    const jwt = JSON.stringify({
      sub: owner.id,
      role: "authenticated",
      app_metadata: { tenant_id: tenantId, role: "owner" },
    });
    let errorCode: string | undefined;
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${jwt}, true)`;
        await tx`set local role authenticated`;
        await tx`delete from public.members where tenant_id = ${tenantId} and user_id = ${owner.id}`;
      });
    } catch (error) {
      errorCode = (error as { code?: string }).code;
    }
    // BEFORE-owy guard rzuca 23514 → usunięcie nie zaszło → AFTER się nie odpalił.
    expect(errorCode, "guard ostatniego ownera powinien zablokować").toBe("23514");
    expect(
      await sessionCount(owner.id),
      "sesja ownera zniknęła mimo zablokowanego usunięcia — AFTER wyprzedził BEFORE",
    ).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------
  // 6. Samousunięcie ownera (jest drugi) unieważnia własną sesję
  // -------------------------------------------------------------------

  it("samousunięcie ownera (jest drugi) unieważnia jego WŁASNĄ sesję", async () => {
    const { tenantId, owner } = await createTenantWithOwner(admin, "self-remove");
    await addMember(admin, tenantId, "self-remove-coowner", "owner");
    const ownerClient = await signIn(owner.email);
    expect(await sessionCount(owner.id)).toBeGreaterThan(0);

    // Owner usuwa SIEBIE własną sesją (RLS tenant_delete: owner usuwa wiersze
    // swojego tenanta; guard 0051 przepuszcza, bo jest drugi owner).
    const { error } = await ownerClient
      .from("members")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("user_id", owner.id)
      .select("user_id");
    expect(error, `samousunięcie ownera: ${error?.message}`).toBeNull();
    expect(
      await sessionCount(owner.id),
      "samousunięcie nie unieważniło własnej sesji",
    ).toBe(0);
  });
});
