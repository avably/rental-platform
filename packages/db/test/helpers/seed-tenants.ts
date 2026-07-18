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

// Rejestr obiektów utworzonych przez harness — sprzątane w cleanupSeeded()
// (afterAll testów), żeby lokalne reruny bez `supabase db reset` nie
// akumulowały userów/tenantów testowych.
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

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
  createdTenantIds.push(tenantId);

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
  createdUserIds.push(ownerUserId);

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

/**
 * Zwraca nazwy tabel PLATFORMOWYCH `public` (bez kolumny tenant_id) bez
 * włączonego RLS — lista, która w zielonym buildzie zawsze musi być pusta.
 *
 * Powód istnienia obok `listTenantTables({ withoutRls: true })`: tamta bramka
 * wybiera tabele PO KOLUMNIE tenant_id, więc tabela platformowa (waitlista
 * produktu, katalog planów) nie wchodziła do niej w ogóle — nowa tabela bez
 * tenant_id i bez RLS przechodziła build na zielono. Ta funkcja zamyka tę
 * lukę: „każda tabela w public ma RLS" jest niezmiennikiem bez wyjątków, a
 * tabele bez tenant_id izolują się politykami opartymi o app.is_superadmin()
 * albo nie mają polityk wcale (fail-closed).
 */
export async function listPlatformTablesWithoutRls(): Promise<string[]> {
  const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
  try {
    const rows = await sql<{ tablename: string }[]>`
      select t.tablename
      from pg_tables t
      where t.schemaname = 'public'
        and t.rowsecurity = false
        and not exists (
          select 1
          from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name = t.tablename
            and c.column_name = 'tenant_id'
        )
      order by t.tablename
    `;
    return rows.map((r) => r.tablename);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Zwraca nazwy WSZYSTKICH tabel w schemacie `public` — baza bramki
 * uprawnień spoza zasięgu RLS (patrz packages/db/test/rls-isolation.test.ts).
 *
 * Osobna funkcja obok `listTenantTables` / `listPlatformTablesWithoutRls`,
 * bo pyta o inny niezmiennik. Tamte dwie dzielą tabele wg tego, JAK się
 * izolują (kolumna tenant_id vs polityki platformowe). TRUNCATE nie podlega
 * politykom RLS w ogóle, więc ten podział jest tu bez znaczenia: bramka musi
 * objąć każdą tabelę w `public`, per-tenant czy platformową, i nie może mieć
 * furtki „tabela nie pasuje do żadnej kategorii".
 *
 * Wyłącznie relkind='r' (tabele zwykłe) — TRUNCATE dotyczy tabel, nie widoków.
 */
export async function listPublicTables(): Promise<string[]> {
  const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
  try {
    const rows = await sql<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
      order by c.relname
    `;
    return rows.map((r) => r.tablename);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Zwraca (tabela, rola, uprawnienie) dla każdego uprawnienia spoza zasięgu
 * RLS, jakie role publiczne mają na tabelach `public` — lista, która w
 * zielonym buildzie zawsze musi być pusta.
 *
 * DLACZEGO NIE information_schema.role_table_grants: ten widok zna wyłącznie
 * przywileje z SQL/92 i NIE raportuje MAINTAIN (PostgreSQL 17+). Zapytanie
 * diagnostyczne po nim pokazywało 3 uprawnienia i milczało o czwartym, choć
 * `anon` miał je na wszystkich tabelach z 0001. `has_table_privilege` pyta
 * silnik wprost i tego ślepego pola nie ma.
 *
 * Uwaga: `has_table_privilege` uwzględnia dziedziczenie przez członkostwo w
 * rolach — czyli dokładnie to, co realnie może rola, a nie to, co jej nadano
 * bezpośrednio. Dla bramki bezpieczeństwa to jedyna sensowna semantyka.
 */
export interface RlsBypassingGrant {
  table: string;
  role: string;
  privilege: string;
}

/** Uprawnienia, których RLS nie widzi, a aplikacja ich dla ról publicznych nie potrzebuje. */
export const RLS_BYPASSING_PRIVILEGES = ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"] as const;
export const PUBLIC_ROLES = ["anon", "authenticated"] as const;

export async function listRlsBypassingGrants(): Promise<RlsBypassingGrant[]> {
  const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
  try {
    // Listy ról i uprawnień wstawiane jako literały, nie parametry: to
    // stałe modułowe (żadna nie pochodzi z zewnątrz, więc nie ma tu
    // powierzchni na wstrzyknięcie), a parametr tablicowy postgres.js
    // dojeżdża do serwera nieotypowany i `unnest` odrzuca go jako `text`.
    const values = (items: readonly string[]) => items.map((item) => `('${item}')`).join(", ");
    const rows = await sql.unsafe<RlsBypassingGrant[]>(`
      select c.relname as table, r.role, p.privilege
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join (values ${values(PUBLIC_ROLES)}) as r(role)
      cross join (values ${values(RLS_BYPASSING_PRIVILEGES)}) as p(privilege)
      where n.nspname = 'public'
        and c.relkind = 'r'
        and has_table_privilege(r.role, c.oid, p.privilege)
      order by c.relname, r.role, p.privilege
    `);
    return rows.map((row) => ({ table: row.table, role: row.role, privilege: row.privilege }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// -----------------------------------------------------------------------
// Sekwencje — uprawnienia poza zasięgiem RLS (0009)
// -----------------------------------------------------------------------

/**
 * Zwraca nazwy WSZYSTKICH sekwencji w schemacie `public`.
 *
 * Osobna funkcja obok `listPublicTables`, bo `relkind` jest inny ('S' vs 'r')
 * — i to jest dokładnie ten szczegół, przez który 0008 przeoczyło sekwencje.
 * Bramka uprawnień patrzyła wyłącznie na `relkind='r'`, więc świeciła na
 * zielono przy sekwencji, na której `anon` miał UPDATE.
 *
 * Sekwencje w `public` nie powstają z jawnego `create sequence` — rodzą się
 * niejawnie przy każdej kolumnie `generated as identity`. Introspekcja jest
 * tu więc jedyną uczciwą metodą: autor migracji, który dodaje kolumnę
 * identity, nie pisze ani jednego słowa o sekwencji i nie ma powodu pamiętać
 * o dopisaniu jej do jakiejkolwiek listy.
 */
export async function listPublicSequences(): Promise<string[]> {
  const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
  try {
    const rows = await sql<{ seqname: string }[]>`
      select c.relname as seqname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'S'
      order by c.relname
    `;
    return rows.map((r) => r.seqname);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export interface SequenceGrant {
  sequence: string;
  role: string;
  privilege: string;
}

/**
 * Komplet uprawnień, jakie w ogóle można mieć na sekwencji. Rola publiczna
 * nie potrzebuje żadnego z nich:
 *   UPDATE — `setval`/`nextval`; setval COFA licznik (patrz 0009),
 *   USAGE  — `nextval`/`currval`,
 *   SELECT — odczyt bieżącej wartości.
 *
 * `nextval` na kolumnie identity NIE wymaga żadnego z nich — sekwencja jest
 * wewnętrzną własnością kolumny, a nie obiektem, do którego rola sięga po
 * prawa (zweryfikowane empirycznie, patrz 0009). Dlatego pusta lista dla ról
 * publicznych nie psuje zapisu do audit_log.
 */
export const SEQUENCE_PRIVILEGES = ["USAGE", "SELECT", "UPDATE"] as const;

/**
 * Zwraca (sekwencja, rola, uprawnienie) dla każdego uprawnienia, jakie role
 * publiczne mają na sekwencjach `public` — lista, która w zielonym buildzie
 * zawsze musi być pusta.
 *
 * Odpowiednik `listRlsBypassingGrants` dla drugiego rodzaju obiektu.
 * `has_sequence_privilege` (nie information_schema) z tego samego powodu, co
 * tam: pyta silnik wprost i uwzględnia dziedziczenie przez członkostwo w
 * rolach, czyli to, co rola realnie MOŻE, a nie to, co jej nadano wprost.
 */
export async function listPublicRoleSequenceGrants(): Promise<SequenceGrant[]> {
  const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
  try {
    // Literały zamiast parametrów — jak w listRlsBypassingGrants: to stałe
    // modułowe (zero powierzchni na wstrzyknięcie), a parametr tablicowy
    // postgres.js dojeżdża nieotypowany i `unnest` odrzuca go jako `text`.
    const values = (items: readonly string[]) => items.map((item) => `('${item}')`).join(", ");
    const rows = await sql.unsafe<SequenceGrant[]>(`
      select c.relname as sequence, r.role, p.privilege
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join (values ${values(PUBLIC_ROLES)}) as r(role)
      cross join (values ${values(SEQUENCE_PRIVILEGES)}) as p(privilege)
      where n.nspname = 'public'
        and c.relkind = 'S'
        and has_sequence_privilege(r.role, c.oid, p.privilege)
      order by c.relname, r.role, p.privilege
    `);
    return rows.map((row) => ({ sequence: row.sequence, role: row.role, privilege: row.privilege }));
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
  createdUserIds.push(data.user.id);
  return data.user.id;
}

// -----------------------------------------------------------------------
// Rodzice FK dla tabel rdzenia wynajmu (0007)
// -----------------------------------------------------------------------
//
// Tabele rdzenia wiążą się kluczami ZŁOŻONYMI (tenant_id, id) — pozycja
// zamówienia nie może wskazać zamówienia innego tenanta (patrz 0007). Fabryki
// muszą więc tworzyć rodziców W TYM SAMYM tenancie, dla którego budują wiersz.
// Każde wywołanie tworzy ŚWIEŻEGO rodzica: payload INSERT-u cross-tenant w
// macierzy nie może kolidować kluczem z wcześniej zasianym wierszem, bo błąd
// 23505 (duplicate key) zamaskowałby brak odmowy RLS fałszywą zielenią.

/** Wstawia wiersz service-rolem i zwraca jego id (rodzic FK dla fabryk). */
async function insertReturningId(
  ctx: SeedCtx,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await ctx.admin.from(table).insert(row).select("id").single();
  if (error || !data) {
    throw new Error(`Nie udało się utworzyć rodzica FK w "${table}": ${error?.message}`);
  }
  return data.id as string;
}

async function createProduct(ctx: SeedCtx, tenantId: string): Promise<string> {
  return insertReturningId(ctx, "products", {
    tenant_id: tenantId,
    name: `RLS test product ${randomUUID().slice(0, 8)}`,
    base_price_day_grosze: 10_000,
  });
}

async function createCustomer(ctx: SeedCtx, tenantId: string): Promise<string> {
  return insertReturningId(ctx, "customers", {
    tenant_id: tenantId,
    email: `customer-${randomUUID()}@test.local`,
    full_name: "RLS test customer",
  });
}

/**
 * Zamówienie z metodą 'courier' — świadomie NIE 'pickup', bo ta wymaga
 * pickup_location_id (CHECK orders_pickup_requires_location w 0007), a
 * macierz izolacji potrzebuje najprostszego poprawnego wiersza. Sam CHECK
 * jest dowodzony osobno, testem negatywnym w rental-core.test.ts.
 *
 * order_number celowo pominięty — nadaje go trigger orders_generate_order_number.
 */
async function createOrder(ctx: SeedCtx, tenantId: string): Promise<string> {
  return insertReturningId(ctx, "orders", {
    tenant_id: tenantId,
    customer_id: await createCustomer(ctx, tenantId),
    start_date: "2026-08-01",
    end_date: "2026-08-03",
    delivery_method: "courier",
  });
}

/**
 * Strona storefrontu tenanta (0019) — GET-OR-CREATE, nie świeży rodzic jak
 * createProduct/createOrder: sites ma UNIQUE(tenant_id) (jedna strona per
 * tenant), więc „świeży rodzic per wywołanie" kolidowałby 23505 przy drugim
 * użyciu. Fabryka site_sections reużywa istniejącą stronę tenanta.
 */
async function ensureSite(ctx: SeedCtx, tenantId: string): Promise<string> {
  const { data } = await ctx.admin.from("sites").select("id").eq("tenant_id", tenantId).maybeSingle();
  if (data) return data.id as string;
  return insertReturningId(ctx, "sites", { tenant_id: tenantId, template: "classic" });
}

// Tenanty, dla których fabryka `sites` zrobiła już jednorazowe sprzątnięcie
// (patrz komentarz przy fabryce) — kolejne wywołania zostawiają wiersz w spokoju.
const sitesFactoryCleanedTenants = new Set<string>();

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
  // Unikalny metric per wywołanie: payload INSERT-u cross-tenant w macierzy
  // NIE może kolidować kluczem głównym z wcześniej zasianym wierszem — kolizja
  // dawałaby błąd 23505 (duplicate key) zamiast 42501 (RLS) i fałszywą zieleń.
  usage_counters: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    metric: `test_metric_${randomUUID().slice(0, 8)}`,
    period: new Date().toISOString().slice(0, 10),
    value: 1,
  }),
  audit_log: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    action: "test.action",
    subject: "rls-isolation-test",
  }),

  // --- rdzeń wynajmu (0007_rental_core.sql) ---
  products: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    name: `RLS test product ${randomUUID().slice(0, 8)}`,
    base_price_day_grosze: 10_000,
  }),
  product_units: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    product_id: await createProduct(ctx, tenantId),
    serial_number: `SN-${randomUUID().slice(0, 8)}`,
  }),
  pricing_tiers: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    product_id: await createProduct(ctx, tenantId),
    tier_days: 7,
    multiplier: 6.5,
    label: "RLS test tier",
  }),
  pickup_locations: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    name: `RLS test location ${randomUUID().slice(0, 8)}`,
    address_city: "Warszawa",
  }),
  customers: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    email: `customer-${randomUUID()}@test.local`,
    full_name: "RLS test customer",
  }),
  orders: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    customer_id: await createCustomer(ctx, tenantId),
    start_date: "2026-08-01",
    end_date: "2026-08-03",
    delivery_method: "courier",
  }),
  order_items: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    order_id: await createOrder(ctx, tenantId),
    product_id: await createProduct(ctx, tenantId),
    rental_grosze: 30_000,
    deposit_grosze: 10_000,
  }),
  deposit_events: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    order_id: await createOrder(ctx, tenantId),
    kind: "collected",
    amount_grosze: 10_000,
  }),
  // Unikalny provider_order_number per wywołanie — dane fikcyjne (0013).
  courier_shipments: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    order_id: await createOrder(ctx, tenantId),
    shipment_type: "outbound",
    provider_order_number: `GK-TEST-${randomUUID().slice(0, 8)}`,
    length_cm: 60,
    width_cm: 40,
    height_cm: 30,
    weight_kg: 10,
  }),
  // Unikalny klucz per wywołanie — PK to (tenant_id, key), a kolizja dałaby
  // 23505 zamiast 42501 w teście INSERT-u cross-tenant (patrz usage_counters).
  tenant_settings: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    key: `test_setting_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    value: { enabled: true },
  }),
  // Zdjęcie produktu (0018). Ścieżka w konwencji {tenant_id}/{product_id}/{uuid}
  // — sama tabela nie wymusza jej kształtu (izolację zapisu PLIKÓW pilnują
  // polityki storage.objects), ale wiersz odzwierciedla realny zapis aplikacji.
  // product_id z createProduct: FK złożony (tenant_id, product_id) wymaga
  // produktu TEGO SAMEGO tenanta.
  product_images: async (ctx, tenantId) => {
    const productId = await createProduct(ctx, tenantId);
    return {
      tenant_id: tenantId,
      product_id: productId,
      storage_path: `${tenantId}/${productId}/${randomUUID()}`,
    };
  },

  // --- model sekcyjny storefrontu (0019_site_model.sql, ADR-041) ---
  //
  // sites ma UNIQUE(tenant_id): jedna strona per tenant. Fabryka jest wołana
  // dwa razy dla tego samego tenanta (zasiew + payload sondy INSERT), a stronę
  // tenanta mogła już wcześniej utworzyć fabryka site_sections (ensureSite).
  // Jednorazowe sprzątnięcie usuwa TAMTĄ stronę, żeby zasiew nie kolidował
  // 23505 na etapie service-role; drugie wywołanie zwraca świeży wiersz BEZ
  // sprzątania — kolizja z zasianym wierszem jest wtedy nieszkodliwa, bo
  // WITH CHECK jest egzekwowane przed unikalnością i sonda i tak dostaje
  // 42501 (wzorzec subscriptions, PK = tenant_id).
  sites: async (ctx, tenantId) => {
    if (!sitesFactoryCleanedTenants.has(tenantId)) {
      sitesFactoryCleanedTenants.add(tenantId);
      const { error } = await ctx.admin.from("sites").delete().eq("tenant_id", tenantId);
      if (error) {
        throw new Error(`Nie udało się sprzątnąć strony tenanta przed zasiewem sites: ${error.message}`);
      }
    }
    return { tenant_id: tenantId, template: "classic" };
  },
  site_sections: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    site_id: await ensureSite(ctx, tenantId),
    type: "hero",
    content_draft: { heading: "RLS test heading" },
  }),
  // Unikalna domena per wywołanie — kolumna domain ma UNIQUE globalny, a
  // kolizja dawałaby 23505 zamiast 42501 (pułapka opisana przy usage_counters).
  domains: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    domain: `rls-${randomUUID().slice(0, 12)}.example.com`,
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

