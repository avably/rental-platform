/**
 * Predykaty LIVE w RLS — bramka regresu dla H-01 (R12a, migracja 0060,
 * ADR-126).
 *
 * Pilnuje DWÓCH rzeczy naraz, bo każda z osobna daje fałszywe poczucie
 * bezpieczeństwa:
 *
 *  1. INWARIANT STATYCZNY na pg_policies — „każde wyrażenie polityki, które
 *     przypina wiersz do claimu app.tenant_id(), zawiera też predykat live".
 *     To jest jedyny sposób, żeby PRZYSZŁA migracja nie odtworzyła dziury
 *     w nowej tabeli. Test behawioralny tego nie złapie, bo sprawdza jedną
 *     tabelę, a polityk jest 125.
 *
 *  2. TEST BEHAWIORALNY — usunięty członek naprawdę przestaje czytać i pisać
 *     przy TYM SAMYM, nieodświeżonym tokenie. Sam inwariant tekstowy tego nie
 *     dowodzi: predykat mógłby być wpięty wszędzie i mimo to zwracać prawdę
 *     (por. docs — bramka regexowa nie zastępuje dowodu behawioralnego).
 *
 * Wymaga SUPABASE_LOCAL_URL (patrz docs/konwencje-migracji.md).
 */
import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { integrationEnv } from "./helpers/integration-env";

const hasEnv = integrationEnv(["SUPABASE_LOCAL_URL"]);
const LOCAL_DB_URL = process.env.SUPABASE_LOCAL_URL;

const sql = LOCAL_DB_URL ? postgres(LOCAL_DB_URL, { max: 1 }) : null;

const PREDICATES = ["is_current_tenant_member", "is_current_superadmin"] as const;

/** Identyfikatory per przebieg — baza lokalna bywa współdzielona. */
const ids = {
  tenant: randomUUID(),
  owner: randomUUID(),
  staff: randomUUID(),
  superadmin: randomUUID(),
  customer: randomUUID(),
};

const claimsFor = (userId: string, tenantId: string | null, superadmin: boolean) =>
  JSON.stringify({
    sub: userId,
    role: "authenticated",
    app_metadata: { tenant_id: tenantId, role: "staff", superadmin },
  });

