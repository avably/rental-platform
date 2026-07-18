-- 0021_email_logs.sql
-- Historia wysłanych e-maili (Faza 2, Zadanie 2.8) — ADR-045.
--
-- PROBLEM, KTÓRY TO ZAMYKA: wysyłka jest krokiem PO utrwalonej operacji i
-- NIGDY jej nie blokuje (ADR-033, wzorzec 8b). Powód niewysłania wracał
-- dotąd wyłącznie jako string w wyniku akcji — operator widział go raz, w
-- formularzu, po czym przepadał. Po deployu na produkcję nieudana wysyłka
-- nie zostawiała ŻADNEGO śladu: ani „czy klient dostał potwierdzenie", ani
-- „dlaczego nie". Ta migracja daje trwały rejestr obu odpowiedzi.
--
-- Zawartość:
--   1. tabela public.email_logs (per tenant, append-only),
--   2. RLS + revoke przed grantami + polityki (wzorzec 0007),
--   3. orders.checkout_log_token — token jednorazowy wiążący zapis dziennika
--      z FAKTYCZNIE wykonanym checkoutem,
--   4. app.public_checkout — redefinicja z 0020: wydaje token i zwraca go
--      w odpowiedzi RPC (reszta ciała BEZ ZMIAN),
--   5. app.log_public_checkout_email() — jedyna ścieżka zapisu logu ze
--      storefrontu (anon nie dostaje grantu na tabelę), bramkowana tokenem.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md, nagłówki 0007/0013):
--   * zbiory wartości to text + CHECK, nie enumy — dopisanie rodzaju
--     wiadomości to zwykła migracja bez ALTER TYPE,
--   * revoke all PRZED grantami na każdej nowej tabeli (0006/0008),
--   * FK ZŁOŻONY (tenant_id, order_id) → orders — wiersz międzytenantowy
--     jest niereprezentowalny niezależnie od polityk RLS (0007/0013),
--   * indeksy zaczynają się od tenant_id,
--   * wyłącznie standardowe SQLSTATE (22023/23503/23514) — kody P0xxx
--     PostgREST zjada do gołego 500 bez treści (nagłówek 0011).

