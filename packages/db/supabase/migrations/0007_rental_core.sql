-- 0007_rental_core.sql
-- Model danych rdzenia wynajmu (Faza 1, Zadanie 1).
--
-- Zawartość:
--   1. app.is_tenant_owner() — bramka roli ownera (wyciągnięta z 0001),
--   2. tabele katalogu: products, product_units, pricing_tiers,
--      pickup_locations,
--   3. customers,
--   4. orders + order_items + deposit_events,
--   5. tenant_settings (konfiguracja tenanta klucz→jsonb),
--   6. app.generate_order_number() + trigger — numeracja {PREFIX}-{YYYY}-{NNN}
--      niezależna per tenant,
--   7. RLS + GRANT-y dla wszystkich dziewięciu tabel.
--
-- KONWENCJE UTRZYMANE Z FAZY 0 (patrz docs/konwencje-migracji.md):
--   * każda tabela per-tenant: `tenant_id uuid not null references
--     public.tenants(id) on delete cascade` + indeks zaczynający się od
--     tenant_id + RLS w tej samej migracji (0001),
--   * zbiory wartości to `text` + CHECK, nie natywne enumy (0001, 0005, 0006) —
--     rozszerzenie listy jest zwykłą migracją bez ALTER TYPE,
--   * `revoke all ... from anon, authenticated` PRZED grantami na KAŻDEJ nowej
--     tabeli (0006) — Supabase ma w schemacie public `alter default privileges
--     ... grant all on tables to anon, authenticated`, więc nowa tabela startuje
--     z kompletem uprawnień dla obu ról publicznych, w tym z TRUNCATE, które
--     NIE PODLEGA politykom RLS,
--   * funkcje bramkujące/wyzwalacze z przypiętym search_path (0002).
--
-- DECYZJE JEDNOSTEK I ZAKRESÓW (wiążące dla silnika dostępności — Zadanie 2+):
--   * daty najmu to DATE (doba, nie moment) i zakres jest INCLUSIVE: najem
--     start_date = end_date = 2026-07-20 to jeden dzień najmu, a nie zero.
--     Kolizję dwóch najmów liczy się więc `start_date <= b.end_date and
--     end_date >= b.start_date` (nie half-open), i tak samo działają bufory,
--   * kwoty to grosze (jednostka podrzędna) w kolumnach z sufiksem _grosze —
--     nigdy typ zmiennoprzecinkowy. Waluty w tych tabelach NIE MA: jedyne
--     źródło waluty to plans.currency (0005) i duplikat rozjechałby się z nim.

-- ---------------------------------------------------------------------
-- 1. app.is_tenant_owner() — bramka roli ownera
-- ---------------------------------------------------------------------

-- 0001 powtarza ten sam `exists (select 1 from public.members ...)` inline w
-- każdej polityce zastrzeżonej dla ownera. Przy dziewięciu tabelach rdzenia
-- byłoby to kilkanaście kopii jednego warunku — a rozjazd między kopiami to
-- cicha dziura w uprawnieniach. Warunek jest więc nazwany raz, tak jak
-- app.tenant_id() i app.is_superadmin() z 0001.
--
-- SECURITY INVOKER (domyślne, zapisane jawnie): funkcja czyta public.members
-- uprawnieniami wywołującego, przez politykę tenant_select z 0001. Członek
-- widzi członków własnego tenanta, więc odpowiedź jest prawdziwa — i nie
-- daje wglądu w cudze wiersze, gdyby funkcję wywołać wprost.
--
-- search_path przypięty do pg_catalog (wzorzec 0002): ciało odwołuje się
-- wyłącznie do obiektów jawnie skwalifikowanych (public.members, auth.uid(),
-- app.tenant_id()) i wbudowanych operatorów, więc przypięcie nie zmienia
-- zachowania, a odbiera sesji możliwość podstawienia własnych obiektów pod
-- nazwy nieskwalifikowane.
create or replace function app.is_tenant_owner() returns boolean
language sql stable security invoker as $$
  select exists (
    select 1
    from public.members m
    where m.tenant_id = app.tenant_id()
      and m.user_id = auth.uid()
      and m.role = 'owner'
  )
$$;

alter function app.is_tenant_owner() set search_path = pg_catalog;

