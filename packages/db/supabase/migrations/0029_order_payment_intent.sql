-- 0029_order_payment_intent.sql
-- Z3 / ADR-066: płatność online za zamówienie storefrontu — i tor offline
-- jako RÓWNORZĘDNA, trwała droga do tej samej rezerwacji.
--
-- CZEGO W TEJ MIGRACJI NIE MA I NIE BĘDZIE: ani jednego miejsca, które
-- ustawia `payment_status = 'paid'`. Jedynym writerem `paid` jest handler
-- webhooka z Z4 — po ODCZYCIE stanu u dostawcy (ADR-049). Ta migracja
-- doprowadza zamówienie najdalej do `pending`, czyli do zdania „ktoś zaczął
-- płacić", które da się udowodnić bez pytania dostawcy o cokolwiek.
--
-- DLACZEGO WYBÓR METODY TO KOLUMNA, A NIE STAN SESJI. Zamówienie żyje dłużej
-- niż karta w przeglądarce: operator otwiera je za tydzień i musi wiedzieć,
-- czy klient deklarował przelew, czy zapłacił online. Stan sesji nie odpowie
-- na to pytanie ani po powrocie z płatności, ani po telefonie klienta, ani
-- w panelu. `orders.payment_method` odpowiada zawsze i jedzie z zamówieniem
-- wszędzie — dokładnie jak `payment_provider` z 0027.
--
-- DLACZEGO `application_fee_grosze` JEST KOLUMNĄ OD DZIŚ, MIMO WARTOŚCI 0.
-- Prowizja platformy to faza 4, ale dopisanie kolumny WTEDY nie odtworzy,
-- jaka prowizja obowiązywała w chwili sprzedaży — a to jest liczba
-- rozliczeniowa: najemca ma prawo wiedzieć po roku, ile potrąciliśmy z
-- konkretnej transakcji. Kolumna zapisana zerem niesie prawdę („nie
-- potrąciliśmy nic"); kolumna dopisana później niesie domysł.
--
-- Zawartość:
--   1. orders.provider_payment_intent_id / application_fee_grosze /
--      payment_method + unikat identyfikatora płatności,
--   2. app.orders_write_gate — redefinicja z 0027: identyfikator płatności
--      NIEZMIENNY po ustawieniu (reszta ciała bez zmian co do znaku),
--   3. app.public_checkout — redefinicja z 0021: przyjmuje wybór metody,
--      zapisuje go i wywodzi z niego reżim (reszta ciała bez zmian),
--   4. app.attach_payment_intent — jedyna anonowa ścieżka wiązania płatności
--      z zamówieniem (unpaid → pending),
--   5. app.get_public_order_payment — odczyt stanu płatności dla strony
--      powrotu z płatności (własny serwer zamiast parametrów URL),
--   6. app.get_public_payment_account — identyfikator konta najemcy dla
--      serwera storefrontu (BEZ kolumn gotowości — te czyta się u dostawcy).
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md):
--   * zbiory wartości to text + CHECK, nie enumy,
--   * wyłącznie standardowe SQLSTATE (22023 / 23514) — P0xxx PostgREST zjada
--     do gołego 500 bez treści,
--   * idempotencja: add column if not exists / drop ... if exists /
--     create or replace — baza lokalna jest współdzielona i bywa dogrywana
--     ręcznie, a 0028 już na niej stoi.

-- ---------------------------------------------------------------------
-- 1. Kolumny płatności na zamówieniu
-- ---------------------------------------------------------------------

alter table public.orders
  add column if not exists provider_payment_intent_id text;

alter table public.orders
  drop constraint if exists orders_provider_payment_intent_id_check;

alter table public.orders
  add constraint orders_provider_payment_intent_id_check
  check (
    provider_payment_intent_id is null
    or length(provider_payment_intent_id) between 3 and 255
  );

-- Świadomie BEZ sprawdzania prefiksu identyfikatora (`pi_`): kształt
-- identyfikatora należy do słownika DOSTAWCY, a nasz CHECK zamieniłby zmianę
-- jego konwencji w naszą awarię zapisu. Ta sama decyzja co przy
-- `payment_accounts.provider_account_id` (0028) i `requirements_due`.

