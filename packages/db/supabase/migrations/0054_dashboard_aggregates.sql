-- 0054_dashboard_aggregates.sql
--
-- Dashboard operatora — agregaty liczone W BAZIE (C1, ADR-109).
--
-- Cztery funkcje odczytowe `app.dashboard_*`. Zasady wspólne:
--
--   * SECURITY INVOKER + jawny filtr `tenant_id = app.tenant_id()` w KAŻDYM
--     zapytaniu. Dwie warstwy izolacji: RLS tabel bazowych (invoker nie
--     omija polityk) ORAZ jawny filtr — dzięki niemu wywołanie przez
--     service_role (RLS zdjęte) nie agreguje cudzych wierszy, tylko zwraca
--     pusty wynik (`app.tenant_id()` bez claimu tenanta = NULL → fail-closed).
--     Agregat to klasyczne miejsce wycieku (COUNT po cudzych wierszach to też
--     wyciek), dlatego świadomie NIE używamy SECURITY DEFINER (ADR-109).
--
--   * Multiwaluta (ADR-103): kwoty żyją w walucie WIERSZA zamówienia, więc
--     każdy agregat kwotowy grupuje PO WALUCIE. Suma groszy różnych walut
--     nigdy nie opuszcza tej migracji.
--
--   * Przychód ZREALIZOWANY (kontrakt, przypięty testem
--     packages/db/test/dashboard-aggregates.test.ts):
--       payment_status IN ('paid','manual','completed','deposit_refunded')
--       AND order_status <> 'cancelled'.
--     `paid` — potwierdzona wpłata online; `manual`/`completed` — ręczne
--     oznaczenia operatora (obieg offline); `deposit_refunded` — najem
--     rozliczony, kaucja oddana (przychód z najmu pozostał). Wykluczone:
--     `unpaid`/`pending`/`payment_failed` (brak wpłaty), `refunded`
--     (pieniądze oddane), `cancelled` na obu osiach. Kaucja NIE jest
--     przychodem (depozyt) — total_deposit_grosze nie występuje w żadnej
--     sumie przychodu.
--
--   * Okno miesięczne = miesiąc kalendarzowy operatora: `start_date` jest
--     datą kalendarzową (kolumna date, bez strefy), a „dziś" liczymy w
--     Europe/Warsaw. Przypisanie zamówienia do miesiąca: po `start_date`
--     (dzień rozpoczęcia najmu) — brak w schemacie znacznika czasu wpłaty,
--     a start najmu jest deterministyczny i indeksowany
--     (orders_tenant_dates_idx). `p_today` pozwala testom przypiąć okna
--     deterministycznie; dla członka to nieszkodliwe (własne dane).
--
--   * Zajętość (utilization) NIE wymyśla drugiej definicji: „trzyma sprzęt"
--     to statusy AVAILABILITY_BLOCKING_ORDER_STATUSES z silnika
--     (pending/reserved/ready_for_pickup/picked_up — lustro 0010) plus
--     `returned` — stan terminalny zamówienia, które sprzęt TRZYMAŁO (okno
--     patrzy w przeszłość; bez `returned` zdrowy biznes miałby zajętość
--     bliską zeru). Jedyny status poza zbiorem to `cancelled` — zamówienie,
--     które sprzętu nigdy nie trzymało. Zgodność z silnikiem przypina test.
--
--   * Granty: WYŁĄCZNIE authenticated + service_role. Anon nie dosięga
--     żadnej z funkcji (revoke z public/anon — jawnie, nie przez domysł
--     o default privileges).
--
-- Bez nowych indeksów: zapytania jadą po istniejących
-- orders_tenant_dates_idx / orders_tenant_status_idx /
-- orders_tenant_customer_idx / deposit_events_tenant_order_idx /
-- order_items_tenant_product_idx (ADR-109; skala pojedynczego najemcy).

