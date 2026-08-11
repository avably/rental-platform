/**
 * Predykat komercyjny app.tenant_commercially_active (0065, ADR-134).
 *
 * Dwie rzeczy, których ten plik pilnuje:
 *
 * 1. ZACHOWANIE: zbiór komercyjnie aktywny = trialing | active | past_due
 *    (okno dunningowe — zasada 2: `past_due` to normalna praca dla KLIENTÓW
 *    najemcy), a suspended/cancelled/superadmin_locked odmawiają. Zmiana
 *    zbioru w predykacie pali te asercje ORAZ testy behawioralne powierzchni
 *    (tenant-resolve, domain-resolve, public-checkout) i test parytetu
 *    lustra TS (apps/storefront/test/tenant-status-parity.test.ts).
 *
 * 2. JEDYNOŚĆ DECYZJI (bramka introspekcyjna, nie jednorazowy grep): po 0065
 *    literał `('trialing','active')` nie występuje w ŻADNEJ funkcji, polityce
 *    RLS, widoku ani CHECK-u na żywej bazie — decyzja komercyjna ma dokładnie
 *    jedno miejsce w SQL. Przyszła migracja, która wróci do literału zamiast
 *    wywołać predykat, pali build, nie recenzenta. Introspekcja idzie wprost
 *    z silnika (pg_get_functiondef / pg_policies / pg_views / pg_constraint),
 *    więc łapie też definicje, których nie ma w plikach tego repo.
 *    Czujnik ma test-przynętę: funkcja z literałem MUSI zostać wykryta.
 *
 * Wymaga lokalnego Supabase (SUPABASE_LOCAL_URL) — patrz function-acls.test.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = ["SUPABASE_LOCAL_URL"] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/**
 * Pełna domena statusu tenanta (CHECK z 0001). Rozszerzenie domeny o nowy
 * status wymaga ŚWIADOMEJ decyzji, po której stronie predykatu ląduje —
 * tripwire niżej porównuje tę listę z CHECK-iem na żywej bazie.
 */
const STATUS_DOMAIN = [
  "trialing",
  "active",
  "past_due",
  "suspended",
  "cancelled",
  "superadmin_locked",
] as const;

/** Zbiór komercyjnie aktywny wg ADR-134 (rdzeń decyzji okna dunningowego). */
const COMMERCIALLY_ACTIVE = new Set(["trialing", "active", "past_due"]);

/**
 * Normalizacja pod wykrywanie literału: małe litery, zero białych znaków.
 * Wzorzec dwuelementowy (oba porządki) NIE łapie samego predykatu
 * (('trialing','active','past_due') ma przecinek zamiast nawiasu po 'active')
 * ani CHECK-a domeny statusu (enumeracja sześciu wartości).
 */
const LITERAL_PATTERNS = ["('trialing','active')", "('active','trialing')"];

function containsLiteral(sqlText: string | null): boolean {
  if (!sqlText) return false;
  const normalized = sqlText.toLowerCase().replace(/\s+/g, "");
  return LITERAL_PATTERNS.some((p) => normalized.includes(p));
}

interface NamedDefinition {
  name: string;
  definition: string | null;
}

/** Wszystkie definicje funkcji app+public wprost z silnika. */
async function listFunctionDefs(sql: ReturnType<typeof postgres>): Promise<NamedDefinition[]> {
  return sql<NamedDefinition[]>`
    select n.nspname || '.' || p.proname as name,
           pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and p.prokind = 'f'
    order by 1
  `;
}

