-- 0113_partial_returns.sql
-- ZWROTY CZĘŚCIOWE — egzemplarz wraca do puli dostępności PER-POZYCJA
-- (ADR-272, naprawa double-bookingu; decyzja właściciela).
--
-- PO CO. Do 0112 dostępność liczyła się WYŁĄCZNIE po statusie ZAMÓWIENIA:
-- egzemplarz blokował okno, dopóki całe zamówienie było w statusie blokującym
-- (pending/reserved/ready_for_pickup/picked_up), a przejście → returned zwalniało
-- WSZYSTKIE egzemplarze naraz. W realnej wypożyczalni klient oddaje sprzęt
-- częściami: dwa rowery wracają w środę, trzeci w piątek. Bez znacznika
-- per-pozycja albo trzymaliśmy wszystkie trzy jako zajęte do piątku (utrata
-- dostępności), albo zwracaliśmy całość w środę i wtedy trzeci rower — fizycznie
-- wciąż u klienta — stawał się „wolny" i dało się go podwójnie zarezerwować.
-- To DRUGIE jest dokładnie double-bookingiem, któremu bramka dostępności ma
-- zapobiegać.
--
-- CO ROBI.
--   (1) `order_items.returned_at timestamptz null` — znacznik FAKTYCZNEGO
--       zwrotu POJEDYNCZEJ pozycji. NULL = egzemplarz wciąż u klienta (blokuje
--       okno). Not null = wrócił do puli (nie blokuje), nawet gdy zamówienie
--       jest jeszcze `picked_up`.
--   (2) WSZYSTKIE funkcje dostępności dostają JEDEN dodatkowy warunek
--       `and oi.returned_at is null` OBOK warunku statusu blokującego —
--       egzemplarz liczy się jako zajęty tylko wtedy, gdy jego pozycja NIE
--       została zwrócona. Pominięcie którejkolwiek funkcji = double-booking,
--       więc zmiana obejmuje KOMPLET ścieżek liczących „czy egzemplarz zajęty
--       w oknie":
--         * app.assert_unit_available        — WIĄŻĄCA bramka wydania/checkoutu
--                                              (0082; wołana przez triggery
--                                              order_items_assignment_gate
--                                              i orders_write_gate),
--         * app.get_public_availability       — publiczny odczyt zakresu (0065),
--         * app.get_public_catalog_availability — publiczny odczyt katalogu (0081),
--         * app.get_public_availability_days  — publiczny odczyt dzienny (0081),
--         * app.public_checkout               — DOBÓR KANDYDATÓW w anonowym
--                                              zapisie zamówienia (0110). Bez
--                                              tego warunku sklep POKAZYWAŁBY
--                                              zwrócony egzemplarz jako wolny
--                                              (funkcje odczytu wyżej), ale
--                                              checkout ODMAWIAŁBY jego
--                                              rezerwacji — rozjazd „widać, nie
--                                              da się zarezerwować". Wiążącą
--                                              bramką wyścigu pozostaje
--                                              assert_unit_available; ta zmiana
--                                              tylko domyka spójność doboru.
--       Ciała funkcji przepisane co do bajtu z ich NAJŚWIEŻSZYCH definicji
--       (dyscyplina create-or-replace: starsza kopia cofnęłaby po cichu bramki
--       dołożone później). Jedyna różnica względem źródła to dokładnie ten
--       jeden warunek returned_at w projekcji kolizji.
--   (3) `app.return_order_items(p_order_id, p_item_ids, p_returned)` — RPC
--       panelu, którym operator ODZNACZA zwrócone pozycje. Stempluje/kasuje
--       returned_at; tenant-scope przez app.tenant_id() + żywy członek;
--       wyłącznie dla zamówienia `picked_up`; idempotentne. Odznaczenie
--       (p_returned=false) przechodzi przez re-check assert_unit_available —
--       egzemplarz zajęty w międzyczasie NIE wraca do najmu (nie wskrzeszamy
--       konfliktu).
--   (4) Trigger `order_items_return_backfill` — przejście → returned stempluje
--       returned_at na pozostałych pozycjach NULL, żeby dotychczasowy „zwrot
--       całości" dalej zwalniał wszystko I zostawiał spójny ślad per-pozycja.
--       Wybór BACKFILL, nie GATE: gdyby zamiast tego BLOKOWAĆ przejście →
--       returned do czasu odznaczenia wszystkich pozycji, dotychczasowy zwrot
--       całości (jedno kliknięcie w dropdownie statusu) przestałby działać.
--       Backfill zachowuje tę ścieżkę i czyni ją spójną z nowym modelem.
--
-- KAUCJA — BEZ ZMIAN. Rozliczenie kaucji zostaje przy PEŁNYM zwrocie
-- (payment_status → deposit_refunded, ADR-027). Zwrot częściowy rusza WYŁĄCZNIE
-- inwentarz/dostępność, ani jednego wiersza deposit_events.
--
-- BEZPIECZEŃSTWO / IZOLACJA. RPC jest SECURITY DEFINER z przypiętym
-- search_path i JAWNYM zawężeniem tenant_id (nie polega na RLS): zamówienie
-- innego najemcy nie istnieje w zapytaniu (P0002). Publiczne funkcje odczytu
-- zachowują kopertę „wyłącznie liczby" (ADR-042) — returned_at nie wychodzi na
-- zewnątrz, zmienia jedynie licznik wolnych sztuk. Kolumna jest ADDYTYWNA
-- (nullable), więc macierz izolacji i fabryki seed-tenants.ts bez zmian.
--
-- OKNO WDROŻENIOWE (migracja jedzie na produkcję PRZED kodem — deploy-before-code):
-- warunek returned_at is null jest neutralny dla istniejących danych (kolumna
-- rodzi się NULL wszędzie, więc każdy dotychczasowy blokujący najem blokuje
-- dalej). UI panelu i RPC zapalają się dopiero po wdrożeniu kodu; brak kodu
-- w oknie wdrożeniowym niczego nie osłabia.

-- === BEGIN PROD MIGRATION 0113 ===

-- ---------------------------------------------------------------------
-- 1. Kolumna: znacznik zwrotu POJEDYNCZEJ pozycji
-- ---------------------------------------------------------------------
alter table public.order_items
  add column returned_at timestamptz;

comment on column public.order_items.returned_at is
  'Znacznik FAKTYCZNEGO zwrotu POJEDYNCZEJ pozycji (ADR-272). NULL = egzemplarz '
  'wciąż u klienta i BLOKUJE okno dostępności; not null = wrócił do puli i nie '
  'blokuje, nawet gdy zamówienie jest jeszcze picked_up. Ustawiany przez '
  'app.return_order_items (zwrot częściowy) oraz trigger order_items_return_backfill '
  '(pełny zwrot → returned). Kaucja rozlicza się osobno, przy pełnym zwrocie.';

-- ---------------------------------------------------------------------
-- 2. WIĄŻĄCA bramka wydania/checkoutu (przepisana z 0082 + returned_at)
-- ---------------------------------------------------------------------
create or replace function app.assert_unit_available(
  p_tenant_id uuid,
  p_unit_id uuid,
  p_exclude_item_id uuid,
  p_start_date date,
  p_end_date date
) returns void
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_buffer_before int;
  v_buffer_after int;
  v_service_from date;
  v_service_to date;
  v_conflict_order text;