alter table public.orders
  add column if not exists application_fee_grosze int not null default 0;

alter table public.orders
  drop constraint if exists orders_application_fee_grosze_check;

alter table public.orders
  add constraint orders_application_fee_grosze_check
  check (application_fee_grosze >= 0);

alter table public.orders
  add column if not exists payment_method text;

alter table public.orders
  drop constraint if exists orders_payment_method_check;

-- NULLABLE Z ROZMYSŁEM: zamówienia z panelu (app.create_order — obsługa lady)
-- i wszystkie sprzed tej migracji nie niosą wyboru klienta. Kolumna bez
-- wartości znaczy tu „klient nie wybierał", a nie „brak danych" — wpisanie
-- im 'transfer' byłoby zmyśleniem deklaracji, której nikt nie złożył.
alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method is null or payment_method in ('online', 'transfer', 'cod'));

comment on column public.orders.provider_payment_intent_id is
  'Identyfikator płatności u dostawcy (Z3, ADR-066). Ustawiany RAZ przez app.attach_payment_intent; UPDATE zmieniający istniejącą wartość jest odrzucany (23514, app.orders_write_gate) — przepisanie go przypisałoby zamówieniu CUDZĄ płatność. Po tej kolumnie Z4 odnajduje zamówienie dla zdarzenia webhooka, dlatego unikat jest globalny, nie per tenant.';
comment on column public.orders.application_fee_grosze is
  'Prowizja platformy pobrana z tej transakcji, w groszach (Z3, ADR-066). W fazie 3 zawsze 0 — kolumna istnieje od dziś, bo dopisanie jej w fazie 4 nie odtworzyłoby, ile potrącono przy sprzedaży sprzed dopisania. Dołożenie prowizji ma być zmianą WARTOŚCI, nie zmianą kształtu danych.';
comment on column public.orders.payment_method is
  'Wybór klienta w checkoucie: online | transfer | cod (Z3, ADR-066). DANE ZAMÓWIENIA, nie stan sesji — operator musi znać deklarację klienta także za tydzień, w panelu, bez przeglądarki. NULL dla zamówień z panelu i sprzed 0029 (nikt nie wybierał). Reżim osi płatności wywodzi się z tej kolumny przy narodzinach zamówienia (online → payment_provider stripe), ale to payment_provider jest źródłem prawdy o reżimie (0027).';

-- Unikat GLOBALNY, nie per tenant: identyfikator płatności jest unikatowy
-- u dostawcy, a Z4 dostaje w webhooku sam ten identyfikator i musi trafić
-- w DOKŁADNIE JEDNO zamówienie. Unikat per (tenant_id, ...) dopuszczałby
-- dwa zamówienia różnych najemców z tym samym intentem — czyli pytanie
-- „czyja to wpłata" bez odpowiedzi w danych.
create unique index if not exists orders_provider_payment_intent_key
  on public.orders (provider_payment_intent_id)
  where provider_payment_intent_id is not null;

-- Zamówienia oczekujące na płatność online — po tym indeksie chodzi strona
-- powrotu z płatności i (w Z4) dosprzątanie porzuconych prób.
create index if not exists orders_tenant_payment_pending_idx
  on public.orders (tenant_id, payment_status)
  where payment_provider = 'stripe';

-- ---------------------------------------------------------------------
-- 2. app.orders_write_gate — redefinicja z 0027
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0027 + jeden blok) — bo create or replace
-- nadpisuje też atrybuty funkcji; okrojona kopia zdjęłaby cicho reżimy
-- płatności, maszynę order_status, blokadę anulowania i re-walidację terminu.
-- Zmiany względem 0027 oznaczone [0029]; reszta ciała jest DOSŁOWNA.
--
-- PO CO TA BRAMKA: `UPDATE` na `orders` przez PostgREST ma KAŻDY członek
-- tenanta (RLS 0007). Bez niej jedno żądanie przepisujące
-- `provider_payment_intent_id` przypisałoby zamówieniu cudzą, opłaconą już
-- płatność — a webhook z Z4, który pisze `paid` po odczycie TEJ płatności,
-- posłusznie oznaczyłby zamówienie jako opłacone. Unikat z punktu 1 broni
-- tylko przed wskazaniem płatności zajętej przez INNE zamówienie; ten
-- trigger domyka resztę (m.in. wyzerowanie kolumny i wpisanie jej od nowa).