-- ---------------------------------------------------------------------
-- 1. public.email_logs
-- ---------------------------------------------------------------------
--
-- REJESTR PRÓB, NIE SKRZYNKA NADAWCZA: wiersz powstaje po KAŻDEJ próbie
-- wysyłki — udanej ('sent' + provider_message_id od dostawcy) i nieudanej
-- ('failed' + powód). Rejestr wyłącznie udanych wysyłek nie odpowiadałby
-- na pytanie, które w ogóle wywołało to zadanie („dlaczego klient nic nie
-- dostał"), a to jest jedyny powód istnienia tej tabeli.
--
-- APPEND-ONLY (wzorzec deposit_events z 0007): brak polityk i grantów
-- UPDATE/DELETE. Historia, którą da się poprawić po fakcie, nie jest
-- dowodem na to, co wyszło do klienta.
--
-- BEZ TREŚCI WIADOMOŚCI: zapisujemy metadane (rodzaj, odbiorca, temat),
-- nigdy html/text. Treść to duplikat szablonu z @avably/emails powiększony
-- o dane osobowe klienta, rosnący z każdą wysyłką — a do diagnozy „czy i
-- dlaczego" nie jest potrzebny.
create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- NULLABLE Z ROZMYSŁEM: nie każda wiadomość dotyczy zamówienia —
  -- zaproszenie do organizacji (0003/ADR-036) nie ma z czym się związać.
  -- Kolumna bez wartości jest tu stanem legalnym, nie brakiem danych.
  order_id uuid,

  -- Rodzaje odpowiadają JEDEN DO JEDNEGO ścieżkom wysyłki w kodzie:
  --   rental_* (5)            — cykl najmu, panel: TEMPLATE_FOR_STATUS
  --                             (zamowienia/[id]/rental-email.ts),
  --   invitation              — zaproszenie do organizacji (panel/lib/email.ts),
  --   return_label,
  --   pickup_return_reminder  — zwroty (zamowienia/[id]/return-email.ts, ADR-043),
  --   checkout_confirmation,
  --   new_order_notification  — checkout storefrontu (lib/checkout/emails.ts, ADR-042).
  --
  -- checkout_confirmation jest ODDZIELNE od rental_confirmed, mimo wspólnego
  -- szablonu: to inna ścieżka (publiczna, anonowa) i inna diagnoza przy
  -- awarii. Sklejenie ich kosztowałoby dokładnie tę informację, po którą
  -- operator otwiera historię.
  kind text not null check (kind in (
    'rental_confirmed',
    'rental_ready_for_pickup',
    'rental_picked_up',
    'rental_returned',
    'rental_cancelled',
    'invitation',
    'return_label',
    'pickup_return_reminder',
    'checkout_confirmation',
    'new_order_notification'
  )),

  -- DANE OSOBOWE (ADR-045, decyzja D3): adres odbiorcy to dana osobowa w
  -- rozumieniu RODO i jest tu przetwarzany na podstawie prawnie
  -- uzasadnionego interesu (dowód wykonania umowy najmu + obsługa
  -- reklamacji „nie dostałem potwierdzenia"). Retencja: 24 miesiące od
  -- created_at, potem czyszczenie wsadowe. CZYSZCZENIA TU NIE MA I TO JEST
  -- DECYZJA: cron kasujący dane bez ekranu, na którym najemca to widzi i
  -- potwierdza, jest gorszy niż jego brak. Implementacja: faza 5 (RODO),
  -- razem z eksportem i usuwaniem danych klienta.
  recipient text not null check (length(btrim(recipient)) between 3 and 320),

  subject text not null check (length(subject) between 1 and 500),

  status text not null check (status in ('sent','failed')),

  -- Identyfikator wiadomości u dostawcy (Resend). Jest WYŁĄCZNIE przy
  -- sukcesie i tylko wtedy, gdy dostawca go zwrócił — stąd nullable nawet
  -- dla status='sent'. To jedyny uchwyt do korelacji z panelem dostawcy
  -- przy sporze „wysłaliśmy, a nie doszło".
  provider_message_id text,

  -- Powód porażki, dokładnie ten, który dziś operator widzi raz w
  -- formularzu (komunikat EmailTransportError albo błąd renderowania).
  error text,

  created_at timestamptz not null default now(),

  -- Para status ↔ kolumny wyniku. Bez tego CHECK-a dałoby się zapisać
  -- 'failed' bez powodu — czyli dokładnie ten bezużyteczny ślad, którego
  -- ta tabela ma być końcem (wzorzec strażnika reason_code z 0011).
  constraint email_logs_result_shape check (
    (status = 'sent' and error is null)
    or (status = 'failed' and provider_message_id is null and length(btrim(coalesce(error, ''))) > 0)
  ),

  -- FK ZŁOŻONY — bramka spójności tenanta, której RLS nie zapewnia
  -- (uzasadnienie: 0007, order_items_order_fk): log wskazujący zamówienie
  -- CUDZEGO tenanta jest niereprezentowalny (23503).
  --
  -- SET NULL, NIE CASCADE: usunięcie zamówienia (owner-only ścieżka naprawy
  -- pomyłki, 0007) nie może wymazać dowodu, że coś do klienta wyszło —
  -- rejestr traci wtedy powiązanie, nie wiersz. Lista kolumn `(order_id)`
  -- jest OBOWIĄZKOWA: goły `set null` zerowałby też tenant_id (not null),
  -- więc usunięcie zamówienia wywracałoby się na 23502.
  constraint email_logs_order_fk
    foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete set null (order_id)
);

-- Ekran globalny /historia-emaili: „wiadomości tenanta, od najnowszej".
create index email_logs_tenant_created_idx
  on public.email_logs (tenant_id, created_at desc);

-- Sekcja „Wysłane wiadomości" na ekranie zamówienia.
create index email_logs_tenant_order_idx
  on public.email_logs (tenant_id, order_id);

comment on table public.email_logs is
  'Historia prób wysyłki e-maili per tenant (ADR-045): sukces (sent + provider_message_id) i porażka (failed + error). APPEND-ONLY — bez grantów i polityk UPDATE/DELETE. Metadane bez treści wiadomości. order_id nullable: zaproszenie nie dotyczy zamówienia.';
comment on column public.email_logs.order_id is
  'Zamówienie, którego dotyczy wiadomość; NULL dla wiadomości spoza cyklu zamówienia (zaproszenie) oraz po usunięciu zamówienia (on delete set null — rejestr przeżywa zamówienie).';
comment on column public.email_logs.recipient is
  'Adres odbiorcy — DANA OSOBOWA (ADR-045 D3). Retencja 24 miesiące od created_at; czyszczenie wsadowe wchodzi w fazie 5 (RODO), tu celowo niezaimplementowane.';
comment on column public.email_logs.provider_message_id is
  'Identyfikator wiadomości u dostawcy poczty (Resend). NULL przy porażce oraz gdy dostawca id nie zwrócił.';
comment on column public.email_logs.error is
  'Powód niewysłania (komunikat transportu/renderowania). NOT NULL przy status=failed — pilnuje CHECK email_logs_result_shape.';

-- ---------------------------------------------------------------------
-- 2. RLS + GRANT-y
-- ---------------------------------------------------------------------

alter table public.email_logs enable row level security;

-- REVOKE PRZED GRANT-em (wzorzec 0006/0008): nowa tabela rodzi się z
-- kompletem uprawnień z default privileges, w tym z TRUNCATE, które NIE
-- PODLEGA politykom RLS.
revoke all on public.email_logs from anon, authenticated;

-- anon: NIC. Storefront pisze wyłącznie przez app.log_public_checkout_email
-- (punkt 3) — grant na tabelę wystawiłby przez PostgREST cudzą historię
-- wysyłek gołym kluczem anonimowym.
--
-- Brak UPDATE/DELETE dla KOGOKOLWIEK poza service_role to druga połowa
-- append-only (pierwsza: brak polityk niżej). RLS jest fail-closed, więc
-- brak polityki = brak dostępu — ale grant bez polityki i tak byłby
-- mylącym sygnałem w audycie uprawnień.
grant select, insert on public.email_logs to authenticated;
grant select, insert, update, delete on public.email_logs to service_role;

-- Odczyt: członek tenanta + superadmin (wzorzec 0007 — podgląd superadmina
-- idzie zwykłą sesją, RLS jest bramką, nie service-role).
create policy tenant_select on public.email_logs for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());

