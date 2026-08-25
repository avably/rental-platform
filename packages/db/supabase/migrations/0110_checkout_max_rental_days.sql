-- 0110_checkout_max_rental_days.sql
-- ADR-268: SUFIT ANTYNADUŻYCIOWY DŁUGOŚCI NAJMU — bramka NIEOBEJŚCIOWA
-- w app.public_checkout, która odrzuca najem dłuższy niż c_max_rental_days.
--
-- PO CO (finding audytu rdzenia przedlaunchowego, klasa resource-exhaustion):
-- ani checkoutSchema (walidacja TS: tylko endDate >= startDate), ani
-- app.public_checkout (do 0110: tylko p_end_date < p_start_date) NIE
-- ograniczały DŁUGOŚCI najmu. Anon z ważnym biletem zaufanej granicy mógł
-- zamówić najem start=2026-01-01…end=9999-12-31: egzemplarze wypadały wtedy
-- z dostępności praktycznie „na zawsze" (inventory DoS), a wycena
-- `base_price_day_grosze * v_days` przy ~2.9 mln dób groziła przepełnieniem
-- int. To NIE jest luka izolacji ani obejście bramki — funkcja pozostaje
-- SECURITY DEFINER tenant-scope bez zmian poza dodaniem SUFITU; kwoty liczone
-- w groszach, więc cap chroni też przed przepełnieniem.
--
-- SUFIT, NIE REGUŁA BIZNESOWA: minimum najmu to reguła SPRZĘTU
-- (products.min_rental_days, 0089/ADR-202). Maksimum jest przeciwieństwem
-- klasy: nie mówi „ile najkrócej wynajmuje się TEN sprzęt", tylko stawia
-- hojny pułap PLATFORMY na anty-nadużycie, wspólny dla wszystkich pozycji.
-- Wartość c_max_rental_days = 365 dób pokrywa każdy realny najem z dużym
-- zapasem. OWNER-ADJUSTABLE: właściciel platformy może pułap ZAWĘZIĆ przyszłą
-- migracją; wartość MUSI zostać zgodna z MAX_RENTAL_DAYS w checkoutSchema
-- (apps/storefront/lib/checkout/validation.ts) — rozjazd znaczyłby, że jedna
-- warstwa odrzuca najmy, które druga przyjmuje.
--
-- DWIE WARSTWY (obrona w głąb): sufit stoi TU (nieobejściowo, tak samo jak
-- min_rental_days z 0089 — żadna powierzchnia nie omija tej funkcji: sklep,
-- embed, API v1, wtyczka) ORAZ w checkoutSchema (wcześniejszy, czytelny błąd
-- UX na polu endDate). Schemat da się ominąć surowym RPC z anon key, więc
-- REGUŁĄ jest ta bramka; walidacja TS jest wygodą.
--
-- KLASA ODMOWY = 22023 (jak inne odmowy walidacyjne), NIE PT422+hint jak
-- min_rental_days. Świadomie: min_rental_days potrzebuje osobnej klasy, bo
-- checkout jest JEDYNYM miejscem, w którym klient dowiaduje się o minimum,
-- i warstwa TS składa z detail zdanie „minimum X dni". Sufit maksymalny na
-- normalnej ścieżce jest złapany WCZEŚNIEJ przez checkoutSchema (czytelny
-- błąd pola), więc odmowa w RPC pada tylko dla bezpośredniego wołania anon
-- omijającego formularz — a wtedy neutralne 22023 (→ status `rejected`
-- w lib/checkout/core.ts, jak ban-lista i bilet z 0059) jest właściwą
-- postawą: nie daje botowi precyzyjnej wyroczni o progu. Bez zmian w kontrakcie
-- ani w mapowaniu SQLSTATE po stronie sklepu.
--
-- LICZENIE DNI = ta sama zmienna `v_days := (p_end_date - p_start_date) + 1`
-- (INCLUSIVE), której funkcja używa od 0020 do wyceny i której od 0089 używa
-- bramka minimum — jedna arytmetyka, zgodna z rentalDaysInclusive
-- (@avably/core) i z MAX_RENTAL_DAYS w checkoutSchema. Zero rozjazdu SQL↔TS.
--
-- CIAŁO FUNKCJI: przepisane W CAŁOŚCI z 0089_min_rental_days.sql — NAJNOWSZEJ
-- definicji (historia przepisań: 0010/0020/0021/0029/0040/0041/0049/0058/
-- 0059/0063/0065/0086/0089; create or replace zastępuje całe ciało, więc kopia
-- ze starszej wersji cicho cofnęłaby bramki publikacji dokumentów z 0086
-- i minimum najmu z 0089). Różnice wobec 0089 to DOKŁADNIE trzy miejsca,
-- wszystkie oznaczone [0110]: stała w declare, bramka sufitu, komentarz funkcji.
--
-- CZEGO NIE ZMIENIA (świadomie):
--   * SYGNATURA BEZ ZMIAN (23 argumenty jak w 0063/0065/0086/0089) — bez drop
--     function, bez przeciążenia, bez okna z drugą ścieżką zapisu.
--   * KOPERTY PUBLICZNYCH ODCZYTÓW BEZ ZMIAN — sufit nie dotyka projekcji.
--   * PRACA LADY BEZ BRAMKI: create_order panelu nie sprawdza sufitu — to
--     obrona przed nadużyciem publicznego wejścia, nie ograniczenie operatora,
--     który może zawrzeć dowolny najem (ta sama logika co throttle i minimum:
--     limity chronią najemcę, nie wiążą go).
--
-- OKNO WDROŻENIOWE (migracja jedzie na produkcję PRZED kodem): bramka zapala
-- się od wgrania i jest neutralna dla każdego realnego najmu (365 dób z zapasem
-- pokrywa ofertę wypożyczalni). Kod sklepu z checkoutSchema dokłada tylko
-- wcześniejszy błąd UX; brak tego kodu w oknie wdrożeniowym nie osłabia bramki.
-- Bezpieczne w obie strony.

