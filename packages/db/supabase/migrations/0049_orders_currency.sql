-- 0049_orders_currency.sql
-- K3 (plan v3 §4, ADR-103): waluta staje się DANĄ ZAMÓWIENIA, utrwalaną
-- w chwili złożenia — a przestaje być atrybutem najemcy doklejanym przy
-- każdym odczycie.
--
-- STAN PRZED: orders nie ma waluty. Każdy konsument kwot zamówienia
-- (payload checkoutu, strona płatności → PaymentIntent, ekrany panelu,
-- maile, PDF umowy) czytał tenant_settings key='currency' W CHWILI ODCZYTU
-- (coalesce z fallbackiem 'PLN', wklejony w 0020/0021/0029/0040/0041).
-- Skutek: zmiana ustawienia najemcy przepisywała WSTECZNIE znaczenie kwot
-- wszystkich istniejących zamówień — kolumny _grosze mówią „ile jednostek
-- podrzędnych", a waluta mówi „czego"; podmiana waluty bez przeliczenia
-- kwot to podmiana ceny umowy po fakcie. Audyt E2E 2026-08-07: „tani szew
-- teraz, drogi beton później".
--
-- STAN PO: orders.currency NOT NULL + CHECK (lustro plans.currency z 0005:
-- UPPERCASE, podzbiór SUPPORTED_CURRENCIES z @avably/core). Wartość nadaje
-- trigger BEFORE INSERT z ustawień najemcy — wzorzec identyczny jak
-- numeracja (0007): wypełnij, gdy wstawiający nie podał; podana wprost
-- (import z innego systemu) zostaje. Po narodzinach waluta jest NIEZMIENNA
-- (bramka app.orders_write_gate). Konsumenci czytają ODTĄD kolumnę;
-- ustawienie najemcy pozostaje źródłem WYŁĄCZNIE dla cennika sklepu
-- (get_public_catalog) i dla zamówień przyszłych.
--
-- DLACZEGO TRIGGER, A NIE ZAPIS W OBU RPC:
--   * writerów orders jest więcej niż dwa RPC (fabryki macierzy RLS, seed
--     e2e, przyszły import) — trigger obejmuje KAŻDY INSERT, więc kontrakt
--     „zamówienie rodzi się z walutą" jest niezmiennikiem tabeli, nie
--     obietnicą dwóch funkcji;
--   * to jest dokładnie wzorzec order_number: wartość nadawana przy
--     narodzinach, której brak w INSERT nie jest błędem wołającego;
--   * app.create_order (0044) nie wymaga przez to redefinicji — panel
--     czyta wiersze wprost, a wstawianie przechodzi przez trigger.
--
-- BACKFILL: istniejące wiersze dostają DZISIEJSZY efektywny odczyt — tę
-- samą wartość, którą każdy konsument zobaczyłby dziś przy późnym wiązaniu
-- (coalesce po tenant_settings z fallbackiem 'PLN'). To utrwalenie stanu
-- obserwowalnego, nie rekonstrukcja historii: waluta obowiązująca w chwili
-- złożenia starych zamówień nie jest nigdzie zapisana, więc jest
-- nieodtwarzalna. Fallback 'PLN' jest osiągalny, bo klucz 'currency' w
-- tenant_settings może nie istnieć (tabela klucz→wartość; ustawienie nie ma
-- dziś writera w UI) — dokładnie wtedy działał dotychczasowy fallback
-- odczytów.
--
-- Bez nowych tabel i bez zmian polityk RLS: kolumna dziedziczy polityki
-- orders (macierz izolacji od 0007). Fabryka orders w seed-tenants.ts nie
-- wymaga zmiany — trigger wypełnia walutę, a przy cross-tenant INSERT
-- niczego nie rzuca (odmowę 42501 wystawia polityka WITH CHECK, jak przy
-- numeracji; lekcja 0043: trigger nie może zabierać 42501).

-- === BEGIN PROD MIGRATION 0049 ===

-- ---------------------------------------------------------------------
-- 1. Kolumna + backfill + niezmienniki
-- ---------------------------------------------------------------------

-- Najpierw NULLABLE: NOT NULL przed backfillem odrzuciłby ALTER na
-- niepustej tabeli.
alter table public.orders add column currency text;

