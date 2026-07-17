/**
 * customers.locale (0016, ADR-037) — preferowany język korespondencji klienta.
 *
 * Kolumna NULLABLE z CHECK-iem spójnym z 0005 (tenants.locale). Dwie własności:
 *   1. wartości dozwolone: 'en'/'pl'/NULL; wszystko inne → 23514 (check_violation),
 *   2. dodanie kolumny NIE rusza izolacji customers — RLS włączone, cztery
 *      polityki tenanckie na miejscu, klucz złożony (tenant_id, id) nietknięty.
 *
 * Introspekcja + bezpośrednie INSERT-y idą połączeniem superusera (postgres.js,
 * SUPABASE_LOCAL_URL) — CHECK obowiązuje KAŻDĄ rolę, więc dowód nie potrzebuje
 * sesji członka (wzorzec schema.test.ts).
 *
 * Dowód mutacyjny (poza testem, na żywej bazie): zdjęcie CHECK-a
 * (`alter table public.customers drop constraint <nazwa>`) zapala DOKŁADNIE
 * test „locale spoza zbioru → 23514" (INSERT 'de' przechodzi) i nic więcej —
 * żaden inny CHECK nie ogląda tej kolumny, RLS na wartość locale nie patrzy;
 * restore constraintu wraca na zielono. Pytanie kontrolne o maskowanie: co
 * jeszcze mogłoby odrzucić 'de'? Typ text przyjmuje dowolny string, kolumna
 * nie ma FK ani osobnego triggera — odrzuca wyłącznie CHECK.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { integrationEnv } from "./helpers/integration-env";

const hasEnv = integrationEnv(["SUPABASE_LOCAL_URL"]);
const LOCAL_DB_URL = process.env.SUPABASE_LOCAL_URL;

const sql = LOCAL_DB_URL ? postgres(LOCAL_DB_URL, { max: 1 }) : null;

describe.skipIf(!hasEnv)("customers.locale — 0016 (ADR-037)", () => {
  let tenantId: string;

  beforeAll(async () => {
    const rows = await sql!<{ id: string }[]>`
      insert into public.tenants (slug, name)
      values (${`loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}, 'Tenant testów locale')
      returning id
    `;
    tenantId = rows[0]!.id;
  }, 30_000);

  afterAll(async () => {
    if (sql && tenantId) {
      await sql`delete from public.tenants where id = ${tenantId}`;
    }
    await sql?.end({ timeout: 5 });
  });

  it("kolumna public.customers.locale istnieje i jest nullable", async () => {
    const rows = await sql!<{ is_nullable: string; data_type: string }[]>`
      select is_nullable, data_type
      from information_schema.columns
      where table_schema = 'public' and table_name = 'customers' and column_name = 'locale'
    `;
    expect(rows, "kolumna customers.locale nie istnieje").toHaveLength(1);
    expect(rows[0]!.is_nullable, "customers.locale powinno być nullable").toBe("YES");
    expect(rows[0]!.data_type).toBe("text");
  });

  it("locale 'en' i 'pl' przechodzą", async () => {
    for (const locale of ["en", "pl"] as const) {
      const rows = await sql!<{ locale: string }[]>`
        insert into public.customers (tenant_id, email, locale)
        values (${tenantId}, ${`ok-${locale}-${Math.random().toString(36).slice(2)}@test.local`}, ${locale})
        returning locale
      `;
      expect(rows[0]!.locale).toBe(locale);
    }
  });

  it("locale NULL przechodzi (brak preferencji → fallback na tenants.locale)", async () => {
    const rows = await sql!<{ locale: string | null }[]>`
      insert into public.customers (tenant_id, email)
      values (${tenantId}, ${`null-${Math.random().toString(36).slice(2)}@test.local`})
      returning locale
    `;
    expect(rows[0]!.locale, "domyślnie brak preferencji, nie 'pl'").toBeNull();
  });

  it("locale spoza zbioru → 23514 (check_violation)", async () => {
    await expect(
      sql!`
        insert into public.customers (tenant_id, email, locale)
        values (${tenantId}, ${`bad-${Math.random().toString(36).slice(2)}@test.local`}, 'de')
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("RLS wciąż włączone na public.customers", async () => {
    const rows = await sql!<{ rowsecurity: boolean }[]>`
      select rowsecurity from pg_tables
      where schemaname = 'public' and tablename = 'customers'
    `;
    expect(rows[0]?.rowsecurity, "RLS zdjęte z customers").toBe(true);
  });

  it("cztery polityki tenanckie customers nietknięte", async () => {
    const rows = await sql!<{ policyname: string; cmd: string }[]>`
      select policyname, cmd from pg_policies
      where schemaname = 'public' and tablename = 'customers'
      order by cmd
    `;
    const cmds = rows.map((r) => r.cmd).sort();
    expect(cmds, "zmieniła się liczba/rodzaj polityk customers").toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
  });

  it("klucz złożony (tenant_id, id) nietknięty", async () => {
    const rows = await sql!<{ conname: string; cols: string[] }[]>`
      select con.conname,
        (
          select array_agg(att.attname order by att.attnum)
          from unnest(con.conkey) as k(attnum)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
        ) as cols
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public' and rel.relname = 'customers' and con.contype = 'u'
    `;
    const composite = rows.filter(
      (r) => r.cols.length === 2 && r.cols.includes("tenant_id") && r.cols.includes("id"),
    );
    expect(composite, "unikat (tenant_id, id) zniknął lub zmienił kształt").toHaveLength(1);
  });
});