begin
  -- Serializacja per (tenant, egzemplarz). Lock zwalnia koniec transakcji.
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':unit:' || p_unit_id::text, 0)
  );

  select p.buffer_before_days, p.buffer_after_days, u.unavailable_from, u.unavailable_to
    into v_buffer_before, v_buffer_after, v_service_from, v_service_to
  from public.product_units u
  join public.products p on p.tenant_id = u.tenant_id and p.id = u.product_id
  where u.tenant_id = p_tenant_id and u.id = p_unit_id;

  -- Egzemplarz niewidoczny (cudzy tenant albo nieistniejący): bramka się
  -- nie wypowiada — odrzuci go klucz złożony (23503), zachowując semantykę
  -- błędów z 0007 dla referencji międzytenantowych.
  if not found then
    return;
  end if;

  -- Okno serwisowe porównujemy z SUROWYM terminem (bez buforów): bufor to
  -- czas na przegląd między najmami, nie najem — nie musi omijać serwisu.
  -- Lustro isUnitInService z availability.ts, łącznie z oknami
  -- jednostronnymi: CHECK z 0007 wymusza komplet, ale silnik (i to lustro)
  -- nie ma prawa na cudzy CHECK liczyć — dane mogą przyjść z importu.
  if (v_service_from is not null or v_service_to is not null)
     and (v_service_from is null or p_end_date >= v_service_from)
     and (v_service_to is null or p_start_date <= v_service_to)
  then
    -- 0082: bez uuid egzemplarza. Okno serwisowe to informacja operacyjna
    -- wypożyczalni — klient sklepu ma wiedzieć, że sprzęt jest niedostępny,
    -- a nie KTÓRA sztuka i z jakiego powodu wewnętrznego.
    raise exception 'Egzemplarz jest niedostępny w wybranym terminie.'
      using errcode = '23P01';
  end if;

  -- Kolizja z innym najmem: żądany termin ROZSZERZONY o bufory produktu vs
  -- SUROWE terminy pozostałych pozycji tego egzemplarza — dokładnie tak
  -- liczy checkAvailability (relacja jest symetryczna, więc rozszerzenie
  -- jednej strony wystarcza). Zakresy INCLUSIVE (0007). Lista statusów
  -- blokujących = AVAILABILITY_BLOCKING_ORDER_STATUSES z @avably/core;
  -- returned i cancelled zwalniają egzemplarz (wcześniejszy zwrot otwiera
  -- termin natychmiast). Zgodność luster przypina order-gates.test.ts.
  select o.order_number into v_conflict_order
  from public.order_items oi
  join public.orders o on o.tenant_id = oi.tenant_id and o.id = oi.order_id
  where oi.tenant_id = p_tenant_id
    and oi.unit_id = p_unit_id
    and oi.id is distinct from p_exclude_item_id
    and o.order_status in ('pending', 'reserved', 'ready_for_pickup', 'picked_up')
    and oi.returned_at is null
    and o.start_date <= p_end_date + v_buffer_after
    and o.end_date >= p_start_date - v_buffer_before
  limit 1;

  -- `v_conflict_order` ZOSTAJE w zapytaniu: to on rozstrzyga, czy kolizja
  -- w ogóle istnieje (`is not null`). Zmienia się wyłącznie to, że jego
  -- WARTOŚĆ nie opuszcza już funkcji.
  if v_conflict_order is not null then
    raise exception 'Egzemplarz jest zajęty w wybranym terminie.'
      using errcode = '23P01';
  end if;
end;
$$;

comment on function app.assert_unit_available(uuid, uuid, uuid, date, date) is
  'Bramka dostępności egzemplarza (ADR-024, ADR-181, ADR-272): advisory lock '
  'per (tenant, egzemplarz) + re-check semantyką silnika (bufory produktu, okno '
  'serwisowe vs surowy termin, statusy blokujące). Od ADR-272 kolizję liczy '
  'WYŁĄCZNIE z pozycji NIEZWRÓCONYCH (order_items.returned_at is null) — '
  'egzemplarz na pozycji zwróconej jest wolny, nawet gdy zamówienie wciąż '
  'picked_up. Rzuca 23P01. Treść odmowy nie niesie identyfikatorów.';

revoke all on function app.assert_unit_available(uuid, uuid, uuid, date, date) from public, anon;
grant execute on function app.assert_unit_available(uuid, uuid, uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Publiczny odczyt dostępności — zakres (przepisany z 0065 + returned_at)
-- ---------------------------------------------------------------------
create or replace function app.get_public_availability(
  p_tenant_id uuid,
  p_product_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select case
    when p.id is null or p_start_date is null or p_end_date is null or p_end_date < p_start_date
      then null
    else jsonb_build_object(
      'total_units', (
        select count(*) from public.product_units u
        where u.tenant_id = p.tenant_id and u.product_id = p.id
      ),
      'available_units', (
        select count(*) from public.product_units u
        where u.tenant_id = p.tenant_id and u.product_id = p.id
          -- poza oknem serwisowym (surowy termin, lustro isUnitInService)
          and not (
            (u.unavailable_from is not null or u.unavailable_to is not null)
            and (u.unavailable_from is null or p_end_date >= u.unavailable_from)
            and (u.unavailable_to is null or p_start_date <= u.unavailable_to)
          )
          -- bez kolizji z najmem blokującym (termin rozszerzony o bufory)
          and not exists (
            select 1
            from public.order_items oi
            join public.orders o on o.tenant_id = oi.tenant_id and o.id = oi.order_id
            where oi.tenant_id = p.tenant_id
              and oi.unit_id = u.id
              and o.order_status in ('pending', 'reserved', 'ready_for_pickup', 'picked_up')
              and oi.returned_at is null
              and o.start_date <= p_end_date + p.buffer_after_days
              and o.end_date >= p_start_date - p.buffer_before_days
          )
      )
    )
  end
  from (
    select pr.id, pr.tenant_id, pr.buffer_before_days, pr.buffer_after_days
    from public.products pr
    join public.tenants t on t.id = pr.tenant_id
    where pr.tenant_id = p_tenant_id
      and pr.id = p_product_id
      and pr.active
      and app.tenant_commercially_active(t.status)
    union all
    select null::uuid, null::uuid, null::int, null::int
    limit 1
  ) p;
$$;

comment on function app.get_public_availability(uuid, uuid, date, date) is
  'Publiczna dostępność zakresu jednego sprzętu (0020/0065, ADR-042, ADR-272). '
  'Od ADR-272 kolizję liczy wyłącznie z pozycji niezwróconych '
  '(order_items.returned_at is null). Zwraca WYŁĄCZNIE liczby — bez '
  'identyfikatorów. SECURITY DEFINER: izolację niesie jawne zawężenie tenant_id.';

revoke all on function app.get_public_availability(uuid, uuid, date, date) from public;
grant execute on function app.get_public_availability(uuid, uuid, date, date) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Publiczny odczyt dostępności — katalog (przepisany z 0081 + returned_at)
-- ---------------------------------------------------------------------
create or replace function app.get_public_catalog_availability(
  p_tenant_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select case
    when t.id is null or p_start_date is null or p_end_date is null or p_end_date < p_start_date
      then null
    else jsonb_build_object(
      'products', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'product_id', p.id,
            'total_units', (
              select count(*) from public.product_units u
              where u.tenant_id = p.tenant_id and u.product_id = p.id
            ),
            'available_units', (
              select count(*) from public.product_units u
              where u.tenant_id = p.tenant_id and u.product_id = p.id
                -- poza oknem serwisowym (surowy termin, lustro isUnitInService)
                and not (
                  (u.unavailable_from is not null or u.unavailable_to is not null)
                  and (u.unavailable_from is null or p_end_date >= u.unavailable_from)
                  and (u.unavailable_to is null or p_start_date <= u.unavailable_to)
                )
                -- bez kolizji z najmem blokującym (termin rozszerzony o bufory)
                and not exists (
                  select 1
                  from public.order_items oi
                  join public.orders o on o.tenant_id = oi.tenant_id and o.id = oi.order_id
                  where oi.tenant_id = p.tenant_id
                    and oi.unit_id = u.id
                    and o.order_status in ('pending', 'reserved', 'ready_for_pickup', 'picked_up')
                    and oi.returned_at is null
                    and o.start_date <= p_end_date + p.buffer_after_days
                    and o.end_date >= p_start_date - p.buffer_before_days
                )
            )
          )
          order by p.id
        )
        from public.products p
        where p.tenant_id = t.id and p.active
      ), '[]'::jsonb)
    )
  end
  -- Najemca jako pojedynczy wiersz ALBO brak wiersza: `union all` z wierszem
  -- pustym i `limit 1` daje zawsze dokładnie jeden wiersz, więc CASE ma na czym
  -- stanąć. Ten sam idiom, co w `app.get_public_availability` (0020) — bez niego
  -- funkcja `language sql` przy najemcy poza oknem handlowym oddałaby ZERO
  -- WIERSZY, czyli NULL-a nieodróżnialnego od naszego, ale osiągniętego inną
  -- drogą i przez to nieodpornego na dołożenie drugiego klucza do koperty.
  from (
    select ten.id
    from public.tenants ten
    where ten.id = p_tenant_id
      and app.tenant_commercially_active(ten.status)
    union all
    select null::uuid
    limit 1
  ) t;
$$;

comment on function app.get_public_catalog_availability(uuid, date, date) is
  'Publiczna dostępność CAŁEGO katalogu w jednym wywołaniu (0081, ADR-179, '
  'ADR-272). Reguła kolizji przepisana co do znaku z app.get_public_availability, '
  'łącznie z warunkiem order_items.returned_at is null. Zwraca WYŁĄCZNIE liczby '
  '(ADR-042). SECURITY DEFINER: izolację niesie jawne zawężenie tenant_id.';

