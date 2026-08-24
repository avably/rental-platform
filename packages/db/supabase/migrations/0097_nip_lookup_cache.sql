-- =====================================================================
-- 0097 — app.nip_lookup_cache: PAMIĘĆ PODRĘCZNA WYNIKÓW REJESTRU (ADR-234, L1)
-- =====================================================================
--
-- PO CO. MF Biała lista ogranicza wyszukiwania do 100/dobę (brief SPEC B) —
-- bez cache'a każde ponowne kliknięcie „Pobierz dane" (literówka w NIP-ie,
-- powrót do formularza, dwa okna) zjadałoby budżet. Cache jest też DOWODEM:
-- `app.create_tenant` (0098) wymaga, żeby NIP przechodzący do `tenants.nip`
-- miał realnie odpowiadający mu wpis tutaj — „zweryfikowany w rejestrze"
-- (brief: „NIE można założyć organizacji bez NIP-u realnie istniejącego w
-- rejestrze") oznacza W PRAKTYCE „istnieje świeży/dowolny wpis w tym cache'u
-- utworzony przez udane zapytanie do MF albo GUS", nie samą poprawną sumę
-- kontrolną (tę baza i tak sprawdza niezależnie, 0096).
--
-- SCHEMAT `app`, NIE `public` — jak `app.user_active_tenant` (0092) i
-- `app.superadmins` (0003): to NIE jest byt per-tenant (klucz to `nip`, nie
-- `tenant_id`), więc stoi POZA automatyczną macierzą izolacji RLS
-- (`listTenantTables`/`listPlatformTablesWithoutRls` w
-- packages/db/test/helpers/seed-tenants.ts filtrują `table_schema='public'`)
-- — nie dokładamy fabryki ani mutation-patcha do seed-tenants. Dane w środku
-- są PUBLICZNE z natury (to, co MF/GUS oddają każdemu bez uwierzytelnienia),
-- więc oś izolacji tu nie jest „tenant A vs tenant B" (nie ma takiej osi —
-- każdy zweryfikowany NIP jest widoczny identycznie każdemu, kto go poda),
-- tylko „nikt poza serwerem panelu nie czyta/pisze surowej tabeli wprost przez
-- PostgREST" — patrz sonda izolacji w packages/db/test/nip-lookup-cache.test.ts.
--
-- ZERO GRANTÓW DLA authenticated/anon NA TABELI. RLS włączone i BEZ ANI JEDNEJ
-- polityki — nawet gdyby ktoś kiedyś przez pomyłkę dograntował SELECT,
-- pusty zbiór polityk odmawia wszystkiego (fail-closed domyślne Postgresa).
-- Jedyna droga do danych to DWIE funkcje SECURITY DEFINER niżej, bo
-- `scripts/audit-service-role.sh` (ADR-099/115/206) zakazuje klienta
-- service-role w panelu poza webhookami/jobami/reviewem — dokładnie ten sam
-- wzorzec, którym `app.check_rate_limit` (0052) i `app.my_organizations`
-- (0092) omijają RLS bez wynoszenia service_role do kodu aplikacji.

create table app.nip_lookup_cache (
  nip text primary key check (nip ~ '^[0-9]{10}$'),
  data jsonb not null,
  source text not null check (source in ('mf', 'gus')),
  request_id text,
  fetched_at timestamptz not null default now()
);

alter table app.nip_lookup_cache enable row level security;

revoke all on app.nip_lookup_cache from public, anon, authenticated;
grant select, insert, update, delete on app.nip_lookup_cache to service_role;

comment on table app.nip_lookup_cache is
  'ADR-234: cache wyników wyszukiwania NIP (MF Biała lista / GUS BIR1.1), klucz = nip. '
  'Dane PUBLICZNE (rejestr dostępny każdemu bez klucza), więc brak osi izolacji tenant-vs-tenant; '
  'oś ochrony to "nikt poza serwerem panelu nie czyta/pisze wprost" — zero grantów dla '
  'authenticated/anon, dostęp WYŁĄCZNIE przez app.nip_lookup_cache_get/put (SECURITY DEFINER). '
  'TTL ~72h egzekwowany PO STRONIE APLIKACJI (apps/panel/lib/registry/cache.ts) — wiersz starszy '
  'niż TTL jest traktowany jak "brak" przy DECYZJI o ponownym strzale do MF/GUS, ale NIE jest '
  'usuwany: stary wpis nadal jest ważnym dowodem "NIP kiedyś zweryfikowany" dla app.create_tenant.';
