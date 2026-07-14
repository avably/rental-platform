/**
 * Macierz testów izolacji RLS — najważniejszy artefakt bezpieczeństwa
 * Fazy 0 (patrz plan zadaniowy, Task 5). Weryfikuje, że:
 *
 *   1. każda tabela per-tenant (kolumna tenant_id) ma włączone RLS,
 *   2. nowa tabela per-tenant bez RLS zostaje WYKRYTA przez harness
 *      (test-przynęta — dowód, że bramka rzeczywiście łapie regresje),
 *   3. żaden tenant nie widzi ani nie modyfikuje (SELECT/INSERT/UPDATE/
 *      DELETE) danych innego tenanta — dla KAŻDEJ tabeli per-tenant
 *      zwróconej przez introspekcję, automatycznie.
 *
 * Wymaga uruchomionego lokalnego Supabase (`supabase start` z katalogu
 * packages/db, patrz docs/konwencje-migracji.md) i zmiennych
 * SUPABASE_LOCAL_URL / SUPABASE_LOCAL_API_URL / SUPABASE_LOCAL_ANON_KEY /
 * SUPABASE_LOCAL_SERVICE_ROLE_KEY. Bez nich cały plik jest pomijany.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import {
  buildSampleRow,
  createAdminClient,
  listTenantTables,
  seedSampleRow,
  seedTwoTenants,
} from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = REQUIRED_ENV.every((name) => Boolean(process.env[name]));

describe.skipIf(!hasEnv)("izolacja tenantów (RLS)", () => {
  it("każda tabela per-tenant ma włączone RLS", async () => {
    const missing = await listTenantTables({ withoutRls: true });
    expect(missing, "tabele z kolumną tenant_id bez włączonego RLS").toEqual([]);
  });

  describe("test-przynęta: nowa tabela bez RLS musi zostać wykryta", () => {
    const baitTable = `_rls_bait_${Date.now()}`;
    let sql: ReturnType<typeof postgres>;

    beforeEach(async () => {
      sql = postgres(process.env.SUPABASE_LOCAL_URL as string, { max: 1 });
      await sql.unsafe(`
        create table public.${baitTable} (
          tenant_id uuid not null,
          value text
        )
      `);
    });

    afterEach(async () => {
      await sql.unsafe(`drop table if exists public.${baitTable}`);
      await sql.end({ timeout: 5 });
    });

    it("listTenantTables({ withoutRls: true }) wykrywa tabelę-przynętę", async () => {
      const missing = await listTenantTables({ withoutRls: true });
      expect(missing, "harness nie wykrył nowej tabeli bez RLS").toContain(baitTable);
    });
  });

  it(
    "tenant A nie widzi i nie modyfikuje danych tenanta B (macierz SELECT/INSERT/UPDATE/DELETE)",
    async () => {
      const { a, b } = await seedTwoTenants();
      const admin = createAdminClient();
      const tables = await listTenantTables({});
      expect(tables.length, "macierz izolacji nie objęła żadnej tabeli — regresja introspekcji").toBeGreaterThan(0);

      for (const table of tables) {
        // `members` ma już po jednym wierszu-ownerze per tenant z seedTwoTenants —
        // dla pozostałych tabel dosiewamy przykładowy wiersz tenanta B.
        if (table !== "members") {
          await seedSampleRow(admin, table, b.tenantId);
        }

        // --- SELECT: A nie widzi wierszy B ---
        const { data: selected, error: selectError } = await a.ownerClient
          .from(table)
          .select("*")
          .eq("tenant_id", b.tenantId);
        expect(selectError, `SELECT ${table}: nieoczekiwany błąd zamiast filtrowania`).toBeNull();
        expect(selected ?? [], `SELECT ${table}: ujawnił wiersze tenanta B`).toHaveLength(0);

        // --- INSERT: A nie może wstawić wiersza z cudzym tenant_id ---
        const insertPayload = await buildSampleRow(admin, table, b.tenantId);
        const { error: insertError } = await a.ownerClient.from(table).insert(insertPayload);
        expect(
          insertError,
          `INSERT ${table}: wstawienie wiersza z tenant_id cudzego tenanta powinno zostać odrzucone`,
        ).not.toBeNull();

        // --- UPDATE: A nie może zmodyfikować wiersza B ---
        const { data: updated, error: updateError } = await a.ownerClient
          .from(table)
          .update({ tenant_id: b.tenantId })
          .eq("tenant_id", b.tenantId)
          .select("*");
        if (!updateError) {
          expect(updated ?? [], `UPDATE ${table}: zmodyfikował wiersz tenanta B`).toHaveLength(0);
        }

        // --- DELETE: A nie może usunąć wiersza B ---
        const { data: deleted, error: deleteError } = await a.ownerClient
          .from(table)
          .delete()
          .eq("tenant_id", b.tenantId)
          .select("*");
        if (!deleteError) {
          expect(deleted ?? [], `DELETE ${table}: usunął wiersz tenanta B`).toHaveLength(0);
        }
      }
    },
    60_000,
  );
});
