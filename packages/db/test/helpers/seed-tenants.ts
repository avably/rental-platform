/**
 * Harness testów izolacji RLS (packages/db/test/rls-isolation.test.ts).
 *
 * Wymaga uruchomionego lokalnego Supabase (`supabase start` z katalogu
 * packages/db) oraz zmiennych środowiskowych:
 *   - SUPABASE_LOCAL_URL           — bezpośrednie połączenie Postgres
 *   - SUPABASE_LOCAL_API_URL       — bazowy URL API (Auth/PostgREST)
 *   - SUPABASE_LOCAL_ANON_KEY      — klucz anon (klienci ownerów)
 *   - SUPABASE_LOCAL_SERVICE_ROLE_KEY — klucz service-role (tylko seeding
 *     danych testowych — service-role omija RLS celowo, wyłącznie po to,
 *     by przygotować dane DO testu izolacji, nigdy jako obiekt testu).
 *
 * Wartości pobiera `supabase status -o env` — patrz docs/konwencje-migracji.md.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";

// supabase-js zawsze konstruuje klienta Realtime, nawet gdy nie jest
// używany — a Node.js 20 (wymagane minimum repo, patrz package.json
// "engines") nie ma natywnego globalnego WebSocket (dodane dopiero w
// Node 22). Testy izolacji RLS nie korzystają z Realtime, ale bez
// jawnego `transport` konstrukcja klienta rzuca błąd na starcie.
const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

export interface TenantCtx {
  tenantId: string;
  ownerUserId: string;
  ownerEmail: string;
  /** Klient zalogowany jako owner tego tenanta (anon key + sesja). */
  ownerClient: SupabaseClient;
}

const TEST_PASSWORD = "RlsTest!12345678";

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Brak zmiennej środowiskowej ${name} — wymagana dla testów izolacji RLS ` +
        `(patrz docs/konwencje-migracji.md).`,
    );
  }
  return value;
}

/** Klient service-role — WYŁĄCZNIE do seedowania/inspekcji na potrzeby testów. */
export function createAdminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function createTenantWithOwner(admin: SupabaseClient, label: string): Promise<TenantCtx> {
  const unique = randomUUID();
  const slug = `rls-test-${label}-${unique}`.slice(0, 39);

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({ slug, name: `RLS test tenant ${label}` })
    .select("id")
    .single();
  if (tenantError || !tenant) {
    throw new Error(`Nie udało się utworzyć tenanta testowego "${label}": ${tenantError?.message}`);
  }
  const tenantId = tenant.id as string;

  const email = `owner-${label}-${unique}@test.local`;
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role: "owner" },
  });
  if (userError || !userData.user) {
    throw new Error(`Nie udało się utworzyć usera testowego "${label}": ${userError?.message}`);
  }
  const ownerUserId = userData.user.id;

  const { error: memberError } = await admin
    .from("members")
    .insert({ tenant_id: tenantId, user_id: ownerUserId, role: "owner" });
  if (memberError) {
    throw new Error(`Nie udało się dodać membera-ownera dla "${label}": ${memberError.message}`);
  }

  const ownerClient = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    ...realtimeTransport,
  });
  const { error: signInError } = await ownerClient.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError) {
    throw new Error(`Logowanie ownera testowego "${label}" nie powiodło się: ${signInError.message}`);
  }

  return { tenantId, ownerUserId, ownerEmail: email, ownerClient };
}

/**
 * Tworzy dwóch niezależnych tenantów (A, B) z zalogowanymi klientami ich
 * ownerów. Reużywane przez wszystkie testy izolacji RLS.
 */
export async function seedTwoTenants(): Promise<{ a: TenantCtx; b: TenantCtx }> {
  const admin = createAdminClient();
  const a = await createTenantWithOwner(admin, "a");
  const b = await createTenantWithOwner(admin, "b");
  return { a, b };
}

// -----------------------------------------------------------------------
// Odkrywanie tabel per-tenant (information_schema + pg_tables)
// -----------------------------------------------------------------------

/**
 * Zwraca nazwy tabel `public` mających kolumnę `tenant_id` — czyli tabele
 * "per-tenant" wg konwencji projektu (docs/konwencje-migracji.md). Dzięki
 * introspekcji każda NOWA tabela z kolumną tenant_id wchodzi do macierzy
 * testów izolacji automatycznie, bez edycji testu.
 *
 * `withoutRls: true` zawęża wynik do tabel, które MAJĄ kolumnę tenant_id,
 * ale NIE MAJĄ włączonego RLS (rowsecurity = false) — to jest lista, która
 * w zielonym buildzie zawsze musi być pusta.
 */
export async function listTenantTables(
  opts: { withoutRls?: boolean } = {},
): Promise<string[]> {
  const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
  try {
    const rowsecurityFilter = opts.withoutRls ? sql`and t.rowsecurity = false` : sql``;
    const rows = await sql<{ table_name: string }[]>`
      select distinct c.table_name
      from information_schema.columns c
      join pg_tables t
        on t.schemaname = c.table_schema
       and t.tablename = c.table_name
      where c.table_schema = 'public'
        and c.column_name = 'tenant_id'
        ${rowsecurityFilter}
      order by c.table_name
    `;
    return rows.map((r) => r.table_name);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// -----------------------------------------------------------------------
// Fabryki przykładowych wierszy — dane DO testu macierzy izolacji
// -----------------------------------------------------------------------

interface SeedCtx {
  admin: SupabaseClient;
}

// public.plans nie ma nadanego GRANT insert nawet dla service_role (katalog
// globalny, celowo zarządzany poza ścieżkami API — patrz 0001_core.sql).
// Zasiew testowego planu idzie więc bezpośrednim połączeniem Postgres,
// tak samo jak introspekcja w `listTenantTables`.
async function ensureTestPlanId(): Promise<string> {
  const planId = "rls-test-plan";
  const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
  try {
    await sql`
      insert into public.plans (id, name, price_grosze)
      values (${planId}, 'RLS test plan', 0)
      on conflict (id) do nothing
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
  return planId;
}

