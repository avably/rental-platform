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
//
// PLAN JEST WŁASNOŚCIĄ PRZEBIEGU, NIE WSPÓLNY. Wcześniej wszystkie pliki
// testowe dzieliły JEDEN wiersz o stałym id `rls-test-plan`, a teardown
// kasował go „jeśli nikt nie trzyma". Pliki biegną RÓWNOLEGLE w jednej bazie,
// więc między sprawdzeniem a wstawieniem subskrypcji mieściło się całe okno:
// plik A widzi plan, teardown pliku B nie widzi ani jednej subskrypcji i
// kasuje wiersz, plik A wstawia subskrypcję i dostaje 23503 na
// `subscriptions_plan_id_fkey` — w CI objawem było
// „Nie udało się zasiać przykładowego wiersza w subscriptions”.
// Własny wiersz per proces zamyka to z konstrukcji: nikt inny go nie widzi
// w swoim teardownie, więc nie ma kogo wyprzedzić.
const TEST_PLAN_ID = `rls-test-plan-${randomUUID()}`;
let testPlanSeeded = false;

async function ensureTestPlanId(): Promise<string> {
  if (testPlanSeeded) return TEST_PLAN_ID;
  const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
  try {
    await sql`
      insert into public.plans (id, name, price_grosze)
      values (${TEST_PLAN_ID}, 'RLS test plan', 0)
      on conflict (id) do nothing
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
  testPlanSeeded = true;
  return TEST_PLAN_ID;
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

/**
 * Kategoria katalogu (0072) — ŚWIEŻA przy każdym wywołaniu. Nazwę obejmuje
 * unikat (tenant_id, lower(btrim(name))), a slug unikat (tenant_id, slug),
 * więc stała wartość dawałaby 23505 zamiast 42501 i fałszywą zieleń w macierzy.
 * Slug musi przy tym przejść CHECK kształtu (małe litery, cyfry, myślniki)
 * i NIE MOŻE trafić w app.reserved_store_paths() — prefiks `rls-test-` zamyka
 * oba warunki.
 */
async function createCategory(ctx: SeedCtx, tenantId: string): Promise<string> {
  const unique = randomUUID().slice(0, 8);
  return insertReturningId(ctx, "catalog_categories", {
    tenant_id: tenantId,
    name: `RLS test category ${unique}`,
    slug: `rls-test-category-${unique}`,
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

/**
 * Szkic dokumentu prawnego (0063) — GET-OR-CREATE z tego samego powodu co
 * ensureSite: legal_documents ma UNIQUE(tenant_id, kind), a `kind` przyjmuje
 * dokładnie dwie wartości, więc „świeży rodzic per wywołanie" kolidowałby
 * 23505 przy drugim użyciu. Fabryka legal_document_versions reużywa szkic.
 */
async function ensureLegalDocument(ctx: SeedCtx, tenantId: string): Promise<string> {
  const { data } = await ctx.admin
    .from("legal_documents")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("kind", "terms")
    .maybeSingle();
  if (data) return data.id as string;
  return insertReturningId(ctx, "legal_documents", {
    tenant_id: tenantId,
    kind: "terms",
    title: "RLS test terms",
    body_draft: "RLS test terms body",
    locale: "pl",
  });
}

/**
 * Wiersz wersji regulaminu PLATFORMY (0070) — GET-OR-CREATE placeholder-szkicu
 * v0 (seed migracji 0070; get-or-create na wypadek świeżo zresetowanej bazy
 * w połowie suity). Bezpośrednim połączeniem Postgres jak ensureTestPlanId:
 * rejestr wersji celowo nie ma grantów dla ról API.
 *
 * ZAWSZE wiersz-SZKIC (effective_from IS NULL) — fabryka NIE MOŻE opublikować
 * wersji obowiązującej: baza lokalna jest współdzielona, a obowiązująca wersja
 * uzbroiłaby twarde wymuszenie w app.create_tenant dla WSZYSTKICH równoległych
 * suit. FK dowodu akceptacji nie rozróżnia stanów wersji, więc szkic wystarcza.
 */
async function ensurePlatformTermsVersionId(): Promise<string> {
  const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
  try {
    const existing = await sql<{ id: string }[]>`
      select id from public.platform_terms_versions
      where effective_from is null
      order by version_no asc
      limit 1
    `;
    if (existing.length > 0) return existing[0].id;
    const inserted = await sql<{ id: string }[]>`
      insert into public.platform_terms_versions (title_pl, body_pl, title_en, body_en, effective_from)
      values ('Regulamin świadczenia usługi Avably', '[treść po weryfikacji prawnika]',
              'Avably Terms of Service', '[content pending legal review]', null)
      returning id
    `;
    return inserted[0].id;
  } finally {
    await sql.end({ timeout: 5 });
  }
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

  // --- pola własne (0057_custom_fields.sql) ---
  //
  // Najprostszy poprawny wiersz: typ `text` nie wymaga opcji (CHECK wiąże
  // niepustą tablicę wyłącznie z `select`). Etykieta ŚWIEŻA przy każdym
  // wywołaniu, bo obejmuje ją częściowy unikat
  // (tenant_id, entity, lower(btrim(label))) where archived_at is null —
  // kolizja dawałaby 23505 zamiast 42501 i fałszywą zieleń w macierzy.
  custom_field_definitions: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    entity: "customer",
    field_type: "text",
    label: `RLS test field ${randomUUID().slice(0, 8)}`,
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

  // --- taksonomia katalogu (0072_catalog_categories.sql, ADR-155) ---
  //
  // Nazwa i slug ŚWIEŻE per wywołanie — patrz komentarz przy createCategory.
  catalog_categories: async (_ctx, tenantId) => {
    const unique = randomUUID().slice(0, 8);
    return {
      tenant_id: tenantId,
      name: `RLS test category ${unique}`,
      slug: `rls-test-category-${unique}`,
    };
  },
  // Przypisanie produktu do kategorii. OBA rodzice świeże i z TEGO SAMEGO
  // tenanta: FK są ZŁOŻONE po (tenant_id, …), więc wskazanie cudzego produktu
  // albo cudzej kategorii jest niereprezentowalne. Świeżość jest tu bramką
  // przed 23505 — klucz główny to komplet (tenant_id, product_id, category_id),
  // a kolizja klucza maskowałaby brak odmowy RLS fałszywą zielenią.
  product_categories: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    product_id: await createProduct(ctx, tenantId),
    category_id: await createCategory(ctx, tenantId),
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
  // Rejestr ŻĄDAŃ zwrotu (0031). Bez `provider_reference`: wiersz w stanie
  // `requested` z definicji go nie ma — odpowiedzi dostawcy jeszcze nie
  // znamy, a partial unique index po tej kolumnie i tak pomija NULL-e.
  deposit_refunds: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    order_id: await createOrder(ctx, tenantId),
    amount_grosze: 10_000,
  }),
  // Wpis notatki zamówienia (0039). order_id z createOrder: FK ZŁOŻONY
  // (tenant_id, order_id) wymaga zamówienia TEGO SAMEGO tenanta. created_by
  // pominięty (null = wpis historyczny) — macierz bada RLS, nie autorstwo.
  order_notes: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    order_id: await createOrder(ctx, tenantId),
    body: `RLS test note ${randomUUID().slice(0, 8)}`,
  }),
  // Ban klienta (0040). customer_id z createCustomer: FK ZŁOŻONY
  // (tenant_id, customer_id) wymaga klienta TEGO SAMEGO tenanta. Klucze
  // email_normalized/phone_normalized wypełnia trigger customer_bans_fill
  // z wiersza klienta (nie podajemy ich tutaj) — trigger NIE podnosi wyjątku
  // przy braku klienta, więc przy próbie międzytenantowej odmowa pochodzi
  // z RLS WITH CHECK (42501), nie z 23503.
  customer_bans: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    customer_id: await createCustomer(ctx, tenantId),
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
  // Szkic dokumentu prawnego (0063). Rodzaj 'privacy', a NIE 'terms', i to nie
  // jest kosmetyka: introspekcja zwraca legal_document_versions PRZED
  // legal_documents, więc rodzic tworzony przez ensureLegalDocument ('terms')
  // zajmuje już unikat (tenant_id, kind) w chwili zasiewu tej tabeli.
  // Rozdzielenie rodzajów zdejmuje kolizję zasiewu, nie osłabiając testu:
  // INSERT cross-tenant i tak odbija się 42501, bo RLS WITH CHECK jest
  // egzekwowane przed unikalnością (patrz komentarz przy subscriptions).
  legal_documents: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    kind: "privacy",
    title: "RLS test privacy",
    body_draft: "RLS test privacy body",
    locale: "pl",
  }),
  // Wersja dokumentu (0063). Rodzic przez ensureLegalDocument (FK złożony
  // wymaga szkicu TEGO SAMEGO tenanta), a version_no świeży per wywołanie —
  // obejmuje go unikat (tenant_id, kind, version_no), więc powtórka dałaby
  // 23505 zamiast 42501. sha256 podajemy poprawny kształtem, ale i tak
  // nadpisze go trigger legal_document_versions_stamp.
  legal_document_versions: async (ctx, tenantId) => {
    const versionNo = 100_000 + Math.floor(Math.random() * 800_000);
    return {
      tenant_id: tenantId,
      document_id: await ensureLegalDocument(ctx, tenantId),
      kind: "terms",
      version_no: versionNo,
      version_label: `rls-test-v${versionNo}`,
      title: "RLS test terms",
      body: `RLS test terms body ${randomUUID()}`,
      sha256: randomUUID().replace(/-/g, "").padEnd(64, "0"),
      locale: "pl",
      published_by: await createAuxMemberUser(ctx, tenantId),
    };
  },
  // Unikalny klucz per wywołanie — PK to (tenant_id, key), a kolizja dałaby
  // 23505 zamiast 42501 w teście INSERT-u cross-tenant (patrz usage_counters).
  tenant_settings: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    key: `test_setting_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    value: { enabled: true },
  }),
  // Sekret tenanta (0024). Wartość musi przejść CHECK kształtu koperty
  // ORAZ CHECK zgodności key_version z jej członem — to nie jest dowolny
  // tekst. Sama koperta jest atrapą (macierz izolacji bada RLS, nie
  // kryptografię), ale kształtem odpowiada temu, co produkuje
  // @avably/core/secrets. Unikalny klucz per wywołanie jak w tenant_settings.
  tenant_secrets: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    key: `test_secret_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    ciphertext: "v1:1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCC",
    key_version: 1,
  }),
  // Zdjęcie produktu (0018 + kontrakt ścieżki 0038).
  // product_id z createProduct: FK złożony (tenant_id, product_id) wymaga
  // produktu TEGO SAMEGO tenanta.
  product_images: async (ctx, tenantId) => {
    const productId = await createProduct(ctx, tenantId);
    return {
      tenant_id: tenantId,
      product_id: productId,
      storage_path: `${tenantId}/${productId}/${randomUUID()}.png`,
    };
  },
  product_image_uploads: async (ctx, tenantId) => {
    const id = randomUUID();
    const productId = await createProduct(ctx, tenantId);
    const userId = await createAuxMemberUser(ctx, tenantId);
    return {
      id,
      tenant_id: tenantId,
      product_id: productId,
      requested_by: userId,
      storage_path: `${tenantId}/${productId}/${id}.png`,
      declared_mime: "image/png",
      declared_size: 68,
      status: "pending",
      expires_at: new Date(Date.now() + 900_000).toISOString(),
    };
  },
  // Bilet uploadu zdjęcia sekcji (0043) — lustro product_image_uploads, z
  // rodzicem `sites` (ensureSite) zamiast produktu. FK złożony (tenant_id,
  // site_id) wymaga strony TEGO SAMEGO tenanta; ścieżka spełnia CHECK
  // {tenant}/{site}/{upload_id}.png.
  site_image_uploads: async (ctx, tenantId) => {
    const id = randomUUID();
    const siteId = await ensureSite(ctx, tenantId);
    const userId = await createAuxMemberUser(ctx, tenantId);
    return {
      id,
      tenant_id: tenantId,
      site_id: siteId,
      requested_by: userId,
      storage_path: `${tenantId}/${siteId}/${id}.png`,
      declared_mime: "image/png",
      declared_size: 68,
      status: "pending",
      expires_at: new Date(Date.now() + 900_000).toISOString(),
    };
  },

  // Niezmienny dokument umowy (0026/ADR-061). ID powstaje przed storage_path,
  // bo CHECK wymaga ścieżki {tenant}/{order}/{document}.pdf. Fabryka macierzy
  // tworzy wyłącznie metadane; test Storage ma osobny plik i realny upload.
  contract_documents: async (ctx, tenantId) => {
    const id = randomUUID();
    const orderId = await createOrder(ctx, tenantId);
    const userId = await createAuxMemberUser(ctx, tenantId);
    return {
      id,
      tenant_id: tenantId,
      order_id: orderId,
      storage_path: `${tenantId}/${orderId}/${id}.pdf`,
      sha256: randomUUID().replace(/-/g, "").padEnd(64, "0"),
      locale: "pl",
      terms_version: "rls-test-v1",
      recipient: `contract-${randomUUID()}@test.local`,
      created_by: userId,
    };
  },

  // Historia wysyłek (0021, ADR-045). order_id z createOrder: FK ZŁOŻONY
  // (tenant_id, order_id) wymaga zamówienia TEGO SAMEGO tenanta — log
  // wskazujący cudze zamówienie jest niereprezentowalny (23503; osobny
  // dowód w email-logs.test.ts). Wiersz zasiewany jako UDANA wysyłka, bo
  // CHECK email_logs_result_shape wiąże status z parą
  // (provider_message_id, error) i wariant 'failed' bez powodu nie przejdzie.
  email_logs: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    order_id: await createOrder(ctx, tenantId),
    kind: "rental_confirmed",
    recipient: `log-${randomUUID()}@test.local`,
    subject: "RLS test subject",
    status: "sent",
    provider_message_id: `resend-${randomUUID().slice(0, 8)}`,
  }),

  // --- model sekcyjny storefrontu (0019_site_model.sql, ADR-041) ---
  //
  // Do 0047 `sites` miało UNIQUE(tenant_id) i ta fabryka musiała jednorazowo
  // KASOWAĆ stronę tenanta, żeby zasiew nie kolidował 23505 z wierszem, który
  // wcześniej założyła fabryka `site_sections`. Model stron (0048, ADR-093)
  // zdjął tamten unikat: tenant ma wiele WERSJI strony, a ograniczenie dotyczy
  // wyłącznie ŻYWEJ (unikat częściowy po `published_at`). Fabryka wraca więc do
  // najprostszej postaci — dokłada kolejny wiersz i nikomu nic nie kasuje.
  //
  // Wersja rodzi się NIEŻYWA (bez `published_at`), więc dwa wywołania fabryki
  // dla tego samego tenanta nie mają jak trafić na unikat częściowy.
  //
  // OD 0088 (ADR-199) wiersz macierzy jest WYJĄTKIEM strony produktu — czyli
  // wierszem z KOMPLETEM tożsamości (kind='product' + product_id): macierz ma
  // ćwiczyć RLS na najbogatszym reprezentowalnym wierszu, a zwykłe strony
  // (`kind='page'`) mierzą suity site-model/site-page-slugs na własnych
  // wierszach. Świeży produkt per wywołanie (createProduct) — FK jest ZŁOŻONY
  // (tenant_id, product_id), więc rodzic z cudzego najemcy odbiłby się 23503
  // zamiast oczekiwanego 42501 (pułapka opisana przy product_slug_history).
  // Slug zostaje domyślny (''), bo rola `product` nie ma adresu (CHECK 0080).
  // Trigger limitu (PT409) nie wchodzi macierzy w drogę Z KONSTRUKCJI:
  // zasiew jedzie rolą serwisową (przepustka), a atak INSERT w cudzego
  // najemcę zlicza pod RLS napastnika zero wyjątków ofiary — bramka milczy
  // i odmowa zostaje przy RLS (42501).
  sites: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    template: "classic",
    name: `RLS test page ${randomUUID().slice(0, 8)}`,
    kind: "product",
    product_id: await createProduct(ctx, tenantId),
  }),
  site_sections: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    site_id: await ensureSite(ctx, tenantId),
    type: "hero",
    content_draft: { heading: "RLS test heading" },
  }),
  // --- historia adresów sprzętu (0083_product_slug.sql, ADR-182) ---
  //
  // Slug UNIKALNY per wywołanie: (tenant_id, slug) ma unikat, a kolizja dawałaby
  // 23505 zamiast 42501 (pułapka opisana przy usage_counters). Prefiks
  // `rls-test-` spełnia CHECK kształtu — listy adresów zarezerwowanych ta
  // tabela nie dotyka, bo adres sprzętu jest DRUGIM segmentem ścieżki.
  //
  // ŚWIEŻY rodzic per wywołanie (createProduct), jak przy product_images:
  // wiersz historii nie ma unikatu po product_id, ale i tak potrzebuje sprzętu
  // TEGO tenanta — FK jest złożony (tenant_id, product_id), więc rodzic
  // z cudzego najemcy odbiłby się 23503 zamiast oczekiwanego 42501.
  product_slug_history: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    product_id: await createProduct(ctx, tenantId),
    slug: `rls-test-adres-sprzetu-${randomUUID().slice(0, 8)}`,
  }),
  // --- historia adresów stron (0075_site_slug_history.sql, ADR-159) ---
  //
  // Slug UNIKALNY per wywołanie: (tenant_id, slug) ma unikat, a kolizja dawałaby
  // 23505 zamiast 42501 (pułapka opisana przy usage_counters). Prefiks
  // `rls-test-` spełnia jednocześnie CHECK kształtu i mija listę adresów
  // zarezerwowanych — tak samo jak przy kategoriach (0072).
  site_slug_history: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    site_id: await ensureSite(ctx, tenantId),
    slug: `rls-test-adres-${randomUUID().slice(0, 8)}`,
  }),
  // Unikalna domena per wywołanie — kolumna domain ma UNIQUE globalny, a
  // kolizja dawałaby 23505 zamiast 42501 (pułapka opisana przy usage_counters).
  domains: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    domain: `rls-${randomUUID().slice(0, 12)}.example.com`,
  }),

  // Klucz publicznego API (0053, ADR-108). key_hash ma UNIQUE globalny i CHECK
  // 64-hex — unikalny hash per wywołanie (pułapka 23505 opisana przy
  // usage_counters), budowany z dwóch uuid-ów, żeby nie ciągnąć node:crypto
  // do tego helpera. key_prefix spełnia CHECK ^avbl_[0-9a-f]{8}$.
  api_keys: async (_ctx, tenantId) => {
    const hex = (randomUUID() + randomUUID()).replace(/-/g, "").slice(0, 64);
    return {
      tenant_id: tenantId,
      name: `RLS test key ${randomUUID().slice(0, 8)}`,
      key_hash: hex,
      key_prefix: `avbl_${hex.slice(0, 8)}`,
    };
  },

  // Dowód akceptacji regulaminu platformy (0070, ADR-141). version_id wskazuje
  // placeholder-szkic v0 (FK wymaga istnienia wiersza, nie jego stanu) —
  // fabryka NIE publikuje wersji obowiązującej (patrz ensurePlatformTermsVersionId).
  // user_id świeży per wywołanie: snapshot bez FK, ale unikat
  // (tenant_id, version_id) jest wspólny dla obu tenantów macierzy dopiero
  // per-tenant, więc kolizji 23505 nie ma. INSERT idzie service-rolem (role
  // API celowo bez grantu INSERT — zapis produkcyjny wyłącznie przez funkcje
  // DEFINER), a INSERT cross-tenant w macierzy odbija się na braku grantu
  // tym samym SQLSTATE 42501 co odmowa RLS.
  platform_terms_acceptances: async (ctx, tenantId) => ({
    tenant_id: tenantId,
    user_id: await createAuxMemberUser(ctx, tenantId),
    version_id: await ensurePlatformTermsVersionId(),
    context: "tenant_creation",
  }),

  // Konto najemcy u dostawcy płatności (0028, ADR-065). PK = tenant_id, więc
  // sonda INSERT cross-tenant koliduje kluczem tak samo jak przy
  // subscriptions — i tak samo dostaje 42501, bo WITH CHECK jest egzekwowane
  // przed unikalnością. `provider_account_id` unikalny per wywołanie: kolumna
  // ma UNIQUE (provider, provider_account_id), a kolizja dawałaby 23505
  // zamiast odmowy RLS (pułapka opisana przy usage_counters).
  payment_accounts: async (_ctx, tenantId) => ({
    tenant_id: tenantId,
    provider: "stripe",
    provider_account_id: `acct_rlstest_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
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
  // Wartość MUSI przechodzić CHECK subscriptions_status_check (0067):
  // patch spoza słownika dawałby 23514 zamiast zastosowania — przeciekająca
  // polityka NIE zmieniłaby wiersza i snapshot świeciłby fałszywą zielenią
  // (ta sama pułapka co 23505 przy kolumnach unikalnych, opis wyżej).
  // 'unpaid' ≠ 'active' z fabryki, więc skuteczny zapis jest widoczny.
  subscriptions: { status: "unpaid" },
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
  // position, a NIE name/slug: obie te kolumny obejmują unikaty per tenant
  // (23505 zamiast odmowy), a slug dodatkowo przechodzi przez CHECK kształtu
  // i trigger slugów zarezerwowanych — ich 23514/22023 wyglądałyby na
  // „mutacja zatrzymana" i maskowały zepsutą politykę UPDATE. position jest
  // poza unikatem, spełnia CHECK (0..9999) i różni się od zasianego
  // domyślnego 0, więc skuteczna goła mutacja byłaby WIDOCZNĄ zmianą stanu.
  catalog_categories: { position: 999 },
  // created_at, bo innej kolumny nie ma: wiersz to komplet kluczy plus
  // znacznik czasu (patrz nagłówek tabeli w 0072). Tabela nie ma ani grantu,
  // ani polityki UPDATE, ale macierz i tak wymaga patcha, żeby brak UPDATE był
  // TESTOWANY, a nie pomijany (wzorzec contract_documents).
  product_categories: { created_at: "2000-01-01T00:00:00.000Z" },
  customers: { full_name: "rls-test-hacked" },
  // orders.notes zdjęte w 0041 — patch na delivery_grosze (int, bez indeksu
  // unikalnego, CHECK >= 0 spełniony przez 999_999): goła mutacja nie wywoła
  // ani 23505, ani 23514, więc sonda odróżni odmowę RLS od błędu integralności.
  orders: { delivery_grosze: 999_999 },
  order_items: { rental_grosze: 999_999 },
  deposit_events: { reason: "rls-test-hacked" },
  // last_error jest nullable, bez indeksu unikalnego i poza jakimkolwiek
  // CHECK-iem (0031) — goła mutacja na wszystkich widocznych wierszach nie
  // wywoła ani 23505, ani 23514, więc sonda odróżni odmowę RLS od błędu
  // integralności. `provider_reference` byłby tu pułapką: obejmuje go
  // partial unique index.
  deposit_refunds: { last_error: "rls-test-hacked" },
  tenant_settings: { updated_at: "2000-01-01T00:00:00.000Z" },
  // updated_at, a nie ciphertext: CHECK-i 0024 wiążą kształt koperty
  // z key_version, więc goła mutacja na kolumnie ciphertext wywracałaby się
  // na 23514 zamiast dojść do polityki — a błąd CHECK-a wyglądałby na
  // „mutacja zatrzymana" i maskował zepsutą politykę UPDATE.
  tenant_secrets: { updated_at: "2000-01-01T00:00:00.000Z" },
  // body nie jest objęty żadnym indeksem unikalnym (pułapka 23505 nie dotyczy);
  // goła mutacja na wszystkich widocznych wierszach nie wywoła ani 23505, ani
  // 23514 — sonda odróżni odmowę RLS od błędu integralności (0039).
  order_notes: { body: "rls-test-hacked" },
  // reason jest nullable, bez indeksu unikalnego i z CHECK-iem tylko na długość
  // (btrim 1..500) — „rls-test-hacked" go spełnia, więc goła mutacja nie wywoła
  // ani 23505, ani 23514. customer_bans NIE ma polityki/grantu UPDATE (ban jest
  // binarny), ale macierz i tak wymaga patcha, żeby brak UPDATE był testowany,
  // a nie pomijany (jak contract_documents/0026).
  customer_bans: { reason: "rls-test-hacked" },
  // tracking_number nie jest objęty żadnym indeksem unikalnym (pułapka 23505
  // opisana wyżej nie dotyczy).
  courier_shipments: { tracking_number: "rls-test-hacked" },
  // alt_text jest nullable i bez indeksu unikalnego — goła mutacja na wszystkich
  // widocznych wierszach nie wywoła 23505 (pułapka opisana wyżej nie dotyczy).
  product_images: { alt_text: "rls-test-hacked" },
  product_image_uploads: { status: "rejected" },
  // Lustro product_image_uploads: status bez indeksu unikalnego, CHECK spełniony
  // przez 'rejected' (goła mutacja nie wywoła 23505 ani 23514). Tabela nie ma
  // polityki UPDATE dla authenticated (brak grantu), ale macierz i tak wymaga
  // patcha, żeby brak UPDATE był testowany, a nie pomijany.
  site_image_uploads: { status: "rejected" },
  // Append-only tabela 0026 nie ma polityki UPDATE, ale macierz nadal wymaga
  // poprawnego patcha, żeby brak polityki był testowany, a nie pomijany.
  contract_documents: { terms_version: "rls-test-hacked" },
  // title, a nie version_label ani body: etykietę obejmuje unikat
  // (tenant_id, kind, version_label), a `body` jest źródłem sha256
  // stemplowanego triggerem — patch na którejkolwiek z nich mieszałby odmowę
  // RLS z błędem integralności. title jest poza unikatem i spełnia CHECK
  // długości (0063). Rejestr wersji nie ma grantu UPDATE, ale macierz wymaga
  // patcha, żeby brak polityki był testowany, a nie pomijany.
  legal_document_versions: { title: "rls-test-hacked" },
  // body_draft: poza unikatem, CHECK tylko na długość btrim 1..50000 (0063).
  legal_documents: { body_draft: "rls-test-hacked" },
  // subject: bez indeksu unikalnego i poza CHECK-iem email_logs_result_shape
  // (ten wiąże wyłącznie status z provider_message_id/error), więc goła
  // mutacja na wszystkich widocznych wierszach nie wywoła ani 23505, ani
  // 23514 — sonda odróżni odmowę RLS od błędu integralności (0021).
  email_logs: { subject: "rls-test-hacked" },

  // --- model sekcyjny storefrontu (0019) ---
  //
  // Patche na kolumnach BEZ indeksów unikalnych (template/position/verified —
  // pułapka 23505 nie dotyczy). Zasiane wartości to odpowiednio 'classic',
  // default 0 i default false, więc każdy patch byłby widoczną zmianą stanu.
  sites: { template: "bold" },
  site_sections: { position: 999_999 },
  // created_at, a NIE slug: slug obejmuje unikat (tenant_id, slug), więc patch
  // na nim mieszałby 23505 z odmową uprawnienia. Tabela NIE MA grantu UPDATE
  // dla ról API (zapis robi wyłącznie trigger SECURITY DEFINER, 0075) — patch
  // i tak jest potrzebny, żeby brak UPDATE-u był TESTOWANY, a nie pomijany.
  site_slug_history: { created_at: "2000-01-01T00:00:00.000Z" },
  // Lustro site_slug_history (0083): ta sama pułapka unikatu na slugu, ten sam
  // brak grantu UPDATE (zapis robi wyłącznie trigger SECURITY DEFINER).
  product_slug_history: { created_at: "2000-01-01T00:00:00.000Z" },
  domains: { verified: true },

  // name: bez indeksu unikalnego, CHECK tylko na długość btrim 1..80 —
  // „rls-test-hacked" go spełnia, więc goła mutacja nie wywoła ani 23505,
  // ani 23514 (pułapki opisane wyżej nie dotyczą). key_hash byłby pułapką:
  // UNIQUE globalny + CHECK 64-hex.
  api_keys: { name: "rls-test-hacked" },

  // context, a NIE version_id/tenant_id: context ma CHECK dwuwartościowy
  // ('terms_update' ≠ zasianego 'tenant_creation', więc skuteczna mutacja
  // byłaby widoczną zmianą stanu), a version_id obejmuje unikat
  // (tenant_id, version_id) — patch na nim mieszałby 23505 z odmową.
  // Tabela nie ma grantu UPDATE dla ról API, a strażnik append-only (0070)
  // odpowiada tym samym 42501 co RLS — macierz i tak wymaga patcha, żeby
  // brak UPDATE był testowany, a nie pomijany (wzorzec legal_document_versions).
  platform_terms_acceptances: { context: "terms_update" },

  // charges_enabled, a NIE provider_account_id: bramka zapisu 0028 czyni
  // identyfikator konta niezmiennym (23514), więc goła mutacja na tamtej
  // kolumnie wywracałaby się na triggerze zamiast dojść do polityki — a błąd
  // wyglądałby na „mutacja zatrzymana" i maskował zepsutą politykę UPDATE.
  // Wiersz zasiewany z domyślnym `false`, więc patch jest widoczną zmianą.
  payment_accounts: { charges_enabled: true },

  // position, a NIE label/field_type/entity/options: etykietę obejmuje
  // częściowy unikat (23505 zamiast odmowy), a pozostałe trzy kolumny są pod
  // bramką `custom_field_definitions_guard` — jej 23514 wyglądałby na
  // „mutacja zatrzymana" i maskował zepsutą politykę UPDATE. `position` jest
  // poza unikatem, spełnia CHECK (0..9999) i różni się od zasianego domyślnego
  // 0, więc skuteczna goła mutacja byłaby WIDOCZNĄ zmianą stanu.
  custom_field_definitions: { position: 999 },
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
    // WYŁĄCZNIE WŁASNY wiersz planu (id z randomUUID per proces). Warunek
    // „nikt nie trzyma" zniknął razem ze współdzieleniem: subskrypcje na tym
    // planie należały do tenantów skasowanych linijkę wyżej (kaskada), a
    // cudzych wierszy ten DELETE nie widzi — więc nie ma jak wyprzedzić
    // równoległej suity w połowie jej zasiewu. Wiersz zasiany, ale nieusunięty
    // (proces ubity w połowie) zostaje w LOKALNEJ bazie jako sierota, na którą
    // nic nie liczy — żaden test nie asertuje zawartości katalogu planów poza
    // wierszami nazwanymi wprost (saas-billing-transitions).
    await sql`delete from public.plans where id = ${TEST_PLAN_ID}`;
    await sql`delete from public.audit_log where subject = 'rls-isolation-test'`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