grant execute on function app.is_tenant_owner() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Katalog: products, product_units, pricing_tiers, pickup_locations
-- ---------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  description text,

  -- Cena bazowa za dobę. CHECK > 0, a nie >= 0: pozycja katalogu za darmo
  -- jest z dużym prawdopodobieństwem pomyłką w imporcie, a nie decyzją
  -- biznesową — cennik promocyjny robi się progiem w pricing_tiers.
  base_price_day_grosze int not null check (base_price_day_grosze > 0),

  -- Kaucja 0 jest legalna (nie każdy sprzęt jej wymaga), stąd >= 0.
  deposit_grosze int not null default 0 check (deposit_grosze >= 0),

  -- Mnożnik automatycznej podwyżki ceny (sterowany przez silnik wyceny —
  -- Zadanie 2). 1.0 = brak podwyżki; numeric, nie float, bo mnoży kwoty.
  auto_increment_multiplier numeric not null default 1.0
    check (auto_increment_multiplier > 0),

  -- Bufory serwisowe w dobach PRZED i PO najmie: egzemplarz zajęty w tych
  -- dniach nie jest dostępny, mimo że najem już się skończył. 0 jest legalne
  -- (sprzęt wydawany z ręki do ręki).
  buffer_before_days int not null default 1 check (buffer_before_days >= 0),
  buffer_after_days int not null default 1 check (buffer_after_days >= 0),

  active boolean not null default true,
  created_at timestamptz not null default now(),

  -- Cel klucza kandydującego (tu i w każdej tabeli-rodzicu niżej): pozwala
  -- dzieciom wskazywać rodzica kluczem ZŁOŻONYM (tenant_id, id) zamiast
  -- samym id. Patrz komentarz przy order_items — to jest bramka spójności
  -- tenanta, której RLS nie zapewnia.
  constraint products_tenant_id_key unique (tenant_id, id)
);

create index products_tenant_id_idx on public.products (tenant_id);
-- Listing katalogu w panelu i storefroncie filtruje po aktywności.
create index products_tenant_active_idx on public.products (tenant_id, active);

comment on table public.products is
  'Pozycja katalogu wynajmu (model sprzętu). Fizyczne sztuki to public.product_units.';
comment on column public.products.auto_increment_multiplier is
  'Mnożnik automatycznej podwyżki ceny stosowany przez silnik wyceny. 1.0 = brak podwyżki.';
comment on column public.products.buffer_before_days is
  'Bufor serwisowy w dobach PRZED najmem — dni blokowane na egzemplarzu mimo braku najmu.';
comment on column public.products.buffer_after_days is
  'Bufor serwisowy w dobach PO najmie — dni blokowane na egzemplarzu mimo braku najmu.';

-- --- product_units: fizyczne egzemplarze ---

create table public.product_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  serial_number text check (serial_number is null or length(btrim(serial_number)) between 1 and 100),

  -- Okno niedostępności (serwis, naprawa, wypożyczenie poza systemem).
  -- Zakres INCLUSIVE, jak daty najmu.
  unavailable_from date,
  unavailable_to date,
  unavailable_reason text,

  created_at timestamptz not null default now(),

  constraint product_units_tenant_id_key unique (tenant_id, id),

  constraint product_units_product_fk
    foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete cascade,

  -- Okno niedostępności jest albo pełne, albo go nie ma. Sam `from` bez `to`
  -- to niedostępność bez końca, a sam `to` bez `from` nie znaczy nic —
  -- w obu przypadkach silnik dostępności musiałby ZGADYWAĆ intencję.
  constraint product_units_unavailable_range_complete check (
    (unavailable_from is null) = (unavailable_to is null)
  ),

  -- Zakres inclusive, więc from = to (jednodniowy serwis) jest poprawne.
  constraint product_units_unavailable_range_ordered check (
    unavailable_to is null or unavailable_to >= unavailable_from
  )
);

create index product_units_tenant_product_idx on public.product_units (tenant_id, product_id);

-- Numer seryjny jest unikalny w obrębie produktu TENANTA, ale wyłącznie gdy
-- istnieje: indeks częściowy, bo NULL-e nie kolidują ze sobą, a egzemplarze
-- bez numeru (sprzęt nieoznaczony) są normalne i musi ich być wiele.
create unique index product_units_serial_key
  on public.product_units (tenant_id, product_id, serial_number)
  where serial_number is not null;

comment on table public.product_units is
  'Fizyczny egzemplarz produktu — jednostka, którą realnie wydaje się najemcy.';
comment on column public.product_units.unavailable_from is
  'Początek okna niedostępności (serwis/naprawa). Zakres INCLUSIVE; komplet z unavailable_to wymuszony CHECK-iem.';

-- --- pricing_tiers: progi cenowe ---