describe.skipIf(!hasEnv)("app.tenant_commercially_active — 0065 / ADR-134", () => {
  const sql = postgres(process.env.SUPABASE_LOCAL_URL as string, { max: 1 });

  afterEach(async () => {
    // Sprzątanie przynęty niezależnie od wyniku — wisząca funkcja z literałem
    // wywracałaby kolejne przebiegi na współdzielonej bazie.
    await sql.unsafe(`
      do $$
      declare r record;
      begin
        for r in
          select p.oid::regprocedure as fn
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname like '_literal_bait_%'
        loop
          execute format('drop function %s', r.fn);
        end loop;
      end;
      $$
    `);
  });

  // -------------------------------------------------------------------
  // 1. Zachowanie predykatu — cała domena statusu, obie strony
  // -------------------------------------------------------------------

  it.each(STATUS_DOMAIN)("status '%s' klasyfikowany zgodnie z ADR-134", async (status) => {
    const [{ verdict }] = await sql<{ verdict: boolean }[]>`
      select app.tenant_commercially_active(${status}) as verdict
    `;
    expect(
      verdict,
      `predykat dla '${status}' zwrócił ${verdict} — zbiór komercyjnie aktywny to trialing|active|past_due`,
    ).toBe(COMMERCIALLY_ACTIVE.has(status));
  });

  it("NULL nie jest komercyjnie aktywny (bramki traktują NULL jak odmowę)", async () => {
    const [{ verdict }] = await sql<{ verdict: boolean | null }[]>`
      select app.tenant_commercially_active(null) as verdict
    `;
    // `in` propaguje NULL; w WHERE bramek NULL działa jak fałsz — fail-closed.
    expect(verdict).not.toBe(true);
  });

  it("tripwire domeny: CHECK statusu na tenants enumeruje dokładnie znane 6 wartości", async () => {
    // Nowy status w CHECK-u bez decyzji „po której stronie predykatu leży"
    // ma palić build — predykat klasyfikowałby go w ciemno jako nieaktywny.
    const [{ def }] = await sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.tenants'::regclass and conname = 'tenants_status_check'
    `;
    const enumerated = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(enumerated).toEqual([...STATUS_DOMAIN].sort());
  });

  it("predykat jest IMMUTABLE i czysty (zero odczytu tabel), ACL bez PUBLIC/anon", async () => {
    const [row] = await sql<
      { volatility: string; definition: string; grantees: string[] }[]
    >`
      select p.provolatile as volatility,
             pg_get_functiondef(p.oid) as definition,
             coalesce(
               (select array_agg(case when a.grantee = 0 then 'PUBLIC'
                                      else a.grantee::regrole::text end)
                from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.privilege_type = 'EXECUTE'),
               '{}'
             ) as grantees
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'tenant_commercially_active'
    `;
    expect(row, "predykat app.tenant_commercially_active nie istnieje").toBeDefined();
    expect(row.volatility, "predykat ma być IMMUTABLE (czysta funkcja statusu)").toBe("i");
    // Czystość: definicja nie czyta żadnej tabeli.
    expect(row.definition.toLowerCase()).not.toMatch(/\bfrom\s+(public|app)\./);
    // Konwencja ADR-132: bez PUBLIC; anon/authenticated bez grantu (nic ich
    // dziś nie potrzebuje — wołają go wyłącznie funkcje SECURITY DEFINER).
    expect(row.grantees).not.toContain("PUBLIC");
    expect(row.grantees).not.toContain("anon");
  });

  // -------------------------------------------------------------------
  // 2. Jedyność decyzji — introspekcja żywej bazy
  // -------------------------------------------------------------------

  it("zero literału ('trialing','active') w funkcjach app+public poza samym predykatem", async () => {
    const defs = await listFunctionDefs(sql);
    const offenders = defs
      .filter((d) => d.name !== "app.tenant_commercially_active")
      .filter((d) => containsLiteral(d.definition))
      .map((d) => d.name);
    expect(
      offenders,
      "funkcje z bramką literalną zamiast app.tenant_commercially_active (ADR-134 — " +
        "decyzja komercyjna ma JEDNO miejsce):\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("zero literału w politykach RLS, widokach i CHECK-ach", async () => {
    const policies = await sql<{ name: string; qual: string | null; check: string | null }[]>`
      select schemaname || '.' || tablename || ':' || policyname as name,
             qual, with_check as check
      from pg_policies
    `;
    const policyOffenders = policies
      .filter((p) => containsLiteral(p.qual) || containsLiteral(p.check))
      .map((p) => p.name);

    const views = await sql<{ name: string; definition: string }[]>`
      select schemaname || '.' || viewname as name, definition
      from pg_views where schemaname in ('app', 'public')
    `;
    const viewOffenders = views.filter((v) => containsLiteral(v.definition)).map((v) => v.name);

    const constraints = await sql<{ name: string; def: string }[]>`
      select conrelid::regclass || ':' || conname as name, pg_get_constraintdef(oid) as def
      from pg_constraint
      where connamespace in ('public'::regnamespace, 'app'::regnamespace)
    `;
    const constraintOffenders = constraints
      .filter((c) => containsLiteral(c.def))
      .map((c) => c.name);

    expect([...policyOffenders, ...viewOffenders, ...constraintOffenders]).toEqual([]);
  });

  it("test-przynęta: funkcja z literałem ZOSTAJE wykryta (czujnik nie jest dekoracją)", async () => {
    const baitName = `_literal_bait_${Date.now()}`;
    await sql.unsafe(`
      create function app.${baitName}(p_status text) returns boolean
      language sql immutable
      as 'select p_status in (''trialing'', ''active'')';
      revoke all on function app.${baitName}(text) from public;
    `);
    const defs = await listFunctionDefs(sql);
    const detected = defs.some(
      (d) => d.name === `app.${baitName}` && containsLiteral(d.definition),
    );
    expect(
      detected,
      "introspekcja nie wykryła świeżej funkcji z bramką literalną — bramka jedyności jest dekoracją",
    ).toBe(true);
  });

  it("czujnik nie jest pusty: 12 funkcji publicznej powierzchni woła predykat", async () => {
    // Kontrola pozytywna introspekcji: gdyby listFunctionDefs zwracał pustkę
    // albo złe definicje, `toEqual([])` wyżej przechodziłby bez pokrycia.
    const defs = await listFunctionDefs(sql);
    const callers = defs.filter(
      (d) =>
        d.name !== "app.tenant_commercially_active" &&
        (d.definition ?? "").includes("app.tenant_commercially_active("),
    );
    expect(
      callers.length,
      "publiczna powierzchnia nie woła predykatu — introspekcja ślepa albo migracja 0065 niezastosowana",
    ).toBeGreaterThanOrEqual(12);
  });
});
