-- =====================================================================
-- 0081 — DOSTĘPNOŚĆ DLA KATALOGU I DLA KALENDARZA (ADR-179)
-- =====================================================================
--
-- Faza 5. Sklep ma dziś JEDNĄ publiczną ścieżkę odczytu dostępności:
-- `app.get_public_availability(tenant, product, start, end)` z 0020 (ostatnia
-- definicja: 0065). Odpowiada ona na pytanie „ile sztuk TEGO sprzętu jest
-- wolnych przez CAŁY ten zakres" — i na to pytanie odpowiada dobrze. Dwa inne
-- pytania, które zadaje sklep, nie mają jak przez nią przejść bez mnożenia
-- żądań:
--
--   1. KATALOG pyta o WSZYSTKIE pozycje naraz w jednym zakresie. Przez funkcję
--      zakresową to jedno wywołanie NA POZYCJĘ — katalog z 37 sprzętami robi
--      37 zapytań na każde przeładowanie strony, razy liczba odwiedzających.
--   2. KALENDARZ sprzętu pyta o KAŻDY DZIEŃ okna z osobna. Przez funkcję
--      zakresową to pętla po dniach; `apps/storefront/lib/embed/month.ts`
--      obchodzi ten brak podziałami binarnymi i płaci za to do `n + 6` wywołań
--      na jeden miesiąc (rachunek w ADR-114/120).
--
-- Ta migracja dokłada te dwa kształty jako osobne funkcje. Funkcja zakresowa
-- ZOSTAJE NIETKNIĘTA: ma własnych wołających (podstrona sprzętu, wtyczka WP,
-- API v1, embed) i własną sygnaturę w allowliście anon.
--
-- ==================== JEDNA REGUŁA KOLIZJI, TRZY WEJŚCIA ====================
--
-- Obie nowe funkcje liczą wolną sztukę DOKŁADNIE tą samą regułą, co
-- `app.get_public_availability` w swojej NAJŚWIEŻSZEJ definicji (0065 — nie
-- 0020: tamta ma bramkę literalną `t.status in (...)` zamiast predykatu
-- `app.tenant_commercially_active`, więc przepisanie z niej cofnęłoby cicho
-- ADR-134). Reguła ma dwa człony i oba są przepisane co do znaku:
--
--   • OKNO SERWISOWE liczy się SUROWYM terminem (lustro `isUnitInService`),
--   • KOLIZJA Z NAJMEM liczy się terminem ROZSZERZONYM O BUFORY produktu,
--     przeciw SUROWYM terminom zamówień o statusie blokującym.
--
-- Parafraza byłaby tu najgorszym możliwym wyborem: kafel katalogu i kalendarz
-- sprzętu mówiłyby o tej samej dostępności dwa różne zdania, a rozjazd
-- ujawniłby się dopiero przy składaniu zamówienia — czyli po stronie klienta,
-- który już wybrał. Dowodzi tego bramka `public-availability-calendar.test.ts`:
-- porównuje wynik dzienny i katalogowy z wynikiem funkcji zakresowej NA TYCH
-- SAMYCH danych, a nie z oczekiwaniem wpisanym w test.
--
-- ==================== WYŁĄCZNIE LICZBY (ADR-042) ====================
--
-- Obie funkcje oddają LICZBY i nic poza liczbami. Nie ma w odpowiedzi ani
-- identyfikatora egzemplarza, ani numeru seryjnego, ani identyfikatora
-- zamówienia, ani nazwiska, ani zakresu cudzej rezerwacji. To jest to samo
-- rozstrzygnięcie, co w 0020, i z tego samego powodu: „ile sztuk wolnych"
-- wystarcza, żeby narysować kafel i siatkę dni, a „które sztuki i czyje
-- zamówienia je blokują" to kalendarz najmu najemcy, którego publiczność nie
-- ma prawa poznać.
--
-- `product_id` w odpowiedzi katalogowej NIE JEST wyjątkiem od tej reguły:
-- identyfikatory pozycji katalogu są publiczne od 0020 (`app.get_public_catalog`
-- oddaje je pod kluczem `id`), a bez nich liczby nie miałyby jak trafić na
-- właściwy kafel. Klucz jest ETYKIETĄ liczby, nie nową informacją.
--
-- ==================== SUFIT OKNA DZIENNEGO ====================
--
-- Odpowiedź dzienna rośnie LINIOWO z szerokością okna — to jedyna z trzech
-- funkcji, której rozmiar wyniku zależy od argumentu. Bez sufitu jedno żądanie
-- z `p_end_date` w 2099 roku każe bazie policzyć trzydzieści tysięcy dni na
-- każdą sztukę. Dlatego funkcja dzienna ODMAWIA (NULL) okna szerszego niż
-- AVAILABILITY_WINDOW_MAX_DAYS dni liczonych INCLUSIVE.
--
-- Sufit stoi TU, w bazie, a nie tylko w interfejsie: interfejs jest po stronie
-- klienta i nie jest bramką niczego — argumenty przychodzą do PostgREST-a
-- wprost z sieci. Rdzeń (`@avably/core`, `AVAILABILITY_WINDOW_MAX_DAYS`) trzyma
-- tę samą liczbę dla kalendarza i dla testów; wiąże je DOWÓD ZACHOWANIA
-- (test woła funkcję oknem o szerokości ze stałej rdzenia i oknem o dzień
-- szerszym), a nie porównanie tekstów.
--
-- Sufit NIE dotyczy funkcji katalogowej i to jest decyzja, nie przeoczenie:
-- ona bierze JEDEN zakres (termin najmu klienta) i oddaje jeden wiersz na
-- pozycję katalogu, więc rozmiar odpowiedzi nie zależy od szerokości okna.
-- Najem półroczny jest legalnym terminem i funkcja katalogowa ma o nim umieć
-- odpowiedzieć.
--
-- ==================== IZOLACJA ====================
--
-- Obie funkcje są SECURITY DEFINER, więc RLS w nich NIE UCZESTNICZY. Jedyną
-- bramką izolacji jest jawne zawężenie w ciele: wiersz produktu wchodzi
-- wyłącznie przez `pr.tenant_id = p_tenant_id`, każdy egzemplarz wyłącznie
-- przez `u.tenant_id = p.tenant_id`, a każda pozycja zamówienia wyłącznie przez
-- `oi.tenant_id = p.tenant_id` w parze z warunkiem złączenia
-- `o.tenant_id = oi.tenant_id`. Złożenie tych warunków jest jedynym powodem,
-- dla którego dostępność najemcy A nie ma jak wyjść na sklep najemcy B —
-- i dlatego każdy z nich ma własną mutację w bramce testowej.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): obie funkcje dostają
-- `revoke all ... from public` + jawne granty w TEJ SAMEJ migracji,
-- z uzasadnieniem per rola. Wpis do allowlisty anon
-- (`packages/db/test/function-acls.test.ts`) idzie razem z migracją.
--
-- CZEGO TA MIGRACJA NIE RUSZA: `app.get_public_availability` (sygnatura,
-- ciało i granty bez zmian — ma własnych wołających), `app.get_public_catalog`,
-- `app.public_checkout` (wiążącą bramką przy ZAPISIE pozostaje bramka
-- przypisania egzemplarza pod advisory lockiem — te dwie funkcje są ODCZYTEM
-- i ich liczba jest orientacyjna w chwili odczytu), żadnej tabeli, żadnej
-- polityki RLS, żadnego grantu tabelowego.