create table public.pricing_tiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  tier_days int not null check (tier_days > 0),

  -- SEMANTYKA MNOŻNIKA — czytać uważnie, to jest źródło pomyłek o rząd
  -- wielkości. `multiplier` to CENA CAŁKOWITA progu wyrażona w krotności
  -- base_price_day_grosze, a NIE mnożnik ceny dziennej.
  --
  --   tier_days = 7, multiplier = 6.5, base_price_day_grosze = 10000 (100 zł)
  --     → najem 7-dniowy kosztuje 6.5 × 100 zł = 650 zł ŁĄCZNIE
  --       (a nie 7 × 6.5 × 100 zł = 4550 zł).
  --
  -- Stąd multiplier < tier_days oznacza rabat za dłuższy najem — i to jest
  -- typowy przypadek użycia tej tabeli. Odczyt „mnożnik dzienny" dałby cenę
  -- ~7× za wysoką i przeszedłby wszystkie CHECK-i, dlatego semantyka jest
  -- opisana tu, w schemacie, a nie tylko w kodzie silnika wyceny.
  multiplier numeric not null check (multiplier > 0),

  label text,
  sort_order int not null default 0,

  constraint pricing_tiers_product_fk
    foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete cascade,

  -- Dwa progi o tej samej długości dla jednego produktu to niejednoznaczna
  -- wycena — wynik zależałby od kolejności odczytu.
  constraint pricing_tiers_days_key unique (tenant_id, product_id, tier_days)
);

create index pricing_tiers_tenant_product_idx
  on public.pricing_tiers (tenant_id, product_id, tier_days);

comment on table public.pricing_tiers is
  'Progi cenowe produktu (rabat za dłuższy najem).';
comment on column public.pricing_tiers.multiplier is
  'CENA CAŁKOWITA progu w krotności base_price_day_grosze — NIE mnożnik dzienny. tier_days=7, multiplier=6.5, base=100 zł → 650 zł za 7 dni.';
comment on column public.pricing_tiers.tier_days is
  'Długość progu w dobach (zakres najmu liczony INCLUSIVE).';

-- --- pickup_locations: punkty odbioru ---

create table public.pickup_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  address_street text,
  address_zip text,
  address_city text,
  active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint pickup_locations_tenant_id_key unique (tenant_id, id)
);

create index pickup_locations_tenant_id_idx on public.pickup_locations (tenant_id);

comment on table public.pickup_locations is
  'Punkt odbioru osobistego. Tenant ma ich WIELE — punkt jest wyborem przy zamówieniu, nie stałą tenanta.';

-- ---------------------------------------------------------------------
-- 3. customers
-- ---------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null check (length(email) between 3 and 320),
  full_name text,
  phone text,
  company_name text,
  nip text,
  address_street text,
  address_zip text,
  address_city text,
  created_at timestamptz not null default now(),

  constraint customers_tenant_id_key unique (tenant_id, id)
);

create index customers_tenant_id_idx on public.customers (tenant_id);

-- Unikalność e-maila jest PER TENANT i case-insensitive.
--
-- To jest świadome zerwanie ze wzorcem jednonajemcowym, gdzie e-mail klienta
-- bywa unikalny GLOBALNIE. W systemie wielonajemcowym globalny unique na
-- e-mailu znaczy, że pierwszy tenant, który doda klienta jan@example.com,
-- blokuje go wszystkim pozostałym — a klienci różnych wypożyczalni nie mają
-- ze sobą nic wspólnego. Dodatkowo taki indeks WYCIEKA informację: kolizja
-- 23505 przy dodawaniu klienta ujawnia, że ktoś inny już go obsługuje.
create unique index customers_tenant_email_key
  on public.customers (tenant_id, lower(email));

comment on table public.customers is
  'Klient wypożyczalni. Unikalność e-maila PER TENANT (customers_tenant_email_key) — klienci różnych najemców są niezależni.';

