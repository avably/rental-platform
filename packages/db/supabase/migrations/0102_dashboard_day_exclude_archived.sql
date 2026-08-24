-- 0102_dashboard_day_exclude_archived.sql
--
-- Pulpit „widok dnia" wyklucza ZARCHIWIZOWANE zamówienia (ADR-246) —
-- domknięcie świadomego follow-upu z archiwizacji (ADR-242, migracja 0100).
--
-- KONTEKST. Archiwizacja SOFT (0100/ADR-242) dodała trzecią, niezależną oś
-- widoczności `public.orders.archived_at` (NULL = aktywne). Aktywna LISTA
-- zamówień od razu chowa zarchiwizowane (`archived_at is null`), ale
-- `app.dashboard_day` (0069/ADR-140) kluczował WYŁĄCZNIE po `order_status`
-- i nie znał archiwum. ADR-242 nazwał to wprost jako odłożone: „zamówienie
-- zarchiwizowane z aktywnym statusem wciąż mogłoby wejść w listy dnia; spec
-- zawężał wykluczenie do LISTY zamówień (zrobione), a zmiana RPC dnia jest
-- poza pasem i poza specem (odłożone)". Ta migracja domyka tamten dług.
--
-- CO ZMIENIA. `create or replace app.dashboard_day` na bazie NAJŚWIEŻSZEJ
-- (i jedynej) definicji z 0069 — jedyna różnica merytoryczna to jawny
-- predykat `o.archived_at is null` w KAŻDEJ z pięciu gałęzi liczących
-- zamówienia (pickup_today / return_today / overdue / prepare_tomorrow oraz
-- OBIE gałęzie money_alert: payment_failed i deposit_unsettled). Reszta
-- ciała — projekcje, sortowania, liczniki kind_total, izolacja tenanta,
-- granty — bez zmian co do bajtu.
--
-- SEMANTYKA (świadomy osąd). Widok dnia jest z definicji LUSTREM aktywnej
-- listy zamówień (kontrakt „filtr `dzien`" z 0069). Skoro operator, chowając
-- zamówienie do archiwum, świadomie zdejmuje je z aktywnej powierzchni
-- operacyjnej, to pulpit dnia — również jego kafel alarmów pieniężnych
-- (money_alert) — nie ma dłużej o nim przypominać. Archiwum to FLAGA
-- WIDOCZNOŚCI: wykluczenie z NOTYFIKACJI dnia NIE rusza ani grosza danych —
-- rejestr kaucji, obieg płatności, faktury i historia klienta zostają
-- nietknięte (te subsystemy słusznie dalej liczą zarchiwizowane, ADR-242).
--
-- CZEGO ŚWIADOMIE NIE ZMIENIA. Agregaty ANALITYCZNO-HISTORYCZNE pulpitu
-- (`app.dashboard_revenue`, `app.dashboard_utilization`,
-- `app.dashboard_top_customers`, 0054/ADR-109) DALEJ liczą zarchiwizowane —
-- i to jest zamierzone. To nie są lustra aktywnej listy, tylko historia:
-- przychód zrealizowany, wykorzystanie sprzętu w minionym oknie i ranking
-- klientów. Ukrycie archiwum PRZEPISAŁOBY historię (zaniżony przychód,
-- zaniżona zajętość), co wprost łamie zasadę ADR-242 „archiwum nie dotyka
-- faktur/kaucji/historii". Gdyby właściciel chciał osobno „aktywny vs
-- pełny" widok analityki — to odrębna decyzja, nie ten follow-up.
--
-- IZOLACJA / GRANTY bez zmian: SECURITY INVOKER + jawny filtr
-- `tenant_id = app.tenant_id()` w każdej gałęzi (dwie warstwy: RLS tabel
-- bazowych ORAZ jawny filtr; service_role bez claimu tenanta = pusto,
-- fail-closed), search_path przypięty, EXECUTE tylko dla authenticated +
-- service_role (revoke z public/anon). Bez nowych indeksów: aktywna strona
-- (`archived_at is null`) to gorąca ścieżka obsłużona istniejącymi indeksami
-- tenanta z 0007 (partial index z 0100 celuje w RZADKĄ stronę archiwum).
-- Idempotentna: `create or replace` + powtarzalne alter/revoke/grant.

-- === BEGIN PROD MIGRATION 0102 ===

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
      and o.archived_at is null
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
      and o.archived_at is null
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
      and o.archived_at is null
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
      and o.archived_at is null
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
        and o.archived_at is null
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
        and o.archived_at is null
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

-- Konwencja ADR-132: przy create-or-replace granty istniejącej funkcji
-- pozostają, ale re-issue jest idempotentny i czyni migrację samowystarczalną.
-- EXECUTE wyłącznie dla authenticated (operator na pulpicie, SECURITY INVOKER
-- + RLS + jawny filtr tenanta) i service_role (diagnostyka; bez claimu i tak
-- pusto). Zdejmujemy public/anon jawnie, nie przez domysł o default privileges.
revoke all on function app.dashboard_day(date, integer) from public, anon;
grant execute on function app.dashboard_day(date, integer) to authenticated, service_role;

comment on function app.dashboard_day(date, integer) is
  'Widok dnia pulpitu najemcy wywołującego (UX1, ADR-140): pięć rodzajów spraw (pickup_today/return_today/overdue/prepare_tomorrow/money_alert) w jednym wywołaniu — licznik całego zbioru (kind_total) + do p_limit najpilniejszych pozycji per rodzaj (sortowanie: braki najpierw / saldo kaucji malejąco / dni po terminie malejąco / nieudane płatności przed kaucjami). Definicje zbiorów są kontraktem z filtrem `dzien` listy zamówień. WYKLUCZA zarchiwizowane zamówienia (archived_at is not null) ze WSZYSTKICH pięciu rodzajów — lustro aktywnej listy, która je chowa (ADR-246, domyka follow-up ADR-242); rejestru kaucji/płatności/historii NIE rusza. „Dziś" w Europe/Warsaw; panel linkuje po order_id (UUID) — zero danych osobowych w URL (ADR-109).';

-- === END PROD MIGRATION 0102 ===