-- === BEGIN PROD MIGRATION 0110 ===

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

-- ---------------------------------------------------------------------
-- ACL — restate po redefinicji (konwencja 0082/0065/0089): `create or replace`
-- zachowuje ACL, więc to potwierdzenie stanu, nie zmiana. Publiczny checkout
-- pozostaje jedyną anonową ścieżką zapisu zamówienia (ADR-042).
-- ---------------------------------------------------------------------

revoke all on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb, bigint, text, text) from public;
grant execute on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb, bigint, text, text) to anon, authenticated;

comment on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb, bigint, text, text) is
  'ADR-042/125/129/134/191/202/268: jedyna anonowa ścieżka ZAPISU zamówienia. Od 0086 odmawia (22023, detail=legal_documents_missing), gdy najemca nie ma opublikowanego regulaminu I polityki prywatności; deklarację wersji regulaminu konfrontuje z rejestrem 0063 (żywa → przypięcie terms_version_id, archiwalna → 22023 terms_outdated, obca → zapis napisu bez przypięcia: nazwany dług integracji, ADR-129 gałąź d). Od 0089 (ADR-202) odmawia (PT422, hint=min_rental_days, detail=liczba minimum), gdy najem — liczony INCLUSIVE jak rentalDaysInclusive — jest krótszy niż products.min_rental_days którejkolwiek pozycji. Od 0110 (ADR-268) odmawia (22023, komunikat stały) najmu dłuższego niż sufit antynadużyciowy c_max_rental_days (365 dób, owner-adjustable) — hojny pułap PLATFORMY chroniący dostępność i wycenę groszową przed najmem start…9999, zgodny z MAX_RENTAL_DAYS w checkoutSchema.';


-- === END PROD MIGRATION 0110 ===
