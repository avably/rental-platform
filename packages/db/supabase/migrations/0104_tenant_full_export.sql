-- =====================================================================
-- 0104 — PEŁNY ZRZUT JEDNEGO NAJEMCY (I5.6, ADR-258):
--        app.export_tenant_full(p_tenant_id uuid) — backup-grade eksport
--        strukturalny WSZYSTKICH tabel per-tenant do jednego dokumentu jsonb.
-- =====================================================================
--
-- PO CO (RODO art. 20 „przenośność danych" + fundament Disaster Recovery I5.7).
-- Tor eksportu (0104 rozszerza ADR-111) do tej migracji potrafił wyłącznie
-- per-domenowe CSV (zamówienia / klienci / katalog) — „zabierz swoje dane"
-- w oknie handlowym, sesją zalogowanego ownera. Brakowało jednego artefaktu:
-- STRUKTURALNEGO zrzutu CAŁEGO najemcy (wszystkie tabele z kolumną tenant_id
-- + korzeń `tenants`), nadającego się do ODTWORZENIA po awarii. Runbook DR
-- (ADR-256) i szkielet `scripts/dr/restore-tenant.mjs` czekają dokładnie na ten
-- format (patrz `// TODO(I5.6)` tam) — planer odtwarzania parsuje manifest
-- zbudowany z tego zrzutu.
--
-- ================== CO ROBI FUNKCJA ==================
--
-- Oddaje jeden `jsonb`: obiekt, w którym KLUCZ to nazwa tabeli, a WARTOŚĆ to
-- tablica wierszy tej tabeli należących do `p_tenant_id`. Zbiór tabel NIE jest
-- wypisany ręcznie — funkcja INTROSPEKTUJE `information_schema.columns` i bierze
-- każdą tabelę bazową `public` z kolumną `tenant_id`. Ta sama filozofia, co
-- macierz izolacji RLS (`listTenantTables` w packages/db/test/helpers/
-- seed-tenants.ts): NOWA tabela per-tenant wchodzi do backupu AUTOMATYCZNIE,
-- bez edycji tej funkcji — backup nie może po cichu pominąć tabeli, o której
-- autor migracji zapomniał. Korzeń `tenants` (izolowany po `id`, nie po
-- kolumnie `tenant_id`) jest dołożony jawnie jako osobna gałąź.
--
-- ================== IZOLACJA — SEDNO BEZPIECZEŃSTWA ==================
--
-- KAŻDY odczyt niesie JAWNY filtr `where x.tenant_id = p_tenant_id` (korzeń:
-- `where id = p_tenant_id`). To jest jedyna i wystarczająca granica: zrzut
-- najemcy A nie ma jak zawrzeć ani jednego wiersza najemcy B, bo żaden odczyt
-- nie sięga poza `p_tenant_id`. `p_tenant_id` jest OBOWIĄZKOWY — wołanie bez
-- niego to twardy błąd, nigdy „zrzut wszystkiego".
--
--   * SECURITY INVOKER (nie DEFINER): funkcja nie daje ani grama uprawnień
--     ponad to, co ma jej wołający. Wołającym jest rola `service_role`, która
--     w Supabase omija RLS (BYPASSRLS) — i to jest mechanizm „bypass RLS"
--     z briefu, a nie przywilej właściciela funkcji. Gdyby EXECUTE trafił
--     kiedyś omyłkowo do `authenticated`, INVOKER cofa go pod RLS jego tenanta
--     (fail-safe), zamiast wystawić cudze dane mocą DEFINER-a.
--   * `set search_path = pg_catalog, public` — pełna kwalifikacja obiektów,
--     odporność na przechwycenie nazwy przez obiekt w innym schemacie.
--   * Dynamiczny SQL bierze nazwę tabeli WYŁĄCZNIE z katalogu systemowego
--     (nie z wejścia wołającego) i wstawia ją przez `format('%I', …)`
--     (bezpieczny identyfikator) — powierzchnia wstrzyknięcia zerowa.
--   * `revoke all … from public` + `grant execute … to service_role` — to
--     JOB operatorski (DR / RODO), nie samoobsługa; anon i authenticated
--     funkcji nie widzą. Bramka packages/db/test/function-acls.test.ts
--     obejmuje ją automatycznie (brak EXECUTE dla PUBLIC/anon).
--
-- ================== SEKRETY ==================
--
-- Tabela `tenant_secrets` wchodzi do zrzutu jak każda inna per-tenant — ale
-- niesie WYŁĄCZNIE kolumnę `ciphertext` w postaci koperty `v1:<wersja>:…`
-- (AES-256-GCM, ADR-052). Zrzut NIE odszyfrowuje niczego: klucz mieszka poza
-- bazą (AVABLY_SECRETS_KEY_*), więc odtworzenie sekretów wymaga depozytu klucza
-- (owner-pending, I5.4). Warstwa aplikacji (apps/panel/lib/export/tenant-full.ts)
-- oznacza je w manifeście jako koperty i pilnuje, że nie wyciekła wartość jawna.
--
-- ================== WOLUMEN (świadomy kompromis v1) ==================
--
-- Zrzut budowany jest w pamięci w jednym `jsonb` (bez stronicowania). Dla skali
-- startowej (najemca to setki–tysiące wierszy) jest to w zupełności wystarczające
-- i identyczne w duchu z limitem CSV (ADR-111, EXPORT_ROW_LIMIT). Strumieniowanie
-- / stronicowanie zrzutu wróci, gdy realny wolumen tego zażąda — odłożone
-- świadomie, nie przeoczone.
--
-- ================== BRAK NOWEJ TABELI ==================
--
-- Ta migracja NIE tworzy tabeli — dodaje wyłącznie funkcję odczytu + granty.
-- Nie dotyka RLS, polityk, ani istniejących obiektów. `supabase db reset` musi
-- przejść bez błędu (weryfikacja lokalna przed mergem — PM wdraża migrację
-- PRZED mergem, patrz raport I5.6).

create or replace function app.export_tenant_full(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb := jsonb_build_object();
  v_table  text;
  v_rows   jsonb;
begin
  -- p_tenant_id OBOWIĄZKOWY: „job bez claimu" nie ma prawa zdumpować bazy.
  -- Bez tego warunku NULL przeszedłby do filtrów i każde `tenant_id = NULL`
  -- dałoby zero wierszy po cichu — czyli pusty, myląco „udany" backup.
  if p_tenant_id is null then
    raise exception 'export_tenant_full: p_tenant_id jest wymagany'
      using errcode = '22004'; -- null_value_not_allowed
  end if;

  -- Korzeń: pojedynczy wiersz tenanta (izolacja po `id`, nie po `tenant_id`).
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into v_rows
  from public.tenants t
  where t.id = p_tenant_id;
  v_result := jsonb_set(v_result, array['tenants'], v_rows, true);

  -- Wszystkie tabele bazowe `public` z kolumną `tenant_id` — introspekcja.
  -- Nazwy pochodzą WYŁĄCZNIE z katalogu systemowego i idą przez format('%I').
  for v_table in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x)), %L::jsonb) '
      'from public.%I x where x.tenant_id = $1',
      '[]', v_table
    )
    into v_rows
    using p_tenant_id;
    v_result := jsonb_set(v_result, array[v_table], v_rows, true);
  end loop;

  return v_result;
end;
$$;

comment on function app.export_tenant_full(uuid) is
  'Backup-grade zrzut JEDNEGO najemcy (I5.6, ADR-258): jsonb {tabela -> [wiersze]} '
  'dla wszystkich tabel per-tenant + korzeń tenants, jawny filtr tenant_id na '
  'każdym odczycie, sekrety jako koperty. Job service_role (RODO art. 20 / DR).';

-- Konwencja app.* (docs/konwencje-migracji.md): create function nadaje EXECUTE
-- roli PUBLIC domyślnie. Zdejmujemy i nadajemy WYŁĄCZNIE roli service_role —
-- eksport to job operatorski (DR / RODO), nigdy ścieżka anon/authenticated.
revoke all on function app.export_tenant_full(uuid) from public;
grant execute on function app.export_tenant_full(uuid) to service_role;
