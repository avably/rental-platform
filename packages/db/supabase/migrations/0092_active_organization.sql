-- 0092_active_organization.sql
-- L7 — aktywna organizacja dla użytkownika WIELOTENANTOWEGO (ADR-224).
--
-- DEFEKT (launch-krytyczny). Hook `app.custom_access_token` (0003_auth.sql,
-- jedyna dotychczasowa definicja) wybierał tenant do claimu przez
-- `order by m.created_at asc … limit 1` — NAJSTARSZE członkostwo. Użytkownik
-- należący do >1 organizacji (był pracownikiem cudzej org, POTEM założył
-- własną albo przyjął drugie zaproszenie) lądował na najstarszej i nie miał
-- jak przełączyć się na własną: endpoint „wybierz organizację" był świadomie
-- odłożony poza zakres Zadania 6 (komentarz w 0003). `tenant_id` sesji idzie
-- WYŁĄCZNIE z tego claimu (apps/panel/lib/auth.ts), więc user utykał.
--
-- NAPRAWA (ta migracja):
--   1. app.user_active_tenant — preferencja aktywnej org per użytkownik.
--   2. app.set_active_tenant(uuid) — przełącznik, bramkowany członkostwem.
--   3. app.my_organizations() — lista org użytkownika dla pickera w powłoce
--      (members/tenants RLS wystawiają tylko org z BIEŻĄCEGO claimu, więc
--      lista wszystkich org wołającego wymaga funkcji SECURITY DEFINER).
--   4. create or replace app.custom_access_token — czyta preferencję, ZAWSZE
--      bramkowaną JOINem z public.members; default = NAJNOWSZE członkostwo.
--   5. create or replace app.create_tenant — świeżo założona org staje się
--      aktywną preferencją (twórca ląduje na niej, nie na starej).
--
-- OŚ IZOLACJI (najwyższy rygor — wyżej niż pieniądze). Wybór v_tenant_id
-- w hooku idzie ZAWSZE przez wiersz public.members dla v_user_id. Preferencja
-- wskazująca org, w której user NIE jest członkiem (stała po odebraniu
-- członkostwa albo spreparowana), MUSI zostać zignorowana (fallback) i NIGDY
-- nie może wpaść do claimu. Błąd tu = cross-tenant. Test wprost + mutacja:
-- packages/db/test/auth-hook.test.ts.
--
-- DLACZEGO SCHEMA `app`, A NIE `public`. Tabela jest kluczowana po `user_id`,
-- nie po `tenant_id` — to preferencja UŻYTKOWNIKA, nie byt per-tenant. Jak
-- app.superadmins (0003) stoi poza schematem public, więc poza automatyczną
-- macierzą izolacji RLS (`listTenantTables` filtruje `table_schema='public'`,
-- packages/db/test/helpers/seed-tenants.ts) — i słusznie: nie ma tu osi
-- tenanta do izolowania. Nie dokładamy więc fabryki ani mutation-patcha do
-- seed-tenants; izolację użytkownika daje RLS `own` niżej + bramka
-- członkostwa w set_active_tenant/hooku.

-- ---------------------------------------------------------------------
-- 1. Preferencja aktywnej organizacji (per użytkownik)
-- ---------------------------------------------------------------------

