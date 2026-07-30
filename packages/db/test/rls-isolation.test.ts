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

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";
import {
  buildSampleRow,
  cleanupSeeded,
  createAdminClient,
  listPlatformTablesWithoutRls,
  listPublicRoleSequenceGrants,
  listPublicSequences,
  listPublicTables,
  listRlsBypassingGrants,
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
const hasEnv = integrationEnv(REQUIRED_ENV);

// Kod Postgres 42501 = insufficient_privilege — naruszenie polityki RLS
// (with check) albo brak GRANT-u tabelarycznego. Asercja na konkretny kod
// odróżnia odmowę RLS od np. 23505 (duplicate key), która maskowałaby
// dziurę w izolacji fałszywą zielenią.
const PG_INSUFFICIENT_PRIVILEGE = "42501";

// Tabele per-tenant będące prywatnymi rejestrami nie wystawiają bezpośredniego
// API dla authenticated. Nadal wchodzą do automatycznej introspekcji, fabryk,
// prób mutacji i kontroli trwałego stanu, ale poprawny SELECT kończy się
// brakiem GRANT-u (42501), a nie pustą listą przefiltrowaną przez politykę.
const PRIVATE_TENANT_TABLES = new Set(["product_image_uploads", "site_image_uploads"]);

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

  it("każda tabela platformowa (bez tenant_id) ma włączone RLS", async () => {
    const missing = await listPlatformTablesWithoutRls();
    expect(missing, "tabele public bez tenant_id i bez włączonego RLS").toEqual([]);
  });

  describe("test-przynęta: nowa tabela PLATFORMOWA bez RLS musi zostać wykryta", () => {
    // Odpowiednik przynęty per-tenant powyżej, dla drugiej bramki. Bez tego
    // testu `listPlatformTablesWithoutRls` mogłaby zwracać pustą listę z
    // powodu błędu w zapytaniu, a nie dlatego, że schemat jest czysty —
    // i bramka byłaby dekoracją.
    const baitTable = `_rls_platform_bait_${Date.now()}`;
    let baitSql: ReturnType<typeof postgres>;

    beforeEach(async () => {
      baitSql = postgres(process.env.SUPABASE_LOCAL_URL as string, { max: 1 });
      await baitSql.unsafe(`create table public.${baitTable} (id uuid primary key, value text)`);
    });

    afterEach(async () => {
      await baitSql.unsafe(`drop table if exists public.${baitTable}`);
      await baitSql.end({ timeout: 5 });
    });

    it("listPlatformTablesWithoutRls() wykrywa tabelę-przynętę bez tenant_id", async () => {
      const missing = await listPlatformTablesWithoutRls();
      expect(missing, "harness nie wykrył platformowej tabeli bez RLS").toContain(baitTable);
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
        if (PRIVATE_TENANT_TABLES.has(table)) {
          expect(
            selectError?.code,
            `SELECT ${table}: prywatny rejestr powinien nie mieć bezpośredniego GRANT-u`,
          ).toBe(PG_INSUFFICIENT_PRIVILEGE);
        } else {
          expect(selectError, `SELECT ${table}: nieoczekiwany błąd zamiast filtrowania`).toBeNull();
        }
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
        const { error: updateError } = await a.ownerClient
          .from(table)
          .update(patch)
          .eq("tenant_id", b.tenantId);
        const { error: deleteError } = await a.ownerClient
          .from(table)
          .delete()
          .eq("tenant_id", b.tenantId);
        if (PRIVATE_TENANT_TABLES.has(table)) {
          expect(updateError?.code, `UPDATE ${table}: brak odmowy prywatnego rejestru`).toBe(
            PG_INSUFFICIENT_PRIVILEGE,
          );
          expect(deleteError?.code, `DELETE ${table}: brak odmowy prywatnego rejestru`).toBe(
            PG_INSUFFICIENT_PRIVILEGE,
          );
        }
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

  // ---------------------------------------------------------------------
  // Uprawnienia spoza zasięgu RLS — bramka na KAŻDĄ tabelę w `public`
  // ---------------------------------------------------------------------
  //
  // TRUNCATE nie podlega politykom RLS: rola z tym uprawnieniem czyści
  // tabelę niezależnie od tego, jak szczelne są polityki. Cała macierz
  // powyżej może świecić na zielono przy tabeli, którą anon kasuje jednym
  // zdaniem. To samo dotyczy REFERENCES/TRIGGER/MAINTAIN — innego kalibru,
  // ale tej samej kategorii: uprawnień, których RLS nie widzi.
  //
  // Bramka jest INTROSPEKCYJNA, nie wypisana z nazwy. Wersja z 0006
  // sprawdzała jedną tabelę (waitlist_signups) i dlatego przez cały PR #22
  // nie zauważyła, że 7 tabel z 0001 nosi te uprawnienia — dowód, że lista
  // pisana ręcznie chroni wyłącznie to, co ktoś pamiętał na nią wpisać.
  // Nowa tabela w `public` wchodzi tu automatycznie, kimkolwiek utworzona.
  describe("uprawnienia spoza zasięgu RLS (TRUNCATE i pokrewne)", () => {
    it("żadna rola publiczna nie ma TRUNCATE/REFERENCES/TRIGGER/MAINTAIN na żadnej tabeli public", async () => {
      // Introspekcja przez has_table_privilege, NIE przez
      // information_schema.role_table_grants — tamten widok zna tylko
      // przywileje z SQL/92 i milczy o MAINTAIN (PostgreSQL 17+), przez co
      // pokazywał 3 z 4 faktycznych uprawnień roli anon na tabelach z 0001.
      const grants = await listRlsBypassingGrants();
      expect(
        grants,
        `role publiczne mają uprawnienia spoza zasięgu RLS:\n` +
          grants.map((g) => `  ${g.table}: ${g.role} → ${g.privilege}`).join("\n"),
      ).toEqual([]);
    });

    it("introspekcja widzi wszystkie tabele public (bramka nie może być pusta)", async () => {
      // Bez tego asercja `toEqual([])` wyżej przechodzi także wtedy, gdy
      // zapytanie introspekcyjne nic nie zwraca z powodu literówki czy
      // zmiany schematu — pusty wynik znaczyłby wtedy „nie ma czego
      // sprawdzać", a nie „jest czysto". Test sprawdza sam czujnik.
      const tables = await listPublicTables();
      expect(tables, "introspekcja nie zwróciła żadnej tabeli w public").not.toHaveLength(0);
      expect(tables, "introspekcja zgubiła tabele z 0001/0006").toEqual(
        expect.arrayContaining([
          "tenants",
          "members",
          "invitations",
          "plans",
          "subscriptions",
          "usage_counters",
          "audit_log",
          "waitlist_signups",
        ]),
      );
    });

    it("TRUNCATE jest odmawiany realnym zdaniem SQL na każdej tabeli, dla obu ról publicznych", async () => {
      // Dowód ZACHOWANIA, nie samego katalogu uprawnień: powyższy test czyta
      // ACL, ten wykonuje `truncate` i sprawdza, że silnik odmawia.
      //
      // Asercja na KOD 42501 (insufficient_privilege), nie na „cokolwiek
      // rzuciło": `truncate` na tabeli, do której prowadzi klucz obcy (np.
      // tenants ← members) i tak by się wywalił — ale kodem 0A000, z powodu
      // FK, nie uprawnień. Zliczanie każdego wyjątku jako sukcesu dałoby
      // fałszywą zieleń dokładnie na tabelach z największą liczbą powiązań.
      const tables = await listPublicTables();
      const roles = ["anon", "authenticated"] as const;

      const failures: string[] = [];
      for (const table of tables) {
        for (const role of roles) {
          let code: string | undefined;
          let truncated = false;
          try {
            await sql.begin(async (tx) => {
              await tx.unsafe(`set local role ${role}`);
              try {
                await tx.unsafe(`truncate public.${table}`);
                truncated = true;
              } catch (error) {
                code = (error as { code?: string }).code;
              }
              throw new Rollback();
            });
          } catch (error) {
            if (!(error instanceof Rollback)) throw error;
          }

          if (truncated) {
            failures.push(`${table}: ${role} WYCZYŚCIŁ tabelę TRUNCATE-em`);
          } else if (code !== PG_INSUFFICIENT_PRIVILEGE) {
            failures.push(
              `${table}: ${role} — TRUNCATE odrzucony kodem ${code}, oczekiwano ` +
                `${PG_INSUFFICIENT_PRIVILEGE} (odmowa z innego powodu niż brak uprawnienia)`,
            );
          }
        }
      }

      expect(failures, `TRUNCATE nie jest odmawiany przez uprawnienia:\n${failures.join("\n")}`).toEqual(
        [],
      );
    });

    // Bramki wyżej patrzą wyłącznie na tabele, które JUŻ istnieją — żadna z
    // nich nie zauważyłaby usunięcia `alter default privileges` z 0008, bo
    // skutek tamtej zmiany widać dopiero na tabeli utworzonej PÓŹNIEJ. Bez
    // tego bloku pierwsza sekcja migracji byłaby nieobjęta testem i mogłaby
    // zniknąć przy dowolnym refaktorze, nie psując buildu — a wtedy ochrona
    // wracałaby do „autor pamiętał o revoke", czyli do stanu sprzed 0008.
    describe("test-przynęta: NOWA tabela nie może rodzić się z uprawnieniami spoza zasięgu RLS", () => {
      const baitTable = `_privs_bait_${Date.now()}`;
      let baitSql: ReturnType<typeof postgres>;

      beforeEach(async () => {
        baitSql = postgres(process.env.SUPABASE_LOCAL_URL as string, { max: 1 });
        // Celowo goły `create table`, bez `revoke` z konwencji ADR-016 —
        // przynęta odtwarza dokładnie to, co zrobi autor następnej migracji,
        // gdy o konwencji zapomni. Zielono ma być dlatego, że default
        // privileges są naprawione, a nie dlatego, że ktoś pamiętał.
        await baitSql.unsafe(`create table public.${baitTable} (id uuid primary key, value text)`);
      });

      afterEach(async () => {
        await baitSql.unsafe(`drop table if exists public.${baitTable}`);
        await baitSql.end({ timeout: 5 });
      });

      it("świeżo utworzona tabela nie daje rolom publicznym TRUNCATE ani pokrewnych", async () => {
        const grants = (await listRlsBypassingGrants()).filter((g) => g.table === baitTable);
        expect(
          grants,
          `nowa tabela urodziła się z uprawnieniami spoza zasięgu RLS ` +
            `(default privileges roli postgres nie są naprawione — patrz 0008):\n` +
            grants.map((g) => `  ${g.role} → ${g.privilege}`).join("\n"),
        ).toEqual([]);
      });
    });
  });

  // ---------------------------------------------------------------------
  // Uprawnienia do SEKWENCJI — druga połowa tego samego problemu (0009)
  // ---------------------------------------------------------------------
  //
  // Bramka wyżej pyta o `relkind='r'` i przez to nie widziała sekwencji ani
  // przez moment: `pg_default_acl` ma dla roli `postgres` w schemacie `public`
  // DWA wpisy — objtype 'r' (tabele, naprawione w 0008) i objtype 'S'
  // (sekwencje, przeoczone). Skutek: `anon` i `authenticated` miały UPDATE na
  // `audit_log_id_seq`, a cała macierz wyżej świeciła zielono.
  //
  // UPDATE na sekwencji to prawo do `setval`, czyli do COFNIĘCIA licznika.
  // audit_log jest append-only dziennikiem audytu superadmina z `id` jako
  // kluczem głównym — cofnięty licznik to kolizje PK, czyli odmowa zapisu
  // audytu i utrata wiarygodności dziennika (patrz 0009).
  //
  // Sekwencje nie mają polityk RLS w ogóle — uprawnienia są ich JEDYNĄ
  // ochroną. Ta bramka jest introspekcyjna z tego samego powodu, co
  // tabelaryczna: sekwencja rodzi się NIEJAWNIE przy każdej kolumnie
  // `generated as identity`, więc lista pisana ręcznie chroniłaby wyłącznie
  // to, co ktoś pamiętał na nią wpisać — a o sekwencji nikt nie pamięta,
  // bo nie pisze o niej ani słowa w migracji.
  describe("uprawnienia do sekwencji (setval i pokrewne)", () => {
    it("żadna rola publiczna nie ma USAGE/SELECT/UPDATE na żadnej sekwencji public", async () => {
      const grants = await listPublicRoleSequenceGrants();
      expect(
        grants,
        `role publiczne mają uprawnienia do sekwencji:\n` +
          grants.map((g) => `  ${g.sequence}: ${g.role} → ${g.privilege}`).join("\n"),
      ).toEqual([]);
    });

    it("introspekcja widzi wszystkie sekwencje public (bramka nie może być pusta)", async () => {
      // Bez tego asercja `toEqual([])` wyżej przechodzi także wtedy, gdy
      // zapytanie nic nie zwraca z powodu literówki czy zmiany schematu —
      // pusty wynik znaczyłby wtedy „nie ma czego sprawdzać", a nie „jest
      // czysto". Test sprawdza sam czujnik, nie schemat.
      const sequences = await listPublicSequences();
      expect(sequences, "introspekcja nie zwróciła żadnej sekwencji w public").not.toHaveLength(0);
      expect(sequences, "introspekcja zgubiła sekwencję audit_log_id_seq (0001)").toContain(
        "audit_log_id_seq",
      );
    });

    it("setval jest odmawiany realnym zdaniem SQL na każdej sekwencji, dla obu ról publicznych", async () => {
      // Dowód ZACHOWANIA, nie samego katalogu uprawnień: test wyżej czyta ACL,
      // ten wykonuje `setval` i sprawdza, że silnik odmawia.
      //
      // Asercja na KOD 42501 (insufficient_privilege), nie na „cokolwiek
      // rzuciło" — ta sama pułapka, co przy TRUNCATE/0A000 w 0008. Zweryfikowane
      // na żywej bazie: odmowa pada z `do_setval` (sequence.c) właśnie kodem
      // 42501. Zliczanie każdego wyjątku jako sukcesu maskowałoby np. literówkę
      // w nazwie sekwencji (42P01) jako „bezpiecznie".
      //
      // Sonda w ROLLBACK-u: `setval` NIE jest transakcyjny w tym sensie, że
      // zwykle nie da się go cofnąć — ale tu i tak nie wolno mu przejść, a
      // gdyby przeszedł (regresja), rollback ogranicza szkodę na lokalnej bazie.
      const sequences = await listPublicSequences();
      const roles = ["anon", "authenticated"] as const;

      const failures: string[] = [];
      for (const sequence of sequences) {
        for (const role of roles) {
          let code: string | undefined;
          let succeeded = false;
          try {
            await sql.begin(async (tx) => {
              await tx.unsafe(`set local role ${role}`);
              try {
                await tx.unsafe(`select setval('public.${sequence}', 1)`);
                succeeded = true;
              } catch (error) {
                code = (error as { code?: string }).code;
              }
              throw new Rollback();
            });
          } catch (error) {
            if (!(error instanceof Rollback)) throw error;
          }

          if (succeeded) {
            failures.push(`${sequence}: ${role} COFNĄŁ licznik przez setval`);
          } else if (code !== PG_INSUFFICIENT_PRIVILEGE) {
            failures.push(
              `${sequence}: ${role} — setval odrzucony kodem ${code}, oczekiwano ` +
                `${PG_INSUFFICIENT_PRIVILEGE} (odmowa z innego powodu niż brak uprawnienia)`,
            );
          }
        }
      }

      expect(failures, `setval nie jest odmawiany przez uprawnienia:\n${failures.join("\n")}`).toEqual(
        [],
      );
    });

    it("zapis do audit_log nadal działa mimo odebrania uprawnień do sekwencji", async () => {
      // Bramka REGRESJI, nie bezpieczeństwa — pilnuje drugiej strony 0009.
      //
      // `nextval` wymaga USAGE **albo** UPDATE. Gdyby `audit_log.id` był
      // typem `serial`, revoke z 0009 zabiłby INSERT dla ról aplikacyjnych.
      // Nie jest — jest `generated always as identity`, a dla kolumn identity
      // Postgres nie sprawdza uprawnień do sekwencji (jest ona wewnętrzną
      // własnością kolumny). Ten test przypina TĘ zależność: gdyby ktoś
      // przepisał kolumnę na `serial` albo poszerzył revoke o role
      // aplikacyjne, zapis audytu przestałby działać i dowiemy się tutaj,
      // a nie z produkcyjnego dziennika, który przestał przyjmować wpisy.
      const subject = `seq-privs-regression-${randomUUID()}`;
      const { data, error } = await admin
        .from("audit_log")
        .insert({ action: "test.sequence-privileges", subject })
        .select("id")
        .single();

      expect(
        error,
        `INSERT do audit_log odrzucony po revoke uprawnień do sekwencji — ` +
          `czy kolumna id nadal jest 'generated as identity'? (patrz 0009): ${error?.message}`,
      ).toBeNull();
      expect(data?.id, "INSERT do audit_log nie nadał id z sekwencji").toBeTypeOf("number");

      await sql`delete from public.audit_log where subject = ${subject}`;
    });

    // Odpowiednik przynęty tabelarycznej dla `alter default privileges ... on
    // sequences` z 0009. Bez tego bloku pierwsza sekcja tamtej migracji byłaby
    // nieobjęta testem: bramki wyżej patrzą wyłącznie na sekwencje, które JUŻ
    // istnieją, a skutek default privileges widać dopiero na obiekcie
    // utworzonym PÓŹNIEJ.
    describe("test-przynęta: NOWA sekwencja nie może rodzić się z uprawnieniami", () => {
      const baitTable = `_seq_bait_${Date.now()}`;
      const baitSequence = `${baitTable}_id_seq`;
      let baitSql: ReturnType<typeof postgres>;

      beforeEach(async () => {
        baitSql = postgres(process.env.SUPABASE_LOCAL_URL as string, { max: 1 });
        // Przynętą jest tabela z kolumną IDENTITY, nie gołe `create sequence`.
        // To jest realna ścieżka, którą sekwencje powstają w tym repo (tak
        // powstał audit_log_id_seq) — autor następnej migracji napisze
        // dokładnie to i o sekwencji nie pomyśli. Przynęta ma odtwarzać jego
        // zachowanie, nie wyidealizowane.
        await baitSql.unsafe(`
          create table public.${baitTable} (
            id bigint generated always as identity primary key,
            value text
          )
        `);
      });

      afterEach(async () => {
        await baitSql.unsafe(`drop table if exists public.${baitTable}`);
        await baitSql.end({ timeout: 5 });
      });

      it("introspekcja widzi sekwencję przynęty (przynęta faktycznie ją tworzy)", async () => {
        // Przynęta bez tego testu mogłaby nie tworzyć żadnej sekwencji (np.
        // gdyby zmieniła się nazwa albo składnia), a test niżej i tak byłby
        // zielony — bo filtr nie znalazłby nic do zgłoszenia.
        expect(
          await listPublicSequences(),
          "przynęta nie utworzyła sekwencji — test niżej nie ma czego sprawdzać",
        ).toContain(baitSequence);
      });

      it("sekwencja świeżo utworzonej tabeli nie daje rolom publicznym żadnych uprawnień", async () => {
        const grants = (await listPublicRoleSequenceGrants()).filter((g) => g.sequence === baitSequence);
        expect(
          grants,
          `nowa sekwencja urodziła się z uprawnieniami dla ról publicznych ` +
            `(default privileges roli postgres dla sekwencji nie są naprawione — patrz 0009):\n` +
            grants.map((g) => `  ${g.role} → ${g.privilege}`).join("\n"),
        ).toEqual([]);
      });
    });
  });

  // ---------------------------------------------------------------------
  // waitlist_signups (0006) — tabela PLATFORMOWA, poza automatyczną macierzą
  // ---------------------------------------------------------------------
  //
  // Macierz per-tenant powyżej wybiera tabele po kolumnie tenant_id, której
  // ta tabela świadomie nie ma. Oś izolacji jest tu inna: publiczność (anon)
  // vs platforma (superadmin) — stąd jawny blok zamiast wpisu w introspekcji.
  //
  // Testy DOWODZĄ zachowania (anon nie czyta / nie zmienia / nie kasuje), a
  // nie samego istnienia polityk: brak polityki i polityka `using (true)`
  // dają różne wyniki, a tylko drugi z nich jest dziurą.
  describe("waitlist_signups — publiczność vs platforma", () => {
    const TEST_PASSWORD = "WaitlistRls!12345678";
    let anonClient: SupabaseClient;
    let superadminClient: SupabaseClient;
    let superadminUserId: string;
    let seededEmail: string;

    beforeAll(async () => {
      anonClient = createClient(
        process.env.SUPABASE_LOCAL_API_URL as string,
        process.env.SUPABASE_LOCAL_ANON_KEY as string,
        {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
        },
      );

      const email = `waitlist-superadmin-${randomUUID()}@test.local`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser(superadmin) nie powiódł się: ${error?.message}`);
      superadminUserId = data.user.id;
      await sql`insert into app.superadmins (user_id) values (${superadminUserId})`;

      // Logowanie PO wpisie do app.superadmins — claim `superadmin` wchodzi
      // do JWT przez hook custom_access_token przy wydaniu tokenu (0003).
      superadminClient = createClient(
        process.env.SUPABASE_LOCAL_API_URL as string,
        process.env.SUPABASE_LOCAL_ANON_KEY as string,
        {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
        },
      );
      const { error: signInError } = await superadminClient.auth.signInWithPassword({
        email,
        password: TEST_PASSWORD,
      });
      if (signInError) throw new Error(`Logowanie superadmina nie powiodło się: ${signInError.message}`);
    }, 60_000);

    beforeEach(async () => {
      // Zasiew service-rolem (jedyna rola z grantem INSERT na tabeli obok
      // SECURITY DEFINER RPC) — dane DO testu, nie obiekt testu.
      seededEmail = `seeded-${randomUUID()}@test.local`;
      await sql`
        insert into public.waitlist_signups
          (email, rental_type, inventory_range, current_process, consent_at)
        values (${seededEmail}, 'event', 'r1_20', 'none', now())
      `;
    });

    afterEach(async () => {
      await sql`delete from public.waitlist_signups where email = ${seededEmail}`;
    });

    afterAll(async () => {
      await sql`delete from app.superadmins where user_id = ${superadminUserId}`;
      await admin.auth.admin.deleteUser(superadminUserId);
    }, 60_000);

    it("anon nie odczyta waitlisty", async () => {
      const { data, error } = await anonClient.from("waitlist_signups").select("*");
      // Odmowa pada na GRANCIE (42501), zanim RLS dojdzie do głosu — tabela
      // nie ma i nie ma mieć grantu dla anona. Pusta lista bez błędu też
      // byłaby poprawna funkcjonalnie, ale oznaczałaby, że anon MA grant
      // i chroni go wyłącznie polityka — czyli jedną bramkę mniej.
      expect(data ?? [], "anon zobaczył wiersze waitlisty").toEqual([]);
      expect(error?.code, `anon dostał odpowiedź inną niż odmowa uprawnień: ${error?.message}`).toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
    });

    it("anon nie wstawi wiersza wprost do tabeli (tylko przez RPC)", async () => {
      const { error } = await anonClient.from("waitlist_signups").insert({
        email: `direct-${randomUUID()}@test.local`,
        rental_type: "event",
        inventory_range: "r1_20",
        current_process: "none",
        consent_at: new Date().toISOString(),
      });
      expect(error?.code, `anon wstawił wiersz wprost do tabeli: ${error?.message}`).toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
    });

    // Bramka TRUNCATE dla tej tabeli NIE jest już tutaj: 0008 domknęło dług
    // z ADR-016 i bramka obejmuje dzisiaj KAŻDĄ tabelę w `public` przez
    // introspekcję (blok „uprawnienia spoza zasięgu RLS" niżej), a nie samą
    // waitlistę. Test wpisany z nazwy pod jedną tabelę siłą rzeczy nie
    // zauważa tabeli, której nikt do niego nie dopisał — a to jest właśnie
    // ten błąd, przez który tabele z 0001 nosiły TRUNCATE aż do 0008.

    it("authenticated bez claimu superadmin nie widzi wierszy waitlisty", async () => {
      // Tu grant SELECT istnieje (potrzebny superadminowi), więc bramką jest
      // wyłącznie polityka superadmin_select — PostgREST zwraca pustą listę.
      const { data, error } = await a.ownerClient.from("waitlist_signups").select("*");
      expect(error, `SELECT waitlist_signups jako owner: nieoczekiwany błąd`).toBeNull();
      expect(data ?? [], "zwykły authenticated zobaczył wiersze waitlisty").toHaveLength(0);
    });

    it("superadmin odczytuje waitlistę", async () => {
      const { data, error } = await superadminClient
        .from("waitlist_signups")
        .select("email")
        .eq("email", seededEmail);
      expect(error, `SELECT waitlist_signups jako superadmin: ${error?.message}`).toBeNull();
      expect(
        (data ?? []).map((row) => row.email as string),
        "superadmin nie zobaczył zasianego wiersza — odczyt platformowy zepsuty",
      ).toContain(seededEmail);
    });

    it.each([
      { role: "anon", claims: null },
      { role: "authenticated", claims: "owner" },
    ])(
      "$role nie zmieni ani nie skasuje wierszy waitlisty (gołe mutacje bez WHERE)",
      async ({ role, claims }) => {
        // Gołe mutacje bez WHERE: bez filtra czytającego kolumny polityka
        // SELECT nie ma zastosowania, więc o zasięgu decyduje wyłącznie
        // klauzula USING polityk UPDATE/DELETE — a tych nie ma, więc zasięg
        // musi być pusty. To ta sama metoda, co w macierzy per-tenant.
        const jwt =
          claims === null
            ? null
            : JSON.stringify({
                sub: a.ownerUserId,
                role: "authenticated",
                app_metadata: { tenant_id: a.tenantId, role: "owner" },
              });

        const baseline = await sql<{ email: string }[]>`
          select email from public.waitlist_signups where email = ${seededEmail}
        `;
        expect(baseline, "brak zasianego wiersza — test nie ma czego bronić").toHaveLength(1);

        /**
         * Zasięg mutacji MUSI być zmierzony WEWNĄTRZ transakcji, po `reset
         * role` a przed ROLLBACK-iem. Pomiar po rollbacku pokazywałby stan
         * sprzed sondy niezależnie od tego, czy mutacja przeszła — czyli
         * zawsze zielono, także przy polityce `using (true)`. (Ten test
         * dokładnie tak był najpierw napisany i przepuścił mutację nadającą
         * anonowi DELETE — stąd ten komentarz.)
         */
        async function mutationReaches(statement: string): Promise<boolean> {
          let reached = false;
          try {
            await sql.begin(async (tx) => {
              if (jwt) await tx`select set_config('request.jwt.claims', ${jwt}, true)`;
              await tx.unsafe(`set local role ${role}`);
              try {
                await tx.unsafe(statement);
              } catch {
                // Odmowa (brak GRANT-u albo polityka nie dopuściła żadnego
                // wiersza) — z definicji brak wycieku.
                throw new Rollback();
              }
              await tx`reset role`;
              const rows = await tx<{ email: string }[]>`
                select email from public.waitlist_signups where email = ${seededEmail}
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
          await mutationReaches("update public.waitlist_signups set email = 'attacker@test.local'"),
          `${role}: goła mutacja UPDATE dosięgła wierszy waitlisty — wyciek`,
        ).toBe(false);
        expect(
          await mutationReaches("delete from public.waitlist_signups"),
          `${role}: goła mutacja DELETE usunęła wiersze waitlisty — wyciek`,
        ).toBe(false);
      },
    );

    it("anon zapisuje się WYŁĄCZNIE przez RPC, a deduplikacja jest case-insensitive", async () => {
      const email = `rpc-${randomUUID()}@test.local`;
      const args = {
        p_email: email.toUpperCase(),
        p_rental_type: "event",
        p_inventory_range: "r1_20",
        p_current_process: "none",
        p_consent: true,
      };

      const first = await anonClient.schema("app").rpc("join_waitlist", args);
      expect(first.error, `RPC join_waitlist jako anon: ${first.error?.message}`).toBeNull();
      expect(first.data, "anon nie zapisał się przez RPC — ścieżka publiczna zepsuta").toBe("success");

      const second = await anonClient.schema("app").rpc("join_waitlist", { ...args, p_email: email });
      expect(second.data, "ten sam e-mail innym casingiem nie został zdeduplikowany").toBe("duplicate");

      const rows = await sql<{ email: string }[]>`
        select email from public.waitlist_signups where lower(email) = ${email.toLowerCase()}
      `;
      expect(rows, "deduplikacja przepuściła drugi wiersz").toHaveLength(1);
      expect(rows[0]?.email, "e-mail nie został znormalizowany do lower-case").toBe(email.toLowerCase());

      await sql`delete from public.waitlist_signups where lower(email) = ${email.toLowerCase()}`;
    });
  });
});