-- ---------------------------------------------------------------------
-- 4. orders, order_items, deposit_events
-- ---------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Nadawany przez trigger orders_generate_order_number (sekcja 6), gdy
  -- wstawiany wiersz go nie niesie. CHECK formatu nie jest kosmetyką:
  -- generator wylicza kolejny numer, rozbierając istniejące numery przez
  -- split_part() po '-', więc kształt musi być niezmiennikiem tabeli, a nie
  -- obietnicą triggera. Prefiks bez '-' (patrz walidacja w generatorze)
  -- gwarantuje dokładnie trzy człony.
  order_number text not null
    check (order_number ~ '^[A-Z0-9]{2,10}-[0-9]{4}-[0-9]{3,}$'),

  customer_id uuid not null,

  -- Doby, nie momenty; zakres INCLUSIVE (start = end → najem jednodniowy).
  start_date date not null,
  end_date date not null,

  order_status text not null default 'pending'
    check (order_status in ('pending','reserved','ready_for_pickup','picked_up','returned','cancelled')),

  -- Oś NIEZALEŻNA od order_status: zamówienie wydane (picked_up) może być
  -- nieopłacone, a opłacone może czekać na odbiór. Sklejenie obu osi w jedną
  -- kolumnę wymusiłoby stany-hybrydy typu 'picked_up_unpaid'.
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','pending','paid','manual','completed','deposit_refunded','refunded','cancelled')),

  delivery_method text not null
    check (delivery_method in ('pickup','courier','parcel_locker','own_delivery')),

  pickup_location_id uuid,

  -- Sumy denormalizowane z order_items: kwota, na którą umówiono się z
  -- klientem, ma przetrwać późniejszą zmianę cennika w katalogu. 0 jest
  -- legalne (zamówienie w budowie, kaucja niepobierana).
  total_rental_grosze int not null default 0 check (total_rental_grosze >= 0),
  total_deposit_grosze int not null default 0 check (total_deposit_grosze >= 0),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_tenant_id_key unique (tenant_id, id),

  -- NO ACTION (domyślne), nie RESTRICT — i to jest różnica praktyczna, nie
  -- stylistyczna. RESTRICT sprawdza się NATYCHMIAST, więc kasowanie tenanta
  -- (kaskada z public.tenants na customers i orders jednocześnie) mogłoby
  -- wybuchnąć zależnie od kolejności kaskad. NO ACTION sprawdza się na końcu
  -- instrukcji, gdy kaskada usunęła już oba wiersze — a pojedynczy DELETE
  -- klienta z żywymi zamówieniami nadal jest odrzucany.
  constraint orders_customer_fk
    foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id),

  constraint orders_pickup_location_fk
    foreign key (tenant_id, pickup_location_id)
    references public.pickup_locations (tenant_id, id),

  -- Zakres inclusive: jednodniowy najem ma end_date = start_date.
  constraint orders_dates_ordered check (end_date >= start_date),

  -- Odbiór osobisty bez wskazanego punktu jest zamówieniem, którego nie da
  -- się zrealizować — nikt nie wie, gdzie klient ma przyjechać.
  --
  -- Zależność jest egzekwowana JEDNOSTRONNIE (wymagany przy 'pickup'),
  -- świadomie: punkt wskazany przy dostawie kurierskiej to informacja
  -- nadmiarowa, ale nie sprzeczna — magazyn, z którego jedzie paczka, bywa
  -- tym samym punktem. Zaostrzenie do „przy nie-pickup musi być NULL"
  -- wymagałoby decyzji o logistyce, która należy do Zadania 3.
  constraint orders_pickup_requires_location check (
    delivery_method <> 'pickup' or pickup_location_id is not null
  ),

  -- Siatka bezpieczeństwa numeracji, nie jej mechanizm — właściwą
  -- serializację robi advisory lock w app.generate_order_number().
  constraint orders_number_key unique (tenant_id, order_number)
);

create index orders_tenant_id_idx on public.orders (tenant_id);
-- Zapytanie silnika dostępności: „co koliduje z zakresem [od, do] u tenanta".
create index orders_tenant_dates_idx on public.orders (tenant_id, start_date, end_date);
create index orders_tenant_customer_idx on public.orders (tenant_id, customer_id);
create index orders_tenant_status_idx on public.orders (tenant_id, order_status);

comment on table public.orders is
  'Zamówienie najmu. Daty to doby (DATE), zakres INCLUSIVE. order_status i payment_status to osie niezależne.';
comment on column public.orders.order_number is
  'Numer {PREFIX}-{YYYY}-{NNN}, nadawany per tenant przez app.generate_order_number(). Unikalny w obrębie tenanta, NIE globalnie.';
comment on column public.orders.total_rental_grosze is
  'Suma pozycji najmu w groszach — denormalizacja utrwalająca uzgodnioną cenę wobec późniejszych zmian cennika. Waluta: plans.currency (0005).';

-- --- order_items ---

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  product_id uuid not null,

  -- Egzemplarz przypisywany PÓŹNIEJ niż powstaje pozycja: przy rezerwacji
  -- klient wybiera model, a konkretną sztukę wskazuje magazyn przy wydaniu.
  -- Stąd NULL, a nie sztuczny „egzemplarz nieokreślony".
  unit_id uuid,

  rental_grosze int not null check (rental_grosze >= 0),
  deposit_grosze int not null default 0 check (deposit_grosze >= 0),
  created_at timestamptz not null default now(),

  -- KLUCZE ZŁOŻONE (tenant_id, ...) — bramka spójności tenanta, której RLS
  -- NIE zapewnia. Zwykłe `references public.orders(id)` pozwoliłoby wstawić
  -- pozycję z własnym tenant_id, wskazującą na zamówienie CUDZEGO tenanta:
  -- polityki RLS sprawdzają wyłącznie tenant_id WSTAWIANEGO wiersza i taki
  -- INSERT przechodzi. Klucz złożony czyni ten wiersz niereprezentowalnym —
  -- baza odrzuca go niezależnie od polityk.
  constraint order_items_order_fk
    foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete cascade,

  -- NO ACTION (patrz uzasadnienie przy orders_customer_fk): produkt usuwany
  -- pojedynczo, gdy wisi na nim pozycja zamówienia, jest odrzucany; kasowanie
  -- tenanta przechodzi, bo sprawdzenie następuje na końcu instrukcji.
  constraint order_items_product_fk
    foreign key (tenant_id, product_id)
    references public.products (tenant_id, id),

  constraint order_items_unit_fk
    foreign key (tenant_id, unit_id)
    references public.product_units (tenant_id, id)
);