create or replace function app.orders_write_gate() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  r record;
  v_collected bigint;
  v_settled bigint;
begin
  if tg_op = 'INSERT' then
    if new.order_status <> 'pending' then
      raise exception
        'Zamówienie może powstać wyłącznie w statusie pending (otrzymano %).',
        new.order_status
        using errcode = '23514';
    end if;
    -- Zbiór dopuszczalny przy narodzinach BEZ ZMIAN względem 0015/0027:
    -- payment_failed przy INSERT zakłada nieudaną próbę, której nie było,
    -- a stan rozliczeniowy zakłada historię, której nie ma.
    if new.payment_status not in ('unpaid', 'pending', 'paid', 'manual', 'completed') then
      raise exception
        'Zamówienie może powstać wyłącznie w otwartym statusie płatności (otrzymano %).',
        new.payment_status
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- [0027] Reżim nie cofa się ze `stripe` na `manual`. Bez tej reguły ścisła
  -- bramka miałaby jednolinijkowe obejście: UPDATE payment_provider='manual',
  -- potem paid → pending. Kierunek manual → stripe zostaje otwarty — tak
  -- zamówienie wchodzi w płatność online (Z3).
  if new.payment_provider is distinct from old.payment_provider
     and old.payment_provider = 'stripe'
  then
    raise exception
      'Nie można zmienić obiegu płatności ze stripe na % — reżim zamówienia jest jednokierunkowy.',
      new.payment_provider
      using errcode = '23514';
  end if;

  -- [0029] Identyfikator płatności jest NIEZMIENNY po ustawieniu — w obie
  -- strony: nie wolno go ani podmienić, ani wyczyścić (wyczyszczenie byłoby
  -- podmianą w dwóch krokach). Warunek patrzy na STARĄ wartość: dopóki
  -- kolumna jest pusta, wpisanie identyfikatora jest legalne i tak właśnie
  -- działa app.attach_payment_intent.
  --
  -- Bez WARTOŚCI identyfikatorów w komunikacie: komunikat trafia do warstwy,
  -- która pokazuje go człowiekowi (wzorzec 0028).
  if new.provider_payment_intent_id is distinct from old.provider_payment_intent_id
     and old.provider_payment_intent_id is not null
  then
    raise exception
      'Identyfikatora płatności nie można zmienić ani usunąć po jego przypisaniu.'
      using errcode = '23514';
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
    -- [0027] payment_failed NIE blokuje: nieudana próba nie pobrała środków.
    if new.order_status = 'cancelled'
       and new.payment_status in ('pending', 'paid', 'manual', 'completed', 'deposit_refunded')
    then
      raise exception
        'Nie można anulować zamówienia z nierozliczoną płatnością (payment_status=%).',
        new.payment_status
        using errcode = '23001';
    end if;
  end if;

  if new.payment_status is distinct from old.payment_status then
    -- [0027] Reżim czytany z NEW — ten sam wzorzec co blokada anulowania
    -- wyżej: liczy się stan PO zapisie. UPDATE wchodzący w Stripe i zmieniający
    -- status jednym żądaniem jest więc oceniany reżimem ścisłym (ostrzejszym),
    -- a nie tym, z którego wychodzi.
    if not app.payment_transition_allowed(
         old.payment_status, new.payment_status, new.payment_provider
       ) then
      raise exception
        'Niedozwolone przejście statusu płatności: % → % (obieg %).',
        old.payment_status, new.payment_status, new.payment_provider
        using errcode = '23514';
    end if;

    -- Reguła B — spójność z rejestrem kaucji przy wejściu w deposit_refunded:
    -- saldo 0 przy pobraniach > 0 (lustro isDepositSettled / ADR-027).
    -- Obowiązuje OBA reżimy: rejestr kaucji nie zna Stripe'a.
    if new.payment_status = 'deposit_refunded' then
      select
        coalesce(sum(amount_grosze) filter (where kind = 'collected'), 0),
        coalesce(sum(amount_grosze) filter (where kind in ('refunded','deducted')), 0)
        into v_collected, v_settled
      from public.deposit_events
      where tenant_id = new.tenant_id and order_id = new.id;

      if not (v_collected > 0 and v_settled = v_collected) then
        raise exception
          'Nie można oznaczyć kaucji jako rozliczonej: rejestr nie pokrywa (pobrano % gr, rozliczono % gr).',
          v_collected, v_settled
          using errcode = '23514';
      end if;
    end if;
  end if;

  -- Zmiana TERMINU przechodzi przez tę samą bramkę dostępności, co
  -- przypisanie egzemplarza — inaczej PATCH dat byłby dziurą obok bramki.
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

  new.updated_at := now();
  return new;