-- Zapis: KAŻDY członek tenanta. Wysyłka jest pracą lady (zmiana statusu,
-- etykieta zwrotna), więc log musi powstać z tej samej sesji, która wysyła
-- — inaczej ślad zostawiałby wyłącznie owner.
create policy tenant_insert on public.email_logs for insert
  with check (tenant_id = app.tenant_id());

-- ---------------------------------------------------------------------
-- 3. orders.checkout_log_token — dowód, że checkout NAPRAWDĘ się odbył
-- ---------------------------------------------------------------------
--
-- POWIERZCHNIA, KTÓRĄ TO ZAMYKA (znalezisko recenzji adwersaryjnej 2.8):
-- funkcja zapisu dziennika ma grant dla anona, a pierwsza wersja przyjmowała
-- WYŁĄCZNIE dane publiczne — p_tenant_id (zwracany każdemu przez
-- app.resolve_tenant_by_slug, 0017) i p_order_number, który jest
-- SEKWENCYJNY (trigger generate_order_number z 0007: max(...)+1). Nic w tych
-- argumentach nie dowodziło, że wołający w ogóle przeprowadził checkout.
-- Skutki były dwa i oba trafiają w sens tej tabeli:
--   (1) FAŁSZOWANIE: posiadacz publicznego klucza strony dopisywał do
--       historii REALNYCH zamówień wpisy z dowolnym odbiorcą, tematem i
--       powodem błędu. Dziennik, do którego każdy może dopisać, nie
--       odpowiada na pytanie, po które powstał,
--   (2) WYROCZNIA ENUMERACJI: różnica między „zamówienie nie istnieje"
--       a sukcesem pozwalała odpytać kolejne numery i odczytać wolumen
--       najemcy.
--
-- Bramki whitelisty rodzaju, zakresu tenanta i limitu wpisów ograniczały
-- SKALĘ, ale nie zamykały żadnego z tych problemów — ograniczony fałsz to
-- nadal fałsz.
--
-- ROZWIĄZANIE: token jednorazowy wydawany przez app.public_checkout przy
-- INSERT-cie zamówienia i wymagany przy zapisie dziennika. Tokena nie da się
-- zgadnąć ani wyprowadzić z danych publicznych, więc zapis może wykonać
-- WYŁĄCZNIE ten, kto naprawdę przeprowadził ten konkretny checkout.
--
-- NULLABLE Z ROZMYSŁEM: zamówienia z PANELU (create_order, 0010) nie mają
-- tokenu i mieć go nie powinny — panel loguje wysyłki sesją członka przez
-- politykę tenant_insert, nie tą funkcją. Kolumna nullable bez CHECK-a nie
-- dokłada żadnego warunku do bramek 0010/0015 (orders_write_gate patrzy na
-- order_status i payment_status), więc istniejące zamówienia i wszystkie
-- tranzycje zostają nietknięte.
alter table public.orders
  add column checkout_log_token uuid;