create index order_items_tenant_order_idx on public.order_items (tenant_id, order_id);
create index order_items_tenant_product_idx on public.order_items (tenant_id, product_id);
-- Silnik dostępności pyta „czy ten egzemplarz jest już na jakimś zamówieniu".
create index order_items_tenant_unit_idx on public.order_items (tenant_id, unit_id)
  where unit_id is not null;

comment on table public.order_items is
  'Pozycja zamówienia. unit_id NULL = egzemplarz jeszcze nieprzypisany (przypisanie następuje przy wydaniu).';

-- --- deposit_events ---

create table public.deposit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,

  kind text not null check (kind in ('collected','refunded','deducted')),

  -- Kwota jest zawsze DODATNIA, a kierunek niesie `kind`. Kwoty ujemne
  -- dawałyby dwa sposoby zapisu tego samego zdarzenia (refunded +100 vs
  -- collected -100) i każde sumowanie musiałoby znać oba.
  amount_grosze int not null check (amount_grosze > 0),

  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),

  constraint deposit_events_order_fk
    foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete cascade,

  -- Potrącenie z kaucji to zabranie pieniędzy klientowi — bez powodu jest
  -- nie do obrony w sporze. Zwrot i pobranie powodu nie potrzebują.
  constraint deposit_events_deduction_requires_reason check (
    kind <> 'deducted' or (reason is not null and length(btrim(reason)) > 0)
  )
);

create index deposit_events_tenant_order_idx on public.deposit_events (tenant_id, order_id, created_at);

comment on table public.deposit_events is
  'REJESTR zdarzeń kaucji (append-only): pobranie, zwrot, potrącenie. Stan kaucji to suma zdarzeń, a nie kolumna statusowa — historia rozliczenia jest tu dowodem w sporze z klientem, więc nie może być nadpisywana. Niezmiennik sumy (zwroty + potrącenia <= pobrania) egzekwuje Zadanie 5; tutaj są wyłącznie CHECK-i wierszowe.';
comment on column public.deposit_events.created_by is
  'Użytkownik, który zarejestrował zdarzenie (auth.users.id). Bez FK — wiersz rejestru musi przetrwać usunięcie konta pracownika.';

-- ---------------------------------------------------------------------
-- 5. tenant_settings
-- ---------------------------------------------------------------------

-- Ustawienia jako WIERSZE (klucz→jsonb), nie kolumny na public.tenants.
-- Powód: każde nowe ustawienie produktowe byłoby inaczej migracją tabeli
-- tenants — a ta jest tabelą rdzenia platformy, którą czyta uwierzytelnianie,
-- panel superadmina i onboarding. Ustawienia najemcy zmieniają się w tempie
-- produktu, tenants nie ma się zmieniać w ogóle.
--
-- Uwaga na granicę: tu trafia konfiguracja WYNAJMU (prefiks numeracji, dalej
-- np. reguły zwrotów). Rzeczy, na których stoją bramki bezpieczeństwa i
-- rozliczenia (status, locale, plan), zostają kolumnami tenants/subscriptions
-- — CHECK na kolumnie jest mocniejszy niż walidacja jsonb.
create table public.tenant_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Klucz jest identyfikatorem, nie tekstem wolnym: bez CHECK-a wpisy
  -- „order_number_prefix" i „Order Number Prefix " byłyby dwoma ustawieniami,
  -- a odczyt trafiałby raz w jedno, raz w drugie.
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,63}$'),

  value jsonb not null,
  updated_at timestamptz not null default now(),

  primary key (tenant_id, key),

  -- Prefiks numeracji jest walidowany U ŹRÓDŁA, przy zapisie ustawienia.
  --
  -- Alternatywa (walidacja dopiero w generatorze numerów) przenosiłaby skutek
  -- pomyłki na inną, niezwiązaną operację: najemca wpisywałby zły prefiks w
  -- ustawieniach i dowiadywał się o tym dopiero przy próbie utworzenia
  -- ZAMÓWIENIA, w dodatku błędem, którego PostgREST nie umie przełożyć na nic
  -- czytelniejszego niż 500 „Something went wrong" (kody P0xxx z RAISE nie mają
  -- mapowania). CHECK odrzuca zapis natychmiast, standardowym 23514 i w tym
  -- miejscu, w którym użytkownik popełnia błąd.
  --
  -- jsonb_typeof pilnuje też KSZTAŁTU: 42 albo {"prefix":"SK"} pod tym kluczem
  -- to nie jest prefiks, a `value #>> '{}'` zwróciłoby dla obiektu NULL i
  -- generator po cichu wróciłby do 'AV'.
  --
  -- Małe litery są dozwolone w zapisie — generator normalizuje je do wielkich
  -- (upper), więc 'sk' i 'SK' to to samo ustawienie, a nie błąd do zgłoszenia.
  constraint tenant_settings_order_number_prefix_valid check (
    key <> 'order_number_prefix'
    or (jsonb_typeof(value) = 'string' and value #>> '{}' ~ '^[A-Za-z0-9]{2,10}$')
  )
);