end;
$$;

comment on function app.orders_write_gate() is
  'Bramka zapisu orders (0010 + 0015 + 0027 + 0029): INSERT tylko pending i w otwartym payment_status; mapa przejść order_status (ADR-025) i payment_status per reżim payment_provider (ADR-064, 23514); reżim nie cofa się ze stripe na manual (23514); provider_payment_intent_id niezmienny po przypisaniu (23514, ADR-066) — przepisanie go przypisałoby zamówieniu cudzą płatność; anulowanie blokowane przy pobranej płatności (23001); wejście w deposit_refunded wymaga pokrycia w rejestrze kaucji (23514); re-walidacja terminu (23P01); updated_at.';

-- ---------------------------------------------------------------------
-- 3. app.public_checkout — redefinicja z 0021 (wybór metody płatności)
-- ---------------------------------------------------------------------
--
-- Ciało odtworzone w CAŁOŚCI z 0021, nie okrojone (lekcja 0016: okrojona
-- kopia cicho gubi logikę). Względem 0021 zmieniają się DOKŁADNIE cztery
-- miejsca, wszystkie oznaczone [0029]: parametr `p_payment_method`,
-- deklaracje `v_payment_method` / `v_payment_provider`, blok walidacji metody
-- (z wymaganiem ISTNIEJĄCEGO konta najemcy przy `online`), kolumny w
-- INSERT-cie zamówienia oraz trzy pola w zwracanym jsonb.
--
-- BEZ ZMIAN zostają: throttle w bazie (per klient i per tenant, z
-- coalesce-guardem konfiguracji), wycena SERWEROWA (klient nie niesie kwot),
-- wybór egzemplarzy, kolejność advisory locków (porządek po unit_id — brak
-- zakleszczenia), bramki 0010/0015/0027, wydanie log_tokenu (ADR-045) oraz
-- polityka zwrotu bez PII (notify_email wyłącznie z email_sender.reply_to).
--
-- SYGNATURA SIĘ ZMIENIA, więc wariant 17-argumentowy MUSI zniknąć. Zostawiony
-- byłby drugą, nieaktualną ścieżką zapisu zamówienia: wywołanie bez
-- `p_payment_method` przechodziłoby przez STARE ciało, które nie zna kolumny
-- `payment_method` — i zamówienia zakładane starą drogą rodziłyby się bez
-- deklaracji klienta, w milczeniu. Drop idzie PRZED create (inaczej obie
-- wersje istniałyby naraz i wołanie 17 argumentami byłoby niejednoznaczne).

