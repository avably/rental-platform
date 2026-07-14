/**
 * Test schematu rdzenia (packages/db/supabase/migrations/0001_core.sql).
 *
 * Wymaga uruchomionego lokalnego Supabase i zresetowanej bazy
 * (`supabase db reset` z katalogu packages/db) oraz zmiennej
 * SUPABASE_LOCAL_URL wskazującej na bazę Postgres (patrz `supabase status`,
 * domyślnie postgresql://postgres:postgres@127.0.0.1:54322/postgres).
 * Bez tej zmiennej cały pakiet testów jest pomijany — patrz
 * docs/konwencje-migracji.md.
 */
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const LOCAL_DB_URL = process.env.SUPABASE_LOCAL_URL;

// Tabele wprowadzone przez 0001_core.sql — każda nowa tabela per-tenant
// dopisywana tu wg konwencji z docs/konwencje-migracji.md.
const CORE_TABLES = [
  "tenants",
  "members",
  "invitations",
  "plans",
  "subscriptions",
  "usage_counters",
  "audit_log",
] as const;

const APP_FUNCTIONS = ["tenant_id", "is_superadmin"] as const;

const sql = LOCAL_DB_URL ? postgres(LOCAL_DB_URL, { max: 1 }) : null;

describe.skipIf(!LOCAL_DB_URL)("schemat rdzenia — 0001_core.sql", () => {
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it.each(CORE_TABLES)("tabela public.%s istnieje", async (table) => {
    const rows = await sql!`
      select tablename
      from pg_tables
      where schemaname = 'public' and tablename = ${table}
    `;
    expect(rows, `tabela public.${table} nie istnieje`).toHaveLength(1);
  });

  it.each(CORE_TABLES)("tabela public.%s ma włączone RLS", async (table) => {
    const rows = await sql!<{ rowsecurity: boolean }[]>`
      select rowsecurity
      from pg_tables
      where schemaname = 'public' and tablename = ${table}
    `;
    expect(rows, `tabela public.${table} nie istnieje`).toHaveLength(1);
    expect(rows[0]?.rowsecurity, `RLS wyłączone na public.${table}`).toBe(true);
  });

  it.each(APP_FUNCTIONS)("funkcja app.%s() istnieje", async (fn) => {
    const rows = await sql!`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = ${fn}
    `;
    expect(rows.length, `funkcja app.${fn}() nie istnieje`).toBeGreaterThan(0);
  });
});