-- === BEGIN PROD MIGRATION 0081 ===

-- ---------------------------------------------------------------------
-- 1. app.get_public_catalog_availability — CAŁY KATALOG, JEDNO WYWOŁANIE
-- ---------------------------------------------------------------------
--
-- KSZTAŁT: {"products": [{"product_id", "total_units", "available_units"}, ...]}
-- posortowane po `product_id`. Koperta jest OBIEKTEM, a nie gołą tablicą, z tego
-- samego powodu, co w `app.get_public_catalog`: pusta tablica pod kluczem znaczy
-- „najemca handluje, ale nie ma ani jednej aktywnej pozycji", a NULL znaczy
-- „najemca nieosiągalny albo zakres odwrócony" — dwa różne zdania, których goła
-- tablica nie umiałaby rozróżnić.
--
-- Zakres pozycji jest DOKŁADNIE ten sam, co w `app.get_public_catalog`
-- (`pr.active`, najemca w oknie handlowym): odpowiedź, która niosłaby liczby
-- dla pozycji spoza katalogu, dokładałaby kafle, których katalog nie pokazuje,
-- a odpowiedź węższa zostawiałaby kafle bez liczby.
--
-- NULL dla: najemca poza oknem handlowym, zakres niekompletny lub odwrócony —
-- nieodróżnialnie, bez wycieku istnienia. Ten sam kontrakt, co w 0020.

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
  'Publiczna dostępność CAŁEGO katalogu w JEDNYM wywołaniu (0081, ADR-179): {"products":[{"product_id","total_units","available_units"}]} dla zakresu [start,end] INCLUSIVE. Reguła kolizji przepisana co do znaku z app.get_public_availability (ostatnia definicja 0065): okno serwisowe surowym terminem, najmy blokujące terminem rozszerzonym o bufory produktu. Zwraca WYŁĄCZNIE liczby (ADR-042) — bez identyfikatorów egzemplarzy, zamówień i bez zakresów cudzych rezerwacji; product_id jest etykietą liczby, publiczną od 0020. Zakres pozycji identyczny z app.get_public_catalog (aktywne, najemca w oknie handlowym). Istnieje po to, żeby katalog nie robił jednego zapytania NA POZYCJĘ. NULL: najemca nieosiągalny lub zakres odwrócony. ODCZYT — liczba jest orientacyjna w chwili odczytu, wiążącą bramką pozostaje przypisanie egzemplarza w app.public_checkout. SECURITY DEFINER: izolację niesie jawne zawężenie tenant_id w ciele, nie RLS.';