create table app.user_active_tenant (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table app.user_active_tenant enable row level security;

-- Odczyt: użytkownik widzi WYŁĄCZNIE swój wiersz. Zapis (ustawienie
-- preferencji) NIE jest samoobsługą przez PostgREST — jedyną drogą jest
-- app.set_active_tenant (SECURITY DEFINER, bramkowana członkostwem) oraz
-- service_role. Brak polityk/grantów insert/update/delete dla authenticated
-- jest CELOWY (wzorzec app.superadmins, 0003): każdy zapis preferencji musi
-- przejść przez bramkę członkostwa, więc bezpośredni upsert authenticated
-- nie istnieje. FK on delete cascade na tenants sprząta preferencję po
-- skasowaniu org; po odebraniu członkostwa (bez kasowania org) wiersz zostaje
-- i jest IGNOROWANY przez hook (fallback) — dokładnie oś izolacji.
create policy own_select on app.user_active_tenant for select
  using (user_id = auth.uid());

grant select on app.user_active_tenant to authenticated, service_role;
grant insert, update, delete on app.user_active_tenant to service_role;

comment on table app.user_active_tenant is
  'L7/ADR-224: preferowana (aktywna) organizacja użytkownika wielotenantowego. '
  'Czytana przez hook app.custom_access_token WYŁĄCZNIE przez JOIN z '
  'public.members — preferencja na org nieczłonkowską jest ignorowana. '
  'Zapis tylko przez app.set_active_tenant (bramka członkostwa) i service_role.';

-- ---------------------------------------------------------------------
-- 2. app.set_active_tenant — przełącznik organizacji (bramka członkostwa)
-- ---------------------------------------------------------------------
-- Ustawia preferencję na p_tenant_id WYŁĄCZNIE, gdy wołający ma tam żywe
-- członkostwo (odczyt public.members po auth.uid()). NIGDY nie ufa samemu
-- inputowi — to druga bramka tej samej osi izolacji co JOIN w hooku. Panel
-- po sukcesie wymusza refresh tokenu, żeby hook przeliczył claim.

create or replace function app.set_active_tenant(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth, app
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;

  -- BRAMKA CZŁONKOSTWA (oś izolacji). Preferencję da się ustawić tylko na
  -- organizację, w której wołający JEST członkiem — inaczej odmowa, a wiersz
  -- preferencji zostaje nietknięty. Kod 42501 (insufficient_privilege) jest
  -- STANDARDOWYM SQLSTATE, który PostgREST mapuje na 403 z zachowanym
  -- komunikatem — nietypowe kody (np. własne P00xx) potrafi zamaskować jako
  -- 500 „Something went wrong". Czytelną odmowę w panelu i tak daje
  -- pre-check members-gated w akcji (defense in depth), niezależnie od tego,
  -- jak dostawca ubierze ten wyjątek.
  if not exists (
    select 1
    from public.members m
    where m.user_id = v_user_id
      and m.tenant_id = p_tenant_id
  ) then
    raise exception 'Nie jesteś członkiem wskazanej organizacji.' using errcode = '42501';
  end if;

  insert into app.user_active_tenant (user_id, tenant_id, updated_at)
  values (v_user_id, p_tenant_id, now())
  on conflict (user_id) do update
    set tenant_id = excluded.tenant_id,
        updated_at = now();

  return p_tenant_id;
end;
$$;

comment on function app.set_active_tenant(uuid) is
  'L7/ADR-224: ustawia preferowaną organizację użytkownika. Bramka '
  'członkostwa (public.members po auth.uid()); org nieczłonkowska → 42501 '
  '(forbidden) bez zmiany preferencji. Po sukcesie panel woła refreshSession, '
  'by hook przeliczył claim tenant_id.';

revoke all on function app.set_active_tenant(uuid) from public;
grant execute on function app.set_active_tenant(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. app.my_organizations — lista organizacji wołającego (picker powłoki)
-- ---------------------------------------------------------------------
-- Zwraca WYŁĄCZNIE członkostwa auth.uid() (org id, nazwa, slug, rola,
-- created_at). SECURITY DEFINER jest tu konieczny: RLS na public.members
-- i public.tenants (0060, predykaty live) wystawia tylko org z BIEŻĄCEGO
-- claimu tenant_id, więc zwykły odczyt nie zobaczyłby pozostałych org
-- użytkownika. Funkcja nie ujawnia niczego o cudzych użytkownikach —
-- twardo przypięta do auth.uid().

create or replace function app.my_organizations()
returns table (
  tenant_id uuid,
  name text,
  slug text,
  role text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select t.id, t.name, t.slug, m.role, m.created_at
  from public.members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid()
  order by m.created_at desc, t.name asc
$$;

comment on function app.my_organizations() is
  'L7/ADR-224: organizacje wołającego (auth.uid()) dla pickera powłoki — '
  'id, nazwa, slug, rola, created_at, najnowsze pierwsze. SECURITY DEFINER, '
  'bo RLS members/tenants wystawia tylko org z bieżącego claimu.';

revoke all on function app.my_organizations() from public, anon;
grant execute on function app.my_organizations() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Hook — create or replace (najnowsza definicja wygrywa)
-- ---------------------------------------------------------------------
-- Przepisana W CAŁOŚCI wobec 0003 (jsonb_set, coalesce'e i superadmin
-- co do znaku). Zmiana WYŁĄCZNIE w wyborze v_tenant_id/v_role:
--   * PREFERENCJA aktywnej org — ale TYLKO przez JOIN z public.members dla
--     v_user_id (oś izolacji: org nieczłonkowska nigdy nie wpada do claimu),
--   * gdy brak preferencji ALBO preferencja niedopasowana do żadnego
--     członkostwa → DEFAULT = NAJNOWSZE członkostwo (created_at desc), żeby
--     świeżo założona/dołączona org była domyślnie aktywna. Odwrotnie niż
--     „najstarsze" z 0003, które więziło usera na pierwszej, cudzej org.
--   * brak członkostwa w ogóle → v_tenant_id/v_role NULL (jak w 0003;
--     coalesce'y niżej chronią GoTrue przed json-null crash).

create or replace function app.custom_access_token(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app
as $$
declare
  claims jsonb;
  v_user_id uuid;
  v_tenant_id uuid;
  v_role text;
  v_is_superadmin boolean;
begin
  claims := coalesce(event->'claims', '{}'::jsonb);
  v_user_id := (event->>'user_id')::uuid;

  -- PREFEROWANA organizacja — brana pod uwagę WYŁĄCZNIE, gdy user ma tam
  -- żywe członkostwo. JOIN members↔preferencja to bramka: v_tenant_id/v_role
  -- pochodzą z wiersza public.members dla v_user_id, więc claim nigdy nie
  -- niesie org nieczłonkowskiej, choćby preferencja wskazywała inną (oś
  -- izolacji — ADR-224). Brak dopasowania → NULL → fallback niżej.
  select m.tenant_id, m.role
    into v_tenant_id, v_role
  from public.members m
  join app.user_active_tenant p
    on p.user_id = m.user_id
   and p.tenant_id = m.tenant_id
  where m.user_id = v_user_id
  limit 1;

  -- DEFAULT: najnowsze członkostwo (created_at desc). Gdy brak preferencji
  -- albo preferencja nie ma pokrycia w członkostwie — świeża org wygrywa.
  if v_tenant_id is null then
    select m.tenant_id, m.role
      into v_tenant_id, v_role
    from public.members m
    where m.user_id = v_user_id
    order by m.created_at desc, m.tenant_id desc
    limit 1;
  end if;

  select exists(
    select 1 from app.superadmins s where s.user_id = v_user_id
  ) into v_is_superadmin;

  -- UWAGA: jsonb_set zwraca SQL NULL (nie json null!) gdy new_value jest
  -- SQL NULL — bez coalesce(...,'null'::jsonb) cały wynik (i każdy kolejny
  -- jsonb_set na nim) staje się NULL, co GoTrue odrzuca jako "Invalid type:
  -- Expected object, given null" (zweryfikowane empirycznie na lokalnym
  -- Supabase — user bez membera crashował logowanie zanim to dodano).
  claims := jsonb_set(claims, '{app_metadata}', coalesce(claims->'app_metadata', '{}'::jsonb), true);
  claims := jsonb_set(
    claims, '{app_metadata,tenant_id}', coalesce(to_jsonb(v_tenant_id), 'null'::jsonb), true
  );
  claims := jsonb_set(
    claims, '{app_metadata,role}', coalesce(to_jsonb(v_role), 'null'::jsonb), true
  );
  claims := jsonb_set(
    claims, '{app_metadata,superadmin}', to_jsonb(coalesce(v_is_superadmin, false)), true
  );

  return jsonb_build_object('claims', claims);
end;
$$;

-- ACL restated (konwencja ADR-132): create or replace zachowuje granty, ale
-- migracja podmieniająca app.custom_access_token jawnie je potwierdza.
grant usage on schema app to supabase_auth_admin;
grant execute on function app.custom_access_token(jsonb) to supabase_auth_admin;
revoke execute on function app.custom_access_token(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------
-- 5. create_tenant — świeża org staje się aktywną preferencją
-- ---------------------------------------------------------------------
-- Przepisana W CAŁOŚCI wobec 0070 (najnowsza definicja: text,text,uuid —
-- wymuszenie regulaminu D5, zarezerwowane slugi, trial, subdomena — NIC
-- z tego nie zgubione, [[create-or-replace-szukaj-ostatniej-definicji]]).
-- JEDYNA różnica merytoryczna oznaczona [0092]: upsert preferencji aktywnej
-- org po INSERT-cie członkostwa ownera. Bez tego twórca należący już do
-- innej org z ustawioną preferencją wylądowałby po refreshu na STAREJ org
-- (hook wybrałby preferencję-członka), nie na świeżo założonej.

create or replace function app.create_tenant(
  p_slug text,
  p_name text,
  p_terms_version_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth, app
as $$
declare
  v_user_id uuid := auth.uid();
  v_email_confirmed boolean;
  v_tenant_count int;
  v_tenant_id uuid;
  v_host text;
  -- Wersja OBOWIĄZUJĄCA rozstrzygana przez bazę, nigdy z payloadu.
  v_terms_id uuid;
begin
  if v_user_id is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;

  select (u.email_confirmed_at is not null)
    into v_email_confirmed
  from auth.users u
  where u.id = v_user_id;

  if coalesce(v_email_confirmed, false) is false then
    raise exception 'Adres e-mail nie został zweryfikowany.' using errcode = 'P0001';
  end if;

  select count(distinct m.tenant_id) into v_tenant_count
  from public.members m
  where m.user_id = v_user_id;

  if v_tenant_count >= 2 then
    raise exception 'Limit 2 organizacji na użytkownika został osiągnięty.' using errcode = 'P0002';
  end if;

  -- WYMUSZENIE TWARDE (ADR-141, D5, fail-closed). Gdy jakakolwiek wersja
  -- regulaminu OBOWIĄZUJE, organizacja nie powstaje bez wskazania DOKŁADNIE
  -- tej wersji.
  select v.id into v_terms_id
  from public.platform_terms_versions v
  where v.effective_from is not null
    and v.effective_from <= now()
  order by v.version_no desc
  limit 1;

  if v_terms_id is not null then
    if p_terms_version_id is null then
      raise exception 'Do założenia organizacji wymagana jest akceptacja regulaminu.'
        using errcode = 'P0003';
    end if;
    if p_terms_version_id <> v_terms_id then
      raise exception 'Wskazana wersja regulaminu nie jest wersją obowiązującą — odśwież formularz i zaakceptuj aktualną.'
        using errcode = '22023';
    end if;
  elsif p_terms_version_id is not null then
    raise exception 'Wskazana wersja regulaminu nie obowiązuje.' using errcode = '22023';
  end if;

  -- BRAMKA SLUGÓW ZAREZERWOWANYCH (0023). Bez niej najemca brał adres, pod
  -- którym routing nigdy nie znajdzie jego sklepu (ADR-039).
  if lower(btrim(p_slug)) = any (app.reserved_subdomains()) then
    raise exception 'Adres „%" jest zarezerwowany — wybierz inny.', lower(btrim(p_slug))
      using errcode = '22023';
  end if;

  -- ZEGAR TRIALA (0066, ADR-135): now() + 14 dni w TEJ SAMEJ transakcji co
  -- created_at (default now()), więc trial_ends_at - created_at = dokładnie
  -- 14 dni. Wartość wyłącznie informacyjna w fazie 1 — patrz komentarz kolumny.
  insert into public.tenants (slug, name, trial_ends_at)
  values (p_slug, p_name, now() + interval '14 days')
  returning id into v_tenant_id;

  insert into public.members (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner');

  -- [0092] AKTYWNA PREFERENCJA = świeżo założona org (ADR-224). Upsert, bo
  -- twórca mógł już mieć preferencję na inną org — po założeniu ma lądować
  -- na nowej. Wiersz przechodzi bramkę członkostwa NATURALNIE: owner został
  -- właśnie wstawiony do public.members wyżej, więc hook (JOIN z members)
  -- ten claim przepuści.
  insert into app.user_active_tenant (user_id, tenant_id, updated_at)
  values (v_user_id, v_tenant_id, now())
  on conflict (user_id) do update
    set tenant_id = excluded.tenant_id,
        updated_at = now();

  -- [0070] DOWÓD AKCEPTACJI w tej samej transakcji co tenant + członkostwo
  -- (D2: umowa i trial zaczynają się w tym samym punkcie; wzorzec B4 —
  -- dowód zgody powstaje razem z bytem, którego dotyczy). Wiersz wskazuje
  -- wersję zweryfikowaną WYŻEJ przeciw rejestrowi, nie surowy payload.
  if v_terms_id is not null then
    insert into public.platform_terms_acceptances (tenant_id, user_id, version_id, context)
    values (v_tenant_id, v_user_id, p_terms_version_id, 'tenant_creation');
  end if;

  -- Subdomena platformy (Zadanie 2.6). Lustro ROOT_DOMAIN z @avably/core.
  v_host := lower(p_slug) || '.avably.io';
  if v_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
     and length(v_host) <= 253
  then
    -- ON CONFLICT: host mógł już zostać zajęty (np. wcześniejszy tenant o tym
    -- slugu skasowany i odtworzony). UNIQUE na `domain` jest globalny, więc
    -- kolizja nie może wywrócić onboardingu — brak wiersza jest widoczny na
    -- ekranie domen i naprawialny, przerwana rejestracja organizacji nie.
    insert into public.domains (tenant_id, domain, kind, verified, verified_at)
    values (v_tenant_id, v_host, 'subdomain', true, now())
    on conflict (domain) do nothing;
  end if;

  return v_tenant_id;
end;
$$;

comment on function app.create_tenant(text, text, uuid) is
  'Onboarding organizacji: tenant + członkostwo ownera + AKTYWNA PREFERENCJA (0092, ADR-224) + DOWÓD AKCEPTACJI REGULAMINU (0070, ADR-141) + subdomena w JEDNEJ transakcji. Slugi zarezerwowane odrzuca 22023 (0023); trial_ends_at = now() + 14 dni (0066, ADR-135). Wymuszenie twarde (D5): przy obowiązującej wersji regulaminu brak p_terms_version_id → P0003, wersja inna niż obowiązująca → 22023; bez obowiązującej wersji NULL przechodzi.';

-- ACL restated (konwencja ADR-132): create or replace zachowuje granty,
-- migracja i tak jawnie je potwierdza.
revoke all on function app.create_tenant(text, text, uuid) from public;
grant execute on function app.create_tenant(text, text, uuid) to authenticated;