drop function if exists app.public_checkout(
  uuid, text, text, text, date, date, text, uuid, jsonb, text,
  text, text, text, text, text, text, text
);

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
  p_payment_method text default 'transfer'
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
  v_locale text;
  v_days int;
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
begin
  -- --- Tenant aktywny (izolacja: nieaktywny nieodróżnialny od nieistniejącego) ---
  select id, name, locale into v_tenant
  from public.tenants
  where id = p_tenant_id and status in ('trialing', 'active');
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
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Zamówienie wymaga co najmniej jednej pozycji.' using errcode = '22023';
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
  -- inwentarz tenanta z oferty. Limity liczone WYŁĄCZNIE po zamówieniach
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
      address_street, address_zip, address_city, locale
    )
    values (
      p_tenant_id, v_email, v_full_name,
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_company_name, '')), ''),
      nullif(btrim(coalesce(p_nip, '')), ''),
      nullif(btrim(coalesce(p_address_street, '')), ''),
      nullif(btrim(coalesce(p_address_zip, '')), ''),
      nullif(btrim(coalesce(p_address_city, '')), ''),
      v_locale
    )
    on conflict (tenant_id, lower(email)) do nothing
    returning id into v_customer_id;

    if v_customer_id is null then
      select id into v_customer_id
      from public.customers
      where tenant_id = p_tenant_id and lower(email) = v_email;
    end if;
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
           buffer_before_days, buffer_after_days
      into v_product
    from public.products
    where tenant_id = p_tenant_id and id = v_product_id and active;
    if not found then
      raise exception 'Produkt jest niedostępny.' using errcode = '22023';
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
    pickup_location_id, notes, total_rental_grosze, total_deposit_grosze,
    delivery_grosze, terms_accepted_at, terms_version, source, checkout_log_token,
    -- [0029] Metoda to DANE ZAMÓWIENIA, nie stan sesji (ADR-066), a reżim
    -- jedzie z nią od narodzin. `payment_status` zostaje domyślne `unpaid`:
    -- zamówienie rodzi się nieopłacone także wtedy, gdy klient za chwilę
    -- zapłaci kartą — `paid` w tej migracji nie występuje ani razu.
    payment_method, payment_provider
  )
  values (
    p_tenant_id, v_customer_id, p_start_date, p_end_date, p_delivery_method,
    v_pickup, nullif(btrim(coalesce(p_notes, '')), ''),
    v_total_rental, v_total_deposit, v_delivery, now(), btrim(p_terms_version),
    'storefront', v_log_token, v_payment_method, v_payment_provider
  )
  returning id, order_number into v_order_id, v_order_number;

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

  select coalesce(
    (select value #>> '{}' from public.tenant_settings
     where tenant_id = p_tenant_id and key = 'currency'
       and jsonb_typeof(value) = 'string' and (value #>> '{}') in ('PLN', 'EUR', 'USD')),
    'PLN'
  ) into v_currency;

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

revoke all on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text) from public;
grant execute on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text) to anon, authenticated;

comment on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text) is
  'Publiczny checkout storefrontu (ADR-042 + ADR-045 + ADR-066): jedyna anonowa ścieżka ZAPISU zamówienia. Kwoty i egzemplarze liczy/przypisuje SERWER (klient nie niesie kwot); INSERT orders+items przez bramki 0010/0015/0027 (pending/unpaid, wyścig o egzemplarz zatrzymany advisory lockiem); throttle w bazie (defaulty 3/24h per klient, 30/1h per tenant; konfigurowalne kluczem tenant_settings checkout_limits z coalesce-guardem — bezpośrednie RPC omija bramki storefrontu). [0029] p_payment_method (online|transfer|cod) zapisuje wybór klienta na zamówieniu i wywodzi z niego payment_provider (online → stripe, reszta → manual); online wymaga ISTNIEJĄCEGO wiersza payment_accounts, ale NIE czyta jego kolumn gotowości (ADR-049 — gotowość stwierdza odczyt u dostawcy po stronie serwera storefrontu). payment_status pozostaje unpaid — ta funkcja nie ustawia paid ani pending. SECURITY DEFINER, tenant_id z parametru. Zwraca order_id + order_number + podsumowanie + kontekst wysyłki e-maili + log_token (server-only; notify_email wyłącznie z email_sender.reply_to — zero PII z auth.users). Odmowy: 22023 / 23P01.';


