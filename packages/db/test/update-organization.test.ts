import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";

/**
 * SAMOOBSŁUGA DANYCH ORGANIZACJI (0093, ADR-225).
 *
 * `app.update_organization(p_name, p_locale)` daje WŁAŚCICIELOWI jedną wąską
 * ścieżkę zapisu do `tenants`, której RLS mu nie daje (superadmin_update, 0001).
 * Plik dowodzi pięciu rzeczy, a każda psuje się inaczej:
 *
 *   1. HAPPY PATH — owner zmienia name+locale własnej org i wiersz to pokazuje;
 *   2. NIEZMIENNIK KOLUMN — po wywołaniu ZMIENIAJĄ SIĘ WYŁĄCZNIE name+locale,
 *      ani jedna inna kolumna (status/plan/slug/…). To jest zdanie, dla którego
 *      wybrano RPC zamiast polityki `for update`: dowód mutacyjny (poszerz UPDATE
 *      w migracji o `status` → ta asercja robi się czerwona);
 *   3. ROLA — staff (nie-owner) dostaje 42501 i NIC nie zapisuje. Owner przez
 *      ten sam mechanizm sesji przechodzi (kontrola pozytywna — bez niej „odmowa"
 *      nie dowodzi bramki, tylko złej konstrukcji sesji);
 *   4. IZOLACJA — wywołanie ownera A zmienia WYŁĄCZNIE wiersz A; wiersz B
 *      nietknięty. Tenant bierze się z app.tenant_id(), nie z argumentu, więc
 *      „zmień cudzą org" jest NIEWYRAŻALNE, a nie odmawiane;
 *   5. WALIDACJA — pusta nazwa i locale spoza {pl,en} → 22023, bez zapisu.
 *
 * Plus regresja: trigger `tenants_guard_published` (0076) nietknięty, a anon nie
 * ma EXECUTE. Wymaga lokalnego Supabase i SUPABASE_LOCAL_* (patrz seed-tenants).
 */
const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/** Odmowa UPRAWNIENIA — ten sam SQLSTATE, co RLS i grant (ADR-091). */
const PG_INSUFFICIENT_PRIVILEGE = "42501";
/** Odmowa WALIDACJI — jedno zdanie dla wszystkich powodów (wzorzec 0076/0077). */
const PG_INVALID_PARAMETER = "22023";

const sql = process.env.SUPABASE_LOCAL_URL
  ? postgres(process.env.SUPABASE_LOCAL_URL, { max: 1 })
  : null;

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

let admin: SupabaseClient;
let anon: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;
/** Staff najemcy A — dowód progu roli (owner-only) idzie po nim. */
let staffUserId: string;

function createAnonClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_LOCAL_API_URL as string,
    process.env.SUPABASE_LOCAL_ANON_KEY as string,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...realtimeTransport,
    },
  );
}

function updateOrg(client: SupabaseClient, name: string, locale: string) {
  return client.schema("app").rpc("update_organization", { p_name: name, p_locale: locale });
}

/** Pełny wiersz tenanta — czytany bezpośrednim połączeniem (omija RLS odczytu). */
async function tenantRow(tenantId: string): Promise<Record<string, unknown>> {
  const [row] = await sql!<Record<string, unknown>[]>`
    select * from public.tenants where id = ${tenantId}
  `;
  return row!;
}

/** Wiersz tenanta bez pól, które ta ścieżka WOLNO zmieniać. */
function withoutEditable(row: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...row };
  delete rest.name;
  delete rest.locale;
  return rest;
}