comment on table public.tenant_settings is
  'Ustawienia tenanta (klucz→jsonb). Skalary zapisywane jako skalary JSON i czytane przez `value #>> ''{}''` — patrz app.generate_order_number().';
comment on column public.tenant_settings.key is
  'Identyfikator ustawienia (snake_case). Znane klucze: order_number_prefix (prefiks numeracji zamówień, 2-10 znaków [A-Z0-9]).';

-- ---------------------------------------------------------------------
-- 6. Numeracja zamówień per tenant
-- ---------------------------------------------------------------------
--
-- Format: {PREFIX}-{YYYY}-{NNN}, sekwencja niezależna dla każdej pary
-- (tenant, rok). Prefiks pochodzi z tenant_settings key='order_number_prefix',
-- domyślnie 'AV' — najemca ma numerować zamówienia SWOIM znakiem, bo numer
-- widzi jego klient na dokumentach.
--
-- MECHANIZM: advisory lock na (tenant_id, rok) + wyliczenie kolejnego numeru
-- z samych zamówień. Rozważana alternatywa: tabela liczników z
-- `update ... returning`.
--
-- Wybrano advisory lock, bo:
--   * licznik w tabeli to DRUGIE źródło prawdy o numerach obok samych
--     zamówień — a dwa źródła prawdy się rozjeżdżają (import zamówień,
--     ręczna korekta numeru, przywrócenie kopii częściowej). Po rozjeździe
--     licznik generuje numer, który już istnieje, i wykłada się na unikalności
--     bez ścieżki naprawy poza ręcznym ustawieniem licznika;
--   * licznik byłby DZIESIĄTĄ tabelą per-tenant — z własnym tenant_id, RLS,
--     politykami i wpisem w macierzy izolacji. To powierzchnia bezpieczeństwa
--     dodana wyłącznie po to, by trzymać liczbę, którą i tak da się policzyć;
--   * kolizja hasha (dwa tenanty na jednym locku) kosztuje WYŁĄCZNIE
--     współbieżność — dwa zamówienia poczekają na siebie. Nie kosztuje
--     poprawności, bo lock nie jest źródłem numeru, tylko serializacją.
--
-- Koszt świadomie przyjęty: numeracja tenanta jest szeregowana (jedno
-- zamówienie naraz per tenant, blokada trzymana do końca transakcji) i
-- max(...)+1 to odczyt tabeli, nie inkrement licznika. Przy wolumenach
-- wypożyczalni (dziesiątki zamówień dziennie) to nie jest wąskie gardło,
-- a odporność na rozjazd jest warta więcej niż stała-czasowa wydajność.
--
-- POPRAWNOŚĆ opiera się na READ COMMITTED (domyślny poziom izolacji
-- Postgresa/Supabase): transakcja czeka na zwolnienie locka, a po jego
-- zdobyciu jej NOWY snapshot (nowe zapytanie = nowy snapshot w READ
-- COMMITTED) widzi zamówienie zatwierdzone przez poprzednika. Lock jest
-- xact-scoped, więc zwalnia go COMMIT albo ROLLBACK — bez ścieżki wycieku
-- blokady. W REPEATABLE READ ten wzorzec dałby duplikat; wyłapałaby go
-- unikalność orders_number_key (błąd zamiast cichego dubla).
--
-- Numery po ROLLBACK-u nie tworzą dziur — kolejny numer liczy się z
-- zatwierdzonych wierszy, więc numer wycofanego zamówienia wraca do puli.
--
-- SECURITY DEFINER: numeracja NIE MOŻE zależeć od tego, ile wierszy widzi
-- wywołujący. Gdyby funkcja czytała orders jako invoker, polityka RLS
-- przefiltrowałaby wynik max(...) i wystarczyłby jeden wiersz niewidoczny dla
-- sesji, by wygenerować numer już istniejący. Definer czyta komplet zamówień
-- tenanta — a wywołujący i tak nie zobaczy cudzego numeru, bo INSERT z cudzym
-- tenant_id odrzuci polityka WITH CHECK (trigger BEFORE działa przed nią).
--
-- search_path przypięty (wzorzec 0002) — przy SECURITY DEFINER podstawienie
-- obiektów pod nieskwalifikowane nazwy oznaczałoby wykonanie ich z
-- uprawnieniami właściciela funkcji.
create or replace function app.generate_order_number() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_prefix text;
  v_year text;
  v_seq int;