async function createAuxMemberUser(ctx: SeedCtx, tenantId: string): Promise<string> {
  const email = `staff-${randomUUID()}@test.local`;
  const { data, error } = await ctx.admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role: "staff" },
  });
  if (error || !data.user) {
    throw new Error(`Nie udało się utworzyć dodatkowego usera-membera: ${error?.message}`);
  }
  return data.user.id;
}

type SampleRowFactory = (ctx: SeedCtx, tenantId: string) => Promise<Record<string, unknown>>;

/**
 * Rejestr fabryk przykładowych wierszy dla każdej tabeli per-tenant.
 *
 * UWAGA: brak wpisu dla tabeli zwróconej przez `listTenantTables` to
 * ŚWIADOMY, głośny błąd testu (patrz `seedSampleRow`) — nowa tabela
 * per-tenant MUSI dostać tu fabrykę, inaczej macierz izolacji ją odrzuci.
 */
const SAMPLE_ROW_FACTORIES: Record<string, SampleRowFactory> = {
  members: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    user_id: await createAuxMemberUser(ctx, tenantId),
    role: "staff",
  }),
  invitations: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    email: `invite-${randomUUID()}@test.local`,
    role: "staff",
    token_hash: randomUUID(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  }),
  subscriptions: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    plan_id: await ensureTestPlanId(),
    status: "active",
  }),
  usage_counters: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    metric: "test_metric",
    period: new Date().toISOString().slice(0, 10),
    value: 1,
  }),
  audit_log: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    action: "test.action",
    subject: "rls-isolation-test",
  }),
};

/**
 * Buduje (ale NIE wstawia) przykładowy wiersz dla danej tabeli/tenanta.
 * Rzuca czytelny błąd, jeśli tabela nie ma zarejestrowanej fabryki — to
 * jest zamierzona bramka: nowa tabela per-tenant bez fabryki wywala test,
 * zamiast być po cichu pominięta przez macierz izolacji.
 */
export async function buildSampleRow(
  admin: SupabaseClient,
  table: string,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const factory = SAMPLE_ROW_FACTORIES[table];
  if (!factory) {
    throw new Error(
      `Brak zarejestrowanej fabryki danych testowych dla tabeli "${table}" ` +
        `w packages/db/test/helpers/seed-tenants.ts (SAMPLE_ROW_FACTORIES). ` +
        `Nowa tabela per-tenant musi dostać tu wpis, aby wejść do macierzy izolacji RLS.`,
    );
  }
  return factory({ admin }, tenantId);
}

/**
 * Zasiewa jeden przykładowy wiersz dla danej tabeli/tenanta (klientem
 * service-role, bo INSERT dla niektórych tabel — np. audit_log — jest
 * dla ról authenticated celowo zablokowany politykami RLS).
 */
export async function seedSampleRow(
  admin: SupabaseClient,
  table: string,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const row = await buildSampleRow(admin, table, tenantId);
  const { error } = await admin.from(table).insert(row);
  if (error) {
    throw new Error(`Nie udało się zasiać przykładowego wiersza w "${table}": ${error.message}`);
  }
  return row;
}
