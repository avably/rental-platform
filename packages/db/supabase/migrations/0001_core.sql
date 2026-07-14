-- 0001_core.sql
-- Schemat rdzenia multi-tenant: tenants, members, invitations, plans,
-- subscriptions, usage_counters, audit_log + wzorzec RLS oparty o
-- app.tenant_id() (custom claim z JWT) i app.is_superadmin().
--
-- Konwencja: każda tabela per-tenant ma kolumnę tenant_id, indeks
-- zaczynający się od tenant_id oraz RLS włączone w tej samej migracji
-- (patrz docs/konwencje-migracji.md).

create schema if not exists app;

-- ---------------------------------------------------------------------
-- Tabele
-- ---------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,38}$'),
  name text not null,
  status text not null default 'trialing'
    check (status in ('trialing','active','past_due','suspended','cancelled','superadmin_locked')),
  created_at timestamptz not null default now()
);

create table public.members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index members_tenant_id_idx on public.members (tenant_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner','staff')),
  token_hash text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.invitations (tenant_id, email);

create table public.plans (
  id text primary key,
  name text not null,
  price_grosze int not null,
  limits jsonb not null default '{}',
  features jsonb not null default '{}',
  active boolean not null default true
);

create table public.subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_id text not null references public.plans(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table public.usage_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  metric text not null,
  period date not null,
  value int not null default 0,
  primary key (tenant_id, metric, period)
);
create index usage_counters_tenant_id_idx on public.usage_counters (tenant_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete set null,
  actor_user_id uuid,
  action text not null,
  subject text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_log (tenant_id, created_at desc);

-- ---------------------------------------------------------------------
-- Funkcje pomocnicze (schema app) — źródło prawdy o tenancie żądania
-- ---------------------------------------------------------------------

-- Funkcja źródła prawdy o tenancie żądania
create or replace function app.tenant_id() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id'),
      ''
    ), ''
  )::uuid
$$;

create or replace function app.is_superadmin() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'superadmin')::boolean, false)
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.members enable row level security;
alter table public.invitations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_counters enable row level security;
alter table public.audit_log enable row level security;
alter table public.plans enable row level security;

-- Uprawnienia bazowe: RLS ogranicza wiersze, ale rola musi mieć też
-- przywilej na poziomie tabeli. service_role ma bypassrls (Supabase),
-- ale i tak wymaga jawnego GRANT na przywileje tabelaryczne.
grant usage on schema app to authenticated, anon, service_role;
grant execute on function app.tenant_id() to authenticated, anon, service_role;
grant execute on function app.is_superadmin() to authenticated, anon, service_role;

grant select, insert, update, delete on public.tenants to authenticated, service_role;
grant select, insert, update, delete on public.members to authenticated, service_role;
grant select, insert, update, delete on public.invitations to authenticated, service_role;
grant select on public.plans to authenticated, service_role;
grant select, insert, update, delete on public.subscriptions to authenticated, service_role;
grant select, insert, update, delete on public.usage_counters to authenticated, service_role;
grant select on public.audit_log to authenticated, service_role;
grant insert on public.audit_log to service_role;

-- --- tenants: select własnego wiersza + superadmin; zapis tylko superadmin
-- (tworzenie tenanta w praktyce idzie przez service-role przy onboardingu).
create policy own_select on public.tenants for select
  using (id = app.tenant_id() or app.is_superadmin());
create policy superadmin_insert on public.tenants for insert
  with check (app.is_superadmin());
create policy superadmin_update on public.tenants for update
  using (app.is_superadmin())
  with check (app.is_superadmin());
create policy superadmin_delete on public.tenants for delete
  using (app.is_superadmin());

-- --- members: wzorzec bazowy (select/insert dane wprost w brief), update/delete
-- analogicznie — mutacje tylko przez ownera swojego tenanta.
create policy tenant_select on public.members for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.members for insert
  with check (tenant_id = app.tenant_id() and
              exists (select 1 from public.members m
                      where m.tenant_id = app.tenant_id()
                        and m.user_id = auth.uid() and m.role = 'owner'));
