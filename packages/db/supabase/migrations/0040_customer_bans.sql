-- 0040_customer_bans.sql
-- Ban-lista klientów (R6b, uwaga właściciela runda 2026-07-28: „możliwość
-- dodania klienta na ban-listę, żeby nie mógł robić zamówień — po adresie
-- mailowym i po numerze telefonu. Pewnie tylko byśmy to sprawdzali"). Decyzja
-- projektowa: ADR-080.
--
-- CO ROBI: wprowadza tabelę public.customer_bans (jeden wiersz = jeden
-- zablokowany klient tenanta, ze ZNORMALIZOWANYMI kluczami mail + telefon)
-- i EGZEKWUJE ban w app.public_checkout — zbanowany klient nie złoży
-- zamówienia w storefroncie.
--
-- DLACZEGO OSOBNA TABELA Z KLUCZAMI, A NIE KOLUMNA banned_at NA customers
-- (rozstrzygnięcie ADR-080): checkout DEDUPUJE klienta po (tenant, lower(email))
-- i zakłada NOWY wiersz, gdy maila nie zna. Ban po TELEFONIE musi zadziałać
-- także wtedy, gdy zbanowany wróci z INNYM mailem — trafiłby wtedy w nowy,
-- nieoznaczony wiersz customers, więc banned_at na customers by go przepuścił.
-- Osobna tabela z kluczami mail/telefon dopasowuje ban NIEZALEŻNIE od tego, do
-- którego (jeśli w ogóle) wiersza customers dedupuje checkout. Jeden ban per
-- klient (unique tenant_id, customer_id) mapuje binarny przełącznik z karty
-- klienta (R6a) i badge na liście.
--
-- ODMOWA NIEROZRÓŻNIALNA (ADR-080): egzekucja rzuca 22023 — standardową klasę,
-- którą PostgREST mapuje na 400, a rdzeń checkoutu storefrontu na ogólny status
-- „rejected" (jak każda inna odmowa walidacyjna). Klient końcowy nie dowiaduje
-- się, że jest na liście; storefront NIE wymaga zmiany (ścieżka błędu istnieje).
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md, nagłówki 0007/0039):
--   * revoke all PRZED grantami na nowej tabeli (0006/0008),
--   * FK ZŁOŻONY (tenant_id, customer_id) → customers — wiersz międzytenantowy
--     niereprezentowalny niezależnie od RLS (0007, order_items),
--   * indeks zaczyna się od tenant_id,
--   * wyłącznie standardowe SQLSTATE (22023/23503) — P0xxx PostgREST zjada do
--     gołego 500 (nagłówek 0011),
--   * public_checkout redefiniowany create-or-replace W CAŁOŚCI z NAJNOWSZEGO
--     ciała (0029, nie 0037 — 0037 dotyczy log_public_checkout_email), z jednym
--     dołożonym blokiem [R6b]; sygnatura BEZ ZMIAN (18 arg), więc bez drop.

-- ---------------------------------------------------------------------
-- 1. app.normalize_phone — jedno źródło normalizacji numeru
-- ---------------------------------------------------------------------
--
-- Numer bywa wpisywany z myślnikami, spacjami i prefiksem (+48 501 123 456 vs
-- 501123456). Ban po telefonie ma łapać ten sam numer niezależnie od formatu,
-- więc porównujemy WYŁĄCZNIE cyfry. Ta sama funkcja normalizuje numer przy
-- ZAPISIE banu (trigger niżej) i przy DOPASOWANIU w checkoucie
-- (app.public_checkout) — jedno źródło reguły, bez ryzyka rozjazdu dwóch kopii.
--
-- IMMUTABLE: wynik zależy wyłącznie od argumentu. Pusty wynik (brak cyfr) to
-- NULL, nie '' — „brak telefonu" nie dopasowuje się wtedy do „braku telefonu".
--
-- DŁUG (ADR-080): normalizacja jest CYFROWA, nie kanonizuje kodu kraju („+48
-- 501…" i „501…" dają różne ciągi i się nie zrównają). Pełne E.164 to
-- biblioteka (libphonenumber), poza zakresem R6b — operator banuje numer,
-- który ma zapisany u klienta.
create or replace function app.normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
$$;

comment on function app.normalize_phone(text) is
  'Normalizacja numeru telefonu do samych cyfr (NULL gdy brak cyfr). Jedno źródło reguły dla ZAPISU banu (trigger customer_bans) i DOPASOWANIA w app.public_checkout (R6b, ADR-080). IMMUTABLE. Dług: nie kanonizuje kodu kraju.';