-- ---------------------------------------------------------------------
-- 4. app.attach_payment_intent — związanie płatności z zamówieniem
-- ---------------------------------------------------------------------
--
-- STOREFRONT NIE MA KLUCZA SERVICE-ROLE (twarda konwencja fazy) i anon nie ma
-- grantu UPDATE na `orders`. Zapis idzie więc wąską funkcją SECURITY DEFINER —
-- tym samym wzorcem, co `app.log_public_checkout_email` (0021): jedna funkcja,
-- jawny zakres, zero dostępu do tabeli.
--
-- BRAMKA TO `checkout_log_token` Z 0021 — świadomie TEN SAM token, nie nowy.
-- On nie jest „tokenem dziennika maili"; jest DOWODEM, ŻE WOŁAJĄCY
-- PRZEPROWADZIŁ TEN CHECKOUT. Dwa różne tokeny na to samo zdanie znaczyłyby
-- dwa niezależne sekrety do wydania, przekazania i unieważnienia — przy
-- jednej i tej samej odpowiedzi na pytanie „czy to ty składałeś zamówienie".
-- Bez bramki funkcja byłaby otwarta na danych PUBLICZNYCH (tenant_id jest
-- jawny, a numery zamówień sekwencyjne): obcy przypisałby zamówieniu WŁASNĄ
-- płatność na 1 zł i czekał, aż webhook z Z4 oznaczy je jako opłacone.
--
-- CZEGO TA FUNKCJA NIE ROBI: nie ustawia `paid` i nie ma jak — bramka 0027
-- w reżimie `stripe` nie zna przejścia `unpaid → paid`, a funkcja i tak
-- prosi wyłącznie o `pending`. Nie przyjmuje też ŻADNEJ kwoty od wołającego:
-- jedyna liczba, którą przyjmuje, to prowizja platformy, a ta w fazie 3
-- jest zerem i ma CHECK-a przy kolumnie.

