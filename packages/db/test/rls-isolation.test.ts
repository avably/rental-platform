/**
 * Macierz testów izolacji RLS — najważniejszy artefakt bezpieczeństwa
 * Fazy 0 (patrz plan zadaniowy, Task 5). Weryfikuje, że:
 *
 *   1. każda tabela per-tenant (kolumna tenant_id) ma włączone RLS,
 *   2. nowa tabela per-tenant bez RLS zostaje WYKRYTA przez harness
 *      (test-przynęta — dowód, że bramka rzeczywiście łapie regresje),
 *   3. żaden tenant nie widzi ani nie modyfikuje (SELECT/INSERT/UPDATE/
 *      DELETE) danych innego tenanta — dla KAŻDEJ tabeli per-tenant
 *      zwróconej przez introspekcję, automatycznie,
 *   4. tabela tenants (izolowana po `id`, nie po kolumnie tenant_id,
 *      więc poza automatyczną macierzą) nie ujawnia cudzych wierszy.
 *
 * KLUCZOWE dla wiarygodności macierzy: skuteczność blokady UPDATE/DELETE
 * NIE jest wnioskowana z odpowiedzi PostgREST (RETURNING angażuje politykę
 * SELECT i potrafi zamaskować udaną mutację), tylko z odczytu TRWAŁEGO
 * stanu wierszy tenanta B klientem service-role (omija RLS) po każdej
 * próbie ataku. Próby mutacji wykonywane są zarówno z filtrem
 * .eq("tenant_id", B) jak i z filtrem obejmującym WSZYSTKIE wiersze
 * (odpowiednik gołego update/delete na tabeli) — to ta druga ścieżka
 * realnie wycieka przy zepsutej polityce USING.
 *
 * Wymaga uruchomionego lokalnego Supabase (`supabase start` z katalogu
 * packages/db, patrz docs/konwencje-migracji.md) i zmiennych
 * SUPABASE_LOCAL_URL / SUPABASE_LOCAL_API_URL / SUPABASE_LOCAL_ANON_KEY /
 * SUPABASE_LOCAL_SERVICE_ROLE_KEY. Bez nich cały plik jest pomijany.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import {
  buildSampleRow,
  cleanupSeeded,
  createAdminClient,
  listTenantTables,
  mutationPatch,
  seedSampleRow,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = REQUIRED_ENV.every((name) => Boolean(process.env[name]));

// Kod Postgres 42501 = insufficient_privilege — naruszenie polityki RLS
// (with check) albo brak GRANT-u tabelarycznego. Asercja na konkretny kod
// odróżnia odmowę RLS od np. 23505 (duplicate key), która maskowałaby
// dziurę w izolacji fałszywą zielenią.
const PG_INSUFFICIENT_PRIVILEGE = "42501";

/** Deterministyczna migawka wierszy tenanta w tabeli — odczyt service-role. */
async function snapshotTenantRows(
  admin: SupabaseClient,
  table: string,
  tenantId: string,
): Promise<string[]> {
  const { data, error } = await admin.from(table).select("*").eq("tenant_id", tenantId);
  if (error) {
    throw new Error(`Migawka service-role dla "${table}" nie powiodła się: ${error.message}`);
  }
  return normalizeRows(data ?? []);
}

function normalizeRows(rows: Record<string, unknown>[]): string[] {
  return rows
    .map((row) => JSON.stringify(row, Object.keys(row).sort()))
    .sort();
}

// Klasa-sygnał do wymuszenia ROLLBACK transakcji sondującej (patrz niżej).
class Rollback extends Error {}

/**
 * Rdzeń macierzy UPDATE/DELETE: reprodukuje realny wektor ataku, którego
 * ścieżka PostgREST NIE potrafi wykryć. Klient PostgREST wykonuje mutację
 * z filtrem czytającym kolumny (`.eq/.neq`), przez co Postgres nakłada na
 * nią politykę SELECT — a ta maskuje zepsutą politykę UPDATE/DELETE (wynik
 * fałszywie zielony). Tutaj łączymy się BEZPOŚREDNIO z Postgresem, w
 * transakcji przełączamy się na rolę `authenticated` z podstawionymi
 * claimami tenanta A (dokładnie tak, jak robi to authenticator Supabase po
 * zalogowaniu) i wykonujemy GOŁĄ mutację bez klauzuli WHERE. Bez WHERE
 * czytającego kolumny polityka SELECT nie ma zastosowania — o zasięgu
 * mutacji decyduje WYŁĄCZNIE polityka USING danej operacji. Zasięg mierzymy
 * odczytem stanu po `reset role` (znów superuser, RLS omijane) i cofamy całą
 * sondę ROLLBACK-iem, żeby nie było efektów ubocznych na danych macierzy.
 *
 * Zwraca, czy goła mutacja tenanta A dosięgła trwałych wierszy tenanta B.
 */