revoke all on function app.normalize_phone(text) from public;
grant execute on function app.normalize_phone(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Tabela public.customer_bans
-- ---------------------------------------------------------------------
--
-- Jeden wiersz = jeden ZABLOKOWANY klient tenanta. Klucze dopasowania są
-- ZNORMALIZOWANE i ZAPISANE (migawka z chwili banu): email_normalized
-- (lower+btrim) zawsze, phone_normalized (same cyfry) gdy klient ma telefon.
--
-- DLACZEGO MIGAWKA, A NIE JOIN DO customers PRZY DOPASOWANIU: ban „tego
-- numeru/maila" jest faktem z chwili decyzji operatora. Późniejsza edycja
-- danych klienta nie ma cicho przesuwać, co ban łapie (uwaga/dług w ADR-080:
-- żeby odświeżyć klucze po edycji — odbanuj i zabanuj ponownie).
--
-- customer_id WIĄŻE ban z klientem (źródłem) — stąd binarny przełącznik na
-- karcie (jeden ban per klient: unique (tenant_id, customer_id)) i badge na
-- liście (istnieje wiersz = zbanowany). FK ZŁOŻONY (ADR-019) + kaskada:
-- usunięcie klienta zabiera jego ban.
create table public.customer_bans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,

  -- Klucze dopasowania (wypełnia trigger z danych klienta — sekcja 3).
  -- email_normalized zawsze obecny (mail jest wymagany u klienta i jest jego
  -- tożsamością/kluczem dedupu w checkoucie); phone_normalized nullable.
  email_normalized text not null check (length(email_normalized) between 3 and 320),
  phone_normalized text check (phone_normalized is null or length(phone_normalized) between 1 and 64),

  -- Opcjonalny powód dla operatora (NIE pokazywany klientowi końcowemu).
  reason text check (reason is null or length(btrim(reason)) between 1 and 500),

  -- Autor bez FK (wzorzec order_notes/0039): autorstwo przeżywa usunięcie konta
  -- pracownika. NULL możliwy (dane historyczne/serwisowe).
  created_by uuid,
  created_at timestamptz not null default now(),

  constraint customer_bans_tenant_id_key unique (tenant_id, id),
  -- Binarny stan „zbanowany" per klient — jeden ban na klienta.
  constraint customer_bans_customer_key unique (tenant_id, customer_id),
  constraint customer_bans_customer_fk
    foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete cascade
);

-- Dopasowanie w checkoucie: „ban tego tenanta po mailu" i „…po telefonie".
-- Oba indeksy zaczynają się od tenant_id (konwencja) i celują w dokładnie te
-- dwa warunki z OR-a w app.public_checkout.
create index customer_bans_tenant_email_idx
  on public.customer_bans (tenant_id, email_normalized);
create index customer_bans_tenant_phone_idx
  on public.customer_bans (tenant_id, phone_normalized)
  where phone_normalized is not null;

comment on table public.customer_bans is
  'Ban-lista klientów per tenant (R6b, ADR-080). Jeden wiersz = jeden zablokowany klient, ze ZNORMALIZOWANYMI kluczami mail (lower+btrim) i telefon (same cyfry) w migawce z chwili banu. Egzekwowane w app.public_checkout (odmowa 22023, nierozróżnialna). Jeden ban per klient (unique tenant_id, customer_id) — binarny przełącznik na karcie i badge na liście.';
comment on column public.customer_bans.phone_normalized is
  'Telefon klienta w normalizacji app.normalize_phone (same cyfry) z chwili banu; NULL gdy klient nie miał telefonu. Dopasowanie po telefonie wymaga niepustego numeru z checkoutu (guard w public_checkout).';

