-- 0055_import_catalog.sql — atomowy import katalogu z CSV (C3, ADR-112).
--
-- Panel parsuje plik (format wymiany ADR-111 — dokładnie to, co pisze
-- eksport) i po potwierdzeniu przez operatora woła TĘ JEDNĄ funkcję.
-- PostgREST nie daje transakcji obejmującej wiele żądań, więc pętla
-- upsertów z panelu zostawiałaby po pierwszym błędzie cennik wgrany
-- W POŁOWIE — a połowicznie wgrany cennik jest gorszy niż odrzucony plik
-- (wzorzec app.create_order, 0010/0044; ADR-028).
--
-- SECURITY INVOKER — celowo, jak w app.create_order: wywołuje członek
-- tenanta, który te same INSERT/UPDATE/DELETE może wykonać wprost przez
-- PostgREST. Polityki RLS z 0007 działają wewnątrz bez zmian (INSERT/UPDATE
-- products i pricing_tiers dla każdego członka, DELETE pricing_tiers dla
-- każdego członka — import nie kasuje produktów, więc bramka ownera na
-- DELETE products nie jest potrzebna). Funkcja nie dodaje ŻADNYCH uprawnień,
-- wyłącznie atomowość.
--
-- DWIE WARSTWY izolacji (wzorzec 0054): RLS invoker-a ORAZ jawny filtr
-- `tenant_id = v_tenant` w każdym zapytaniu. Klient z BYPASSRLS (service_role)
-- bez claimu tenant_id pada na strażniku `v_tenant is null` — fail-closed,
-- a grantu i tak nie dostaje.
--
-- KONTRAKT DOPASOWANIA (ADR-112):
--   * product_id NULL → nowy produkt najemcy z sesji,
--   * product_id niepusty → musi istnieć w katalogu najemcy z sesji;
--     cudzy albo nieistniejący identyfikator = wyjątek 22023 i rollback
--     CAŁOŚCI (nigdy nie tworzy się produktu „na cudzym id"),
--   * progi produktu z pliku są ZASTĘPOWANE kompletem z pliku (pusta lista
--     progów = progi usunięte),
--   * produkty najemcy nieobecne w pliku zostają nietknięte (import to
--     aktualizacja, nie synchronizacja lustrzana).
--
-- LICZBY: grosze przychodzą jako int w JSON; mnożniki jako STRINGI dziesiętne
-- rzutowane ::numeric — żadnej arytmetyki zmiennoprzecinkowej po drodze.
-- Walidację wartości (CHECK-i > 0, długość nazwy, unikat tier_days) robi
-- schemat 0007 — naruszenie wycofuje całą transakcję.

create or replace function app.import_catalog(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_created int := 0;
  v_updated int := 0;
  v_tiers int := 0;
  v_row jsonb;
  v_tier jsonb;
  v_product_id uuid;
  v_existing uuid;
begin
  if v_tenant is null then
    raise exception 'Brak kontekstu najemcy.' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Import wymaga co najmniej jednego produktu.' using errcode = '22023';
  end if;

  -- Siostra limitu eksportu (ADR-111/112): jawna odmowa, nigdy cichy obcinek.
  if jsonb_array_length(p_rows) > 10000 then
    raise exception 'Import przekracza limit 10000 wierszy.' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_product_id := nullif(v_row ->> 'product_id', '')::uuid;

    if v_row -> 'tiers' is not null and jsonb_typeof(v_row -> 'tiers') <> 'array' then
      raise exception 'Pole tiers musi być tablicą.' using errcode = '22023';
    end if;

    if v_product_id is not null then
      -- Jawny filtr tenanta OBOK RLS — patrz nagłówek (dwie warstwy).
      select p.id into v_existing
        from public.products p
       where p.id = v_product_id
         and p.tenant_id = v_tenant;
      if v_existing is null then
        raise exception 'Produkt % nie istnieje w katalogu tego najemcy.', v_product_id
          using errcode = '22023';
      end if;

      update public.products set
        name = v_row ->> 'name',
        description = v_row ->> 'description',
        base_price_day_grosze = (v_row ->> 'base_price_day_grosze')::int,
        deposit_grosze = (v_row ->> 'deposit_grosze')::int,
        auto_increment_multiplier = (v_row ->> 'auto_increment_multiplier')::numeric,
        buffer_before_days = (v_row ->> 'buffer_before_days')::int,
        buffer_after_days = (v_row ->> 'buffer_after_days')::int,
        active = (v_row ->> 'active')::boolean
      where id = v_product_id
        and tenant_id = v_tenant;

      -- Progi ZASTĄPIONE kompletem z pliku (kontrakt ADR-112).
      delete from public.pricing_tiers
       where product_id = v_product_id
         and tenant_id = v_tenant;

      v_updated := v_updated + 1;
    else
      insert into public.products (
        tenant_id, name, description, base_price_day_grosze, deposit_grosze,
        auto_increment_multiplier, buffer_before_days, buffer_after_days, active
      ) values (
        v_tenant,
        v_row ->> 'name',
        v_row ->> 'description',
        (v_row ->> 'base_price_day_grosze')::int,
        (v_row ->> 'deposit_grosze')::int,
        (v_row ->> 'auto_increment_multiplier')::numeric,
        (v_row ->> 'buffer_before_days')::int,
        (v_row ->> 'buffer_after_days')::int,
        (v_row ->> 'active')::boolean
      )
      returning id into v_product_id;
      v_created := v_created + 1;
    end if;

    for v_tier in
      select value from jsonb_array_elements(coalesce(v_row -> 'tiers', '[]'::jsonb))
      order by (value ->> 'tier_days')::int
    loop
      insert into public.pricing_tiers (
        tenant_id, product_id, tier_days, multiplier, label, sort_order
      ) values (
        v_tenant,
        v_product_id,
        (v_tier ->> 'tier_days')::int,
        (v_tier ->> 'multiplier')::numeric,
        v_tier ->> 'label',
        coalesce((v_tier ->> 'sort_order')::int, 0)
      );
      v_tiers := v_tiers + 1;
    end loop;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'tiers', v_tiers);
end;
$$;

comment on function app.import_catalog(jsonb) is
  'Atomowy import katalogu z CSV (C3, ADR-112): nowe produkty + aktualizacje + wymiana progów w JEDNEJ transakcji. SECURITY INVOKER — RLS 0007 obowiązuje wewnątrz; tenant wyłącznie z claimu (app.tenant_id()), jawny filtr tenant_id w każdym zapytaniu (dwie warstwy, wzorzec 0054). Odmowy: 22023 (walidacja/cudzy id), 42501 (brak kontekstu najemcy).';

-- Wyłącznie authenticated (wzorzec app.create_order): anon nie ma tu nic do
-- szukania, a service_role bez claimu tenant_id pada na strażniku — nie
-- nadajemy uprawnienia, którego nie da się poprawnie użyć.
revoke all on function app.import_catalog(jsonb) from public, anon;
grant execute on function app.import_catalog(jsonb) to authenticated;