comment on column public.orders.checkout_log_token is
  'Token jednorazowy wydawany przez app.public_checkout (ADR-045): dowód, że wołający app.log_public_checkout_email faktycznie przeprowadził TEN checkout. NULL dla zamówień z panelu (create_order) — panel loguje wysyłki sesją członka przez RLS. Dane SERWEROWE: nie trafiają do przeglądarki (kontrakt CheckoutResult ich nie zawiera, jak notify_email w ADR-042).';

-- ---------------------------------------------------------------------
-- 4. app.public_checkout — redefinicja z 0020 (wydanie tokenu)
-- ---------------------------------------------------------------------
--
-- Ciało odtworzone w CAŁOŚCI z 0020, nie okrojone (lekcja 0016: okrojona
-- kopia cicho gubi logikę). Względem 0020 zmieniają się DOKŁADNIE cztery
-- miejsca: deklaracja v_log_token, kolumna i wartość w INSERT-cie zamówienia
-- oraz pole 'log_token' w zwracanym jsonb. Bez zmian zostają: throttle w
-- bazie (per klient i per tenant, z coalesce-guardem konfiguracji), wycena
-- SERWEROWA (klient nie niesie kwot), wybór egzemplarzy, kolejność advisory
-- locków (porządek po unit_id — brak zakleszczenia), bramki 0010/0015 oraz
-- polityka zwrotu bez PII (notify_email wyłącznie z email_sender.reply_to).
--
-- log_token jest KOLEJNYM polem server-only w tej odpowiedzi — obowiązuje go
-- ta sama dyscyplina co notify_email z ADR-042: odpowiedź RPC czyta każdy
-- bezpośredni wołający anon keyem, więc konsumuje je server action, a
-- kontrakt CheckoutResult (2.4b) ich nie zawiera.
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
  p_notes text default null
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
    delivery_grosze, terms_accepted_at, terms_version, source, checkout_log_token
  )
  values (
    p_tenant_id, v_customer_id, p_start_date, p_end_date, p_delivery_method,
    v_pickup, nullif(btrim(coalesce(p_notes, '')), ''),
    v_total_rental, v_total_deposit, v_delivery, now(), btrim(p_terms_version),
    'storefront', v_log_token
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
    'order_status', 'pending',
    'payment_status', 'unpaid',
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

comment on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text) is
  'Publiczny checkout storefrontu (ADR-042 + ADR-045): jedyna anonowa ścieżka ZAPISU zamówienia. Kwoty i egzemplarze liczy/przypisuje SERWER (klient nie niesie kwot); INSERT orders+items przez bramki 0010/0015 (pending/unpaid, wyścig o egzemplarz zatrzymany advisory lockiem); throttle w bazie (defaulty 3/24h per klient, 30/1h per tenant; konfigurowalne kluczem tenant_settings checkout_limits z coalesce-guardem — bezpośrednie RPC omija bramki storefrontu). SECURITY DEFINER, tenant_id z parametru. Zwraca order_number + podsumowanie + kontekst wysyłki e-maili + log_token (server-only; notify_email wyłącznie z email_sender.reply_to — zero PII z auth.users). Odmowy: 22023 / 23P01.';

-- ---------------------------------------------------------------------
-- 5. app.log_public_checkout_email — zapis logu ze storefrontu
-- ---------------------------------------------------------------------
--
-- STOREFRONT NIE MA KLUCZA SERVICE-ROLE (twarda konwencja) i nie dostanie
-- grantu na tabelę. Zapis idzie więc wąską funkcją SECURITY DEFINER —
-- dokładnie tym samym wzorcem, którym idzie sam checkout (app.public_checkout,
-- 0020/ADR-042): jedna funkcja, jawny zakres, zero dostępu do tabeli.
--
-- Bramki (odmowa = 22023, jak w 0020 — PostgREST przenosi ją do wołającego):
--   * TOKEN musi zgadzać się z orders.checkout_log_token tego zamówienia —
--     jedyna bramka dowodząca, że wołający przeprowadził ten checkout
--     (uzasadnienie: punkt 3 wyżej). Pozostałe trzy ograniczają skalę
--     nadużycia, ta zamyka samą możliwość,
--   * rodzaj ograniczony do DWÓCH ścieżek checkoutu. Bez tego wołający
--     mógłby wstrzykiwać wpisy udające cykl najmu albo zaproszenie,
--   * zamówienie MUSI istnieć u tego tenanta (rozwiązanie order_number →
--     order_id dzieje się TUTAJ; wołający nigdy nie widzi order_id, więc
--     odpowiedź RPC checkoutu nie musi go nieść),
--   * limit wpisów per zamówienie — checkout wysyła najwyżej dwie
--     wiadomości, więc każdy nadmiar to nadużycie, nie użycie.
--
-- ODMOWY SĄ NIEROZRÓŻNIALNE i to jest częścią mechanizmu, nie kosmetyką:
-- „zamówienie nie istnieje" i „zły token" oddają IDENTYCZNY komunikat pod
-- IDENTYCZNYM kodem. Rozróżnienie ich zamieniłoby funkcję w wyrocznię:
-- odpytując kolejne (sekwencyjne) numery zamówień z byle jakim tokenem,
-- wołający czytałby po samej treści odmowy, które numery ISTNIEJĄ — czyli
-- wolumen zamówień najemcy. Sprawdzenie jest więc JEDNYM zapytaniem po parze
-- (numer, token), a nie dwoma po kolei.
--
-- p_order_number, NIE p_order_id: numer zamówienia wołający i tak zna
-- (dostał go z checkoutu), a identyfikator wewnętrzny nie musi opuszczać
-- bazy. Numer jest unikalny w obrębie tenanta (0007).
create or replace function app.log_public_checkout_email(
  p_tenant_id uuid,
  p_order_number text,
  p_log_token uuid,
  p_kind text,
  p_recipient text,
  p_subject text,
  p_status text,
  p_provider_message_id text default null,
  p_error text default null
) returns void
language plpgsql
security definer
as $$
declare
  v_order_id uuid;
  v_count int;
  -- Jeden komunikat dla OBU odmów tożsamościowych (patrz nagłówek): treść nie
  -- może zdradzać, czy zawiodło istnienie zamówienia, czy dopasowanie tokenu.
  c_denied constant text := 'Nie można zapisać wpisu dziennika dla tego zamówienia.';
