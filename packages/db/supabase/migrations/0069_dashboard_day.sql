-- 0069_dashboard_day.sql
--
-- Pulpit jako widok dnia (UX1, ADR-140) — JEDNA funkcja odczytu
-- `app.dashboard_day`, siostrzana wobec czterech funkcji 0054 (ADR-109).
--
-- Pięć kafli „Dzisiaj" na pulpicie (wydania dziś · zwroty dziś · po terminie
-- · jutro do przygotowania · alarmy pieniężne) czyta komplet dnia JEDNYM
-- wywołaniem — nie pięcioma zapytaniami z panelu. Panel wyłącznie prezentuje:
-- liczniki (kind_total), pozycje w kolejności pilności (item_position) i braki
-- (payment_status / unit_missing) przychodzą policzone z bazy.
--
-- Zasady wspólne z 0054 (ADR-109):
--
--   * SECURITY INVOKER + jawny filtr `tenant_id = app.tenant_id()` w KAŻDEJ
--     gałęzi. Dwie warstwy izolacji: RLS tabel bazowych ORAZ jawny filtr —
--     wywołanie przez service_role bez claimu tenanta zwraca pusto
--     (fail-closed), nigdy agregat po cudzych wierszach.
--
--   * „Dziś" = data warszawska (Europe/Warsaw), jak pozostałe funkcje
--     dashboardu; `p_today` pozwala testom przypiąć okna deterministycznie.
--
--   * Granty: WYŁĄCZNIE authenticated + service_role, revoke z public/anon
--     (konwencja ADR-132; bramka function-acls.test.ts łapie odstępstwo).
--
-- DEFINICJE ZBIORÓW (kontrakt z listą zamówień — filtr `dzien` na
-- /zamowienia stosuje TE SAME warunki, więc licznik kafla i wynik filtra
-- zawsze się zgadzają):
--
--   * pickup_today      — start_date = dziś,  order_status ∈
--                         (pending, reserved, ready_for_pickup);
--   * return_today      — end_date = dziś,    order_status = picked_up;
--   * overdue           — end_date < dziś,    order_status = picked_up
--                         (ta sama definicja co overdue_return z 0054);
--   * prepare_tomorrow  — start_date = jutro, order_status ∈
--                         (pending, reserved, ready_for_pickup);
--   * money_alert       — payment_failed (order_status <> cancelled) oraz
--                         nierozliczona kaucja po najmie (returned, saldo
--                         rejestru > 0) — treść dawnej sekcji „Wymaga uwagi"
--                         BEZ overdue_return (ten mieszka w kaflu „Po
--                         terminie"; jedna sprawa nigdy w dwóch kaflach).
--                         Gałąź kaucyjna WYKLUCZA payment_failed — jedno
--                         zamówienie to jeden wiersz i jedna jednostka
--                         licznika (lustro filtra listy, który liczy zbiór
--                         DISTINCT po zamówieniach).
--
-- SORTOWANIE pozycji (reguła zawartości kafla ze spec-u UX1):
--   * pickup_today / prepare_tomorrow — braki najpierw (płatność
--     niezrealizowana, potem egzemplarz nieprzypisany), dalej numer rosnąco;
--   * return_today — kaucja do rozliczenia najpierw (saldo malejąco), numer;
--   * overdue — dni po terminie malejąco (end_date rosnąco), numer;
--   * money_alert — nieudane płatności przed kaucjami, end_date rosnąco
--     (semantyka sekcji „Wymaga uwagi" bez zmian).
--
-- „Płatność niezrealizowana" = payment_status poza zbiorem zrealizowanych
-- z 0054 (paid/manual/completed/deposit_refunded). Saldo kaucji liczone
-- z rejestru deposit_events (collected − refunded − deducted), jak w 0054.
--
-- kind_total liczy CAŁY zbiór rodzaju (przed limitem pozycji) — to jest
-- licznik kafla i licznik „Zobacz wszystkie (N)". Rodzaj bez wierszy = 0
-- po stronie panelu (kafle nigdy nie znikają — stan zerowy renderuje panel).
--
-- Bez nowych indeksów: zapytania jadą po orders_tenant_dates_idx /
-- orders_tenant_status_idx / deposit_events_tenant_order_idx (skala
-- pojedynczego najemcy, jak 0054).

create or replace function app.dashboard_day(
  p_today date default null,
  p_limit integer default 3
) returns table (
  kind text,
  kind_total bigint,
  item_position bigint,
  order_id uuid,
  order_number text,
  customer_name text,
  start_date date,
  end_date date,
  amount_grosze bigint,
  currency_code text,
  payment_status text,
  unit_missing boolean,
  item_kind text
)
language sql stable security invoker as $$
  with bounds as (
    select
      coalesce(p_today, (pg_catalog.now() at time zone 'Europe/Warsaw')::date) as today,
      greatest(1, least(coalesce(p_limit, 3), 20)) as lim
  ),
  pickup as (
    -- Wydania dziś: do wydania, jeszcze nie wydane.
    select
      'pickup_today'::text as kind, o.id, o.order_number, o.customer_id,
      o.start_date, o.end_date,
      (o.total_rental_grosze + o.delivery_grosze)::bigint as amount,
      o.currency, o.payment_status as pay_status,
      g.no_unit as no_unit,
      null::text as alert,
      count(*) over ()::bigint as total,
      row_number() over (
        order by
          (o.payment_status not in ('paid', 'manual', 'completed', 'deposit_refunded')) desc,
          g.no_unit desc,
          o.order_number asc,
          o.id
      ) as rn
    from public.orders o
    cross join bounds b
    cross join lateral (
      select exists (
        select 1 from public.order_items oi
        where oi.tenant_id = o.tenant_id and oi.order_id = o.id and oi.unit_id is null
      ) as no_unit
    ) g
    where o.tenant_id = app.tenant_id()
      and o.order_status in ('pending', 'reserved', 'ready_for_pickup')
      and o.start_date = b.today
  ),
  returns_today as (
    -- Zwroty dziś: wydane, termin zwrotu dziś. Kwota pozycji = OTWARTE saldo
    -- kaucji z rejestru (0 = nic do rozliczenia przy zwrocie).
    select
      'return_today'::text as kind, o.id, o.order_number, o.customer_id,
      o.start_date, o.end_date,
      d.balance as amount,
      o.currency, o.payment_status as pay_status,
      false as no_unit,
      null::text as alert,
      count(*) over ()::bigint as total,
      row_number() over (order by d.balance desc, o.order_number asc, o.id) as rn
    from public.orders o
    cross join bounds b
    join lateral (
      select
        coalesce(
          sum(
            case de.kind
              when 'collected' then de.amount_grosze
              else -de.amount_grosze
            end
          ),
          0
        )::bigint as balance
      from public.deposit_events de
      where de.tenant_id = o.tenant_id and de.order_id = o.id
    ) d on true
    where o.tenant_id = app.tenant_id()
      and o.order_status = 'picked_up'
      and o.end_date = b.today
  ),
  overdue as (
    -- Po terminie: wydane, termin zwrotu minął (definicja overdue_return 0054).
    select
      'overdue'::text as kind, o.id, o.order_number, o.customer_id,
      o.start_date, o.end_date,
      (o.total_rental_grosze + o.delivery_grosze)::bigint as amount,
      o.currency, o.payment_status as pay_status,
      false as no_unit,
      null::text as alert,
      count(*) over ()::bigint as total,
      row_number() over (order by o.end_date asc, o.order_number asc, o.id) as rn
    from public.orders o
    cross join bounds b
    where o.tenant_id = app.tenant_id()
      and o.order_status = 'picked_up'
      and o.end_date < b.today
  ),
  prepare_tomorrow as (
    -- Jutro do przygotowania: start jutro, jeszcze nie wydane.
    select
      'prepare_tomorrow'::text as kind, o.id, o.order_number, o.customer_id,
      o.start_date, o.end_date,
      (o.total_rental_grosze + o.delivery_grosze)::bigint as amount,
      o.currency, o.payment_status as pay_status,
      g.no_unit as no_unit,
      null::text as alert,
      count(*) over ()::bigint as total,
      row_number() over (
        order by
          (o.payment_status not in ('paid', 'manual', 'completed', 'deposit_refunded')) desc,
          g.no_unit desc,
          o.order_number asc,
          o.id
      ) as rn
    from public.orders o
    cross join bounds b
    cross join lateral (
      select exists (
        select 1 from public.order_items oi
        where oi.tenant_id = o.tenant_id and oi.order_id = o.id and oi.unit_id is null
      ) as no_unit
    ) g
    where o.tenant_id = app.tenant_id()
      and o.order_status in ('pending', 'reserved', 'ready_for_pickup')
      and o.start_date = (b.today + 1)
  ),
  money as (
    -- Alarmy pieniężne: treść dawnej sekcji „Wymaga uwagi" bez overdue_return.
    select
      'money_alert'::text as kind, m.id, m.order_number, m.customer_id,
      m.start_date, m.end_date,
      m.amount,
      m.currency, m.pay_status,
      false as no_unit,
      m.alert,
      count(*) over ()::bigint as total,
      row_number() over (
        order by
          case m.alert when 'payment_failed' then 1 else 2 end,
          m.end_date asc,
          m.order_number asc,
          m.id
      ) as rn
    from (
      select
        o.id, o.order_number, o.customer_id, o.start_date, o.end_date,
        (o.total_rental_grosze + o.delivery_grosze)::bigint as amount,
        o.currency, o.payment_status as pay_status,
        'payment_failed'::text as alert
      from public.orders o
      where o.tenant_id = app.tenant_id()
        and o.payment_status = 'payment_failed'
        and o.order_status <> 'cancelled'
      union all
      select
        o.id, o.order_number, o.customer_id, o.start_date, o.end_date,
        d.balance,
        o.currency, o.payment_status,
        'deposit_unsettled'::text
      from public.orders o
      join lateral (
        select
          coalesce(
            sum(
              case de.kind
                when 'collected' then de.amount_grosze
                else -de.amount_grosze
              end
            ),
            0
          )::bigint as balance
        from public.deposit_events de
        where de.tenant_id = o.tenant_id and de.order_id = o.id
      ) d on true
      where o.tenant_id = app.tenant_id()
        and o.order_status = 'returned'
        and d.balance > 0
        -- Rozłączność gałęzi: zamówienie payment_failed liczy się RAZ,
        -- w gałęzi płatności (jedna sprawa = jeden wiersz i jedna jednostka
        -- licznika — lustro filtra listy zamówień, który liczy DISTINCT).
        and o.payment_status <> 'payment_failed'
    ) m
  )
  select
    u.kind,
    u.total as kind_total,
    u.rn as item_position,
    u.id as order_id,
    u.order_number,
    coalesce(c.full_name, c.company_name, c.email) as customer_name,
    u.start_date,
    u.end_date,
    u.amount as amount_grosze,
    u.currency as currency_code,
    u.pay_status as payment_status,
    u.no_unit as unit_missing,
    u.alert as item_kind
  from (
    select * from pickup
    union all
    select * from returns_today
    union all
    select * from overdue
    union all
    select * from prepare_tomorrow
    union all
    select * from money
  ) u
  join public.customers c
    on c.tenant_id = app.tenant_id() and c.id = u.customer_id
  cross join bounds b
  where u.rn <= b.lim
  order by
    case u.kind
      when 'pickup_today' then 1
      when 'return_today' then 2
      when 'overdue' then 3
      when 'prepare_tomorrow' then 4
      else 5
    end,
    u.rn
$$;

alter function app.dashboard_day(date, integer) set search_path = pg_catalog;

-- Konwencja ADR-132: funkcja rodzi się z EXECUTE dla PUBLIC — zdejmujemy
-- jawnie. EXECUTE wyłącznie dla ról, które jej potrzebują: authenticated
-- (operator na pulpicie, SECURITY INVOKER + RLS + jawny filtr tenanta)
-- i service_role (diagnostyka; bez claimu tenanta i tak dostaje pusto).
revoke all on function app.dashboard_day(date, integer) from public, anon;
grant execute on function app.dashboard_day(date, integer) to authenticated, service_role;

comment on function app.dashboard_day(date, integer) is
  'Widok dnia pulpitu najemcy wywołującego (UX1, ADR-140): pięć rodzajów spraw (pickup_today/return_today/overdue/prepare_tomorrow/money_alert) w jednym wywołaniu — licznik całego zbioru (kind_total) + do p_limit najpilniejszych pozycji per rodzaj (sortowanie: braki najpierw / saldo kaucji malejąco / dni po terminie malejąco / nieudane płatności przed kaucjami). Definicje zbiorów są kontraktem z filtrem `dzien` listy zamówień. „Dziś" w Europe/Warsaw; panel linkuje po order_id (UUID) — zero danych osobowych w URL (ADR-109).';
