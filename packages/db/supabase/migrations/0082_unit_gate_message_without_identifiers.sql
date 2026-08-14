-- =====================================================================
-- 0082 — ODMOWA BRAMKI EGZEMPLARZA PRZESTAJE WYDAWAĆ CUDZE DANE (ADR-181)
-- =====================================================================
--
-- `app.assert_unit_available` (0010, ADR-024) odmawiała dotąd zdaniami, które
-- niosły w treści dane operacyjne wypożyczalni:
--
--   'Egzemplarz % jest zajęty w terminie % — % (kolizja z zamówieniem %).'
--        ^ uuid egzemplarza                            ^ numer CUDZEGO zamówienia
--   'Egzemplarz % jest w oknie serwisowym w terminie % — %.'
--        ^ uuid egzemplarza
--
-- ==================== DLACZEGO TO WYCIEK, A NIE KOSMETYKA ====================
--
-- Te zdania DOCIERAJĄ DO NIEZALOGOWANEGO KLIENTA SKLEPU. Droga jest krótka
-- i cała udokumentowana: `app.public_checkout` (wołalna rolą `anon`) NIE MA
-- bloku `exception when`, więc wyjątek bramki propaguje się do wołającego,
-- a PostgREST oddaje `message` w ciele odpowiedzi HTTP.
--
-- KIEDY TO WIDAĆ: w normalnej pracy wyprzedza tę bramkę dobór kandydatów
-- w samym `public_checkout` i klient dostaje neutralne
-- „Brak wolnych egzemplarzy w wybranym terminie.". Ale dobór kandydatów NIE
-- JEST bramką wyścigu — jest nią advisory lock + re-check w tej funkcji
-- (komentarz przy doborze mówi to wprost). Przegrany w wyścigu o ostatnią
-- sztukę omija więc zdanie neutralne i dostaje TO zdanie, z numerem
-- zamówienia sąsiada.
--
-- CO Z TEGO WYNIKA DLA OSOBY Z ZEWNĄTRZ: numery zamówień są sekwencyjne
-- (`PREFIKS-ROK-NNN`, `app.generate_order_number`), więc jeden taki komunikat
-- ujawnia obłożenie wypożyczalni — a powtarzany, jej tempo sprzedaży. To jest
-- dokładnie to, czego zakazuje ADR-042: publiczna powierzchnia oddaje
-- WYŁĄCZNIE liczby, nigdy cudzych rezerwacji. Wyciek jest przy tym MIĘDZY
-- KLIENTAMI TEGO SAMEGO NAJEMCY, więc nie łapie go ani macierz izolacji RLS
-- (ta pilnuje granicy między najemcami), ani bramka ACL funkcji.
--
-- ==================== CO SIĘ ZMIENIA, A CO NIE ====================
--
-- ZMIENIA SIĘ WYŁĄCZNIE TREŚĆ DWÓCH KOMUNIKATÓW. Nie zmienia się: logika
-- doboru egzemplarzy, kolejność bramek, mechanizm wyścigu (advisory lock +
-- re-check), warunki kolizji ani sygnatura funkcji.
--
-- KOD BŁĘDU `23P01` ZOSTAJE PRZY OBU ODMOWACH. Rozpoznają po nim ścieżkę
-- wyścigu: sklep (`checkout/core.ts` → `unavailable`), API v1 (→ 409), panel
-- (przypisanie egzemplarza i przedłużenie najmu) oraz suity `order-gates`,
-- `order-extension`, `public-checkout`. Kod jest kontraktem, treść nie jest
-- i nigdy nie powinna była nim być.
--
-- ==================== DLACZEGO ZDANIA SĄ CAŁKIEM STAŁE ====================
--
-- Nie ma w nich ANI JEDNEGO parametru — nawet dat z żądania, które klient
-- przecież zna. Powód jest mechaniczny, nie estetyczny: dopóki komunikat
-- składa się z literału i argumentów, każda przyszła zmiana treści jest
-- o jeden nieuważny argument od przywrócenia wycieku. Zdanie bez listy
-- argumentów nie ma jak wydać niczego, a to, co klient ma zobaczyć, i tak
-- składa warstwa aplikacji (sklep mapuje `23P01` na własny komunikat).
--
-- ==================== `detail`, `hint` I DZIENNIK — ŚWIADOMIE PUSTE ====================
--
-- `detail` i `hint` jadą do klienta tą samą drogą co `message`, więc nie są
-- schowkiem na szczegóły — obie odmowy zostają bez nich.
--
-- Nie ma tu też `raise log` ze szczegółami kolizji, choć byłby technicznie
-- możliwy (dziennik serwera, nie wyjątek). Odrzucone świadomie: numer
-- kolidującego zamówienia jest w PEŁNI odtwarzalny z `order_items`/`orders`
-- przez każdego, kto ma do tych danych prawo, więc wpis do dziennika nie
-- dokłada nikomu informacji, której nie może zdobyć — dokłada wyłącznie
-- powierzchnię (dziennik czytają też osoby bez potrzeby znania cudzych
-- numerów, a wpisy przeżywają retencję samych danych).
--
-- ==================== NAJŚWIEŻSZA DEFINICJA ====================
--
-- Ciało poniżej wychodzi od NAJŚWIEŻSZEJ definicji funkcji, nie od dowolnej.
-- Sprawdzone dwiema drogami: `assert_unit_available` ma w całym katalogu
-- migracji dokładnie JEDNO `create or replace` (0010) i ani jednego
-- `drop`/`alter function`, a `md5(pg_get_functiondef(...))` na bazie po
-- komplecie migracji do 0081 zgadza się z definicją z 0010
-- (`383710faa970c1360513104620ae746b`). Poza dwoma literałami komunikatów
-- ciało jest przepisane co do znaku — inaczej ta migracja cofnęłaby po cichu
-- poprawki, których w diffie nie widać.

-- === BEGIN PROD MIGRATION 0082 ===

-- SECURITY INVOKER bez zmian (0010): odczyty idą przez RLS wywołującego,
-- a jedyny zbiór, w którym kolizja może istnieć, to dane WŁASNEGO tenanta.
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
  'Bramka dostępności egzemplarza (ADR-024): advisory lock per (tenant, egzemplarz) + re-check semantyką silnika (bufory produktu, okno serwisowe vs surowy termin, statusy blokujące). Rzuca 23P01. Treść odmowy nie niesie identyfikatorów — komunikat dociera do niezalogowanego klienta sklepu (ADR-181).';

-- Konwencja migracji: każda migracja PODMIENIAJĄCA funkcję app.* powtarza
-- revoke + granty w tym samym pliku. `create or replace` zachowuje ACL, więc
-- to nie jest naprawa — to jawny zapis stanu docelowego w miejscu, w którym
-- recenzent go szuka. Zestaw ról bez zmian względem 0010: funkcję wołają
-- funkcje triggerowe pod rolą sesji, `anon` jej NIE wykonuje wprost.
revoke all on function app.assert_unit_available(uuid, uuid, uuid, date, date) from public, anon;
grant execute on function app.assert_unit_available(uuid, uuid, uuid, date, date) to authenticated, service_role;

-- === END PROD MIGRATION 0082 ===