begin
  if p_kind not in ('checkout_confirmation','new_order_notification') then
    raise exception 'Nieobsługiwany rodzaj wiadomości checkoutu: %', p_kind
      using errcode = '22023';
  end if;

  -- JEDNO zapytanie po PARZE (numer, token) — celowo nie dwa po kolei.
  -- Rozbicie na „najpierw znajdź zamówienie, potem porównaj token" wróciłoby
  -- do wyroczni enumeracji nawet przy identycznych komunikatach, bo obie
  -- gałęzie różniłyby się kosztem i czasem odpowiedzi.
  --
  -- `is not distinct from` nie jest tu potrzebne i byłoby SZKODLIWE: NULL
  -- w p_log_token ma NIE dopasować niczego, a zamówienia z panelu mają
  -- checkout_log_token NULL — `=` daje NULL (brak dopasowania), czyli
  -- dokładnie to, czego chcemy. `is not distinct from` dopasowałoby
  -- wywołanie bez tokenu do każdego zamówienia panelowego.
  select o.id into v_order_id
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.order_number = p_order_number
    and o.checkout_log_token = p_log_token;

  if v_order_id is null then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  select count(*) into v_count
  from public.email_logs el
  where el.tenant_id = p_tenant_id and el.order_id = v_order_id;

  -- 10 przy dwóch wiadomościach na zamówienie zostawia zapas na ponowienia
  -- operatora z panelu, a odcina zalewanie rejestru skryptem.
  if v_count >= 10 then
    raise exception 'Przekroczono limit wpisów dziennika dla tego zamówienia.'
      using errcode = '22023';
  end if;

  insert into public.email_logs (
    tenant_id, order_id, kind, recipient, subject, status, provider_message_id, error
  ) values (
    p_tenant_id, v_order_id, p_kind, p_recipient, p_subject, p_status,
    p_provider_message_id, p_error
  );
end;
$$;

alter function app.log_public_checkout_email(uuid, text, uuid, text, text, text, text, text, text)
  set search_path = pg_catalog, public;

grant execute on function app.log_public_checkout_email(uuid, text, uuid, text, text, text, text, text, text)
  to anon, service_role;

comment on function app.log_public_checkout_email(uuid, text, uuid, text, text, text, text, text, text) is
  'Zapis wpisu historii wysyłki z checkoutu storefrontu (ADR-045): jedyna anonowa ścieżka do public.email_logs — anon NIE ma grantu na tabelę. Zapis wymaga log_tokenu wydanego przez app.public_checkout dla TEGO zamówienia (bez niego dziennik byłby fałszowalny danymi publicznymi: tenant_id jest jawny, a order_number sekwencyjny). Odmowa „nie ma takiego zamówienia" i „zły token" są NIEROZRÓŻNIALNE — inaczej funkcja działałaby jak wyrocznia enumeracji numerów zamówień. Rodzaj ograniczony do checkout_confirmation|new_order_notification; limit 10 wpisów na zamówienie. Odmowy: 22023. SECURITY DEFINER.';
