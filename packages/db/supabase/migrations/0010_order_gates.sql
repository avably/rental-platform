-- 0010_order_gates.sql
-- Bramki zamówień w BAZIE (Faza 1, Zadanie 4): maszyna stanów order_status
-- oraz dostępność egzemplarza przy przypisaniu. Decyzje: ADR-024 (wyścig
-- o egzemplarz), ADR-025 (gdzie naprawdę jest bramka maszyny stanów).
--
-- DLACZEGO W BAZIE: członek tenanta ma przez RLS (0007) pełny UPDATE na
-- orders i INSERT/UPDATE na order_items — to jest potrzebne do pracy lady.
-- Skutek uboczny: każdą regułę egzekwowaną wyłącznie w kodzie panelu można
-- ominąć jednym żądaniem PostgREST (PATCH /rest/v1/orders). CHECK-i z 0007
-- pilnują ZBIORU wartości statusów; dozwolonych PRZEJŚĆ między nimi oraz
-- kolizji egzemplarzy pilnują dopiero triggery z tej migracji. `canTransition`
-- i `checkAvailability` w @avably/core pozostają wygodą UI (czytelne
-- komunikaty, podgląd) — bramką jest baza, zgodnie z konwencją projektu.
--
-- ZERO NOWYCH TABEL: wyłącznie funkcje i triggery. Macierz izolacji RLS
-- (rls-isolation.test.ts), granty tabelaryczne i rejestr fabryk wierszy
-- pozostają bez zmian. Obie bramki obowiązują KAŻDĄ rolę, także
-- service_role — import danych nie ma prawa tworzyć stanów niemożliwych;
-- zamówienie historyczne wprowadza się spacerem po dozwolonych przejściach.
--
-- DRUGA IMPLEMENTACJA — ŚWIADOMY KOSZT: mapa przejść i semantyka
-- dostępności (bufory, okna serwisowe, zakresy INCLUSIVE) są lustrem
-- definicji z @avably/core (order-status.ts, availability.ts). Projekt
-- konsekwentnie unika duplikowania semantyki (ADR-022), ale tu duplikat
-- jest ceną za gwarancję na poziomie bazy — sprawdzenie w JS nie domyka
-- TOCTOU i nie wiąże żądań idących poza panelem. Rozjazd luster łapie
-- behawioralny test zgodności packages/db/test/order-gates.test.ts
-- (wszystkie 36 par przejść + macierz scenariuszy dostępności, werdykt
-- bazy porównywany z werdyktem silnika na tych samych danych). Zmieniasz
-- cokolwiek tutaj — zmieniasz stałe w core, i odwrotnie.
--
-- KODY BŁĘDÓW (asertowane w testach, mapowane na komunikaty w panelu):
--   23P01 (exclusion_violation) — egzemplarz zajęty w żądanym terminie,
--   23514 (check_violation) — niedozwolone przejście order_status (w tym
--     INSERT ≠ pending); trigger egzekwuje ograniczenie na WARTOŚCIACH,
--     więc kod klasy CHECK jest semantycznie trafny,
--   23001 (restrict_violation) — anulowanie przy payment_status blokującym
--     rozliczenie,
--   22023 (invalid_parameter_value) — puste pozycje w app.create_order.
--
-- Kody są WYŁĄCZNIE z klas mapowanych przez PostgREST (22xxx → 400,
-- 23xxx → 409): kody własne P0xxx PostgREST zjada do gołego 500
-- „Something went wrong" bez kodu w odpowiedzi (zweryfikowane na żywej
-- bazie; to samo ostrzeżenie stoi przy CHECK-u prefiksu w 0007) — ani
-- test, ani panel nie miałyby po czym rozpoznać odmowy.