revoke all on function app.get_public_catalog_availability(uuid, date, date) from public;
grant execute on function app.get_public_catalog_availability(uuid, date, date) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Publiczny odczyt dostępności — mapa dzienna (przepisany z 0081 + returned_at)
-- ---------------------------------------------------------------------
create or replace function app.get_public_availability_days(
  p_tenant_id uuid,
  p_product_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select case
    when p.id is null
      or p_start_date is null or p_end_date is null
      or p_end_date < p_start_date
      -- SUFIT OKNA (AVAILABILITY_WINDOW_MAX_DAYS w @avably/core). Szerokość
      -- INCLUSIVE, więc okno jednodniowe ma szerokość 1, a dokładnie 90 dni
      -- jeszcze przechodzi. Odmowa jest NULL-em, a nie wyjątkiem: wołający
      -- traktuje NULL jako „dostępność niedostępna" i degraduje się tak samo,
      -- jak przy najemcy poza oknem handlowym — jedna ścieżka błędu zamiast dwóch.
      or (p_end_date - p_start_date) + 1 > 90
      then null
    else jsonb_build_object(
      'total_units', (
        select count(*) from public.product_units u
        where u.tenant_id = p.tenant_id and u.product_id = p.id
      ),
      'days', (
        select jsonb_object_agg(to_char(d.day, 'YYYY-MM-DD'), d.free)
        from (
          select
            g.day::date as day,
            (
              select count(*)
              from public.product_units u
              where u.tenant_id = p.tenant_id and u.product_id = p.id
                -- poza oknem serwisowym (surowy termin, lustro isUnitInService)
                and not (
                  (u.unavailable_from is not null or u.unavailable_to is not null)
                  and (u.unavailable_from is null or g.day::date >= u.unavailable_from)
                  and (u.unavailable_to is null or g.day::date <= u.unavailable_to)
                )
                -- bez kolizji z najmem blokującym (termin rozszerzony o bufory)
                and not exists (
                  select 1
                  from public.order_items oi
                  join public.orders o on o.tenant_id = oi.tenant_id and o.id = oi.order_id
                  where oi.tenant_id = p.tenant_id
                    and oi.unit_id = u.id
                    and o.order_status in ('pending', 'reserved', 'ready_for_pickup', 'picked_up')
                    and oi.returned_at is null
                    and o.start_date <= g.day::date + p.buffer_after_days
                    and o.end_date >= g.day::date - p.buffer_before_days
                )
            ) as free
          from generate_series(p_start_date, p_end_date, interval '1 day') g(day)
        ) d
      )
    )
  end
  from (
    select pr.id, pr.tenant_id, pr.buffer_before_days, pr.buffer_after_days
    from public.products pr
    join public.tenants t on t.id = pr.tenant_id
    where pr.tenant_id = p_tenant_id
      and pr.id = p_product_id
      and pr.active
      and app.tenant_commercially_active(t.status)
    union all
    select null::uuid, null::uuid, null::int, null::int
    limit 1
  ) p;
$$;

comment on function app.get_public_availability_days(uuid, uuid, date, date) is
  'Publiczna dostępność DZIENNA jednego sprzętu (0081, ADR-179, ADR-272): każdy '
  'dzień liczony jak zakres jednodniowy. Reguła kolizji przepisana co do znaku '
  'z app.get_public_availability, łącznie z warunkiem order_items.returned_at is '
  'null. Okno szersze niż AVAILABILITY_WINDOW_MAX_DAYS odrzucane NULL-em. Zwraca '
  'WYŁĄCZNIE liczby (ADR-042). SECURITY DEFINER: izolację niesie zawężenie tenant_id.';

revoke all on function app.get_public_availability_days(uuid, uuid, date, date) from public;
grant execute on function app.get_public_availability_days(uuid, uuid, date, date) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Anonowy zapis zamówienia — DOBÓR KANDYDATÓW (przepisany z 0110 + returned_at)
--
-- CIAŁO W CAŁOŚCI z 0110_checkout_max_rental_days.sql (NAJŚWIEŻSZA definicja;
-- historia przepisań: 0010/0020/0021/0029/0040/0041/0049/0058/0059/0063/0065/
-- 0086/0089/0110). JEDYNA różnica względem 0110: warunek `and oi.returned_at is
-- null` w zapytaniu doboru wolnych egzemplarzy — żeby sklep nie odmawiał
-- rezerwacji egzemplarza, który funkcje odczytu pokazują już jako wolny.
-- Sygnatura, sufit najmu, bramki regulaminu/minimum i koperty odczytów BEZ ZMIAN.
-- ---------------------------------------------------------------------
create or replace function app.public_checkout(
  p_tenant_id uuid,
  p_email text,
  p_full_name text,
  p_phone text,
  p_start_date date,
  p_end_date date,
  p_delivery_method text,
  p_pickup_location_id uuid,
  p_items jsonb,
  p_terms_version text,
  p_locale text default null,
  p_company_name text default null,
  p_nip text default null,
  p_address_street text default null,
  p_address_zip text default null,
  p_address_city text default null,
  p_notes text default null,
  -- [0029] Wybór metody płatności przez klienta. Default 'transfer', bo
  -- wołający, który o płatności nie wie NIC, ma dostać obieg offline —
  -- najbezpieczniejszy z możliwych: zamówienie czeka na rozliczenie
  -- z człowiekiem. Domyślka 'online' cicho wprowadzałaby zamówienia
  -- w reżim ścisły bez płatności, która ma je z niego wyprowadzić.
  p_payment_method text default 'transfer',
  -- [0058] POLA WŁASNE Z ZAMAWIANIA (C6-A3, ADR-121). Dwie mapy, nie jedna:
  -- kolumna `custom_fields` mieszka OSOBNO na zamówieniu i na kliencie, więc
  -- rozdział musi nastąpić PRZED wejściem tutaj. Encję wybiera DEFINICJA
  -- (rdzeń `splitCustomFieldValuesByEntity`), nigdy wołający — inaczej
  -- wystarczyłoby przenieść wartość do drugiej mapy, żeby ominąć filtr encji
  -- w triggerze 0057.
  --
  -- DEFAULT '{}' czyni wołającego sprzed C6-A3 poprawnym: checkout bez pól
  -- własnych zachowuje się dokładnie tak, jak przed tą migracją.
  p_order_custom_fields jsonb default '{}'::jsonb,
  p_customer_custom_fields jsonb default '{}'::jsonb,
  -- [0059] BILET ZAUFANEJ GRANICY (R13/H-02, ADR-125). Trzy pola jednego
  -- zaświadczenia, rozbite na osobne parametry, bo PostgREST i tak przekazuje
  -- je z nazwy — a rozbicie oszczędza parsowania stringa po stronie SQL.
  -- Bije je serwer storefrontu (lib/checkout/ticket.ts) PO zaliczonych
  -- bramkach; przeglądarka ich nie widzi i nie ma jak wyprodukować.
  p_ticket_exp bigint default null,
  p_ticket_nonce text default null,
  p_ticket_sig text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_tenant record;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_full_name text := btrim(coalesce(p_full_name, ''));
  -- [R6b] Telefon wejścia w normalizacji app.normalize_phone (same cyfry),
  -- do dopasowania przeciw ban-liście (ADR-080).
  v_phone_normalized text;
  v_locale text;
  v_days int;
  -- [0110] SUFIT ANTYNADUŻYCIOWY DŁUGOŚCI NAJMU (ADR-268) — hojny pułap
  -- PLATFORMY (nie reguła biznesowa najemcy), OWNER-ADJUSTABLE. Wartość musi
  -- zostać zgodna z MAX_RENTAL_DAYS w checkoutSchema. Patrz nagłówek migracji.
  c_max_rental_days constant int := 365;
  v_customer_id uuid;
  v_pickup uuid;
  v_currency text;
  v_item jsonb;
  v_product record;
  v_product_id uuid;
  v_quantity int;
  v_matched_mult numeric;
  v_highest_days int;
  v_extra_days int;
  v_rental_per_unit int;
  v_units uuid[];
  v_unit uuid;
  v_seen_products uuid[] := array[]::uuid[];
  v_item_rows jsonb := '[]'::jsonb;
  v_summary jsonb := '[]'::jsonb;
  v_total_rental int := 0;
  v_total_deposit int := 0;
  v_delivery int := 0;
  v_pricing jsonb;
  v_entry jsonb;
  v_free_above int;
  v_log_token uuid := gen_random_uuid();
  -- [0029] Metoda z wejścia po normalizacji i wywiedziony z niej REŻIM osi
  -- płatności (ADR-064). Reżim NIE jest osobnym parametrem: wywiedzenie go
  -- z metody czyni stan „online w obiegu manual" (i odwrotnie)
  -- niereprezentowalnym, zamiast pilnować zgodności dwóch pól wejścia.
  v_payment_method text;
  v_payment_provider text;
  v_order_id uuid;
  v_order_number text;
  v_reply_to text;
  v_sender jsonb;
  v_limits jsonb;
  v_limit_customer int;
  v_limit_tenant int;
  v_tenant_recent int;
  v_customer_recent int;
  -- [0058] Mapy po normalizacji NULL→'{}' — anon potrafi przysłać JSON-owy null.
  v_order_cf jsonb;
  v_customer_cf jsonb;
  -- [0063] REJESTR WERSJI REGULAMINU (R18, ADR-129). `v_terms_label` to
  -- wartość, która TRAFI do kolumny — w gałęzi (b) pochodzi z rejestru, nie
  -- z wejścia. `v_terms_version_id` startuje z NULL i pozostaje nim wszędzie
  -- poza gałęzią (b): brak dowodu zapisujemy jako brak dowodu.
  v_terms_input text;
  v_terms_current record;
  v_terms_label text;
  v_terms_version_id uuid := null;
begin
  -- --- [0059] BRAMKA BILETU (R13/H-02, ADR-125) — PIERWSZA INSTRUKCJA ---
  --
  -- Przed wszystkim innym: przed odczytem tenanta, przed walidacją, przed
  -- throttlem, przed klientem, wyceną i zapisem. Powód jest dwojaki.
  --
  -- BEZPIECZEŃSTWO: każda instrukcja wykonana przed bramką to praca zrobiona
  -- dla wołającego, który nie udowodnił, że przeszedł zaufaną granicę —
  -- a część tych instrukcji (odczyt tenanta, throttle, ban-lista) odpowiada
  -- RÓŻNYMI komunikatami, więc byłaby wyrocznią dostępną bez biletu.
  --
  -- KOSZT: odmowa kosztuje wtedy jeden odczyt klucza i jedno HMAC, a nie
  -- przebieg przez wycenę i dobór egzemplarzy. Zalew żądań ma się odbijać
  -- tanio.
  --
  -- Pozostałe bramki (throttle w bazie, ban-lista, wycena serwerowa, bramka
  -- widoczności pól własnych) zostają NIETKNIĘTE jako obrona w głąb — bilet
  -- ich nie zastępuje, tylko dokłada brakującą warstwę: dowód, że wołający
  -- jest naszym serwerem po zaliczonych bramkach, a nie kimkolwiek z anon key.
  perform app.assert_checkout_ticket(p_tenant_id, p_ticket_exp, p_ticket_nonce, p_ticket_sig);

  -- --- Tenant aktywny (izolacja: nieaktywny nieodróżnialny od nieistniejącego) ---
  select id, name, locale into v_tenant
  from public.tenants
  where id = p_tenant_id and app.tenant_commercially_active(status);
  if not found then
    raise exception 'Sklep jest niedostępny.' using errcode = '22023';
  end if;

  -- --- Walidacja wejścia (jawna i pełna — definer omija RLS) ---
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Nieprawidłowy adres e-mail.' using errcode = '22023';
  end if;
  if v_full_name = '' or length(v_full_name) > 200 then
    raise exception 'Imię i nazwisko jest wymagane.' using errcode = '22023';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Nieprawidłowy zakres dat najmu.' using errcode = '22023';
  end if;
  if p_delivery_method is null
     or p_delivery_method not in ('pickup', 'courier', 'parcel_locker', 'own_delivery') then
    raise exception 'Nieprawidłowa metoda dostawy.' using errcode = '22023';
  end if;
  if p_terms_version is null or length(btrim(p_terms_version)) = 0
     or length(btrim(p_terms_version)) > 100 then
    raise exception 'Akceptacja regulaminu jest wymagana.' using errcode = '22023';
  end if;

  -- --- [0086] BRAMKA PUBLIKACJI DOKUMENTÓW (H-COMP-01, ADR-191) ---
  --
  -- Sprzedaż wymaga OPUBLIKOWANEGO regulaminu ORAZ polityki prywatności —
  -- obu naraz: checkbox zgody dotyczy regulaminu, ale nota o przetwarzaniu
  -- danych osobowych nie jest opcjonalna przy formularzu, który te dane
  -- zbiera. Do 0086 brak publikacji przechodził gałęzią (a) niżej:
  -- zamówienie utrwalało napis z wejścia (w praktyce „1.0" ze stałej
  -- storefrontu), a terms_version_id zostawało NULL — zapis, który wyglądał
  -- na dowód zgody, wskazując dokument, którego nie ma. Odmowa stoi TUTAJ,
  -- bo to jedyna warstwa, której nie omija ani embed, ani API v1, ani
  -- wtyczka — wszystkie drogi zapisu przechodzą przez tę funkcję.
  --
  -- „Opublikowany" znaczy dokładnie to samo, co w publicznych odczytach
  -- 0063: current_version_id wskazuje wiersz rejestru. Komunikat odmowy jest
  -- CAŁKOWICIE STAŁY, bez jednego argumentu (dyscyplina ADR-181); detail
  -- niesie znacznik MASZYNOWY dla warstwy sklepu (wzorzec terms_outdated
  -- z 0063) — warstwa TS mapuje go na dedykowany status kontraktu, żeby
  -- klient dostał zdanie o brakujących dokumentach, nie ogólną odmowę.
  if not exists (
    select 1
    from public.legal_documents d
    where d.tenant_id = p_tenant_id
      and d.kind = 'terms'
      and d.current_version_id is not null
  ) or not exists (
    select 1
    from public.legal_documents d
    where d.tenant_id = p_tenant_id
      and d.kind = 'privacy'
      and d.current_version_id is not null
  ) then
    raise exception 'Sklep nie przyjmuje jeszcze zamówień — wypożyczalnia nie opublikowała wymaganych dokumentów prawnych.'
      using errcode = '22023', detail = 'legal_documents_missing';
  end if;

  -- --- [0063] ROZSTRZYGNIĘCIE WERSJI REGULAMINU (R18, ADR-129) ---
  --
  -- Zapytanie wiąże się WYŁĄCZNIE po p_tenant_id — wołający nie ma jak wskazać
  -- wiersza, więc nie ma jak wskazać cudzego ani nieistniejącego. Definer omija
  -- RLS, dlatego granica najemcy musi stać w tym WHERE, nie w polityce.
  v_terms_input := btrim(p_terms_version);
  v_terms_label := v_terms_input;

  select v.id, v.version_label
    into v_terms_current
  from public.legal_documents d
  join public.legal_document_versions v
    on v.tenant_id = d.tenant_id and v.id = d.current_version_id
  where d.tenant_id = p_tenant_id
    and d.kind = 'terms';

  if found then
    if v_terms_input = v_terms_current.version_label then
      -- (b) Zgodne z żywą wersją: przypinamy WIERSZ, a etykietę bierzemy
      -- z rejestru. Napis z wejścia nie dociera już do kolumny nawet tutaj.
      v_terms_version_id := v_terms_current.id;
      v_terms_label := v_terms_current.version_label;
    elsif exists (
      select 1
      from public.legal_document_versions v
      where v.tenant_id = p_tenant_id
        and v.kind = 'terms'
        and v.version_label = v_terms_input
    ) then
      -- (c) Nasza etykieta, ale nie ta żywa: klient zaakceptował tekst, który
      -- najemca zdążył zmienić. Osobny, rozróżnialny komunikat — warstwa
      -- sklepu mapuje go na „odśwież i zaakceptuj ponownie", a nie na ogólne
      -- „zamówienie odrzucone".
      --
      -- DETAIL niesie znacznik MASZYNOWY, a nie ozdobę: warstwa sklepu mapuje
      -- dziś 22023 na jedno „nie przyjęliśmy zamówienia" (świadomie — patrz
      -- lib/checkout/core.ts), a jego rada „sprawdź dane i spróbuj ponownie"
      -- jest tu akurat lekarstwem, bo odświeżona strona pobiera już nową
      -- etykietę. Znacznik stoi po to, żeby osobny status dało się kiedyś
      -- dołożyć BEZ ruszania migracji i bez dopasowywania komunikatu regexem.
      raise exception 'Regulamin zmienił się w trakcie składania zamówienia — zapoznaj się z nim i zaakceptuj ponownie.'
        using errcode = '22023', detail = 'terms_outdated';
    end if;
    -- (d) Napis, który nigdy nie był naszą etykietą — zostaje jak przyszedł,
    -- bez przypięcia. Patrz nagłówek sekcji 10.
  end if;
  -- (a) [0086] Gałąź „brak opublikowanego regulaminu" jest od 0086
  -- NIEOSIĄGALNA: bramka publikacji wyżej odmawia, zanim SELECT się wykona,
  -- więc `found` jest tu zawsze prawdziwe. Struktura zostaje jak w 0063/0065
  -- (czytelny diff wobec poprzednika, zerowy koszt) — ale stan „najemca bez
  -- regulaminu wstawia zamówienie" nie jest już w tej funkcji reprezentowalny.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Zamówienie wymaga co najmniej jednej pozycji.' using errcode = '22023';
  end if;

  -- --- [0058] BRAMKA WIDOCZNOŚCI PÓL WŁASNYCH (C6-A3, ADR-121) ---
  --
  -- Trigger 0057 pilnuje ZGODNOŚCI wartości z definicją (typ, opcje, encja,
  -- najemca) — i to jest wszystko, czego pilnować powinien: reguły
  -- reprezentowalności wiersza obowiązują tak samo pracę lady. NIE pilnuje
  -- natomiast POWIERZCHNI, bo panel wypełnia pola oznaczone „panel", a to
  -- jest ta sama kolumna.
  --
  -- Tu jest jedyne miejsce, w którym powierzchnia ma znaczenie po stronie
  -- bazy: `app.public_checkout` to WEJŚCIE ANONIMOWE. Bez tej bramki klient
  -- końcowy, który raz zobaczył identyfikator definicji (choćby z formularza
  -- innego najemcy albo z DOM-u panelu), mógłby wpisać wartość pod polem
  -- oznaczonym wyłącznie „panel" — czyli pod danymi wewnętrznymi
  -- wypożyczalni. Widoczność jest kontraktem, więc broni jej BAZA, a nie
  -- formularz, który da się ominąć surowym żądaniem.
  v_order_cf := coalesce(nullif(p_order_custom_fields, 'null'::jsonb), '{}'::jsonb);
  v_customer_cf := coalesce(nullif(p_customer_custom_fields, 'null'::jsonb), '{}'::jsonb);
  perform app.assert_checkout_custom_fields(p_tenant_id, 'order', v_order_cf);
  perform app.assert_checkout_custom_fields(p_tenant_id, 'customer', v_customer_cf);

  -- --- [R6b] Ban-lista klientów (ADR-080) ---
  --
  -- Zbanowany klient nie składa zamówienia. Dopasowanie po ZNORMALIZOWANYM
  -- mailu ORAZ telefonie tego tenanta — te same normalizacje, którymi
  -- wypełniono klucze banu (lower+btrim maila, app.normalize_phone telefonu),
  -- więc porównanie jest symetryczne. Ban łapie też NOWY checkout z tym samym
  -- mailem/telefonem, który dedupuje do INNEGO (albo żadnego jeszcze) wiersza
  -- customers — dlatego sprawdzamy klucze banu, nie stan wiersza klienta.
  --
  -- ODMOWA NIEROZRÓŻNIALNA: 22023 (jak inne odmowy walidacyjne) — storefront
  -- mapuje ją na ogólny status „rejected", więc klient końcowy nie dowiaduje
  -- się, że jest na liście. Zawężenie tenant_id jest sednem izolacji: ban
  -- tenanta A nie może blokować checkoutu tenanta B.
  --
  -- Guard `v_phone_normalized is not null`: pusty telefon wejścia nie dopasowuje
  -- się do banów bez telefonu (i tak phone_normalized bywa NULL).
  v_phone_normalized := app.normalize_phone(p_phone);
  if exists (
    select 1
    from public.customer_bans b
    where b.tenant_id = p_tenant_id
      and (
        b.email_normalized = v_email
        or (v_phone_normalized is not null and b.phone_normalized = v_phone_normalized)
      )
  ) then
    raise exception 'Nie można złożyć zamówienia.' using errcode = '22023';
  end if;

  -- --- [0029] Metoda płatności i wywiedziony z niej reżim (ADR-066) ---
  v_payment_method := coalesce(nullif(btrim(p_payment_method), ''), 'transfer');
  if v_payment_method not in ('online', 'transfer', 'cod') then
    raise exception 'Nieprawidłowa metoda płatności.' using errcode = '22023';
  end if;
  v_payment_provider := case when v_payment_method = 'online' then 'stripe' else 'manual' end;

  -- Płatność online wymaga, żeby najemca MIAŁ konto u dostawcy — inaczej
  -- zamówienie rodziłoby się w reżimie ścisłym bez adresata środków i bez
  -- żadnej drogi wyjścia z `pending`.
  --
  -- To NIE JEST bramka gotowości konta. Gotowość (`charges_enabled`) wolno
  -- stwierdzić WYŁĄCZNIE odczytem u dostawcy (ADR-049) i robi to serwer
  -- storefrontu przed utworzeniem płatności; kolumny w `payment_accounts` są
  -- kopią prezentacyjną i celowo NIE SĄ tu czytane. Tu sprawdzamy istnienie
  -- adresata — fakt z NASZEJ bazy, o którym nasza baza wie wszystko.
  if v_payment_method = 'online' then
    perform 1 from public.payment_accounts where tenant_id = p_tenant_id;
    if not found then
      raise exception 'Płatność online jest niedostępna w tym sklepie.' using errcode = '22023';
    end if;
  end if;

  v_locale := case when p_locale in ('en', 'pl') then p_locale else null end;
  v_days := (p_end_date - p_start_date) + 1;

  -- --- [0110] SUFIT ANTYNADUŻYCIOWY DŁUGOŚCI NAJMU (ADR-268) ---
  --
  -- `v_days` jest już policzone (INCLUSIVE, `end - start + 1` — ta sama liczba,
  -- której użyje wycena i której od 0089 używa bramka minimum). Sufit stoi
  -- TUTAJ, przed doborem punktu odbioru, utworzeniem klienta i pętlą pozycji:
  -- najmu dłuższego niż pułap nie ma po co wyceniać ani rezerwować pod niego
  -- egzemplarzy. To bramka GLOBALNA (nie per pozycja), bo pułap jest regułą
  -- platformy, nie sprzętu — dlatego, w odróżnieniu od minimum z 0089, żyje
  -- POZA pętlą pozycji.
  --
  -- 22023 (nie PT422+hint jak minimum) i komunikat STAŁY: na normalnej ścieżce
  -- odmowę wyprzedza checkoutSchema (czytelny błąd pola endDate), więc ta
  -- bramka pada tylko dla bezpośredniego wołania anon omijającego formularz.
  -- Wtedy neutralne „rejected" (mapowanie 22023 w lib/checkout/core.ts, jak
  -- ban-lista i bilet) jest właściwą postawą: nie daje botowi wyroczni o progu.
  if v_days > c_max_rental_days then
    raise exception 'Wybrany okres najmu jest zbyt długi.' using errcode = '22023';
  end if;

  -- Odbiór osobisty wymaga AKTYWNEGO punktu tego tenanta; przy dostawie punktu
  -- nie zapisujemy (informacja nadmiarowa — logistyka to faza 3).
  if p_delivery_method = 'pickup' then
    if p_pickup_location_id is null then
      raise exception 'Odbiór osobisty wymaga wskazania punktu.' using errcode = '22023';
    end if;
    perform 1 from public.pickup_locations
      where tenant_id = p_tenant_id and id = p_pickup_location_id and active;
    if not found then
      raise exception 'Wskazany punkt odbioru jest niedostępny.' using errcode = '22023';
    end if;
    v_pickup := p_pickup_location_id;
  else
    v_pickup := null;
  end if;

  -- --- THROTTLE W BAZIE (ADR-042, znalezisko recenzji) ---
  --
  -- Bezpośrednie wywołanie RPC anon keyem omija bramki warstwy storefrontu
  -- (honeypot / rate-limit per IP / Turnstile), a zamówienia pending blokują
  -- egzemplarze w dostępności — bez limitu W FUNKCJI spam zdejmowałby cały
  -- inwentarz tenanta z oferty. [0059] Bilet zamyka tę drogę u źródła, ale
  -- throttle ZOSTAJE nietknięty: jest obroną w głąb na wypadek wycieku sekretu
  -- podpisu i jedyną warstwą, która ogranicza zalew z NASZEJ ścieżki.
  -- Limity liczone WYŁĄCZNIE po zamówieniach
  -- source='storefront' w stanie pending+unpaid (praca lady i zamówienia już
  -- obsłużone nie zjadają budżetu klienta). Count-check bez własnego locka —
  -- świadomie: INSERT i tak serializuje się na advisory locku numeracji per
  -- (tenant, rok), a celem jest throttling, nie dokładna bariera; drobne
  -- przekroczenie przy wyścigu dwóch transakcji jest dla tego celu
  -- nieszkodliwe, a lock, który niczego nie musi gwarantować, maskowałby
  -- zamiast chronić (lekcja ADR-024/ADR-035).
  --
  -- LIMITY KONFIGUROWALNE PER TENANT (uwaga właściciela): defaulty 3/24h per
  -- klient i 30/1h per tenant są bezpieczne na start, ale za ciasne dla dużej
  -- wypożyczalni w sezonie (30/h = zamówienie co 2 minuty). Operator podnosi
  -- WŁASNE limity kluczem tenant_settings 'checkout_limits'
  -- ({"per_customer_24h": int, "per_tenant_1h": int}) — throttle chroni
  -- TENANTA, więc podniesienie własnego limitu jest legalne i nie wymaga
  -- nowej bramki uprawnień (RLS tenant_settings ogranicza zapis do członków).
  --
  -- COALESCE-GUARD przy ODCZYCIE (w kontrze do CHECK-u u źródła z 0013/0014 —
  -- świadomie): wartość liczy się wyłącznie, gdy jest JSON-ową liczbą
  -- CAŁKOWITĄ w przedziale 1..10000; śmieć (ujemna, ułamek, string, brak
  -- klucza, brak wpisu) spada na DEFAULT zamiast wywracać checkout. Zepsuta
  -- konfiguracja limitu nie ma prawa zablokować sklepu — bezpiecznym stanem
  -- jest default, nie odmowa. Cap 10000: wartość powyżej to pomyłka
  -- konfiguracji, nie intencja (żadna wypożyczalnia nie przyjmuje 10k
  -- publicznych pending na godzinę).
  select value into v_limits
  from public.tenant_settings
  where tenant_id = p_tenant_id and key = 'checkout_limits'
    and jsonb_typeof(value) = 'object';

  v_limit_customer := case
    when jsonb_typeof(v_limits -> 'per_customer_24h') = 'number'
         and (v_limits ->> 'per_customer_24h') ~ '^[0-9]{1,5}$'
         and (v_limits ->> 'per_customer_24h')::int between 1 and 10000
      then (v_limits ->> 'per_customer_24h')::int
    else 3  -- default per klient / 24 h
  end;
  v_limit_tenant := case
    when jsonb_typeof(v_limits -> 'per_tenant_1h') = 'number'
         and (v_limits ->> 'per_tenant_1h') ~ '^[0-9]{1,5}$'
         and (v_limits ->> 'per_tenant_1h')::int between 1 and 10000
      then (v_limits ->> 'per_tenant_1h')::int
    else 30  -- default per tenant / 1 h
  end;

  -- Per tenant PRZED utworzeniem klienta (najtańsza odmowa — bez dotykania
  -- customers); komunikat NEUTRALNY, wspólny dla obu limitów (nie zdradza,
  -- który limit zadziałał ani jakie są progi).
  select count(*) into v_tenant_recent
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.source = 'storefront'
    and o.order_status = 'pending'
    and o.payment_status = 'unpaid'
    and o.created_at > now() - interval '1 hour';
  if v_tenant_recent >= v_limit_tenant then
    raise exception 'Zbyt wiele prób — spróbuj później lub skontaktuj się z wypożyczalnią.'
      using errcode = '22023';
  end if;

  -- --- Klient: znajdź-lub-utwórz per (tenant, lower(email)), atomowo ---
  -- Bez wcześniejszego SELECT-a jako jedynej bramki (wyścig): przy dwóch
  -- równoległych checkoutach nowego klienta on conflict do nothing rozstrzyga
  -- kolizję na customers_tenant_email_key, a ponowny SELECT odzyskuje wiersz
  -- konkurenta. Istniejącego klienta NIE nadpisujemy (może być stały klient
  -- panelu) — bierzemy jego id.
  select id into v_customer_id
  from public.customers
  where tenant_id = p_tenant_id and lower(email) = v_email;

  if v_customer_id is null then
    insert into public.customers (
      tenant_id, email, full_name, phone, company_name, nip,
      address_street, address_zip, address_city, locale,
      custom_fields
    )
    values (
      p_tenant_id, v_email, v_full_name,
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_company_name, '')), ''),
      nullif(btrim(coalesce(p_nip, '')), ''),
      nullif(btrim(coalesce(p_address_street, '')), ''),
      nullif(btrim(coalesce(p_address_zip, '')), ''),
      nullif(btrim(coalesce(p_address_city, '')), ''),
      v_locale,
      v_customer_cf
    )
    on conflict (tenant_id, lower(email)) do nothing
    returning id into v_customer_id;

    if v_customer_id is null then
      select id into v_customer_id
      from public.customers
      where tenant_id = p_tenant_id and lower(email) = v_email;
    end if;
  end if;

  -- --- [0058] POLA WŁASNE KLIENTA: SCALENIE, NIE NADPISANIE (C6-A3) ---
  --
  -- Klient bywa STAŁYM klientem panelu, a jego wiersz niesie wtedy wartości
  -- pod polami oznaczonymi „panel" — których sklep nie pokazuje i o których
  -- nic nie wie. Zapis CAŁĄ MAPĄ skasowałby je przy pierwszym zamówieniu ze
  -- sklepu; dokładnie ta klasa błędu, którą po stronie aplikacji zamyka
  -- wymagalność `existing` (ADR-121).
  --
  -- `existing` nie ma tu jednak jak powstać: anon nie czyta `customers`, więc
  -- serwer storefrontu nie zna zapisanych wartości i NIE MA PRAWA ich znać
  -- (byłaby to wyrocznia o kliencie po samym adresie e-mail). Scalenie musi
  -- więc zrobić baza, atomowo, w tej samej transakcji — operatorem `||`,
  -- gdzie prawa strona (wpis klienta) wygrywa wyłącznie na SWOICH kluczach.
  --
  -- Warunek na niepustej mapie jest istotny: bez niego każdy checkout
  -- wykonywałby bezcelowy UPDATE na wierszu klienta (i budził trigger 0057
  -- na danych, których nikt nie dotknął).
  if v_customer_cf <> '{}'::jsonb then
    update public.customers
       set custom_fields = coalesce(custom_fields, '{}'::jsonb) || v_customer_cf
     where id = v_customer_id and tenant_id = p_tenant_id;
  end if;

  -- Per klient (druga oś throttle'u — patrz komentarz przy limicie per tenant).
  -- Świeżo utworzony klient ma count 0 i przechodzi; odmowa wycofuje całą
  -- transakcję, więc nie zostawia klienta-sieroty utworzonego wyżej.
  select count(*) into v_customer_recent
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.customer_id = v_customer_id
    and o.source = 'storefront'
    and o.order_status = 'pending'
    and o.payment_status = 'unpaid'
    and o.created_at > now() - interval '24 hours';
  if v_customer_recent >= v_limit_customer then
    raise exception 'Zbyt wiele prób — spróbuj później lub skontaktuj się z wypożyczalnią.'
      using errcode = '22023';
  end if;

  -- --- Pozycje: wycena SERWEROWA + przypisanie wolnych egzemplarzy ---
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    v_quantity := coalesce((v_item ->> 'quantity')::int, 0);

    if v_product_id is null then
      raise exception 'Pozycja bez produktu.' using errcode = '22023';
    end if;
    if v_quantity < 1 or v_quantity > 100 then
      raise exception 'Nieprawidłowa ilość pozycji.' using errcode = '22023';
    end if;
    -- Jedna linia per produkt: druga linia tego samego produktu nie wiedziałaby
    -- o egzemplarzach zajętych przez pierwszą (pozycje nie są jeszcze wstawione)
    -- i mogłaby przypisać tę samą sztukę dwa razy. Kontrakt 2.4b: agregacja
    -- ilości po produkcie następuje po stronie klienta.
    if v_product_id = any(v_seen_products) then
      raise exception 'Produkt powtórzony w zamówieniu.' using errcode = '22023';
    end if;
    v_seen_products := v_seen_products || v_product_id;

    select id, base_price_day_grosze, deposit_grosze, auto_increment_multiplier,
           -- [0089] minimum najmu czytane RAZEM z resztą wiersza — jedna
           -- podróż po produkt, bramka niżej nie robi drugiego SELECT-a.
           buffer_before_days, buffer_after_days, min_rental_days
      into v_product
    from public.products
    where tenant_id = p_tenant_id and id = v_product_id and active;
    if not found then
      raise exception 'Produkt jest niedostępny.' using errcode = '22023';
    end if;

    -- --- [0089] BRAMKA MINIMALNEGO OKRESU NAJMU (ADR-202) ---
    --
    -- Reguła SPRZĘTU, nie koszyka: `products.min_rental_days` mówi, na ile
    -- najkrócej wynajmuje się TEN sprzęt. Liczba dób jest już policzona wyżej
    -- (`v_days := (p_end_date - p_start_date) + 1`) — INCLUSIVE, dokładnie
    -- tak, jak liczy `rentalDaysInclusive` w @avably/core
    -- (packages/core/src/rental/dates.ts: 25→27.08 = 3 doby, start = end =
    -- 1 doba). Rozjazd tych dwóch rachunków o jeden dzień byłby błędem klasy
    -- „silnik liczy 7, panel pokazuje 6" — dlatego porównanie stoi na TEJ
    -- SAMEJ zmiennej, której za chwilę użyje wycena, a nie na własnej
    -- arytmetyce dat.
    --
    -- Odmowa stoi TUTAJ, przed wyceną i doborem egzemplarzy: najmu krótszego
    -- niż minimum nie ma po co wyceniać. To jedyna warstwa, której nie omija
    -- żadna powierzchnia (sklep, embed, API v1) — walidacja w kliencie jest
    -- wygodą, ta bramka jest regułą.
    --
    -- Komunikat CAŁKOWICIE STAŁY, bez ani jednego argumentu (dyscyplina
    -- ADR-181). Klasa PT422, nie 22023 i nie P0xxx: PostgREST oddaje PTnnn
    -- jako HTTP nnn z kodem, komunikatem, detail i hint (zmierzone przy
    -- 0088/ADR-199 — każdy P0xxx poza P0001 wychodzi jako zamaskowane 500
    -- bez treści), a osobna klasa pozwala warstwie TS odróżnić tę odmowę od
    -- ogólnej walidacji 22023 bez dopasowywania zdań regexem. HINT niesie
    -- znacznik MASZYNOWY kategorii (wzorzec PT409+hint z 0088), DETAIL —
    -- samą liczbę minimum: to nie jest identyfikator ani cudza dana
    -- (ADR-181 broni przed tamtymi), tylko reguła oferty, którą najemca
    -- świadomie ustawił dla swoich klientów; warstwa sklepu składa z niej
    -- zdanie „minimum X dni". Pierwsza pozycja poniżej minimum kończy całe
    -- zamówienie — transakcja wycofuje się w całości, zero śladu zapisu.
    if v_days < v_product.min_rental_days then
      raise exception 'Wybrany okres najmu jest krótszy niż minimalny okres najmu tej pozycji.'
        using errcode = 'PT422',
              detail = v_product.min_rental_days::text,
              hint = 'min_rental_days';
    end if;

    -- Wycena — lustro calculatePrice (@avably/core): najwyższy próg <= dni;
    -- doby ponad najwyższy próg dolicza auto_increment; bez progu = cena bazowa.
    select pt.multiplier into v_matched_mult
    from public.pricing_tiers pt
    where pt.tenant_id = p_tenant_id and pt.product_id = v_product_id
      and pt.tier_days <= v_days
    order by pt.tier_days desc
    limit 1;

    select max(pt.tier_days) into v_highest_days
    from public.pricing_tiers pt
    where pt.tenant_id = p_tenant_id and pt.product_id = v_product_id;

    if v_matched_mult is null then
      v_rental_per_unit := v_product.base_price_day_grosze * v_days;
    else
      v_extra_days := case when v_days > v_highest_days then v_days - v_highest_days else 0 end;
      v_rental_per_unit :=
        round(v_product.base_price_day_grosze * v_matched_mult)::int
        + case when v_extra_days > 0
            then round(v_product.base_price_day_grosze * v_product.auto_increment_multiplier * v_extra_days)::int
            else 0 end;
    end if;

    -- Wybór wolnych egzemplarzy (lustro checkAvailability). To dobór KANDYDATÓW,
    -- nie bramka wyścigu — właściwą bramką jest advisory lock + re-check w
    -- assert_unit_available przy wstawianiu pozycji (trigger 0010): jeśli
    -- konkurent zdążył zająć sztukę między tym SELECT-em a INSERT-em, trigger
    -- rzuci 23P01 i wycofa transakcję (dokładnie jeden checkout wygrywa).
    select array_agg(u.id order by u.id) into v_units
    from (
      select u.id
      from public.product_units u
      where u.tenant_id = p_tenant_id and u.product_id = v_product_id
        and not (
          (u.unavailable_from is not null or u.unavailable_to is not null)
          and (u.unavailable_from is null or p_end_date >= u.unavailable_from)
          and (u.unavailable_to is null or p_start_date <= u.unavailable_to)
        )
        and not exists (
          select 1
          from public.order_items oi
          join public.orders o on o.tenant_id = oi.tenant_id and o.id = oi.order_id
          where oi.tenant_id = p_tenant_id
            and oi.unit_id = u.id
            and o.order_status in ('pending', 'reserved', 'ready_for_pickup', 'picked_up')
            and oi.returned_at is null
            and o.start_date <= p_end_date + v_product.buffer_after_days
            and o.end_date >= p_start_date - v_product.buffer_before_days
        )
      order by u.id
      limit v_quantity
    ) u;

    if v_units is null or array_length(v_units, 1) < v_quantity then
      raise exception 'Brak wolnych egzemplarzy w wybranym terminie.' using errcode = '23P01';
    end if;

    foreach v_unit in array v_units
    loop
      v_item_rows := v_item_rows || jsonb_build_object(
        'product_id', v_product_id,
        'unit_id', v_unit,
        'rental_grosze', v_rental_per_unit,
        'deposit_grosze', v_product.deposit_grosze
      );
      v_total_rental := v_total_rental + v_rental_per_unit;
      v_total_deposit := v_total_deposit + v_product.deposit_grosze;
    end loop;

    v_summary := v_summary || jsonb_build_object(
      'product_id', v_product_id,
      'quantity', v_quantity,
      'unit_rental_grosze', v_rental_per_unit,
      'unit_deposit_grosze', v_product.deposit_grosze
    );
  end loop;

  -- --- Koszt dostawy — lustro calculateDeliveryCost (po zsumowaniu najmu) ---
  if p_delivery_method = 'pickup' then
    v_delivery := 0;
  else
    select value into v_pricing
    from public.tenant_settings
    where tenant_id = p_tenant_id and key = 'delivery_pricing'
      and jsonb_typeof(value) = 'object';

    v_entry := v_pricing -> p_delivery_method;
    if v_entry is null or jsonb_typeof(v_entry) <> 'object'
       or (v_entry ->> 'price_grosze') is null then
      raise exception 'Metoda dostawy nie jest skonfigurowana.' using errcode = '22023';
    end if;

    v_free_above := (v_entry ->> 'free_above_grosze')::int;
    if v_free_above is not null and v_total_rental >= v_free_above then
      v_delivery := 0;
    else
      v_delivery := (v_entry ->> 'price_grosze')::int;
    end if;
  end if;

  -- --- Wstawienie zamówienia (bramki 0010/0015: pending + unpaid, numeracja) ---
  -- tenant_id z parametru, NIE app.tenant_id() (anon nie ma claimu). Kwoty i
  -- egzemplarze wyłącznie policzone wyżej; nic z klienta.
  insert into public.orders (
    tenant_id, customer_id, start_date, end_date, delivery_method,
    pickup_location_id, total_rental_grosze, total_deposit_grosze,
    -- [0063] terms_version_id obok terms_version: kolumna tekstowa ZOSTAJE
    -- (zgodność wstecz i CHECK orders_terms_complete z 0020), a nowa niesie
    -- dowód rozwijalny do bajtów.
    delivery_grosze, terms_accepted_at, terms_version, terms_version_id, source, checkout_log_token,
    -- [0058] Zamówienie POWSTAJE tutaj, więc mapa idzie w całości — nie ma
    -- czego scalać. Trigger 0057 sprawdzi ją tak samo jak zapis z panelu.
    custom_fields,
    -- [0029] Metoda to DANE ZAMÓWIENIA, nie stan sesji (ADR-066), a reżim
    -- jedzie z nią od narodzin. `payment_status` zostaje domyślne `unpaid`:
    -- zamówienie rodzi się nieopłacone także wtedy, gdy klient za chwilę
    -- zapłaci kartą — `paid` w tej migracji nie występuje ani razu.
    payment_method, payment_provider
  )
  values (
    p_tenant_id, v_customer_id, p_start_date, p_end_date, p_delivery_method,
    v_pickup,
    v_total_rental, v_total_deposit, v_delivery, now(), v_terms_label, v_terms_version_id,
    'storefront', v_log_token, v_order_cf, v_payment_method, v_payment_provider
  )
  -- [0049] RETURNING niesie też walutę UTRWALONĄ na wierszu przez trigger
  -- orders_persist_currency — payload checkoutu (potwierdzenie + maile) mówi
  -- odtąd walutą ZAMÓWIENIA, nie osobnym odczytem ustawień (ADR-103).
  returning id, order_number, currency into v_order_id, v_order_number, v_currency;

  -- [0041] Notatka klienta ze storefrontu → wpis w order_notes (nie usuwana
  -- niżej kolumna orders.notes). created_by = NULL: checkout jest anonimowy,
  -- nie ma członka zespołu jako autora — UI pokaże „—" (jak wpisy historyczne
  -- z 0039). SECURITY DEFINER omija RLS, więc wstawienie z p_tenant_id
  -- przechodzi tak samo jak wstawienie zamówienia wyżej.
  if nullif(btrim(coalesce(p_notes, '')), '') is not null then
    insert into public.order_notes (tenant_id, order_id, body, created_by)
    values (p_tenant_id, v_order_id, btrim(p_notes), null);
  end if;

  -- Pozycje w stałym porządku unit_id (jak create_order): dwie transakcje biorą
  -- advisory locki w tej samej kolejności — bez zakleszczenia.
  insert into public.order_items (tenant_id, order_id, product_id, unit_id, rental_grosze, deposit_grosze)
  select
    p_tenant_id, v_order_id,
    (row ->> 'product_id')::uuid,
    (row ->> 'unit_id')::uuid,
    (row ->> 'rental_grosze')::int,
    (row ->> 'deposit_grosze')::int
  from jsonb_array_elements(v_item_rows) as row
  order by row ->> 'unit_id';

  -- --- Kontekst wysyłki e-maili (konsumowany po stronie serwera) ---
  select value into v_sender
  from public.tenant_settings
  where tenant_id = p_tenant_id and key = 'email_sender'
    and jsonb_typeof(value) = 'object';

  -- Adres powiadomień najemcy: WYŁĄCZNIE email_sender.reply_to — adres
  -- biznesowy z jawnej intencji operatora. ŚWIADOMIE bez fallbacku na e-mail
  -- ownera z auth.users (znalezisko recenzji 2.4a): odpowiedź RPC czyta każdy
  -- bezpośredni wołający z anon keyem, więc fallback zwracałby prywatny adres
  -- konta jednym żądaniem (wyciek PII). Brak reply_to → null; warstwa e-maili
  -- raportuje uczciwie „powiadomienie niewysłane — skonfiguruj nadawcę".
  v_reply_to := case
    when v_sender is not null and jsonb_typeof(v_sender -> 'reply_to') = 'string'
      then nullif(btrim(v_sender ->> 'reply_to'), '')
    else null
  end;

  return jsonb_build_object(
    'order_number', v_order_number,
    -- [0029] Identyfikator zamówienia — SERVER-ONLY, jak log_token. Jest
    -- kluczem idempotencji płatności (jeden intent na zamówienie), więc musi
    -- wyjść z tej funkcji; kontrakt CheckoutResult go nie niesie.
    'order_id', v_order_id,
    'order_status', 'pending',
    'payment_status', 'unpaid',
    -- [0029] Metoda i reżim WPROST z zapisanego wiersza — strona
    -- potwierdzenia nie ma zgadywać, czy czeka ją krok płatności.
    'payment_method', v_payment_method,
    'payment_provider', v_payment_provider,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'delivery_method', p_delivery_method,
    'total_rental_grosze', v_total_rental,
    'total_deposit_grosze', v_total_deposit,
    'delivery_grosze', v_delivery,
    'currency', v_currency,
    'items', v_summary,
    'customer', jsonb_build_object('email', v_email, 'full_name', v_full_name, 'locale', v_locale),
    'tenant', jsonb_build_object('name', v_tenant.name, 'locale', v_tenant.locale),
    'email_sender', case
      when v_sender is not null and jsonb_typeof(v_sender -> 'name') = 'string'
        then jsonb_build_object('name', v_sender ->> 'name', 'reply_to', v_reply_to)
      else null
    end,
    'notify_email', v_reply_to,
    -- Token jednorazowy wiążący PÓŹNIEJSZY zapis dziennika z TYM checkoutem
    -- (ADR-045). Dane SERWEROWE — jak notify_email nie trafiają do przeglądarki.
    'log_token', v_log_token
  );