create or replace function app.attach_payment_intent(
  p_tenant_id uuid,
  p_order_id uuid,
  p_checkout_token uuid,
  p_intent_id text,
  p_application_fee_grosze int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_order record;
  v_intent text := btrim(coalesce(p_intent_id, ''));
begin
  if length(v_intent) < 3 or length(v_intent) > 255 then
    raise exception 'Nieprawidłowy identyfikator płatności.' using errcode = '22023';
  end if;
  if p_application_fee_grosze is null or p_application_fee_grosze < 0 then
    raise exception 'Nieprawidłowa prowizja platformy.' using errcode = '22023';
  end if;

  -- Wiersz szukany po KOMPLECIE (tenant + zamówienie + token). Odmowy „nie
  -- ma takiego zamówienia" i „zły token" są NIEROZRÓŻNIALNE — inaczej
  -- funkcja działałaby jak wyrocznia istnienia zamówień (wzorzec 0021).
  select id, payment_status, payment_provider, provider_payment_intent_id
    into v_order
  from public.orders
  where tenant_id = p_tenant_id
    and id = p_order_id
    and checkout_log_token is not null
    and checkout_log_token = p_checkout_token;

  if not found then
    raise exception 'Nie znaleziono zamówienia dla tej płatności.' using errcode = '22023';
  end if;

  -- Płatność online da się związać WYŁĄCZNIE z zamówieniem, które w nią
  -- weszło przy narodzinach. Inaczej dowolne zamówienie przelewowe dałoby się
  -- po fakcie wciągnąć w reżim ścisły cudzą płatnością.
  if v_order.payment_provider <> 'stripe' then
    raise exception 'To zamówienie nie jest opłacane online.' using errcode = '22023';
  end if;

  -- POWTÓRZONE WYWOŁANIE Z TYM SAMYM IDENTYFIKATOREM JEST SUKCESEM, nie
  -- błędem: klient odświeżający krok płatności ma zobaczyć swoją płatność,
  -- a nie komunikat o awarii. Identyfikator INNY od zapisanego przepuszczamy
  -- do UPDATE — odmowę wystawia bramka z punktu 2, żeby reguła
  -- niezmienności miała DOKŁADNIE JEDNO miejsce w bazie.
  if v_order.provider_payment_intent_id is not distinct from v_intent
     and v_order.payment_status <> 'unpaid'
  then
    return jsonb_build_object(
      'order_id', v_order.id,
      'payment_status', v_order.payment_status,
      'provider_payment_intent_id', v_order.provider_payment_intent_id
    );
  end if;

  update public.orders
     set provider_payment_intent_id = v_intent,
         application_fee_grosze = p_application_fee_grosze,
         -- `unpaid → pending` znaczy „próba płatności istnieje", i tylko
         -- tyle. Status wyższy niż zastany NIE JEST tu osiągalny: gdy
         -- zamówienie jest już `pending` (albo dalej), zostaje jak było.
         payment_status = case when payment_status = 'unpaid' then 'pending' else payment_status end
   where tenant_id = p_tenant_id
     and id = p_order_id;

  -- ODCZYT PO ZAPISIE (ADR-049): `UPDATE` bez błędu nie dowodzi, że kolumna
  -- ma zamierzoną wartość — bramka triggera mogła przepisać status, a
  -- ewentualna polityka odfiltrować wiersz. Zwracamy to, co NAPRAWDĘ stoi
  -- w wierszu, a nie to, o co prosiliśmy.
  select id, payment_status, provider_payment_intent_id into v_order
  from public.orders
  where tenant_id = p_tenant_id and id = p_order_id;

  return jsonb_build_object(
    'order_id', v_order.id,
    'payment_status', v_order.payment_status,
    'provider_payment_intent_id', v_order.provider_payment_intent_id
  );
end;
$$;

revoke all on function app.attach_payment_intent(uuid, uuid, uuid, text, int) from public;
grant execute on function app.attach_payment_intent(uuid, uuid, uuid, text, int) to anon, authenticated;

comment on function app.attach_payment_intent(uuid, uuid, uuid, text, int) is
  'Wiąże płatność u dostawcy z zamówieniem storefrontu (Z3, ADR-066) i przenosi je unpaid → pending. Jedyna anonowa ścieżka zapisu tej kolumny — anon nie ma grantu UPDATE na orders. Bramkowana checkout_log_tokenem z 0021 (dowód przeprowadzenia TEGO checkoutu); odmowy „nie ma zamówienia" i „zły token" nierozróżnialne. Wymaga payment_provider=stripe. NIE ustawia paid — w reżimie stripe (0027) przejście unpaid → paid nie istnieje, a jedynym writerem paid jest webhook Z4 po odczycie. Zwraca stan Z ODCZYTU po zapisie. Odmowy: 22023; niezmienność identyfikatora egzekwuje app.orders_write_gate (23514). SECURITY DEFINER.';

-- ---------------------------------------------------------------------
-- 5. app.get_public_order_payment — stan płatności dla strony powrotu
-- ---------------------------------------------------------------------
--
-- PO CO TO ISTNIEJE: po powrocie z płatności przeglądarka niesie parametry
-- URL (`payment_intent`, `redirect_status`) i wynik `confirmPayment()`. Obie
-- rzeczy są DEKLARACJĄ KLIENTA — kod przeglądarki jest pod kontrolą
-- użytkownika, a `?redirect_status=succeeded` dopisuje sobie każdy. Strona
-- powrotu pyta więc WŁASNY serwer, a serwer — tę funkcję.
--
-- Funkcja zwraca stan Z BAZY, czyli to, co zapisał (albo jeszcze nie zapisał)
-- webhook z Z4. Gdy webhook nie dotarł, odpowiedź brzmi `pending` i strona
-- mówi „sprawdzamy płatność" — komunikat nudny, ale prawdziwy.
--
-- STABLE, nie VOLATILE: to czysty odczyt. Bramkowana tym samym tokenem co
-- funkcja wyżej i tak samo nierozróżnialna w odmowie — zwraca NULL zamiast
-- rzucać, bo „nie ma czego pokazać" jest tu stanem normalnym (wygasłe
-- ciasteczko, cudzy link), a nie awarią.

