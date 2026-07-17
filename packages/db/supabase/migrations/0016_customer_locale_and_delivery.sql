-- 0016_customer_locale_and_delivery.sql
-- Domknięcia fazy 1.5 (Zadanie 1.5.6): preferencja językowa KLIENTA i wpięcie
-- kosztu dostawy w transport tworzenia zamówienia.
--
-- Zawartość (dwie niezależne zmiany, wzorzec 0005 = jedna migracja, dwie sekcje):
--   1. customers.locale — preferowany język korespondencji klienta (ADR-037),
--   2. app.create_order zyskuje p_delivery_grosze — koszt dostawy wchodzi do
--      zamówienia TĄ SAMĄ atomową transakcją co pozycje (ADR-030, wpięcie).
--
-- Bez nowych tabel, więc bez nowych polityk RLS. customers jest już w macierzy
-- izolacji (0007) — nowa kolumna dziedziczy polityki i klucz złożony tabeli.

-- ---------------------------------------------------------------------
-- 1. customers.locale (ADR-037)
-- ---------------------------------------------------------------------
--
-- Preferowany język KLIENTA, oś niezależna od tenants.locale (0005). Do dziś
-- e-maile cyklu najmu szły w języku TENANTA (ADR-033 decyzja 5), więc Niemiec
-- wynajmujący u polskiego najemcy dostawał polską wiadomość. Ta kolumna daje
-- klientowi preferencję; ścieżka wysyłki wybiera `customers.locale ??
-- tenants.locale` (fallback na język tenanta, gdy klient nie ma preferencji).
--
-- NULLABLE i BEZ defaultu: NULL = „brak preferencji" (spada na język tenanta),
-- co jest semantycznie różne od „klient wybrał polski". Default 'pl' udawałby
-- deklarację, której klient nie złożył.
--
-- CHECK spójny z 0005 (tenants.locale) i podzbiorem LOCALES z @avably/core
-- (DEFAULT_TENANT_LOCALE). Jawny `locale is null or ...`, mimo że `null in
-- (...)` i tak daje NULL, a CHECK z wynikiem NULL PRZECHODZI: pułapka
-- trójwartościowej logiki złapana już w 0011/0026 — zapis jawny czyni intencję
-- (NULL dozwolony) czytelną, zamiast polegać na tym, że czytelnik ją odtworzy.
alter table public.customers add column locale text
  check (locale is null or locale in ('en','pl'));

comment on column public.customers.locale is
  'Preferowany język korespondencji klienta (BCP 47, podzbiór LOCALES z @avably/core). NULL = brak preferencji → wysyłka spada na tenants.locale (ADR-037). Oś niezależna od tenants.locale i od języka panelu.';

-- ---------------------------------------------------------------------
-- 2. app.create_order — koszt dostawy w transporcie (ADR-030, wpięcie)
-- ---------------------------------------------------------------------
--
-- orders.delivery_grosze istnieje od 0013 (default 0), ale kreator zamówienia
-- go nie zapisywał — koszt dostawy przepadał. Wpięcie MUSI być atomowe z resztą
-- zamówienia: create_order istnieje właśnie po to, by INSERT zamówienia i
-- pozycji dzielił jedną transakcję (ADR-024). UPDATE po insercie z akcji panelu
-- byłby DRUGIM żądaniem PostgREST, czyli osobną transakcją — jego awaria
-- zostawiłaby zamówienie z delivery_grosze=0 obok policzonego kosztu, czyli
-- dokładnie klasę rozjazdu, którą transport miał zamknąć. Dlatego koszt wchodzi
-- PARAMETREM funkcji, a nie łatką po fakcie.
--
-- p_delivery_grosze ma DEFAULT 0 i stoi NA KOŃCU listy: dzięki temu istniejący
-- wołający (9 argumentów) działa bez zmian (delivery_grosze=0, jak default
-- kolumny), a jedyna definicja funkcji nie tworzy przeciążenia (najpierw DROP
-- starej sygnatury, potem CREATE nowej — bez dwóch wariantów naraz nie ma
-- dwuznaczności wołania). coalesce(...,0) domyka jawny NULL do wartości kolumny.
--
-- Reszta ciała jest IDENTYCZNA jak w 0010 (odtworzona w całości, nie okrojona —
-- okrojona kopia zdjęłaby cicho logikę pustych pozycji albo stały porządek
-- wstawiania spod advisory locka). SECURITY INVOKER, grant tylko authenticated —
-- bez zmian wobec 0010.
drop function if exists app.create_order(uuid, date, date, text, uuid, text, int, int, jsonb);

create function app.create_order(
  p_customer_id uuid,
  p_start_date date,
  p_end_date date,
  p_delivery_method text,
  p_pickup_location_id uuid,
  p_notes text,
  p_total_rental_grosze int,
  p_total_deposit_grosze int,
  p_items jsonb,
  p_delivery_grosze int default 0
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_order_id uuid;
  r record;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Zamówienie wymaga co najmniej jednej pozycji.'
      using errcode = '22023';
  end if;

  insert into public.orders (
    tenant_id, customer_id, start_date, end_date, delivery_method,
    pickup_location_id, notes, total_rental_grosze, total_deposit_grosze,
    delivery_grosze
  ) values (
    app.tenant_id(), p_customer_id, p_start_date, p_end_date, p_delivery_method,
    p_pickup_location_id, p_notes,
    coalesce(p_total_rental_grosze, 0), coalesce(p_total_deposit_grosze, 0),
    coalesce(p_delivery_grosze, 0)
  )
  returning id into v_order_id;

  -- Stały porządek wstawiania (unit_id) = stały porządek blokad advisory —
  -- patrz komentarz przy zmianie terminu w app.orders_write_gate().
  for r in
    select
      (item ->> 'product_id')::uuid as product_id,
      nullif(item ->> 'unit_id', '')::uuid as unit_id,
      coalesce((item ->> 'rental_grosze')::int, 0) as rental_grosze,
      coalesce((item ->> 'deposit_grosze')::int, 0) as deposit_grosze
    from jsonb_array_elements(p_items) as item
    order by item ->> 'unit_id' nulls last
  loop
    insert into public.order_items (
      tenant_id, order_id, product_id, unit_id, rental_grosze, deposit_grosze
    ) values (
      app.tenant_id(), v_order_id, r.product_id, r.unit_id, r.rental_grosze, r.deposit_grosze
    );
  end loop;

  return v_order_id;
end;
$$;

comment on function app.create_order(uuid, date, date, text, uuid, text, int, int, jsonb, int) is
  'Atomowe utworzenie zamówienia z pozycjami i kosztem dostawy (transport, nie bramka — ADR-024/ADR-030). SECURITY INVOKER: RLS i triggery 0010 obowiązują wewnątrz; odmowa bramki wycofuje całość. p_delivery_grosze default 0 zachowuje zgodność z wołającym sprzed 0016.';

-- Uprawnienia bez zmian wobec 0010: anon nic nie robi przy zamówieniach,
-- service_role bez claimu tenant_id poległby na RLS INSERT.
revoke all on function app.create_order(uuid, date, date, text, uuid, text, int, int, jsonb, int) from public, anon;
grant execute on function app.create_order(uuid, date, date, text, uuid, text, int, int, jsonb, int) to authenticated;