// -----------------------------------------------------------------------
// Patche mutacji — wartości do prób UPDATE cross-tenant w macierzy
// -----------------------------------------------------------------------

/**
 * Per-tabela patch UPDATE, którego skuteczne zastosowanie na wierszu
 * tenanta B byłoby WIDOCZNĄ zmianą stanu (weryfikowaną potem odczytem
 * service-role). Celowo NIE `{ tenant_id: ... }` — to byłby no-op wartości.
 * Brak wpisu = głośny błąd (jak w SAMPLE_ROW_FACTORIES).
 */
const MUTATION_PATCHES: Record<string, Record<string, unknown>> = {
  members: { role: "owner" },
  invitations: { email: "hacked@test.local" },
  subscriptions: { status: "rls-test-hacked" },
  usage_counters: { value: 999_999 },
  audit_log: { action: "rls-test-hacked" },

  // --- rdzeń wynajmu (0007_rental_core.sql) ---
  //
  // Patche celowo omijają kolumny objęte indeksem unikalnym (products.name jest
  // wolna, ale np. product_units.serial_number, customers.email i
  // orders.order_number już nie). Goła mutacja `update <tabela> set <patch>`
  // dotyka WSZYSTKICH widocznych wierszy naraz, więc patch na kolumnie
  // unikalnej wywoływałby 23505 — sonda potraktowałaby wyjątek jak odmowę
  // i dała fałszywą zieleń niezależnie od stanu polityk.
  products: { name: "rls-test-hacked" },
  product_units: { unavailable_reason: "rls-test-hacked" },
  pricing_tiers: { label: "rls-test-hacked" },
  pickup_locations: { name: "rls-test-hacked" },
  customers: { full_name: "rls-test-hacked" },
  orders: { notes: "rls-test-hacked" },
  order_items: { rental_grosze: 999_999 },
  deposit_events: { reason: "rls-test-hacked" },
  tenant_settings: { updated_at: "2000-01-01T00:00:00.000Z" },
  // tracking_number nie jest objęty żadnym indeksem unikalnym (pułapka 23505
  // opisana wyżej nie dotyczy).
  courier_shipments: { tracking_number: "rls-test-hacked" },
  // alt_text jest nullable i bez indeksu unikalnego — goła mutacja na wszystkich
  // widocznych wierszach nie wywoła 23505 (pułapka opisana wyżej nie dotyczy).
  product_images: { alt_text: "rls-test-hacked" },

  // --- model sekcyjny storefrontu (0019) ---
  //
  // Patche na kolumnach BEZ indeksów unikalnych (template/position/verified —
  // pułapka 23505 nie dotyczy). Zasiane wartości to odpowiednio 'classic',
  // default 0 i default false, więc każdy patch byłby widoczną zmianą stanu.
  sites: { template: "bold" },
  site_sections: { position: 999_999 },
  domains: { verified: true },
};