create policy tenant_update on public.members for update
  using (tenant_id = app.tenant_id() and
         exists (select 1 from public.members m
                 where m.tenant_id = app.tenant_id()
                   and m.user_id = auth.uid() and m.role = 'owner'))
  with check (tenant_id = app.tenant_id() and
              exists (select 1 from public.members m
                      where m.tenant_id = app.tenant_id()
                        and m.user_id = auth.uid() and m.role = 'owner'));
create policy tenant_delete on public.members for delete
  using (tenant_id = app.tenant_id() and
         exists (select 1 from public.members m
                 where m.tenant_id = app.tenant_id()
                   and m.user_id = auth.uid() and m.role = 'owner'));

-- --- invitations: odczyt dla całego tenanta, zapraszanie/zmiana/odwołanie
-- zaproszeń tylko przez ownera (akcja uprzywilejowana).
create policy tenant_select on public.invitations for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.invitations for insert
  with check (tenant_id = app.tenant_id() and
              exists (select 1 from public.members m
                      where m.tenant_id = app.tenant_id()
                        and m.user_id = auth.uid() and m.role = 'owner'));
create policy tenant_update on public.invitations for update
  using (tenant_id = app.tenant_id() and
         exists (select 1 from public.members m
                 where m.tenant_id = app.tenant_id()
                   and m.user_id = auth.uid() and m.role = 'owner'))
  with check (tenant_id = app.tenant_id() and
              exists (select 1 from public.members m
                      where m.tenant_id = app.tenant_id()
                        and m.user_id = auth.uid() and m.role = 'owner'));
create policy tenant_delete on public.invitations for delete
  using (tenant_id = app.tenant_id() and
         exists (select 1 from public.members m
                 where m.tenant_id = app.tenant_id()
                   and m.user_id = auth.uid() and m.role = 'owner'));

-- --- plans: katalog globalny (nie per-tenant) — odczyt dla każdego
-- zalogowanego użytkownika, zapis nikt (tylko service-role, które omija RLS).
create policy authenticated_select on public.plans for select
  to authenticated
  using (true);

-- --- subscriptions: odczyt dla członków tenanta; mutacje ograniczone do
-- ownera (w praktyce aktualizacje statusu idą z webhooka Stripe przez
-- service-role, które omija RLS — polityki tu to obrona w głąb).
create policy tenant_select on public.subscriptions for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.subscriptions for insert
  with check (tenant_id = app.tenant_id() and
              exists (select 1 from public.members m
                      where m.tenant_id = app.tenant_id()
                        and m.user_id = auth.uid() and m.role = 'owner'));
create policy tenant_update on public.subscriptions for update
  using (tenant_id = app.tenant_id() and
         exists (select 1 from public.members m
                 where m.tenant_id = app.tenant_id()
                   and m.user_id = auth.uid() and m.role = 'owner'))
  with check (tenant_id = app.tenant_id() and
              exists (select 1 from public.members m
                      where m.tenant_id = app.tenant_id()
                        and m.user_id = auth.uid() and m.role = 'owner'));
create policy tenant_delete on public.subscriptions for delete
  using (tenant_id = app.tenant_id() and
         exists (select 1 from public.members m
                 where m.tenant_id = app.tenant_id()
                   and m.user_id = auth.uid() and m.role = 'owner'));

-- --- usage_counters: odczyt dla członków tenanta; insert/update dla
-- każdego członka (liczniki rosną jako efekt uboczny zwykłych akcji
-- staffu, nie tylko ownera); usuwanie zarezerwowane dla ownera.
create policy tenant_select on public.usage_counters for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.usage_counters for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.usage_counters for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
create policy tenant_delete on public.usage_counters for delete
  using (tenant_id = app.tenant_id() and
         exists (select 1 from public.members m
                 where m.tenant_id = app.tenant_id()
                   and m.user_id = auth.uid() and m.role = 'owner'));

-- --- audit_log: tylko odczyt (per tenant + superadmin); zapis wyłącznie
-- przez service-role w webhookach/jobach (brak polityki insert/update/
-- delete dla authenticated/anon — omijane wyłącznie przez bypassrls).
create policy tenant_select on public.audit_log for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