create or replace function app.get_public_order_payment(
  p_tenant_id uuid,
  p_order_id uuid,
  p_checkout_token uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_order record;
  v_currency text;
begin
  select o.order_number, o.order_status, o.payment_status, o.payment_method,
         o.payment_provider, o.provider_payment_intent_id,
         o.total_rental_grosze, o.total_deposit_grosze, o.delivery_grosze
    into v_order
  from public.orders o
  join public.tenants t on t.id = o.tenant_id
  where o.tenant_id = p_tenant_id
    and o.id = p_order_id
    and o.checkout_log_token is not null
    and o.checkout_log_token = p_checkout_token
    -- Sklep nieaktywny nieodróżnialny od nieistniejącego (spójnie z 0017/0019/0020).
    and t.status in ('trialing', 'active');

  if not found then
    return null;
  end if;

  select coalesce(
    (select value #>> '{}' from public.tenant_settings
     where tenant_id = p_tenant_id and key = 'currency'
       and jsonb_typeof(value) = 'string' and (value #>> '{}') in ('PLN', 'EUR', 'USD')),
    'PLN'
  ) into v_currency;

  return jsonb_build_object(
    'order_number', v_order.order_number,
    'order_status', v_order.order_status,
    'payment_status', v_order.payment_status,
    'payment_method', v_order.payment_method,
    'payment_provider', v_order.payment_provider,
    'provider_payment_intent_id', v_order.provider_payment_intent_id,
    -- SUMA POLICZONA PRZEZ SERWER, w groszach — to jest liczba, z którą
    -- wolno porównywać `amount_received` z odczytu u dostawcy. Kwota
    -- z przeglądarki nie występuje w tym obiegu ani razu.
    'amount_grosze',
      v_order.total_rental_grosze + v_order.total_deposit_grosze + v_order.delivery_grosze,
    'currency', v_currency
  );
end;
$$;

revoke all on function app.get_public_order_payment(uuid, uuid, uuid) from public;
grant execute on function app.get_public_order_payment(uuid, uuid, uuid) to anon, authenticated;

comment on function app.get_public_order_payment(uuid, uuid, uuid) is
  'Stan płatności zamówienia storefrontu dla strony powrotu z płatności (Z3, ADR-066). Odpowiedź pochodzi Z BAZY — z tego, co zapisał webhook Z4 po odczycie — a nie z parametrów URL ani z wyniku confirmPayment() w przeglądarce (ADR-049). Bramkowana checkout_log_tokenem z 0021; NULL przy braku dopasowania (wygasłe ciasteczko/cudzy link to stan normalny, nie awaria). Zwraca też sumę zamówienia w groszach policzoną przez serwer — jedyną liczbę, z którą wolno porównywać amount_received u dostawcy. STABLE, SECURITY DEFINER.';

-- ---------------------------------------------------------------------
-- 6. app.get_public_payment_account — konto najemcy dla serwera storefrontu
-- ---------------------------------------------------------------------
--
-- Storefront jest anonem, a `payment_accounts` (0028) daje odczyt wyłącznie
-- członkom tenanta — słusznie. Do utworzenia płatności serwer storefrontu
-- potrzebuje jednak jednej wartości: identyfikatora konta, na którym ma
-- powstać obciążenie.
--
-- ZWRACA WYŁĄCZNIE IDENTYFIKATOR. Kolumny `charges_enabled` / `payouts_enabled`
-- / `requirements_due` NIE WYCHODZĄ tą drogą i to jest decyzja, nie
-- oszczędność: gdyby wychodziły, pierwszy wołający oparłby na nich decyzję
-- o pobraniu pieniędzy — a one są kopią prezentacyjną sprzed nieznanego czasu
-- (0028, ADR-049). Nie ma ich w wyniku, więc nie ma czym się skusić; gotowość
-- konta stwierdza wyłącznie odczyt u dostawcy, wykonany przez serwer tuż
-- przed utworzeniem płatności.

create or replace function app.get_public_payment_account(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select pa.provider_account_id
  from public.payment_accounts pa
  join public.tenants t on t.id = pa.tenant_id
  where pa.tenant_id = p_tenant_id
    and pa.provider = 'stripe'
    and t.status in ('trialing', 'active');
$$;

revoke all on function app.get_public_payment_account(uuid) from public;
grant execute on function app.get_public_payment_account(uuid) to anon, authenticated;

comment on function app.get_public_payment_account(uuid) is
  'Identyfikator konta najemcy u dostawcy płatności dla serwera storefrontu (Z3, ADR-066) — anon nie ma odczytu payment_accounts (0028). Zwraca WYŁĄCZNIE provider_account_id: kolumny gotowości są kopią prezentacyjną i nie wychodzą tą drogą, żeby nie dało się oprzeć na nich decyzji o pobraniu środków (ADR-049 — gotowość stwierdza odczyt u dostawcy). NULL dla najemcy bez konta i dla sklepu nieaktywnego. STABLE, SECURITY DEFINER.';