-- ---------------------------------------------------------------------
-- 3. Trigger wypełniający klucze banu z danych klienta
-- ---------------------------------------------------------------------
--
-- Klucze dopasowania pochodzą z JEDNEGO źródła — wiersza klienta — i są
-- normalizowane TAK SAMO jak wejście checkoutu (mail: lower+btrim; telefon:
-- app.normalize_phone). Gdyby normalizację robił panel w TS, dwie kopie reguły
-- (zapis vs dopasowanie) mogłyby się rozjechać i ban po cichu przestałby łapać.
-- Dlatego wypełnia je baza, przy zapisie.
--
-- SECURITY INVOKER (domyślny): trigger czyta public.customers uprawnieniami
-- członka wstawiającego ban — RLS z 0007 pokazuje mu wyłącznie klientów jego
-- tenanta.
--
-- BRAK WIERSZA KLIENTA NIE JEST TU PODNOSZONY WYJĄTKIEM (świadomie): zostawiamy
-- klucze NULL i pozwalamy zadziałać WŁAŚCIWYM bramkom. Podniesienie P0001/23503
-- z triggera wyprzedziłoby RLS WITH CHECK, który Postgres sprawdza PRZED
-- ograniczeniami tabeli (NOT NULL/FK) — a to on ma odmówić 42501 przy próbie
-- wstawienia banu z CUDZYM tenant_id (RLS ukrywa wtedy klienta, więc SELECT nic
-- nie znajduje). Raise w triggerze przykrywałby 42501 kodem 23503 i psuł
-- macierz izolacji RLS. Dla własnego tenanta: nieistniejący klient → NOT NULL
-- na email_normalized / FK złożony odrzucają zapis (panel mapuje na komunikat
-- „klient nie istnieje").
--
-- created_by = auth.uid(): autorem banu jest zalogowany członek; panel nie musi
-- go podawać.
create or replace function app.customer_bans_fill() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  select lower(btrim(c.email)), app.normalize_phone(c.phone)
    into new.email_normalized, new.phone_normalized
  from public.customers c
  where c.tenant_id = new.tenant_id and c.id = new.customer_id;

  new.created_by := auth.uid();
  return new;
end;
$$;

comment on function app.customer_bans_fill() is
  'Wypełnia klucze banu (email_normalized, phone_normalized) z wiersza klienta, tą samą normalizacją co wejście checkoutu — jedno źródło reguły (R6b, ADR-080). created_by = auth.uid(). SECURITY INVOKER: czyta customers pod RLS wstawiającego.';

create trigger customer_bans_fill
  before insert on public.customer_bans
  for each row execute function app.customer_bans_fill();

-- ---------------------------------------------------------------------
-- 4. RLS + GRANT-y
-- ---------------------------------------------------------------------

alter table public.customer_bans enable row level security;

-- REVOKE PRZED GRANT-em (wzorzec 0006/0008): nowa tabela rodzi się z kompletem
-- uprawnień default privileges, w tym TRUNCATE spoza zasięgu RLS.
revoke all on public.customer_bans from anon, authenticated;

-- anon: NIC. Egzekwowanie banu w checkoucie idzie przez app.public_checkout
-- (SECURITY DEFINER) — anon nie czyta tej tabeli wprost (nie wolno mu poznać,
-- kto jest na liście).
grant select, insert, delete on public.customer_bans to authenticated, service_role;

-- Zapis banu (insert) i zdjęcie (delete) — KAŻDY członek tenanta (uwaga
-- właściciela: „zapis banu wyłącznie członek tenanta"). BRAK UPDATE: ban jest
-- binarny, edycja kluczy nie ma sensu — odbanuj i zabanuj od nowa, żeby
-- odświeżyć migawkę.
create policy tenant_select on public.customer_bans for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.customer_bans for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_delete on public.customer_bans for delete
  using (tenant_id = app.tenant_id());

-- ---------------------------------------------------------------------
-- 5. app.public_checkout — egzekwowanie banu (redefinicja z 0029)
-- ---------------------------------------------------------------------
--
-- Ciało odtworzone W CAŁOŚCI z 0029 (NAJNOWSZA wersja funkcji — 0037 dotyczy
-- log_public_checkout_email, nie tej funkcji), nie okrojone (lekcja 0016/0029:
-- okrojona kopia cicho gubi logikę). Względem 0029 zmieniają się DOKŁADNIE dwa
-- miejsca, oba oznaczone [R6b]: deklaracja v_phone_normalized oraz blok
-- egzekwowania ban-listy po walidacji wejścia. Sygnatura BEZ ZMIAN (18 arg),
-- więc bez drop — create or replace nadpisuje ciało tej samej funkcji.
--
-- BEZ ZMIAN: throttle w bazie, wybór metody płatności (0029), wycena serwerowa,
-- wybór egzemplarzy, kolejność advisory locków, bramki 0010/0015/0027, log_token
-- (0021), polityka zwrotu bez PII.

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
  'Publiczny checkout storefrontu (ADR-042 + ADR-045 + ADR-066 + ADR-080): jedyna anonowa ścieżka ZAPISU zamówienia. Kwoty i egzemplarze liczy/przypisuje SERWER; INSERT orders+items przez bramki 0010/0015/0027; throttle w bazie (defaulty 3/24h per klient, 30/1h per tenant; konfigurowalne tenant_settings checkout_limits z coalesce-guardem). [0029] p_payment_method (online|transfer|cod) zapisuje wybór klienta i wywodzi payment_provider; online wymaga ISTNIEJĄCEGO payment_accounts (bez czytania gotowości — ADR-049). [R6b/ADR-080] Egzekwuje ban-listę: znormalizowany mail LUB telefon w public.customer_bans tego tenanta → odmowa 22023 (nierozróżnialna od innych odmów walidacyjnych; klient nie wie, że jest na liście). payment_status pozostaje unpaid. SECURITY DEFINER, tenant_id z parametru. Zwraca order_id + order_number + podsumowanie + kontekst wysyłki e-maili + log_token. Odmowy: 22023 / 23P01.';