end;
$$;

revoke all on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb, bigint, text, text) from public;
grant execute on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb, bigint, text, text) to anon, authenticated;

comment on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb, bigint, text, text) is
  'ADR-042/125/129/134/191/202/268/272: jedyna anonowa ścieżka ZAPISU zamówienia. '
  'Od ADR-272 dobór wolnych egzemplarzy pomija pozycje zwrócone '
  '(order_items.returned_at is null), więc egzemplarz oddany częściowo jest znów '
  'do zarezerwowania. Bramki regulaminu (0086), minimum (0089) i sufitu najmu '
  '(0110) bez zmian. Wiążącą bramką wyścigu pozostaje app.assert_unit_available.';

-- ---------------------------------------------------------------------
-- 7. RPC panelu: odznaczanie zwróconych pozycji (zwrot częściowy)
-- ---------------------------------------------------------------------
create or replace function app.return_order_items(
  p_order_id uuid,
  p_item_ids uuid[],
  p_returned boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_order record;
  r record;
  v_total int;
  v_returned int;
begin
  -- Bez claimu najemcy nie ma czego zawężać — odmawiamy zanim cokolwiek ruszymy.
  if v_tenant is null then
    raise exception 'Brak kontekstu najemcy.' using errcode = '42501';
  end if;

  -- Żywy członek najemcy z claimu (lustro app.is_current_tenant_member, R12a):
  -- SECURITY DEFINER omija RLS, więc autoryzacja MUSI być jawna w ciele.
  if not app.is_current_tenant_member() then
    raise exception 'Brak uprawnień do zamówień tego najemcy.' using errcode = '42501';
  end if;

  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    raise exception 'Nie wskazano pozycji do zwrotu.' using errcode = '22023';
  end if;

  -- Zamówienie MUSI należeć do najemcy z claimu — jawne zawężenie tenant_id jest
  -- bramką izolacji. FOR UPDATE serializuje z tranzycją statusu (orders_write_gate),
  -- żeby zwrot pozycji i przejście → returned nie przeplatały się w oknie.
  select o.id, o.start_date, o.end_date, o.order_status
    into v_order
  from public.orders o
  where o.tenant_id = v_tenant and o.id = p_order_id
  for update;

  if not found then
    raise exception 'Zamówienie nie istnieje albo należy do innego najemcy.'
      using errcode = 'P0002';
  end if;

  -- Zwrot pozycji działa WYŁĄCZNIE na zamówieniu wydanym: przed wydaniem nie ma
  -- czego zwracać, a returned/cancelled są terminalne.
  if v_order.order_status <> 'picked_up' then
    raise exception
      'Zwrot pozycji jest możliwy tylko dla zamówienia wydanego (picked_up), a nie %.',
      v_order.order_status
      using errcode = '22023';
  end if;

  if p_returned then
    -- IDEMPOTENTNE: pozycje już zwrócone (returned_at not null) nie są
    -- nadpisywane, więc powtórne zaznaczenie nie przesuwa znacznika. Zwolnienie
    -- egzemplarza nie tworzy kolizji — brak re-checku dostępności z założenia.
    update public.order_items oi
       set returned_at = now()
     where oi.tenant_id = v_tenant
       and oi.order_id = p_order_id
       and oi.id = any(p_item_ids)
       and oi.returned_at is null;
  else
    -- ODWRÓCENIE z GUARDEM: egzemplarz, który w międzyczasie zajęło inne
    -- zamówienie w oknie, NIE wraca do najmu — re-check app.assert_unit_available
    -- (advisory lock + reguła kolizji) rzuca 23P01, a wyjątek wycofuje całą
    -- transakcję. Sprawdzamy PRZED kasowaniem znacznika: pozycja odznaczana jest
    -- z puli wykluczana przez p_exclude_item_id, więc liczą się cudze najmy.
    for r in
      select oi.id, oi.unit_id
      from public.order_items oi
      where oi.tenant_id = v_tenant
        and oi.order_id = p_order_id
        and oi.id = any(p_item_ids)
        and oi.returned_at is not null
        and oi.unit_id is not null
    loop
      perform app.assert_unit_available(
        v_tenant, r.unit_id, r.id, v_order.start_date, v_order.end_date
      );
    end loop;

    update public.order_items oi
       set returned_at = null
     where oi.tenant_id = v_tenant
       and oi.order_id = p_order_id
       and oi.id = any(p_item_ids)
       and oi.returned_at is not null;
  end if;

  -- Postęp zwrotu dla panelu — liczby, nie identyfikatory.
  select count(*), count(*) filter (where returned_at is not null)
    into v_total, v_returned
  from public.order_items
  where tenant_id = v_tenant and order_id = p_order_id;

  return jsonb_build_object(
    'total_count', v_total,
    'returned_count', v_returned,
    'all_returned', (v_total > 0 and v_returned = v_total)
  );
end;
$$;

comment on function app.return_order_items(uuid, uuid[], boolean) is
  'Zwrot CZĘŚCIOWY (ADR-272): odznacza/zaznacza returned_at wskazanych pozycji '
  'zamówienia. Tenant-scope przez app.tenant_id() + app.is_current_tenant_member(); '
  'wyłącznie dla zamówienia picked_up; idempotentne. p_returned=false (odznaczenie) '
  'przechodzi przez re-check app.assert_unit_available — egzemplarz zajęty w '
  'międzyczasie nie wraca do najmu. Zwraca {total_count, returned_count, all_returned}. '
  'SECURITY DEFINER: izolację niesie jawne zawężenie tenant_id, nie RLS.';

revoke all on function app.return_order_items(uuid, uuid[], boolean) from public, anon;
grant execute on function app.return_order_items(uuid, uuid[], boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Backfill returned_at przy pełnym zwrocie (spójność „zwrotu całości")
-- ---------------------------------------------------------------------
create or replace function app.backfill_order_item_returns() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  -- Przejście → returned stempluje returned_at KAŻDEJ pozycji jeszcze
  -- niezwróconej, więc dotychczasowy „zwrot całości" dalej zwalnia wszystko
  -- I zostawia spójny ślad per-pozycja. Znacznik bierze orders.returned_at
  -- (ustawiony atomowo przez app.orders_write_gate w TYM SAMYM UPDATE,
  -- 0112/ADR-270), żeby oba znaczniki niosły tę samą chwilę. UPDATE tylko
  -- returned_at nie przechodzi bramki przypisania (order_items_assignment_gate
  -- pomija zmianę bez ruchu unit_id/order_id), więc nie wywołuje re-checku.
  update public.order_items oi
     set returned_at = coalesce(new.returned_at, now())
   where oi.tenant_id = new.tenant_id
     and oi.order_id = new.id
     and oi.returned_at is null;
  return null;
end;
$$;

comment on function app.backfill_order_item_returns() is
  'Trigger AFTER UPDATE on orders (ADR-272): przy przejściu → returned stempluje '
  'returned_at pozostałych pozycji NULL. Backfill, nie gate — dotychczasowy zwrot '
  'całości dalej działa jednym kliknięciem i staje się spójny z modelem per-pozycja.';

revoke all on function app.backfill_order_item_returns() from public, anon;

create trigger order_items_return_backfill
  after update on public.orders
  for each row
  when (new.order_status = 'returned' and old.order_status is distinct from 'returned')
  execute function app.backfill_order_item_returns();

-- === END PROD MIGRATION 0113 ===