describe.skipIf(!hasEnv)("samoobsługa danych organizacji (0093, ADR-225)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    anon = createAnonClient();
    ({ a, b } = await seedTwoTenants());

    // Staff najemcy A. Członkostwo zakładamy WPROST w bazie (jak w
    // tenant-appearance.test.ts): sesję staffa symulujemy niżej ustawieniem
    // claimów w transakcji, więc user nie musi się logować przez GoTrue.
    staffUserId = randomUUID();
    await sql!`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values (${staffUserId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${`org-staff-${staffUserId}@test.local`}, '', now(), now())
    `;
    await sql!`
      insert into public.members (tenant_id, user_id, role)
      values (${a.tenantId}, ${staffUserId}, 'staff')
    `;
  }, 60_000);

  afterAll(async () => {
    if (staffUserId) {
      await sql!`delete from public.members where user_id = ${staffUserId}`;
      await sql!`delete from auth.users where id = ${staffUserId}`;
    }
    await cleanupSeeded(admin);
    await sql?.end({ timeout: 5 });
  });

  it("HAPPY PATH: owner zmienia nazwę i język własnej organizacji", async () => {
    const nowa = `Wypożyczalnia ${randomUUID().slice(0, 8)}`;
    const { error } = await updateOrg(a.ownerClient, `  ${nowa}  `, "en");
    expect(error, error?.message).toBeNull();

    const row = await tenantRow(a.tenantId);
    // Nazwa PRZYCIĘTA (btrim w funkcji), język zmieniony na wskazany.
    expect(row.name).toBe(nowa);
    expect(row.locale).toBe("en");
  });

  it("NIEZMIENNIK KOLUMN: zmieniają się WYŁĄCZNIE name+locale (dowód mutacyjny)", async () => {
    // Znany, deterministyczny punkt wyjścia NIEZALEŻNY od kolejności testów:
    // status ustawiamy wprost na 'trialing' (bezpośrednim połączeniem — omija
    // RLS i guard, a status nie jest kolumną strażnika). Bez tego kroku dowód
    // mutacyjny byłby próżny: mutant `set status='active'` odpaliłby w
    // wcześniejszym teście, a porównanie przed/po widziałoby 'active'='active'
    // (lekcja: niepusty diff/„brak zmiany" nie dowodzi niezmiennika, jeśli
    // mutacja odpaliła przed snapshotem).
    await sql!`update public.tenants set status = 'trialing' where id = ${a.tenantId}`;
    const przed = await tenantRow(a.tenantId);
    expect(przed.status, "kontrola: baseline status").toBe("trialing");

    const { error } = await updateOrg(a.ownerClient, "Nazwa po zmianie", "pl");
    expect(error, error?.message).toBeNull();

    const po = await tenantRow(a.tenantId);

    // Zmieniło się to, co miało.
    expect(po.name).toBe("Nazwa po zmianie");
    expect(po.locale).toBe("pl");

    // I NIC poza tym. Pełny wiersz bez name/locale musi być identyczny — to
    // łapie KAŻDĄ dołożoną kolumnę, nie tylko status.
    expect(withoutEditable(po), "poza name+locale wiersz musi być nietknięty").toEqual(
      withoutEditable(przed),
    );

    // Asercje nazwane WPROST — status/slug to kolumny, które polityka
    // `for update` oddałaby ownerowi, a RPC nie tyka.
    expect(po.status, "owner ruszył status przez update_organization").toBe(przed.status);
    expect(po.slug, "owner ruszył slug przez update_organization").toBe(przed.slug);
    expect(po.id).toBe(przed.id);
    expect(po.created_at).toEqual(przed.created_at);
  });

  it("ROLA: staff dostaje 42501 i nic nie zapisuje; owner przez tę samą sesję przechodzi", async () => {
    // Sesję symulujemy claimami w transakcji (jak tenant-appearance): to samo,
    // co robi PostgREST — app.tenant_id() czyta request.jwt.claims, auth.uid()
    // czyta sub. Bramka `app.is_tenant_owner()` pyta WPROST o wiersz members.
    const asClaims = async <T>(
      claims: Record<string, unknown>,
      fn: (tx: postgres.TransactionSql) => Promise<T>,
    ): Promise<T> =>
      sql!.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
        await tx`set local role authenticated`;
        return fn(tx);
      });

    const ownerClaims = {
      sub: a.ownerUserId,
      role: "authenticated",
      app_metadata: { tenant_id: a.tenantId, role: "owner" },
    };
    const staffClaims = {
      sub: staffUserId,
      role: "authenticated",
      app_metadata: { tenant_id: a.tenantId, role: "staff" },
    };

    // KONTROLA POZYTYWNA — owner przez ten sam mechanizm sesji przechodzi.
    await expect(
      asClaims(ownerClaims, (tx) => tx`select app.update_organization('Owner OK', 'pl')`),
    ).resolves.toBeDefined();

    const przed = await tenantRow(a.tenantId);

    // NEGATYW — staff nie ma prawa; 42501, nie 22023 (to odmowa ROLI, nie danych).
    await expect(
      asClaims(staffClaims, (tx) => tx`select app.update_organization('Staff Hack', 'en')`),
      "staff zapisał dane organizacji",
    ).rejects.toMatchObject({ code: PG_INSUFFICIENT_PRIVILEGE });

    // Wiersz nietknięty przez odrzuconą próbę staffa.
    expect(await tenantRow(a.tenantId)).toEqual(przed);
  });

  it("IZOLACJA: wywołanie ownera A zmienia wiersz A, nie wiersz B", async () => {
    const przedB = await tenantRow(b.tenantId);

    const nowaA = `Tylko A ${randomUUID().slice(0, 8)}`;
    const { error } = await updateOrg(a.ownerClient, nowaA, "en");
    expect(error, error?.message).toBeNull();

    // Wiersz B BAJTOWO nietknięty — funkcja nie ma jak wskazać cudzego tenanta.
    expect(await tenantRow(b.tenantId), "wywołanie ownera A ruszyło wiersz B").toEqual(przedB);
    // A wiersz A dostał nową wartość (kontrola pozytywna — dowód nie po pustym).
    expect((await tenantRow(a.tenantId)).name).toBe(nowaA);

    // Owner A nie widzi nawet wiersza B przez RLS odczytu (own_select).
    const foreign = await a.ownerClient.from("tenants").select("id, name").eq("id", b.tenantId);
    expect(foreign.data ?? []).toEqual([]);
  });

  it("WALIDACJA: pusta nazwa i locale spoza {pl,en} → 22023, bez zapisu", async () => {
    const przed = await tenantRow(a.tenantId);

    // Sama spacja: btrim daje pusty string.
    const pusta = await updateOrg(a.ownerClient, "   ", "pl");
    expect(pusta.error?.code, "pusta nazwa przeszła").toBe(PG_INVALID_PARAMETER);

    // Locale spoza zamkniętego zbioru — odbity ZANIM dojdzie do CHECK-u bazy.
    const zlyLocale = await updateOrg(a.ownerClient, "Poprawna nazwa", "de");
    expect(zlyLocale.error?.code, "zły locale przeszedł").toBe(PG_INVALID_PARAMETER);

    // Żaden z odrzutów nie ruszył wiersza.
    expect(await tenantRow(a.tenantId)).toEqual(przed);
  });

  it("REGRESJA: trigger tenants_guard_published nietknięty", async () => {
    const [row] = await sql!<{ tgname: string }[]>`
      select tgname from pg_trigger
      where tgrelid = 'public.tenants'::regclass
        and tgname = 'tenants_guard_published'
        and not tgisinternal
    `;
    expect(row?.tgname, "strażnik kolumn opublikowanych zniknął z tenants").toBe(
      "tenants_guard_published",
    );
  });

  it("GRANT: anon nie ma EXECUTE na update_organization", async () => {
    const { error } = await updateOrg(anon, "Anon", "pl");
    expect(error?.code, "anon dostał EXECUTE").toBe(PG_INSUFFICIENT_PRIVILEGE);
  });
});