-- ---------------------------------------------------------------------
-- 1. Mapa przejść order_status
-- ---------------------------------------------------------------------
--
-- Lustro TRANSITIONS z packages/core/src/rental/order-status.ts (ADR-025):
--   * ścieżka w przód: pending → reserved → ready_for_pickup → picked_up
--     → returned,
--   * korekta pomyłki operatora: cofnięcie o JEDEN krok,
--   * anulowanie z każdego stanu PRZED wydaniem; po wydaniu nie ma
--     anulowania — sprzęt jest u klienta, ścieżką jest zwrot,
--   * returned i cancelled terminalne: na zwrocie wisi rozliczenie kaucji
--     (Zadanie 5), a reaktywacja anulowanego to nowe zamówienie.
create or replace function app.order_transition_allowed(p_from text, p_to text)
returns boolean
language sql immutable as $$
  select case p_from
    when 'pending'          then p_to in ('reserved', 'cancelled')
    when 'reserved'         then p_to in ('ready_for_pickup', 'pending', 'cancelled')
    when 'ready_for_pickup' then p_to in ('picked_up', 'reserved', 'cancelled')
    when 'picked_up'        then p_to in ('returned', 'ready_for_pickup')
    else false
  end
$$;

alter function app.order_transition_allowed(text, text) set search_path = pg_catalog;

comment on function app.order_transition_allowed(text, text) is
  'Mapa dozwolonych przejść order_status — lustro canTransition z @avably/core (ADR-025). Zgodność przypina test order-gates.test.ts.';

