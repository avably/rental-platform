/**
 * Wyłączenie backendu waitlisty (0071) — dowód NIEOBECNOŚCI app.join_waitlist.
 *
 * Decyzja właściciela (2026-08-12, bez ADR): SaaS z pełną rejestracją,
 * waitlista nie wraca. #270 zdjął warstwę stron; 0071 zdejmuje RPC
 * (revoke + DROP). Ten plik pilnuje, żeby publiczna ścieżka zapisu danych
 * osobowych nie WRÓCIŁA po cichu — przyszła migracja odtwarzająca funkcję
 * pali build, nie recenzenta.
 *
 * Metoda: introspekcja żywej bazy (pg_proc), nie grep po plikach — łapie też
 * definicje, których w repo nie ma. Test nieobecności ma strukturalną słabość:
 * zapytanie z literówką w nazwie/schemacie TEŻ zwraca pustkę i świeci na
 * zielono, niczego nie broniąc. Stąd test-przynęta wzorcem ADR-134
 * (commercial-active-predicate.test.ts): funkcja o dokładnie tej nazwie,
 * utworzona na chwilę, MUSI zostać wykryta tym samym zapytaniem.
 *
 * Druga oś: tabela public.waitlist_signups ŚWIADOMIE przeżywa 0071 (dane
 * historyczne, retencja wg polityki; drop = osobna decyzja właściciela).
 * Przypinamy to wprost — migracja-czystka, która zabrałaby tabelę „przy
 * okazji", też ma palić build. Izolację tabeli (anon/authenticated/superadmin)
 * dowodzi dalej rls-isolation.test.ts.
 *
 * Wymaga lokalnego Supabase — SUPABASE_LOCAL_URL (introspekcja) oraz
 * SUPABASE_LOCAL_API_URL + SUPABASE_LOCAL_ANON_KEY (odmowa PostgREST).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/**
 * Wszystkie funkcje o nazwie join_waitlist w schemacie app, każdą sygnaturą.
 * Celowo bez zawężenia do sygnatury z 0006: „powrót" funkcji z innym zestawem
 * argumentów to dokładnie ten sam regres.
 */
async function listJoinWaitlistFunctions(
  sql: ReturnType<typeof postgres>,
): Promise<string[]> {
  const rows = await sql<{ fn: string }[]>`
    select p.oid::regprocedure::text as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'join_waitlist'
    order by 1
  `;
  return rows.map((r) => r.fn);
}

describe.skipIf(!hasEnv)("wyłączenie backendu waitlisty — 0071", () => {
  const sql = postgres(process.env.SUPABASE_LOCAL_URL as string, { max: 1 });

  afterEach(async () => {
    // Sprzątanie przynęty niezależnie od wyniku testu — wisząca funkcja
    // join_waitlist wywracałaby kolejne przebiegi na współdzielonej bazie.
    await sql.unsafe(`
      do $$
      declare r record;
      begin
        for r in
          select p.oid::regprocedure as fn
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'join_waitlist'
        loop
          execute format('drop function %s', r.fn);
        end loop;
      end;
      $$
    `);
  });

  it("app.join_waitlist nie istnieje w żadnej sygnaturze", async () => {
    const fns = await listJoinWaitlistFunctions(sql);
    expect(
      fns,
      "app.join_waitlist wróciła do bazy — waitlista jest wyłączona decyzją " +
        "właściciela (0071), publiczna ścieżka zapisu nie ma prawa istnieć:\n  " +
        fns.join("\n  "),
    ).toEqual([]);
  });

  it("test-przynęta: funkcja o tej nazwie ZOSTAJE wykryta (czujnik nie jest dekoracją)", async () => {
    // Przynęta z revoke od razu (konwencja ADR-132) — bramka function-acls
    // biegnie równolegle na tej samej bazie i funkcja z domyślnym PUBLIC
    // EXECUTE świeciłaby w cudzym teście. Wykrywalność nieobecności nie
    // zależy od ACL, więc revoke niczego tu nie maskuje.
    await sql.unsafe(`
      create function app.join_waitlist() returns int language sql as 'select 1';
      revoke all on function app.join_waitlist() from public;
    `);
    const fns = await listJoinWaitlistFunctions(sql);
    expect(
      fns.length,
      "introspekcja nie wykryła świeżo utworzonej app.join_waitlist — " +
        "zapytanie nieobecności jest ślepe i niczego nie broni",
    ).toBeGreaterThan(0);
  });

  it("wywołanie RPC anon-em przez PostgREST = odmowa nieistnienia (PGRST202)", async () => {
    // Dowód BEHAWIORALNY z powierzchni publicznej: dokładnie tak wołała
    // funkcję owijka „use server" i tak zawoła ją każdy z anon keyem
    // z przeglądarki. Oczekiwana odmowa to PGRST202 (funkcji nie ma w schema
    // cache → 404), nie 42501: ścieżka ma nie istnieć, a nie być zabroniona.
    const anon = createClient(
      process.env.SUPABASE_LOCAL_API_URL as string,
      process.env.SUPABASE_LOCAL_ANON_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    const { data, error } = await anon.schema("app").rpc("join_waitlist", {
      p_email: "ktos@test.local",
      p_rental_type: "event",
      p_inventory_range: "r1_20",
      p_current_process: "none",
      p_consent: true,
    });
    expect(data, "wywołanie nieistniejącej RPC zwróciło dane").toBeNull();
    expect(error, "PostgREST nie odmówił wywołania usuniętej RPC").not.toBeNull();
    expect(
      error?.code,
      `oczekiwana odmowa nieistnienia (PGRST202), dostaliśmy: ${error?.code} ${error?.message}`,
    ).toBe("PGRST202");
  });

  it("tabela waitlist_signups PRZEŻYWA 0071 z włączonym RLS (dane historyczne)", async () => {
    const rows = await sql<{ rowsecurity: boolean }[]>`
      select rowsecurity from pg_tables
      where schemaname = 'public' and tablename = 'waitlist_signups'
    `;
    expect(
      rows,
      "public.waitlist_signups zniknęła — 0071 miała zdjąć WYŁĄCZNIE RPC; " +
        "drop tabeli z danymi historycznymi to osobna decyzja właściciela",
    ).toHaveLength(1);
    expect(rows[0]?.rowsecurity, "tabela archiwum straciła RLS").toBe(true);
  });
});