-- ---------------------------------------------------------------------------
-- 1. Przychód zrealizowany per miesiąc × waluta (okno p_months wstecz,
--    łącznie z miesiącem bieżącym).
-- ---------------------------------------------------------------------------
create or replace function app.dashboard_revenue(
  p_months integer default 12,
  p_today date default null
) returns table (
  month_start date,
  currency_code text,
  rental_grosze bigint,
  delivery_grosze bigint,
  orders_count bigint
)
language sql stable security invoker as $$
  with bounds as (
    select
      date_trunc(
        'month',
        coalesce(p_today, (pg_catalog.now() at time zone 'Europe/Warsaw')::date)::timestamp
      )::date as cur_month,
      greatest(1, least(coalesce(p_months, 12), 36)) as months
  )
  select
    date_trunc('month', o.start_date::timestamp)::date as month_start,
    o.currency as currency_code,
    sum(o.total_rental_grosze)::bigint as rental_grosze,
    sum(o.delivery_grosze)::bigint as delivery_grosze,
    count(*)::bigint as orders_count
  from public.orders o
  cross join bounds b
  where o.tenant_id = app.tenant_id()
    and o.order_status <> 'cancelled'
    and o.payment_status in ('paid', 'manual', 'completed', 'deposit_refunded')
    and o.start_date >= (b.cur_month - make_interval(months => b.months - 1))::date
    and o.start_date < (b.cur_month + make_interval(months => 1))::date
  group by 1, 2
  order by 1, 2
$$;

alter function app.dashboard_revenue(integer, date) set search_path = pg_catalog;

revoke execute on function app.dashboard_revenue(integer, date) from public, anon;
grant execute on function app.dashboard_revenue(integer, date) to authenticated, service_role;

comment on function app.dashboard_revenue(integer, date) is
  'Przychód zrealizowany najemcy wywołującego: suma rental+delivery (BEZ kaucji) per miesiąc × waluta, przypisanie po start_date, okno p_months miesięcy wstecz włącznie z bieżącym (Europe/Warsaw). Definicja „zrealizowany": paid/manual/completed/deposit_refunded, bez anulowanych (ADR-109).';

-- ---------------------------------------------------------------------------
-- 2. Wykorzystanie sprzętu per produkt w oknie p_days dni (kończącym się
--    dziś). Dni zajętości egzemplarzy / (egzemplarze × dni okna).
-- ---------------------------------------------------------------------------
create or replace function app.dashboard_utilization(
  p_days integer default 30,
  p_today date default null
) returns table (
  product_id uuid,
  product_name text,
  product_active boolean,
  unit_count bigint,
  busy_days bigint,
  window_days integer,
  utilization_pct numeric
)
language sql stable security invoker as $$
  with bounds as (
    select
      coalesce(p_today, (pg_catalog.now() at time zone 'Europe/Warsaw')::date) as win_end,
      greatest(1, least(coalesce(p_days, 30), 365)) as days
  ),
  win as (
    select b.win_end, b.days, (b.win_end - (b.days - 1)) as win_start
    from bounds b
  ),
  busy as (
    -- Jeden order_item = jeden egzemplarz zajęty w dniach nachodzenia
    -- [start_date, end_date] na okno (zakres INCLUSIVE jak w silniku).
    select
      oi.product_id,
      sum(
        greatest(
          0,
          least(o.end_date, w.win_end) - greatest(o.start_date, w.win_start) + 1
        )
      )::bigint as busy_days
    from public.order_items oi
    join public.orders o
      on o.tenant_id = oi.tenant_id and o.id = oi.order_id
    cross join win w
    where oi.tenant_id = app.tenant_id()
      -- AVAILABILITY_BLOCKING_ORDER_STATUSES + returned (patrz nagłówek).
      and o.order_status in
        ('pending', 'reserved', 'ready_for_pickup', 'picked_up', 'returned')
      and o.start_date <= w.win_end
      and o.end_date >= w.win_start
    group by oi.product_id
  ),
  units as (
    select u.product_id, count(*)::bigint as unit_count
    from public.product_units u
    where u.tenant_id = app.tenant_id()
    group by u.product_id
  )
  select
    p.id as product_id,
    p.name as product_name,
    p.active as product_active,
    coalesce(un.unit_count, 0) as unit_count,
    coalesce(bu.busy_days, 0) as busy_days,
    w.days as window_days,
    case
      when coalesce(un.unit_count, 0) > 0 then
        least(
          100,
          round(
            100.0 * coalesce(bu.busy_days, 0) / (un.unit_count * w.days),
            1
          )
        )
      else null
    end as utilization_pct
  from public.products p
  cross join win w
  left join units un on un.product_id = p.id
  left join busy bu on bu.product_id = p.id
  where p.tenant_id = app.tenant_id()
  order by utilization_pct desc nulls last, busy_days desc, product_name asc