-- Utrwalenie dzisiejszego efektywnego odczytu (nagłówek). Wyrażenie jest
-- DOSŁOWNIE tym samym coalesce, którym czytały 0020/0029/0041 — walidacja
-- kształtu (string, wartość z listy) chroni przed śmieciem w ustawieniu.
update public.orders o
set currency = coalesce(
  (
    select s.value #>> '{}'
    from public.tenant_settings s
    where s.tenant_id = o.tenant_id
      and s.key = 'currency'
      and jsonb_typeof(s.value) = 'string'
      and (s.value #>> '{}') in ('PLN', 'EUR', 'USD')
  ),
  'PLN'
)
where o.currency is null;

alter table public.orders alter column currency set not null;

-- Lustro CHECK-a plans.currency (0005): text + CHECK zamiast enuma
-- (konwencja 0001/0005/0007 — rozszerzenie listy jest zwykłą migracją).
-- UPPERCASE to konwencja repo (plans.currency, walidacje odczytów RPC,
-- CurrencyCode w @avably/core); małe litery żyją WYŁĄCZNIE na granicy
-- Stripe (adapter robi lowercase przy wywołaniu — packages/core stripe).
alter table public.orders add constraint orders_currency_check
  check (currency in ('PLN', 'EUR', 'USD'));

comment on column public.orders.currency is
  'Waluta zamówienia (ISO 4217, podzbiór SUPPORTED_CURRENCIES z @avably/core), utrwalona W CHWILI ZŁOŻENIA z tenant_settings key=''currency'' przez trigger orders_persist_currency (ADR-103). Wszystkie kolumny _grosze tego wiersza wyrażają kwoty w jednostkach podrzędnych TEJ waluty. Niezmienna po utworzeniu (app.orders_write_gate). Zmiana ustawienia najemcy dotyczy wyłącznie zamówień PRZYSZŁYCH.';

-- Komentarze kwot przestają wskazywać plans.currency (0005) — plans to
-- cennik PLATFORMY (abonament najemcy), a kwoty zamówienia są pieniędzmi
-- najemcy od jego klienta. Od 0049 walutę zamówienia mówi jego kolumna.
comment on column public.orders.total_rental_grosze is
  'Suma pozycji najmu w groszach — denormalizacja utrwalająca uzgodnioną cenę wobec późniejszych zmian cennika. Waluta: orders.currency (0049).';
comment on column public.orders.delivery_grosze is
  'Koszt dostawy w groszach (ADR-030) — denormalizacja utrwalająca uzgodniony koszt wobec późniejszych zmian cennika (tenant_settings.delivery_pricing). Waluta: orders.currency (0049).';

-- ---------------------------------------------------------------------
-- 2. Trigger: waluta nadawana przy narodzinach (wzorzec numeracji z 0007)
-- ---------------------------------------------------------------------
--
-- SECURITY DEFINER z tego samego powodu co app.generate_order_number:
-- wartość NIE MOŻE zależeć od tego, co widzi wywołujący. Anonimowy checkout
-- (SECURITY DEFINER) i członek panelu (SECURITY INVOKER przez create_order)
-- mają dostać tę samą walutę z tych samych ustawień; RLS tenant_settings
-- nie może tego wyniku filtrować.
--
-- NIGDY NIE RZUCA: śmieciowe ustawienie spada na 'PLN' (jak we wszystkich
-- dotychczasowych odczytach), a brak wiersza rodzica nie jest sprawą tego
-- triggera — odmowę cross-tenant wystawia polityka WITH CHECK (42501),
-- której triggerowi nie wolno uprzedzić własnym wyjątkiem (lekcja 0043).
--
-- Kolejność BEFORE INSERT (alfabetyczna): orders_generate_order_number →
-- orders_persist_currency → orders_write_gate. Numeracja i waluta nie
-- dzielą żadnej kolumny, więc kolejność między nimi jest bez znaczenia;
-- bramka zapisu widzi komplet. Semantyka błędów numeracji (P0014, advisory
-- lock) i bramek (23514 przed 23505 unikatu) pozostaje NIETKNIĘTA — ten
-- trigger nie dokłada żadnej ścieżki wyjątku.
--
-- search_path przypięty (wzorzec 0002/0007): SECURITY DEFINER bez
-- przypięcia wykonywałby nieskwalifikowane nazwy z uprawnieniami
-- właściciela funkcji.
create or replace function app.orders_persist_currency() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
begin
  -- Waluta podana wprost (import, migracja danych) zostaje nietknięta —
  -- kształt pilnuje CHECK orders_currency_check, jak przy order_number.
  if new.currency is not null then
    return new;
  end if;

  select coalesce(
    (
      select s.value #>> '{}'
      from public.tenant_settings s
      where s.tenant_id = new.tenant_id
        and s.key = 'currency'
        and jsonb_typeof(s.value) = 'string'
        and (s.value #>> '{}') in ('PLN', 'EUR', 'USD')
    ),
    'PLN'
  ) into new.currency;

  return new;
end;
$$;

comment on function app.orders_persist_currency() is
  'Trigger BEFORE INSERT na public.orders: utrwala walutę zamówienia z tenant_settings key=''currency'' (fallback PLN) W CHWILI WSTAWIENIA, gdy wstawiający jej nie podał (ADR-103). Wzorzec app.generate_order_number. Nigdy nie rzuca — śmieć w ustawieniu spada na PLN, a odmowy RLS pozostają przy politykach.';

create trigger orders_persist_currency
  before insert on public.orders
  for each row execute function app.orders_persist_currency();

-- ---------------------------------------------------------------------
-- 3. app.orders_write_gate — redefinicja z 0030: waluta niezmienna
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0030 + jeden blok) — bo `create or
-- replace` nadpisuje także atrybuty funkcji; okrojona kopia zdjęłaby po
-- cichu logikę order_status, niezmienności identyfikatora płatności, reguł
-- writera stripe, dat i rejestru kaucji. Zmiana względem 0030 oznaczona
-- [0049]; reszta ciała jest dosłowna.

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
    -- Zbiór dopuszczalny przy narodzinach BEZ ZMIAN względem 0015/0027/0029:
    -- payment_failed przy INSERT zakłada nieudaną próbę, której nie było,
    -- a stan rozliczeniowy zakłada historię, której nie ma.
    if new.payment_status not in ('unpaid', 'pending', 'paid', 'manual', 'completed') then
      raise exception
        'Zamówienie może powstać wyłącznie w otwartym statusie płatności (otrzymano %).',
        new.payment_status
        using errcode = '23514';
    end if;

    -- [0030] Narodziny w obiegu stripe od razu w `paid` byłyby obejściem
    -- bramki writera w JEDNYM kroku: zamówienie nie „przechodzi" wtedy
    -- w paid, tylko się w nim rodzi, więc blok przejść niżej nigdy go nie
    -- ogląda. `app.public_checkout` zakłada zamówienia w `unpaid`, więc
    -- ta reguła nie odbiera niczego żadnej istniejącej ścieżce.
    if new.payment_provider = 'stripe'
       and new.payment_status = 'paid'
       and not app.is_settlement_writer()
    then
      raise exception
        'Zamówienie w obiegu stripe nie może powstać jako opłacone — status paid ustawia wyłącznie handler webhooka (service_role), rola % nie ma tego prawa.',
        current_user
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

  -- [0049] Waluta zamówienia jest NIEZMIENNA od narodzin (ADR-103) — bez
  -- wyjątku dla service_role: kolumny _grosze wyrażają kwoty w TEJ walucie,
  -- więc podmiana waluty przepisywałaby znaczenie wszystkich kwot wiersza
  -- bez zmiany choćby jednej liczby. Kolumna NOT NULL, więc — inaczej niż
  -- przy identyfikatorze płatności — nie ma legalnego przejścia z pustki;
  -- każda różnica jest odmową.
  if new.currency is distinct from old.currency then
    raise exception
      'Waluty zamówienia nie można zmienić po jego utworzeniu.'
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

    -- [0030] KTO wykonuje przejście — pytanie ROZŁĄCZNE z mapą wyżej.
    --
    -- `paid` i `payment_failed` to jedyne dwa stany osi, o których nie da
    -- się orzec bez pytania dostawcy o pieniądze; oba są w obiegu online
    -- wynikiem ODCZYTU (ADR-049), a odczyt robi handler webhooka. Reszta
    -- osi zostaje otwarta dla członka także w obiegu stripe: `pending`
    -- ustawia anonowa ścieżka checkoutu (0029), `cancelled` i rozliczenie
    -- kaucji to decyzje operatora, a nie twierdzenia o wpłacie.
    --
    -- Reżim `manual` nie jest tu wymieniony i to jest cała jego ochrona:
    -- swoboda operatorska ADR-035 zostaje nietknięta.
    if new.payment_provider = 'stripe'
       and new.payment_status in ('paid', 'payment_failed')
       and not app.is_settlement_writer()
    then
      raise exception
        'Status płatności % w obiegu stripe ustawia wyłącznie handler webhooka (service_role) po odczycie u dostawcy — rola % nie ma tego prawa.',
        new.payment_status, current_user
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
  'Bramka zapisu orders (0010 + 0015 + 0027 + 0029 + 0030 + 0049): INSERT tylko pending i w otwartym payment_status; mapa przejść order_status (ADR-025) i payment_status per reżim payment_provider (ADR-064, 23514); reżim nie cofa się ze stripe na manual; identyfikator płatności niezmienny po ustawieniu (ADR-066); [0049] waluta zamówienia niezmienna po utworzeniu (ADR-103, 23514); [0030] w obiegu stripe przejście DO paid/payment_failed wolno wykonać wyłącznie roli service_role (ADR-067, 23514) — mapa mówi CZY, ta bramka mówi KTO; anulowanie blokowane przy pobranej płatności (23001); wejście w deposit_refunded wymaga pokrycia w rejestrze kaucji (23514); re-walidacja terminu (23P01); updated_at.';

-- ---------------------------------------------------------------------
-- 4. app.public_checkout — redefinicja z 0041: waluta z WSTAWIONEGO wiersza
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0041, wzorzec 0021/0029/0040/0041).
-- Różnice merytoryczne są dokładnie dwie, obie oznaczone [0049]:
--   * v_currency przychodzi z RETURNING wstawionego zamówienia (wartość
--     utrwalona przez trigger), a nie z ponownego odczytu ustawień — payload
--     checkoutu (potwierdzenie + maile) mówi walutą ZAMÓWIENIA, więc nie ma
--     okna, w którym równoległa zmiana ustawienia rozjechałaby payload
--     z wierszem (READ COMMITTED: nowy snapshot per zapytanie),
--   * osobny SELECT coalesce po tenant_settings znika — to było ostatnie
--     miejsce późnego wiązania w torze checkoutu.

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
  -- [R6b] Telefon wejścia w normalizacji app.normalize_phone (same cyfry),
  -- do dopasowania przeciw ban-liście (ADR-080).
  v_phone_normalized text;
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
    pickup_location_id, total_rental_grosze, total_deposit_grosze,
    delivery_grosze, terms_accepted_at, terms_version, source, checkout_log_token,
    -- [0029] Metoda to DANE ZAMÓWIENIA, nie stan sesji (ADR-066), a reżim
    -- jedzie z nią od narodzin. `payment_status` zostaje domyślne `unpaid`:
    -- zamówienie rodzi się nieopłacone także wtedy, gdy klient za chwilę
    -- zapłaci kartą — `paid` w tej migracji nie występuje ani razu.
    payment_method, payment_provider
  )
  values (
    p_tenant_id, v_customer_id, p_start_date, p_end_date, p_delivery_method,
    v_pickup,
    v_total_rental, v_total_deposit, v_delivery, now(), btrim(p_terms_version),
    'storefront', v_log_token, v_payment_method, v_payment_provider
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
-- 5. app.get_public_order_payment — redefinicja z 0029: waluta z zamówienia
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0029). Jedyna różnica merytoryczna,
-- oznaczona [0049]: currency w odpowiedzi pochodzi z wiersza zamówienia,
-- nie z tenant_settings. TO JEST odpowiedź, z której serwer storefrontu
-- bierze kwotę I WALUTĘ PaymentIntentu oraz którą renderuje strona powrotu
-- z płatności — po 0049 obie mówią walutą, w której zamówienie POWSTAŁO.

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
begin
  -- [0049] currency prosto z wiersza — waluta, w której zamówienie POWSTAŁO.
  select o.order_number, o.order_status, o.payment_status, o.payment_method,
         o.payment_provider, o.provider_payment_intent_id,
         o.total_rental_grosze, o.total_deposit_grosze, o.delivery_grosze,
         o.currency
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
    'currency', v_order.currency
  );
end;
$$;

revoke all on function app.get_public_order_payment(uuid, uuid, uuid) from public;
grant execute on function app.get_public_order_payment(uuid, uuid, uuid) to anon, authenticated;

comment on function app.get_public_order_payment(uuid, uuid, uuid) is
  'Stan płatności zamówienia storefrontu dla strony powrotu z płatności (Z3, ADR-066). Odpowiedź pochodzi Z BAZY — z tego, co zapisał webhook Z4 po odczycie — a nie z parametrów URL ani z wyniku confirmPayment() w przeglądarce (ADR-049). Bramkowana checkout_log_tokenem z 0021; NULL przy braku dopasowania (wygasłe ciasteczko/cudzy link to stan normalny, nie awaria). Zwraca też sumę zamówienia w groszach policzoną przez serwer — jedyną liczbę, z którą wolno porównywać amount_received u dostawcy — oraz [0049] walutę Z WIERSZA ZAMÓWIENIA (orders.currency, ADR-103): z tej pary serwer storefrontu tworzy PaymentIntent, więc obie mówią stanem, w którym zamówienie POWSTAŁO. STABLE, SECURITY DEFINER.';

-- === END PROD MIGRATION 0049 ===