revoke all on function app.get_public_catalog_availability(uuid, date, date) from public;
-- anon: to JEST publiczny odczyt sklepu — kafel katalogu klienta najemcy pyta
-- o dostępność tą samą drogą, co o sam katalog (app.get_public_catalog).
-- authenticated: podgląd w panelu chodzi tą samą funkcją co sklep, żeby nie
-- powstała druga ścieżka odczytu dostępności.
grant execute on function app.get_public_catalog_availability(uuid, date, date) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. app.get_public_availability_days — MAPA DZIEŃ → WOLNE SZTUKI
-- ---------------------------------------------------------------------
--
-- KSZTAŁT: {"total_units": n, "days": {"YYYY-MM-DD": wolne, ...}}.
--
-- `total_units` stoi NA ZEWNĄTRZ mapy, bo liczba sztuk sprzętu nie zależy od
-- dnia — powtórzona przy każdym dniu byłaby dziewięćdziesięcioma kopiami tej
-- samej liczby i pierwszym miejscem, w którym odpowiedź mogłaby sama ze sobą
-- się rozjechać.
--
-- Mapa niesie KAŻDY dzień okna, także ten z zerem. Dzień nieobecny w mapie
-- znaczyłby „nie wiem" — a ta funkcja zawsze wie, bo liczy wprost, bez
-- rozstrzygania podziałami (inaczej niż `lib/embed/month.ts`, gdzie brak dnia
-- w mapie jest realnym stanem i wychodzi listą `unresolved`).
--
-- KAŻDY DZIEŃ LICZY SIĘ OSOBNO, jak zakres jednodniowy [d, d]. To nie jest to
-- samo, co odpowiedź zakresowa dla całego okna: sztuka wolna przez cały zakres
-- jest wolna każdego dnia, ale zero na zakresie nie przesądza o żadnym dniu
-- z osobna (różne sztuki mogą być zajęte w różne dni). Właśnie tę różnicę
-- rozstrzygał kosztownie `resolveMonthDays` — tutaj rozstrzyga ją baza za darmo.
--
-- NULL dla: produkt cudzy/nieaktywny/nieistniejący, najemca poza oknem
-- handlowym, zakres odwrócony, okno SZERSZE NIŻ SUFIT — nieodróżnialnie.

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
  'Publiczna dostępność DZIENNA jednego sprzętu (0081, ADR-179): {"total_units":n,"days":{"YYYY-MM-DD":wolne}} dla każdego dnia okna [start,end] INCLUSIVE. Każdy dzień liczy się jak zakres jednodniowy, bo zero na zakresie nie przesądza o żadnym dniu z osobna. Reguła kolizji przepisana co do znaku z app.get_public_availability (ostatnia definicja 0065). Zwraca WYŁĄCZNIE liczby (ADR-042) — siatka kalendarza dostaje „ile sztuk wolnych tego dnia", nigdy KTO i co zarezerwował. Okno szersze niż 90 dni (AVAILABILITY_WINDOW_MAX_DAYS w @avably/core) jest ODRZUCANE NULL-em: to jedyna z publicznych funkcji dostępności, której rozmiar odpowiedzi rośnie z argumentem, a interfejs nie jest bramką niczego. NULL także dla: produkt cudzy/nieaktywny/nieistniejący, najemca poza oknem handlowym, zakres odwrócony. ODCZYT — wiążącą bramką pozostaje przypisanie egzemplarza w app.public_checkout. SECURITY DEFINER: izolację niesie jawne zawężenie tenant_id w ciele, nie RLS.';

revoke all on function app.get_public_availability_days(uuid, uuid, date, date) from public;
-- anon: to JEST publiczny odczyt sklepu — kalendarz na stronie sprzętu maluje
-- się w przeglądarce klienta najemcy, tą samą drogą co app.get_public_availability.
-- authenticated: podgląd w panelu chodzi tą samą funkcją co sklep.
grant execute on function app.get_public_availability_days(uuid, uuid, date, date) to anon, authenticated;

-- === END PROD MIGRATION 0081 ===