$$;

alter function app.dashboard_utilization(integer, date) set search_path = pg_catalog;

revoke execute on function app.dashboard_utilization(integer, date) from public, anon;
grant execute on function app.dashboard_utilization(integer, date) to authenticated, service_role;

comment on function app.dashboard_utilization(integer, date) is
  'Wykorzystanie sprzętu najemcy wywołującego: % dni zajętości egzemplarzy per produkt w oknie p_days dni (Europe/Warsaw). Zajętość = statusy blokujące dostępność (lustro silnika) + returned; cancelled nigdy nie trzymał sprzętu (ADR-109). Bez walut — dni są walutowo-neutralne.';

-- ---------------------------------------------------------------------------
-- 3. Złoci klienci — ranking po przychodzie zrealizowanym per waluta
--    (top p_limit W KAŻDEJ walucie + udział % w całości tej waluty).
-- ---------------------------------------------------------------------------
create or replace function app.dashboard_top_customers(
  p_months integer default 12,
  p_limit integer default 10,
  p_today date default null
) returns table (
  customer_id uuid,
  customer_name text,
  currency_code text,
  revenue_grosze bigint,
  orders_count bigint,
  last_order_date date,
  share_pct numeric
)
language sql stable security invoker as $$
  with bounds as (
    select
      date_trunc(
        'month',
        coalesce(p_today, (pg_catalog.now() at time zone 'Europe/Warsaw')::date)::timestamp
      )::date as cur_month,
      greatest(1, least(coalesce(p_months, 12), 36)) as months,
      greatest(1, least(coalesce(p_limit, 10), 50)) as lim
  ),
  realized as (
    select
      o.customer_id,
      o.currency,
      (o.total_rental_grosze + o.delivery_grosze)::bigint as revenue,
      o.start_date
    from public.orders o
    cross join bounds b
    where o.tenant_id = app.tenant_id()
      and o.order_status <> 'cancelled'
      and o.payment_status in ('paid', 'manual', 'completed', 'deposit_refunded')
      and o.start_date >= (b.cur_month - make_interval(months => b.months - 1))::date
      and o.start_date < (b.cur_month + make_interval(months => 1))::date
  ),
  per_customer as (
    select
      r.customer_id,
      r.currency,
      sum(r.revenue)::bigint as revenue_grosze,
      count(*)::bigint as orders_count,
      max(r.start_date) as last_order_date
    from realized r
    group by 1, 2
  ),
  ranked as (
    select
      pc.*,
      round(
        100.0 * pc.revenue_grosze
          / nullif(sum(pc.revenue_grosze) over (partition by pc.currency), 0),
        1
      ) as share_pct,
      row_number() over (
        partition by pc.currency order by pc.revenue_grosze desc, pc.customer_id
      ) as rn
    from per_customer pc
  )
  select
    c.id as customer_id,
    coalesce(c.full_name, c.company_name, c.email) as customer_name,
    r.currency as currency_code,
    r.revenue_grosze,
    r.orders_count,
    r.last_order_date,
    r.share_pct
  from ranked r
  join public.customers c
    on c.tenant_id = app.tenant_id() and c.id = r.customer_id
  cross join bounds b
  where r.rn <= b.lim
  order by r.currency, r.revenue_grosze desc
$$;

alter function app.dashboard_top_customers(integer, integer, date)
  set search_path = pg_catalog;