-- Funkcja jest wołana z triggera pod rolą sesji, więc potrzebuje EXECUTE
-- (w odróżnieniu od samych funkcji triggerowych, których odpalenie nie
-- sprawdza uprawnień wywołującego — wzorzec app.generate_order_number).
-- Jawny revoke przed grantem: schema app jest wystawiona przez PostgREST.
revoke all on function app.order_transition_allowed(text, text) from public, anon;
grant execute on function app.order_transition_allowed(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. app.assert_unit_available — rdzeń bramki dostępności (ADR-024)
-- ---------------------------------------------------------------------
--
-- MECHANIZM WYŚCIGU: advisory lock na (tenant, egzemplarz) + re-check w tej
-- samej transakcji. Druga transakcja czeka na COMMIT pierwszej, a jej nowy
-- snapshot (READ COMMITTED: nowe zapytanie = nowy snapshot) widzi już
-- zatwierdzoną pozycję konkurenta. Wzorzec i pełne uzasadnienie poprawności:
-- app.generate_order_number (0007). Kolizja hasha kosztuje wyłącznie
-- chwilę oczekiwania, nigdy poprawność.
--
-- ODRZUCONE ALTERNATYWY (ADR-024):
--   * EXCLUDE (btree_gist): bufory są per-produkt i ZMIENNE w czasie —
--     zakres zapisany w wierszu utrwala bufor z chwili zapisu i rozjeżdża
--     się przy pierwszej zmianie buforów; relacja „termin rozszerzony o
--     bufor vs surowy cudzy najem" nie jest wyrażalna jednym zakresem
--     w wierszu bez podwójnego liczenia buforów,
--   * RPC jako jedyna ścieżka: member zachowuje bezpośredni INSERT/UPDATE
--     na order_items (praca lady), więc RPC byłby konwencją, nie bramką.
--
-- SECURITY INVOKER: odczyty idą przez RLS wywołującego — członek widzi
-- komplet danych WŁASNEGO tenanta (polityki 0007), a to jedyny zbiór,
-- w którym kolizja może istnieć (klucze złożone nie dopuszczają pozycji
-- międzytenantowych). Definer nie jest potrzebny — mniejsza powierzchnia.
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
    raise exception
      'Egzemplarz % jest w oknie serwisowym w terminie % — %.',
      p_unit_id, p_start_date, p_end_date
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
    and o.start_date <= p_end_date + v_buffer_after
    and o.end_date >= p_start_date - v_buffer_before
  limit 1;

  if v_conflict_order is not null then
    raise exception
      'Egzemplarz % jest zajęty w terminie % — % (kolizja z zamówieniem %).',
      p_unit_id, p_start_date, p_end_date, v_conflict_order
      using errcode = '23P01';
  end if;
end;
$$;

comment on function app.assert_unit_available(uuid, uuid, uuid, date, date) is
  'Bramka dostępności egzemplarza (ADR-024): advisory lock per (tenant, egzemplarz) + re-check semantyką silnika (bufory produktu, okno serwisowe vs surowy termin, statusy blokujące). Rzuca 23P01.';

-- Wołana z funkcji triggerowych pod rolą sesji → EXECUTE dla obu ról
-- operacyjnych. Wywołanie wprost przez PostgREST jest nieszkodliwe:
-- funkcja wyłącznie czyta (przez RLS wywołującego) i rzuca wyjątek.
revoke all on function app.assert_unit_available(uuid, uuid, uuid, date, date) from public, anon;
grant execute on function app.assert_unit_available(uuid, uuid, uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Trigger na order_items: przypisanie egzemplarza przechodzi bramkę
-- ---------------------------------------------------------------------

create or replace function app.order_items_assignment_gate() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_start date;
  v_end date;
  v_status text;
begin
  -- Pozycja bez egzemplarza (rezerwacja modelu) nie blokuje niczego.
  if new.unit_id is null then
    return new;
  end if;

  -- UPDATE niezmieniający przypisania (np. korekta kwoty pozycji) nie
  -- przechodzi przez bramkę — kolizji nie może wytworzyć, a advisory lock
  -- kosztowałby serializację każdej edycji koszyka.
  if tg_op = 'UPDATE'
     and new.unit_id is not distinct from old.unit_id
     and new.order_id is not distinct from old.order_id
  then
    return new;
  end if;

  select o.start_date, o.end_date, o.order_status
    into v_start, v_end, v_status
  from public.orders o
  where o.tenant_id = new.tenant_id and o.id = new.order_id;

  -- Zamówienie niewidoczne: klucz złożony odrzuci pozycję (23503).
  if not found then
    return new;
  end if;

  -- Pozycja zamówienia w statusie niewiążącym (returned/cancelled) nie
  -- blokuje egzemplarza — nie ma czego sprawdzać.
  if v_status not in ('pending', 'reserved', 'ready_for_pickup', 'picked_up') then
    return new;
  end if;

  perform app.assert_unit_available(new.tenant_id, new.unit_id, new.id, v_start, v_end);
  return new;
end;
$$;

create trigger order_items_assignment_gate
  before insert or update on public.order_items
  for each row execute function app.order_items_assignment_gate();

-- ---------------------------------------------------------------------
-- 4. Trigger na orders: maszyna stanów + zmiana terminu + updated_at
-- ---------------------------------------------------------------------

create or replace function app.orders_write_gate() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  r record;
begin
  if tg_op = 'INSERT' then
    -- Zamówienie rodzi się wyłącznie jako pending — INSERT z dowolnym innym
    -- statusem omijałby całą maszynę stanów jednym żądaniem.
    if new.order_status <> 'pending' then
      raise exception
        'Zamówienie może powstać wyłącznie w statusie pending (otrzymano %).',
        new.order_status
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.order_status is distinct from old.order_status then
    if not app.order_transition_allowed(old.order_status, new.order_status) then
      raise exception
        'Niedozwolone przejście statusu zamówienia: % → %.',
        old.order_status, new.order_status
        using errcode = '23514';
    end if;

    -- Anulowanie przy pobranych (lub pobieranych) środkach: najpierw zwrot,
    -- potem anulowanie. Stan sprawdzamy PO zapisie (NEW), więc zwrot
    -- i anulowanie w jednym UPDATE są legalne. Lista = lustro
    -- BLOCKING_PAYMENT_STATUSES z @avably/core (zgodność przypięta testem).
    -- Sama oś płatności NIE jest tu bramkowana — rozliczenia to Zadanie 5.
    if new.order_status = 'cancelled'
       and new.payment_status in ('pending', 'paid', 'manual', 'completed', 'deposit_refunded')
    then
      raise exception
        'Nie można anulować zamówienia z nierozliczoną płatnością (payment_status=%).',
        new.payment_status
        using errcode = '23001';
    end if;
  end if;

  -- Zmiana TERMINU przechodzi przez tę samą bramkę dostępności, co
  -- przypisanie egzemplarza — inaczej PATCH dat byłby dziurą obok bramki.
  -- Wejścia w statusy blokujące z niewiążących nie trzeba sprawdzać:
  -- returned i cancelled są terminalne, więc taka ścieżka nie istnieje.
  -- Pozycje w stałym porządku unit_id: dwie transakcje biorą blokady
  -- advisory w tej samej kolejności (app.create_order wstawia tak samo),
  -- więc nie mogą się zakleszczyć.
  if (new.start_date is distinct from old.start_date
      or new.end_date is distinct from old.end_date)
     and new.order_status in ('pending', 'reserved', 'ready_for_pickup', 'picked_up')
  then
    for r in
      select oi.id, oi.unit_id
      from public.order_items oi
      where oi.tenant_id = new.tenant_id
        and oi.order_id = new.id
        and oi.unit_id is not null
      order by oi.unit_id
    loop
      perform app.assert_unit_available(new.tenant_id, r.unit_id, r.id, new.start_date, new.end_date);
    end loop;
  end if;

  -- 0007 zostawił updated_at bez mechanizmu odświeżania — domykamy tutaj,
  -- w jedynym triggerze BEFORE UPDATE na orders.
  new.updated_at := now();
  return new;
end;
$$;

create trigger orders_write_gate
  before insert or update on public.orders
  for each row execute function app.orders_write_gate();

-- ---------------------------------------------------------------------
-- 5. app.create_order — atomowe utworzenie zamówienia z pozycjami
-- ---------------------------------------------------------------------
--
-- To jest TRANSPORT, nie bramka (ADR-024): PostgREST nie daje transakcji
-- obejmującej dwa żądania, więc „INSERT orders, potem INSERT order_items"
-- z panelu zostawiałby po odmowie bramki zamówienie-sierotę z pustym
-- koszykiem i zużytym numerem. RPC skleja oba kroki w jedną transakcję;
-- odmowa triggera wycofuje całość.
--
-- SECURITY INVOKER — celowo, w kontrze do app.join_waitlist (0006): tam
-- ścieżka publiczna nie miała ŻADNYCH grantów tabelarycznych i definer był
-- jedyną furtką; tu wywołuje członek tenanta, który te same INSERT-y może
-- wykonać wprost. Polityki RLS (WITH CHECK tenant_id = app.tenant_id())
-- i triggery działają wewnątrz bez zmian — funkcja nie dodaje ŻADNYCH
-- uprawnień, wyłącznie atomowość. Kwoty przychodzą jako DANE policzone
-- silnikiem w panelu (ADR-018/ADR-022: arytmetyka tylko w silniku).
create or replace function app.create_order(
  p_customer_id uuid,
  p_start_date date,
  p_end_date date,
  p_delivery_method text,
  p_pickup_location_id uuid,
  p_notes text,
  p_total_rental_grosze int,
  p_total_deposit_grosze int,
  p_items jsonb
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
    pickup_location_id, notes, total_rental_grosze, total_deposit_grosze
  ) values (
    app.tenant_id(), p_customer_id, p_start_date, p_end_date, p_delivery_method,
    p_pickup_location_id, p_notes,
    coalesce(p_total_rental_grosze, 0), coalesce(p_total_deposit_grosze, 0)
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

comment on function app.create_order(uuid, date, date, text, uuid, text, int, int, jsonb) is
  'Atomowe utworzenie zamówienia z pozycjami (transport, nie bramka — ADR-024). SECURITY INVOKER: RLS i triggery 0010 obowiązują wewnątrz; odmowa bramki wycofuje całość.';

-- Wyłącznie authenticated: anon nie ma nic do szukania przy zamówieniach,
-- a service_role bez claimu tenant_id i tak poległby na RLS INSERT —
-- nie nadajemy uprawnienia, którego nie da się poprawnie użyć.
revoke all on function app.create_order(uuid, date, date, text, uuid, text, int, int, jsonb) from public, anon;
grant execute on function app.create_order(uuid, date, date, text, uuid, text, int, int, jsonb) to authenticated;