begin
  -- Numer podany wprost (migracja danych, import z poprzedniego systemu)
  -- zostaje nietknięty. Kształt pilnuje CHECK tabeli, unikalność w obrębie
  -- tenanta — orders_number_key. Generator wchodzi tylko tam, gdzie numeru
  -- nie ma, bo nadpisywanie podanego numeru cicho zrywałoby ciągłość
  -- dokumentów najemcy.
  if new.order_number is not null then
    return new;
  end if;

  -- Rok wg strefy czasowej sesji bazodanowej (Supabase: UTC). Zamówienie
  -- utworzone 31 grudnia o 23:30 czasu lokalnego trafi do numeracji roku
  -- następnego — świadomie, bo alternatywa (strefa najemcy) czyni numer
  -- zależnym od ustawienia, które może się zmienić po fakcie.
  v_year := to_char(now(), 'YYYY');

  select s.value #>> '{}' into v_prefix
  from public.tenant_settings s
  where s.tenant_id = new.tenant_id
    and s.key = 'order_number_prefix';

  -- Brak ustawienia = 'AV' (marka produktu).
  v_prefix := upper(btrim(coalesce(v_prefix, 'AV')));

  -- OBRONA W GŁĄB, nie główna bramka: prefiksu pilnuje CHECK
  -- tenant_settings_order_number_prefix_valid, więc błędna wartość nie ma jak
  -- tu dotrzeć, dopóki ten CHECK stoi. Generator i tak sprawdza sam, bo
  -- składa z prefiksu ciąg, który MUSI przejść CHECK formatu na
  -- orders.order_number — poleganie na constraincie CUDZEJ tabeli byłoby
  -- założeniem, nie gwarancją. Fallback 'AV' celowo NIE jest cichym ratunkiem
  -- dla złej konfiguracji: pomyłka ma być głośna, a nie podmieniona na markę
  -- produktu na dokumentach najemcy.
  if v_prefix !~ '^[A-Z0-9]{2,10}$' then
    raise exception 'Nieprawidłowy prefiks numeracji zamówień: %. Dozwolone: 2-10 znaków A-Z lub 0-9 (ustawienie order_number_prefix).', v_prefix
      using errcode = 'P0014';
  end if;

  -- Serializacja numeracji W OBRĘBIE (tenant, rok). Lock zwalnia koniec
  -- transakcji. Klucz łączy oba wymiary, więc tenanty nie czekają na siebie
  -- nawzajem (poza kolizją hasha, która jest tylko kosztem wydajności).
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || v_year, 0));

  -- Kolejny numer z samych zamówień. split_part jest bezpieczne, bo CHECK
  -- orders.order_number gwarantuje dokładnie trzy człony rozdzielone '-'
  -- (prefiks nie zawiera '-' — pilnuje tego walidacja wyżej).
  select coalesce(max(split_part(o.order_number, '-', 3)::int), 0) + 1
    into v_seq
  from public.orders o
  where o.tenant_id = new.tenant_id
    and split_part(o.order_number, '-', 2) = v_year;

  -- Trzy cyfry z zerami wiodącymi; po 999 numer rośnie naturalnie
  -- (AV-2026-1000) — lpad nie ucina, a CHECK dopuszcza {3,}.
  new.order_number := v_prefix || '-' || v_year || '-' || lpad(v_seq::text, 3, '0');

  return new;
end;
$$;

comment on function app.generate_order_number() is
  'Trigger BEFORE INSERT na public.orders: nadaje {PREFIX}-{YYYY}-{NNN} per (tenant, rok). Prefiks z tenant_settings.order_number_prefix, fallback AV.';

create trigger orders_generate_order_number
  before insert on public.orders
  for each row execute function app.generate_order_number();

-- ---------------------------------------------------------------------
-- 7. RLS + GRANT-y
-- ---------------------------------------------------------------------

alter table public.products enable row level security;
alter table public.product_units enable row level security;
alter table public.pricing_tiers enable row level security;
alter table public.pickup_locations enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.deposit_events enable row level security;
alter table public.tenant_settings enable row level security;

-- REVOKE PRZED GRANT-em na każdej nowej tabeli (wzorzec 0006). Bez tego
-- Supabase'owe `alter default privileges` zostawia anon i authenticated
-- komplet uprawnień, w tym TRUNCATE — które NIE PODLEGA RLS i czyści tabelę
-- mimo najszczelniejszych polityk. Kolejność jest istotna: grant przed revoke
-- zostałby zdjęty.
revoke all on public.products from anon, authenticated;
revoke all on public.product_units from anon, authenticated;
revoke all on public.pricing_tiers from anon, authenticated;
revoke all on public.pickup_locations from anon, authenticated;
revoke all on public.customers from anon, authenticated;
revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
revoke all on public.deposit_events from anon, authenticated;
revoke all on public.tenant_settings from anon, authenticated;