revoke execute on function app.dashboard_top_customers(integer, integer, date)
  from public, anon;
grant execute on function app.dashboard_top_customers(integer, integer, date)
  to authenticated, service_role;

comment on function app.dashboard_top_customers(integer, integer, date) is
  'Złoci klienci najemcy wywołującego: top p_limit klientów per waluta po przychodzie zrealizowanym (definicja ADR-109) w oknie p_months miesięcy, z udziałem % w całości przychodu tej waluty, liczbą zamówień i datą ostatniego zamówienia.';

-- ---------------------------------------------------------------------------
-- 4. Wymaga uwagi: po terminie zwrotu bez zwrotu · nieudane płatności ·
--    nierozliczone kaucje po zakończonym najmie. Do p_limit pozycji per typ.
-- ---------------------------------------------------------------------------
create or replace function app.dashboard_attention(
  p_today date default null,
  p_limit integer default 20
) returns table (
  kind text,
  order_id uuid,
  order_number text,
  customer_name text,
  end_date date,
  amount_grosze bigint,
  currency_code text
)
language sql stable security invoker as $$
  with bounds as (
    select
      coalesce(p_today, (pg_catalog.now() at time zone 'Europe/Warsaw')::date) as today,
      greatest(1, least(coalesce(p_limit, 20), 100)) as lim
  ),
  overdue as (
    -- Wydane, termin zwrotu minął, zwrotu nie odnotowano.
    select
      'overdue_return'::text as kind,
      o.id, o.order_number, o.customer_id, o.end_date,
      (o.total_rental_grosze + o.delivery_grosze)::bigint as amount_grosze,
      o.currency,
      row_number() over (order by o.end_date asc, o.id) as rn
    from public.orders o
    cross join bounds b
    where o.tenant_id = app.tenant_id()
      and o.order_status = 'picked_up'
      and o.end_date < b.today
  ),
  failed as (
    -- Nieudana płatność online (status osiągalny tylko w obiegu stripe).
    select
      'payment_failed'::text as kind,
      o.id, o.order_number, o.customer_id, o.end_date,
      (o.total_rental_grosze + o.delivery_grosze)::bigint as amount_grosze,
      o.currency,
      row_number() over (order by o.end_date asc, o.id) as rn
    from public.orders o
    where o.tenant_id = app.tenant_id()
      and o.payment_status = 'payment_failed'
      and o.order_status <> 'cancelled'
  ),
  deposit_open as (
    -- Najem zakończony (returned), a saldo kaucji z rejestru > 0:
    -- collected − refunded − deducted. Kwota pozycji = otwarte saldo.
    select
      'deposit_unsettled'::text as kind,
      o.id, o.order_number, o.customer_id, o.end_date,
      d.balance as amount_grosze,
      o.currency,
      row_number() over (order by o.end_date asc, o.id) as rn
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
  )
  select u.kind, u.id, u.order_number,
    coalesce(c.full_name, c.company_name, c.email) as customer_name,
    u.end_date, u.amount_grosze, u.currency as currency_code
  from (
    select * from overdue
    union all
    select * from failed
    union all
    select * from deposit_open
  ) u
  join public.customers c
    on c.tenant_id = app.tenant_id() and c.id = u.customer_id
  cross join bounds b
  where u.rn <= b.lim
  order by
    case u.kind
      when 'overdue_return' then 1
      when 'payment_failed' then 2
      else 3
    end,
    u.end_date asc
$$;

alter function app.dashboard_attention(date, integer) set search_path = pg_catalog;

revoke execute on function app.dashboard_attention(date, integer) from public, anon;
grant execute on function app.dashboard_attention(date, integer) to authenticated, service_role;

comment on function app.dashboard_attention(date, integer) is
  'Pozycje wymagające uwagi operatora: zamówienia po terminie zwrotu bez zwrotu (picked_up, end_date < dziś), płatności payment_failed oraz nierozliczone kaucje po zakończonym najmie (returned, saldo rejestru > 0). Panel linkuje po order_id (UUID) — zero danych osobowych w URL (ADR-109).';