async function crossTenantMutationLeaks(
  sql: ReturnType<typeof postgres>,
  table: string,
  aClaims: { sub: string; tenantId: string },
  bTenantId: string,
  patch: Record<string, unknown>,
): Promise<{ updateLeaks: boolean; deleteLeaks: boolean }> {
  const jwt = JSON.stringify({
    sub: aClaims.sub,
    role: "authenticated",
    app_metadata: { tenant_id: aClaims.tenantId, role: "owner" },
  });

  // Baseline liczony TYM SAMYM połączeniem, co odczyt po mutacji — inaczej
  // różnice serializacji (Date vs ISO-string między postgres.js a supabase-js)
  // dawałyby fałszywy „wyciek".
  const baseline = JSON.stringify(
    normalizeRows(
      await sql<Record<string, unknown>[]>`select * from ${sql(table)} where tenant_id = ${bTenantId}`,
    ),
  );

  async function probe(mutate: (tx: ReturnType<typeof postgres>) => Promise<void>): Promise<boolean> {
    let leaked = false;
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${jwt}, true)`;
        await tx`set local role authenticated`;
        try {
          await mutate(tx);
        } catch {
          // Mutacja odrzucona (brak GRANT tabelarycznego lub polityka USING
          // nie dopuściła żadnego wiersza) — z definicji brak wycieku. Txn
          // jest już w stanie aborted, więc kończymy sondę ROLLBACK-iem.
          throw new Rollback();
        }
        await tx`reset role`;
        const rows = await tx<Record<string, unknown>[]>`
          select * from ${tx(table)} where tenant_id = ${bTenantId}
        `;
        leaked = JSON.stringify(normalizeRows(rows)) !== baseline;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    return leaked;
  }

  const updateLeaks = await probe((tx) => tx`update ${tx(table)} set ${tx(patch)}`.then(() => undefined));
  const deleteLeaks = await probe((tx) => tx`delete from ${tx(table)}`.then(() => undefined));
  return { updateLeaks, deleteLeaks };
}

describe.skipIf(!hasEnv)("izolacja tenantów (RLS)", () => {
  let admin: SupabaseClient;
  let sql: ReturnType<typeof postgres>;
  let a: TenantCtx;
  let b: TenantCtx;

  beforeAll(async () => {
    admin = createAdminClient();
    sql = postgres(process.env.SUPABASE_LOCAL_URL as string, { max: 1 });
    ({ a, b } = await seedTwoTenants());
  }, 60_000);

  afterAll(async () => {
    await cleanupSeeded(admin);
    await sql.end({ timeout: 5 });
  }, 60_000);

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

  it("tenants: owner tenanta A nie widzi wiersza tenanta B", async () => {
    // tenants izolowane po `id` (polityka own_select: id = app.tenant_id()),
    // nie po kolumnie tenant_id — stąd poza automatyczną macierzą
    // z listTenantTables i jawny test tutaj.
    const { data: all, error: allError } = await a.ownerClient.from("tenants").select("id");
    expect(allError, "SELECT tenants: nieoczekiwany błąd").toBeNull();
    const visibleIds = (all ?? []).map((row) => row.id as string);
    expect(visibleIds, "owner A powinien widzieć własnego tenanta").toContain(a.tenantId);
    expect(visibleIds, "owner A zobaczył tenanta B").not.toContain(b.tenantId);

    const { data: filtered, error: filteredError } = await a.ownerClient
      .from("tenants")
      .select("*")
      .eq("id", b.tenantId);
    expect(filteredError, "SELECT tenants po id B: nieoczekiwany błąd").toBeNull();
    expect(filtered ?? [], "SELECT tenants po id ujawnił wiersz tenanta B").toHaveLength(0);
  });

  it(
    "tenant A nie widzi i nie modyfikuje danych tenanta B (macierz SELECT/INSERT/UPDATE/DELETE)",
    async () => {
      const tables = await listTenantTables({});
      expect(
        tables.length,
        "macierz izolacji nie objęła żadnej tabeli — regresja introspekcji",
      ).toBeGreaterThan(0);

      for (const table of tables) {
        await seedSampleRow(admin, table, b.tenantId);

        const before = await snapshotTenantRows(admin, table, b.tenantId);
        expect(
          before.length,
          `brak zasianych wierszy tenanta B w "${table}" — macierz nie ma czego bronić`,
        ).toBeGreaterThan(0);

        // --- SELECT: A nie widzi wierszy B ---
        const { data: selected, error: selectError } = await a.ownerClient
          .from(table)
          .select("*")
          .eq("tenant_id", b.tenantId);
        expect(selectError, `SELECT ${table}: nieoczekiwany błąd zamiast filtrowania`).toBeNull();
        expect(selected ?? [], `SELECT ${table}: ujawnił wiersze tenanta B`).toHaveLength(0);

        // --- INSERT: A nie może wstawić wiersza z cudzym tenant_id ---
        // Payload z fabryki ma świeży klucz główny tam, gdzie to możliwe
        // (members: nowy user, invitations: nowy uuid, usage_counters: nowy
        // metric), więc odmowa MUSI pochodzić z RLS/GRANT (42501), nie
        // z kolizji klucza (23505). Wyjątek: subscriptions ma PK =
        // tenant_id i kolizja jest nieunikniona — ale WITH CHECK jest
        // egzekwowane przed unikalnością, więc 42501 również tu jest
        // jedynym akceptowanym kodem.
        const insertPayload = await buildSampleRow(admin, table, b.tenantId);
        const { error: insertError } = await a.ownerClient.from(table).insert(insertPayload);
        expect(
          insertError,
          `INSERT ${table}: wstawienie wiersza z tenant_id cudzego tenanta powinno zostać odrzucone`,
        ).not.toBeNull();
        expect(
          insertError?.code,
          `INSERT ${table}: odmowa powinna pochodzić z RLS/GRANT (42501), nie z innego błędu ` +
            `(np. 23505 duplicate key = fałszywa zieleń): ${insertError?.message}`,
        ).toBe(PG_INSUFFICIENT_PRIVILEGE);

        // --- UPDATE/DELETE: ścieżka PostgREST (powierzchnia API) ---
        // Najpierw udokumentuj, że przez API z filtrem stan B jest nienaruszony.
        const patch = mutationPatch(table);
        await a.ownerClient.from(table).update(patch).eq("tenant_id", b.tenantId);
        await a.ownerClient.from(table).delete().eq("tenant_id", b.tenantId);
        expect(
          await snapshotTenantRows(admin, table, b.tenantId),
          `PostgREST ${table}: stan wierszy tenanta B zmieniony przez API — wyciek izolacji`,
        ).toEqual(before);

        // --- UPDATE/DELETE: gołe mutacje bez WHERE, rola authenticated (A) ---
        // To jest właściwa bramka: bez WHERE polityka SELECT nie maskuje
        // zepsutej polityki UPDATE/DELETE, więc o zasięgu decyduje wyłącznie
        // jej klauzula USING. Zepsucie polityki UPDATE/DELETE na using(true)
        // przechodzi tutaj z czerwienią (zweryfikowane testem negatywnym).
        const { updateLeaks, deleteLeaks } = await crossTenantMutationLeaks(
          sql,
          table,
          { sub: a.ownerUserId, tenantId: a.tenantId },
          b.tenantId,
          patch,
        );
        expect(
          updateLeaks,
          `UPDATE ${table}: goła mutacja tenanta A dosięgła trwałych wierszy tenanta B — wyciek izolacji`,
        ).toBe(false);
        expect(
          deleteLeaks,
          `DELETE ${table}: goła mutacja tenanta A usunęła wiersze tenanta B — wyciek izolacji`,
        ).toBe(false);
      }
    },
    120_000,
  );
});