comment on column app.nip_lookup_cache.data is
  'Kształt CompanyLookupFound (apps/panel/lib/registry/types.ts) minus ok/nip — legalName, regon, krs, '
  'address, statusVat, source, fetchedAt, requestId.';

-- ---------------------------------------------------------------------
-- app.nip_lookup_cache_get — odczyt (zalogowany użytkownik, dowolny)
-- ---------------------------------------------------------------------
-- Bez jawnej bramki auth.uid() w ciele: GRANT jest ograniczony do
-- `authenticated` (revoke od public/anon), więc anon dostaje 403 zanim
-- funkcja w ogóle wystartuje — dokładnie wzorzec app.my_organizations (0092),
-- które ufa samym grantom dla ścieżki WYŁĄCZNIE ODCZYTU danych bez tenant-owej
-- osi izolacji. Dane są publiczne z natury (patrz komentarz tabeli), więc nie
-- ma tu nic do przefiltrowania per użytkownik.
create or replace function app.nip_lookup_cache_get(p_nip text)
returns table (data jsonb, source text, request_id text, fetched_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select c.data, c.source, c.request_id, c.fetched_at
  from app.nip_lookup_cache c
  where c.nip = p_nip
$$;

comment on function app.nip_lookup_cache_get(text) is
  'ADR-234: odczyt cache wyniku rejestru dla NIP-u. SECURITY DEFINER (obchodzi RLS bez grantu tabeli — '
  'jedyna droga bez service_role w panelu, scripts/audit-service-role.sh). Dostęp WYŁĄCZNIE authenticated.';

revoke all on function app.nip_lookup_cache_get(text) from public, anon;
grant execute on function app.nip_lookup_cache_get(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- app.nip_lookup_cache_put — zapis (upsert), zalogowany użytkownik
-- ---------------------------------------------------------------------
-- W ODRÓŻNIENIU od GET, PUT jawnie sprawdza auth.uid() w ciele (wzorzec
-- app.set_active_tenant/app.set_nav_favorites, 0092/0094): zapis jest
-- mutacją, więc dostaje DWIE bramki (grant + jawny check) zamiast jednej —
-- ten sam odruch defense-in-depth co reszta bazy przy każdej ścieżce zapisu.
create or replace function app.nip_lookup_cache_put(
  p_nip text,
  p_data jsonb,
  p_source text,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  if auth.uid() is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;
  if p_nip !~ '^[0-9]{10}$' then
    raise exception 'Nieprawidłowy NIP.' using errcode = '22023';
  end if;
  if p_source not in ('mf', 'gus') then
    raise exception 'Nieprawidłowe źródło danych rejestru.' using errcode = '22023';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Nieprawidłowe dane rejestru.' using errcode = '22023';
  end if;

  insert into app.nip_lookup_cache (nip, data, source, request_id, fetched_at)
  values (p_nip, p_data, p_source, p_request_id, now())
  on conflict (nip) do update
    set data = excluded.data,
        source = excluded.source,
        request_id = excluded.request_id,
        fetched_at = excluded.fetched_at;
end;
$$;

comment on function app.nip_lookup_cache_put(text, jsonb, text, text) is
  'ADR-234: zapis (upsert) wyniku wyszukiwania NIP do cache. Bramka auth.uid() JAWNA w ciele (mutacja, '
  'wzorzec app.set_active_tenant) OBOK grantu (defense in depth). Dane publiczne z natury (nie ma tu '
  '"cudzych danych" do ochrony) — walidacja to higiena kształtu, nie izolacja.';

revoke all on function app.nip_lookup_cache_put(text, jsonb, text, text) from public, anon;
grant execute on function app.nip_lookup_cache_put(text, jsonb, text, text) to authenticated, service_role;