-- anon nie dostaje NIC na żadnej z tych tabel. Storefront publiczny (Faza 2)
-- będzie czytał katalog przez własną, wąską ścieżkę (widok/RPC z jawnie
-- wybranymi kolumnami) — grant na tabelę wystawiłby przez PostgREST także
-- kolumny kosztowe i dane klientów.
grant select, insert, update, delete on public.products to authenticated, service_role;
grant select, insert, update, delete on public.product_units to authenticated, service_role;
grant select, insert, update, delete on public.pricing_tiers to authenticated, service_role;
grant select, insert, update, delete on public.pickup_locations to authenticated, service_role;
grant select, insert, update, delete on public.customers to authenticated, service_role;
grant select, insert, update, delete on public.orders to authenticated, service_role;
grant select, insert, update, delete on public.order_items to authenticated, service_role;
grant select, insert, update, delete on public.tenant_settings to authenticated, service_role;

-- deposit_events: BRAK grantu UPDATE/DELETE dla authenticated — rejestr jest
-- append-only na poziomie uprawnień, nie tylko polityk (dwie niezależne
-- bramki, jak audit_log w 0001). service_role też nie kasuje: wiersze znikają
-- wyłącznie kaskadą z zamówienia/tenanta.
grant select, insert on public.deposit_events to authenticated, service_role;

-- --- Polityki ---
--
-- Wzorzec z 0001: odczyt dla członków tenanta + superadmina (podgląd tenanta
-- w panelu superadmina, 0004, idzie zwykłym klientem z sesją — RLS jest
-- bramką, nie service-role). Zapis operacyjny dla KAŻDEGO członka: obsługa
-- wypożyczalni to praca staffu, nie ownera. Kasowanie zastrzeżone dla ownera
-- (wzorzec usage_counters z 0001) — usunięcie produktu czy klienta jest
-- nieodwracalne i wykracza poza obsługę lady.

-- products
create policy tenant_select on public.products for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.products for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.products for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
create policy tenant_delete on public.products for delete
  using (tenant_id = app.tenant_id() and app.is_tenant_owner());

-- product_units
create policy tenant_select on public.product_units for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.product_units for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.product_units for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
create policy tenant_delete on public.product_units for delete
  using (tenant_id = app.tenant_id() and app.is_tenant_owner());

-- pricing_tiers
create policy tenant_select on public.pricing_tiers for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.pricing_tiers for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.pricing_tiers for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
-- Próg cenowy to konfiguracja odwracalna wpisem — kasowanie zostaje przy
-- członku tenanta, inaczej staff nie poprawi własnej pomyłki w cenniku.
create policy tenant_delete on public.pricing_tiers for delete
  using (tenant_id = app.tenant_id());

-- pickup_locations
create policy tenant_select on public.pickup_locations for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.pickup_locations for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.pickup_locations for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
create policy tenant_delete on public.pickup_locations for delete
  using (tenant_id = app.tenant_id() and app.is_tenant_owner());

-- customers
create policy tenant_select on public.customers for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.customers for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.customers for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
create policy tenant_delete on public.customers for delete
  using (tenant_id = app.tenant_id() and app.is_tenant_owner());

-- orders
create policy tenant_select on public.orders for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.orders for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.orders for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
-- Zamówienia się ANULUJE (order_status='cancelled'), nie kasuje — usunięcie
-- zrywa ciągłość numeracji dokumentów i historię kaucji. Kasowanie zostaje
-- wyłącznie dla ownera, jako ścieżka naprawy pomyłki.
create policy tenant_delete on public.orders for delete
  using (tenant_id = app.tenant_id() and app.is_tenant_owner());

-- order_items
create policy tenant_select on public.order_items for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.order_items for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.order_items for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
-- Edycja koszyka to zwykła praca lady — usunięcie pozycji zostaje przy członku.
create policy tenant_delete on public.order_items for delete
  using (tenant_id = app.tenant_id());

-- deposit_events: APPEND-ONLY.
-- Brak polityk UPDATE/DELETE jest CELOWY i jest tu połową mechanizmu (drugą
-- połową jest brak grantu wyżej): RLS jest fail-closed, więc brak polityki =
-- brak dostępu. Rejestr, który da się poprawić po fakcie, nie jest dowodem
-- rozliczenia kaucji.
create policy tenant_select on public.deposit_events for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.deposit_events for insert
  with check (tenant_id = app.tenant_id());

-- tenant_settings
create policy tenant_select on public.tenant_settings for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.tenant_settings for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.tenant_settings for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
create policy tenant_delete on public.tenant_settings for delete
  using (tenant_id = app.tenant_id() and app.is_tenant_owner());
