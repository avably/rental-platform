-- 0004_superadmin.sql
-- Panel superadmina (Zadanie 7).
--
-- Zasada naczelna: akcje superadmina w panelu idą ZWYKŁYM klientem z sesją
-- użytkownika (anon key + JWT) — egzekwuje je RLS przez app.is_superadmin(),
-- a NIE service-role. Service-role omija RLS; gdyby trafił do ścieżki panelu,
-- pojedynczy błąd w kodzie panelu = dostęp do wszystkich tenantów bez żadnej
-- bramki w bazie.
--
-- Zawartość:
--   1. tenants.status_before_lock — status sprzed blokady (odblokowanie musi
--      przywrócić stan, a nie zgadywać „active"),
--   2. audit_log — INSERT dla superadmina (dotąd zapis miał tylko
--      service-role), z wymuszeniem actor_user_id = auth.uid(),
--   3. subscriptions — INSERT/UPDATE dla superadmina (ręczna zmiana planu),
--   4. RPC app.superadmin_* — mutacja + wpis do audytu w JEDNEJ transakcji,
--      SECURITY INVOKER (uprawnienia wywołującego → polityki RLS obowiązują),
--   5. zasiew katalogu planów.
--
-- Blokada/odblokowanie nie wymaga nowej polityki na tenants — 0001_core.sql
-- ma już superadmin_update.

-- ---------------------------------------------------------------------
-- 1. tenants.status_before_lock
-- ---------------------------------------------------------------------

alter table public.tenants add column status_before_lock text
  check (status_before_lock in ('trialing','active','past_due','suspended','cancelled'));

comment on column public.tenants.status_before_lock is
  'Status sprzed blokady superadmina — przywracany przy odblokowaniu (app.superadmin_unlock_tenant).';

-- ---------------------------------------------------------------------
-- 2. audit_log — append-only, zapis z własnej sesji superadmina
-- ---------------------------------------------------------------------

-- WITH CHECK wiąże wiersz z tożsamością piszącego: superadmin nie podpisze
-- wpisu cudzym actor_user_id. Brak polityk UPDATE/DELETE dla authenticated
-- pozostaje w mocy — dziennik jest append-only również dla superadmina.
create policy superadmin_insert on public.audit_log for insert
  to authenticated
  with check (app.is_superadmin() and actor_user_id = auth.uid());

grant insert on public.audit_log to authenticated;

-- ---------------------------------------------------------------------
-- 3. subscriptions — ręczna zmiana planu przez superadmina
-- ---------------------------------------------------------------------

-- Tenant bez subskrypcji (świeży trial) nie ma jeszcze wiersza, więc
-- superadmin musi móc go założyć, nie tylko zaktualizować. Docelowo (faza 3)
-- źródłem prawdy o planie jest webhook Stripe przez service-role — te
-- polityki obsługują ścieżkę ręczną: korekta, plan przyznany indywidualnie,
-- awaria płatności.
create policy superadmin_insert on public.subscriptions for insert
  to authenticated
  with check (app.is_superadmin());

create policy superadmin_update on public.subscriptions for update
  to authenticated
  using (app.is_superadmin())
  with check (app.is_superadmin());

-- ---------------------------------------------------------------------
-- 4. RPC superadmina — mutacja i audyt atomowo
-- ---------------------------------------------------------------------
--
-- SECURITY INVOKER (domyślne, zapisane jawnie dla czytelności): funkcja
-- działa z uprawnieniami wywołującego, więc UPDATE/INSERT w środku przechodzą
-- przez polityki RLS. Superadmin bez claimu `superadmin` w JWT nie zmieni
-- niczego, choćby wywołał RPC wprost z PostgREST.
--
-- Powód istnienia tych funkcji (zamiast dwóch wywołań z panelu): PostgREST
-- wykonuje RPC w jednej transakcji, więc zmiana stanu i wpis do audit_log są
-- niepodzielne. Panel nie ma jak zmienić statusu tenanta ani planu, POMIJAJĄC
-- wpis w audycie — nawet przez błąd w kodzie.

create or replace function app.superadmin_lock_tenant(p_tenant_id uuid, p_reason text default null)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_previous text;
begin
  update public.tenants t
     set status_before_lock = case when t.status = 'superadmin_locked'
                                   then t.status_before_lock
                                   else t.status end,
         status = 'superadmin_locked'
   where t.id = p_tenant_id
     and t.status <> 'superadmin_locked'
  returning t.status_before_lock into v_previous;

  -- Zero wierszy = tenant nie istnieje, jest już zablokowany, albo (kluczowe)
  -- polityka RLS nie wpuściła wywołującego. Rozróżnianie tych przypadków w
  -- komunikacie ujawniałoby istnienie tenantów osobie bez uprawnień.
  if not found then
    raise exception 'Nie udało się zablokować organizacji (nie istnieje, jest już zablokowana lub brak uprawnień).'
      using errcode = 'P0007';
  end if;

  insert into public.audit_log (tenant_id, actor_user_id, action, subject, details)
  values (
    p_tenant_id, auth.uid(), 'superadmin.tenant.lock', p_tenant_id::text,
    jsonb_build_object('powod', p_reason, 'status_przed', v_previous)
  );
end;
$$;

create or replace function app.superadmin_unlock_tenant(p_tenant_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_restored text;
begin
  update public.tenants t
     set status = coalesce(t.status_before_lock, 'active'),
         status_before_lock = null
   where t.id = p_tenant_id
     and t.status = 'superadmin_locked'
  returning t.status into v_restored;

  if not found then
    raise exception 'Nie udało się odblokować organizacji (nie istnieje, nie jest zablokowana lub brak uprawnień).'
      using errcode = 'P0008';
  end if;

  insert into public.audit_log (tenant_id, actor_user_id, action, subject, details)
  values (
    p_tenant_id, auth.uid(), 'superadmin.tenant.unlock', p_tenant_id::text,
    jsonb_build_object('status_po', v_restored)
  );
end;
$$;

create or replace function app.superadmin_set_plan(p_tenant_id uuid, p_plan_id text)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_previous_plan text;
  v_tenant_exists boolean;
begin
  -- SELECT też przechodzi przez RLS (own_select: własny tenant lub
  -- superadmin), więc dla nie-superadmina tenant „nie istnieje".
  select true into v_tenant_exists from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'Organizacja nie istnieje lub brak uprawnień.' using errcode = 'P0009';
  end if;

  select s.plan_id into v_previous_plan
  from public.subscriptions s where s.tenant_id = p_tenant_id;

  if v_previous_plan is null then
    -- Brak subskrypcji (świeży tenant): zakładamy wiersz. Status 'active' —
    -- plan nadany ręcznie przez superadmina nie czeka na płatność.
    insert into public.subscriptions (tenant_id, plan_id, status)
    values (p_tenant_id, p_plan_id, 'active');
  else
    update public.subscriptions s
       set plan_id = p_plan_id, updated_at = now()
     where s.tenant_id = p_tenant_id;

    if not found then
      raise exception 'Brak uprawnień do zmiany planu.' using errcode = 'P0010';
    end if;
  end if;

  insert into public.audit_log (tenant_id, actor_user_id, action, subject, details)
  values (
    p_tenant_id, auth.uid(), 'superadmin.tenant.plan', p_tenant_id::text,
    jsonb_build_object('plan_przed', v_previous_plan, 'plan_po', p_plan_id)
  );
end;
$$;

-- Wpis audytu bez mutacji — używany przez podgląd tenanta (wejście/wyjście).
-- `p_action` z whitelisty: RPC nie może się stać uniwersalnym wstrzykiwaczem
-- dowolnych zdarzeń do dziennika.
create or replace function app.superadmin_log(
  p_tenant_id uuid,
  p_action text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
begin
  if p_action not in ('superadmin.tenant.view.start', 'superadmin.tenant.view.end') then
    raise exception 'Nieobsługiwana akcja audytu: %', p_action using errcode = 'P0011';
  end if;

  insert into public.audit_log (tenant_id, actor_user_id, action, subject, details)
  values (p_tenant_id, auth.uid(), p_action, p_tenant_id::text, p_details);
end;
$$;

grant execute on function app.superadmin_lock_tenant(uuid, text) to authenticated;
grant execute on function app.superadmin_unlock_tenant(uuid) to authenticated;
grant execute on function app.superadmin_set_plan(uuid, text) to authenticated;
grant execute on function app.superadmin_log(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Katalog planów — zasiew
-- ---------------------------------------------------------------------

-- Ceny i limity są WSTĘPNE (placeholder do czasu cennika i integracji Stripe
-- w fazie 3) — zmieni je osobna migracja. Zasiew idempotentny, żeby migracja
-- przeszła też na bazie, gdzie plany już są.
insert into public.plans (id, name, price_grosze, limits, features) values
  ('start', 'Start', 0,
   '{"produkty": 50, "uzytkownicy": 2}'::jsonb,
   '{"storefront": true, "platnosci": false}'::jsonb),
  ('pro', 'Pro', 19900,
   '{"produkty": 500, "uzytkownicy": 10}'::jsonb,
   '{"storefront": true, "platnosci": true}'::jsonb),
  ('max', 'Max', 49900,
   '{"produkty": null, "uzytkownicy": null}'::jsonb,
   '{"storefront": true, "platnosci": true, "wsparcie_priorytetowe": true}'::jsonb)
on conflict (id) do nothing;
