-- 0003_auth.sql
-- Auth end-to-end (Zadanie 6): custom access token hook (claims tenant_id/
-- role/superadmin), tabela app.superadmins, RPC app.create_tenant i
-- app.accept_invitation. Wszystkie funkcje SECURITY DEFINER mają przypięty
-- search_path (konwencja z 0002_hardening.sql) i wyłącznie schema-kwalifikowane
-- odwołania — search_path nie wpływa na wynik, przypięcie jest higieną.

-- ---------------------------------------------------------------------
-- app.superadmins — osobna tabela, NIE per-tenant (brak kolumny tenant_id,
-- poza schematem public → poza automatyczną macierzą izolacji RLS, patrz
-- packages/db/test/rls-isolation.test.ts / listTenantTables, które filtrują
-- information_schema.columns na table_schema = 'public').
-- ---------------------------------------------------------------------

create table app.superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table app.superadmins enable row level security;

-- Odczyt: user widzi wyłącznie swój wiersz (żeby klient mógł np. sprawdzić
-- czy jest superadminem) + sami superadmini widzą całą listę. Zapis
-- WYŁĄCZNIE przez service-role (bypassrls) — brak polityk insert/update/
-- delete dla authenticated/anon jest tu celowy (nadawanie superadmina to
-- operacja poza samoobsługą użytkownika).
create policy own_or_superadmin_select on app.superadmins for select
  using (user_id = auth.uid() or app.is_superadmin());

grant select on app.superadmins to authenticated, service_role;
grant insert, update, delete on app.superadmins to service_role;

-- ---------------------------------------------------------------------
-- Custom access token hook — jedyne miejsce, gdzie JWT dostaje
-- app_metadata.tenant_id / role / superadmin. Rejestracja: config.toml
-- [auth.hook.custom_access_token] (patrz supabase/config.toml).
--
-- SECURITY DEFINER: funkcja jest właścicielem migracji (rola uruchamiająca
-- `supabase db reset`/`db push`, lokalnie i w CI zawsze superuser) — dzięki
-- temu odczyt public.members i app.superadmins wewnątrz funkcji omija RLS
-- (superuser ma wbudowany bypass), bez potrzeby dodatkowych GRANT-ów dla
-- roli supabase_auth_admin na tabele domenowe. To jest oficjalny wzorzec
-- Supabase dla custom access token hook.
-- ---------------------------------------------------------------------

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

  -- Pierwszy tenant usera (najstarsze członkostwo). Multi-tenant-user:
  -- przełączanie aktywnego tenanta to osobny endpoint „wybierz organizację"
  -- odłożony poza zakres Zadania 6 (patrz plan zadaniowy fazy 0).
  select m.tenant_id, m.role
    into v_tenant_id, v_role
  from public.members m
  where m.user_id = v_user_id
  order by m.created_at asc, m.tenant_id asc
  limit 1;

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

-- Wykonanie WYŁĄCZNIE dla roli, która faktycznie wywołuje hook (GoTrue) —
-- nigdy dla authenticated/anon/public (funkcja czyta dane wszystkich
-- userów, nie wolno jej wystawiać poza Auth).
grant usage on schema app to supabase_auth_admin;
grant execute on function app.custom_access_token(jsonb) to supabase_auth_admin;
revoke execute on function app.custom_access_token(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------
-- app.create_tenant — onboarding: tworzy tenant + members(owner) dla
-- bieżącego usera. SECURITY DEFINER, bo insert do public.tenants wymaga
-- superadmin_insert (polityka RLS z 0001_core.sql) — zwykły authenticated
-- user nie ma prawa insertować do tenants wprost.
--
-- Walidacje: e-mail zweryfikowany (email_confirmed_at), limit 2 tenantów
-- na usera. Wystawiona przez PostgREST pod schematem app (patrz
-- api.schemas w config.toml) — klient woła
-- `supabase.schema('app').rpc('create_tenant', { p_slug, p_name })`.
-- ---------------------------------------------------------------------

create or replace function app.create_tenant(p_slug text, p_name text)
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

  insert into public.tenants (slug, name)
  values (p_slug, p_name)
  returning id into v_tenant_id;

  insert into public.members (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner');

  return v_tenant_id;
end;
$$;

grant execute on function app.create_tenant(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- app.accept_invitation — akcept zaproszenia. SECURITY DEFINER: w chwili
-- akceptacji user NIE jest jeszcze członkiem tenanta (app.tenant_id() = null
-- w jego JWT), więc zwykły authenticated insert do public.members
-- (polityka tenant_insert wymaga bycia ownerem tego samego tenanta) byłby
-- zawsze odrzucony — to jest właśnie problem „jajko i kura" wymagający
-- funkcji omijającej RLS z jawną, węższą walidacją w ciele funkcji.
-- ---------------------------------------------------------------------

create or replace function app.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth, app
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invitation record;
begin
  if v_user_id is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;

  select u.email into v_user_email from auth.users u where u.id = v_user_id;

  select i.* into v_invitation
  from public.invitations i
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if not found then
    raise exception 'Zaproszenie nie istnieje lub token jest nieprawidłowy.' using errcode = 'P0003';
  end if;

  if v_invitation.accepted_at is not null then
    raise exception 'Zaproszenie zostało już wykorzystane.' using errcode = 'P0004';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'Zaproszenie wygasło.' using errcode = 'P0005';
  end if;

  if lower(v_invitation.email) <> lower(coalesce(v_user_email, '')) then
    raise exception 'Zaproszenie zostało wystawione na inny adres e-mail.' using errcode = 'P0006';
  end if;

  insert into public.members (tenant_id, user_id, role)
  values (v_invitation.tenant_id, v_user_id, v_invitation.role)
  on conflict (tenant_id, user_id) do nothing;

  update public.invitations set accepted_at = now() where id = v_invitation.id;

  return v_invitation.tenant_id;
end;
$$;

grant execute on function app.accept_invitation(text) to authenticated;