export function mutationPatch(table: string): Record<string, unknown> {
  const patch = MUTATION_PATCHES[table];
  if (!patch) {
    throw new Error(
      `Brak zarejestrowanego patcha mutacji dla tabeli "${table}" ` +
        `w packages/db/test/helpers/seed-tenants.ts (MUTATION_PATCHES). ` +
        `Nowa tabela per-tenant musi dostać tu wpis, aby wejść do macierzy izolacji RLS.`,
    );
  }
  return patch;
}

// -----------------------------------------------------------------------
// Teardown — sprzątanie danych testowych (stabilność lokalnych rerunów)
// -----------------------------------------------------------------------

/**
 * Usuwa wszystkie obiekty utworzone przez harness w tej sesji testowej:
 * userów auth (auth.admin.deleteUser) i tenantów (kaskada czyści members/
 * invitations/subscriptions/usage_counters; audit_log dostaje tenant_id
 * null przez on delete set null). Testowy plan usuwany bezpośrednim
 * połączeniem Postgres (public.plans nie ma GRANT delete przez API).
 */
export async function cleanupSeeded(admin: SupabaseClient): Promise<void> {
  for (const userId of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      throw new Error(`Teardown: nie udało się usunąć usera ${userId}: ${error.message}`);
    }
  }
  createdUserIds.length = 0;

  if (createdTenantIds.length > 0) {
    const { error } = await admin.from("tenants").delete().in("id", createdTenantIds);
    if (error) {
      throw new Error(`Teardown: nie udało się usunąć tenantów testowych: ${error.message}`);
    }
    createdTenantIds.length = 0;
  }

  const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
  try {
    await sql`delete from public.plans where id = 'rls-test-plan'`;
    await sql`delete from public.audit_log where subject = 'rls-isolation-test'`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