describe.skipIf(!hasEnv)("predykaty live w RLS — H-01 (0060)", () => {
  afterAll(async () => {
    if (sql) {
      // Sprzątanie omija triggery: app.members_last_owner_guard nie pozwala
      // usunąć ostatniego właściciela, a fikstura ma zniknąć w całości.
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`delete from public.customers where tenant_id = ${ids.tenant}`;
        await tx`delete from public.members where tenant_id = ${ids.tenant}`;
        await tx`delete from public.tenants where id = ${ids.tenant}`;
        await tx`delete from app.superadmins where user_id = ${ids.superadmin}`;
        await tx`delete from auth.users where id in (${ids.owner}, ${ids.staff}, ${ids.superadmin})`;
      });
      await sql.end({ timeout: 5 });
    }
  });

  // ------------------------------------------------------------------
  // 1. Kontrakt samych funkcji
  // ------------------------------------------------------------------
  it.each(PREDICATES)("app.%s jest SECURITY DEFINER, STABLE i ma przypięty search_path", async (name) => {
    const [fn] = await sql!<{ secdef: boolean; volatile: string; config: string[] | null }[]>`
      select p.prosecdef as secdef, p.provolatile as volatile, p.proconfig as config
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = ${name}
    `;
    expect(fn, `brak funkcji app.${name}`).toBeDefined();
    // DEFINER nie jest kosmetyką: INVOKER wpada w rekurencję przez politykę
    // members/superadmins i kończy się 54001 (stack depth), czyli HTTP 500
    // na każdym zapytaniu panelu.
    expect(fn.secdef).toBe(true);
    expect(fn.volatile).toBe("s");
    expect(fn.config?.join(",") ?? "").toContain("search_path=");
  });

  it.each(PREDICATES)("app.%s nie jest wykonywalna przez anon", async (name) => {
    const [row] = await sql!<{ anon: boolean; authed: boolean }[]>`
      select has_function_privilege('anon', ${`app.${name}()`}, 'execute') as anon,
             has_function_privilege('authenticated', ${`app.${name}()`}, 'execute') as authed
    `;
    expect(row.anon).toBe(false);
    expect(row.authed).toBe(true);
  });

  // ------------------------------------------------------------------
  // 2. Inwariant na KOMPLECIE polityk — bramka dla przyszłych migracji
  // ------------------------------------------------------------------
  it("żadna polityka nie opiera się już na claimie app.is_superadmin()", async () => {
    const stale = await sql!<{ what: string }[]>`
      select schemaname || '.' || tablename || '.' || policyname as what
      from pg_policies
      where schemaname in ('public', 'app', 'storage')
        and (coalesce(qual, '') like '%app.is_superadmin()%'
          or coalesce(with_check, '') like '%app.is_superadmin()%')
      order by 1
    `;
    expect(stale.map((r) => r.what)).toEqual([]);
  });

  it("każde wyrażenie przypinające wiersz do app.tenant_id() ma predykat live", async () => {
    // Per WYRAŻENIE, nie per polityka: poprawny USING nie może maskować
    // pominiętego WITH CHECK.
    const gaps = await sql!<{ what: string }[]>`
      select schemaname || '.' || tablename || '.' || policyname || ' [using]' as what
      from pg_policies
      where schemaname in ('public', 'app', 'storage')
        and qual like '%app.tenant_id()%'
        and qual not like '%app.is_current_tenant_member()%'
      union all
      select schemaname || '.' || tablename || '.' || policyname || ' [with check]'
      from pg_policies
      where schemaname in ('public', 'app', 'storage')
        and with_check like '%app.tenant_id()%'
        and with_check not like '%app.is_current_tenant_member()%'
      order by 1
    `;
    expect(gaps.map((r) => r.what)).toEqual([]);
  });

  it("bramki uploadu do Storage sięgające tenanta pośrednio też mają predykat", async () => {
    // Te dwie funkcje NIE wymieniają app.tenant_id() w tekście polityki —
    // czysto tekstowy przegląd polityk je pomija.
    const covered = await sql!<{ proname: string }[]>`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname in ('can_upload_product_image', 'can_upload_site_image')
        and pg_get_functiondef(p.oid) like '%app.is_current_tenant_member()%'
      order by 1
    `;
    expect(covered.map((r) => r.proname)).toEqual([
      "can_upload_product_image",
      "can_upload_site_image",
    ]);
  });

  it("predykat w politykach jest owinięty (select …) — InitPlan, nie wywołanie per wiersz", async () => {
    // Goły `app.is_current_tenant_member()` w polityce liczyłby się dla
    // KAŻDEGO wiersza. Owijka `(select …)` robi z niego InitPlan.
    // Katalog przechowuje owinięty predykat zawsze jako "( SELECT app.is_current_…",
    // więc liczba wystąpień owiniętych musi się równać liczbie wystąpień w ogóle.
    // (Postgres nie ma lookbehind, stąd porównanie liczników, nie regex.)
    const unwrapped = await sql!<{ what: string }[]>`
      select what from (
        select schemaname || '.' || tablename || '.' || policyname as what,
               (length(e) - length(replace(e, 'app.is_current_', '')))
                 / length('app.is_current_') as total,
               (length(e) - length(replace(e, '( SELECT app.is_current_', '')))
                 / length('( SELECT app.is_current_') as wrapped
        from (
          select schemaname, tablename, policyname,
                 coalesce(qual, '') || ' ' || coalesce(with_check, '') as e
          from pg_policies
          where schemaname in ('public', 'app', 'storage')
        ) t
      ) x
      where total <> wrapped
      order by 1
    `;
    expect(unwrapped.map((r) => r.what)).toEqual([]);
  });

  // ------------------------------------------------------------------
  // 3. Dowód behawioralny — cofnięcie dostępu działa BEZ nowego tokenu
  // ------------------------------------------------------------------
  it("usunięty członek traci odczyt i zapis natychmiast, przy tym samym tokenie", async () => {
    await sql!`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values (${ids.owner}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${`r12a-owner-${ids.owner}@example.test`}, '', now(), now()),
             (${ids.staff}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${`r12a-staff-${ids.staff}@example.test`}, '', now(), now())
    `;
    await sql!`
      insert into public.tenants (id, slug, name, status)
      values (${ids.tenant}, ${`r12a-${ids.tenant.slice(0, 8)}`}, 'R12a regres', 'active')
    `;
    // Owner musi zostać: app.members_last_owner_guard nie pozwala usunąć
    // ostatniego właściciela, więc odbieramy dostęp STAFFOWI.
    await sql!`
      insert into public.members (tenant_id, user_id, role)
      values (${ids.tenant}, ${ids.owner}, 'owner'), (${ids.tenant}, ${ids.staff}, 'staff')
    `;
    await sql!`
      insert into public.customers (id, tenant_id, email, full_name)
      values (${ids.customer}, ${ids.tenant}, ${`r12a-c-${ids.customer}@example.test`}, 'PRZED')
    `;

    const claims = claimsFor(ids.staff, ids.tenant, false);
    const asStaff = async <T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
      sql!.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        await tx`set local role authenticated`;
        return fn(tx);
      });

    // KONTROLA POZYTYWNA — bez niej „odmowa" nie dowodzi niczego.
    const beforeRead = await asStaff((tx) => tx`select id from public.customers`);
    expect(beforeRead).toHaveLength(1);
    const beforeWrite = await asStaff(
      (tx) => tx`update public.customers set full_name = 'PO-KONTROLI' returning id`,
    );
    expect(beforeWrite).toHaveLength(1);

    // Odebranie członkostwa. Token się NIE zmienia — te same claimy niżej.
    await sql!`delete from public.members where tenant_id = ${ids.tenant} and user_id = ${ids.staff}`;

    const afterRead = await asStaff((tx) => tx`select id from public.customers`);
    expect(afterRead).toHaveLength(0);
    const afterWrite = await asStaff(
      (tx) => tx`update public.customers set full_name = 'NIE-POWINNO-WEJSC' returning id`,
    );
    expect(afterWrite).toHaveLength(0);

    // Wiersz nietknięty przez odrzucony zapis.
    const [row] = await sql!<{ full_name: string }[]>`
      select full_name from public.customers where id = ${ids.customer}
    `;
    expect(row.full_name).toBe("PO-KONTROLI");
  });

  it("odebrany superadmin traci dostęp między tenantami natychmiast", async () => {
    await sql!`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values (${ids.superadmin}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${`r12a-sa-${ids.superadmin}@example.test`}, '', now(), now())
    `;
    await sql!`insert into app.superadmins (user_id) values (${ids.superadmin})`;

    // Claim mówi superadmin=true PRZEZ CAŁY CZAS — zmienia się tylko baza.
    const claims = claimsFor(ids.superadmin, null, true);
    const asSuperadmin = async () =>
      sql!.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        await tx`set local role authenticated`;
        return tx<{ id: string }[]>`select id from public.tenants limit 5`;
      });

    const before = await asSuperadmin();
    expect(before.length).toBeGreaterThan(0);

    await sql!`delete from app.superadmins where user_id = ${ids.superadmin}`;

    const after = await asSuperadmin();
    expect(after).toHaveLength(0);
  });
});
