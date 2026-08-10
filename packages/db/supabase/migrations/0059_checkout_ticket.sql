-- 0059_checkout_ticket.sql
-- ZAUFANA GRANICA CHECKOUTU: jednorazowy bilet HMAC (R13, audyt H-02, ADR-125).
--
-- PROBLEM (H-02). `app.public_checkout` ma grant EXECUTE dla roli `anon`, bo
-- sklep jest anonimowy i nie ma innego sposobu, żeby gość złożył zamówienie.
-- Konsekwencja: bot z kluczem anon (a ten klucz jest PUBLICZNY z definicji —
-- leży w źródle strony) woła funkcję WPROST, z pominięciem Server Action,
-- a więc i z pominięciem wszystkich bramek warstwy aplikacji: honeypotu,
-- limitu per IP i Turnstile. Powstają trwałe zamówienia `pending`, a te
-- zdejmują egzemplarze z dostępności — spam nie tylko zaśmieca bazę, on
-- WYŁĄCZA FLOTĘ najemcy z oferty.
--
-- CZEGO NIE ROBIMY I DLACZEGO. Nie odbieramy anonowi EXECUTE (wariant A/B
-- z rekomendacji): odebranie wymagałoby albo nowej Edge Function (pierwszy
-- taki komponent w systemie: Deno, osobny deploy, kolejny punkt awarii,
-- dodatkowa latencja na ścieżce sprzedaży), albo osobnej roli DB z sekretem
-- w publicznej aplikacji — a to cofa A1/ADR-115, które ŚWIADOMIE zdjęło
-- service_role ze storefrontu. Obie te drogi tylko PRZESUWAJĄ granicę
-- zaufania; żadna nie wiąże zapisu z zaliczonym Turnstile.
--
-- CO ROBIMY. Zapis wymaga BILETU — podpisanego zaświadczenia, że wołający
-- przeszedł bramki zaufanej granicy (Turnstile w sklepie, klucz API w v1).
-- Bilet bije serwer storefrontu LOKALNIE (czyste HMAC, `lib/checkout/ticket.ts`),
-- nigdy nie ma go w przeglądarce i nie ma publicznego RPC, które by go
-- wystawiało — publiczna „fabryka biletów" byłaby tą samą dziurą z jednym
-- krokiem więcej. Baza sprawdza bilet PRZED czymkolwiek innym i konsumuje go
-- JEDNORAZOWO. `anon` zachowuje EXECUTE (minimalny blast radius: zero zmian
-- w grantach, zero zmian w call-site'ach), ale wywołanie bez ważnego biletu
-- nie tworzy ani klienta, ani zamówienia, ani pozycji.
--
-- STAN PO:
--   * app.checkout_ticket_keys — sekret podpisu; ZERO grantów, czyta wyłącznie
--     właściciel przez SECURITY DEFINER. Wartość NIE JEST W REPO — wstawia ją
--     właściciel ręcznie na prodzie (patrz „OPS" niżej);
--   * app.checkout_ticket_nonces — zużyte bilety po HASHU nonce (wzorzec
--     token_hash z 0003/0053), z indeksem po expires_at do sprzątania;
--   * app.assert_checkout_ticket — bramka wewnętrzna (bez grantów), lustro
--     app.assert_checkout_custom_fields z 0058;
--   * app.purge_checkout_ticket_nonces — sprzątanie zużytych biletów;
--   * app.public_checkout — redefinicja: trzy parametry biletu i bramka na
--     samej górze ciała. Reszta ciała BEZ ZMIAN MERYTORYCZNYCH wobec 0058.
--
-- ZAKRES BILETU (świadoma iteracja, nie przeoczenie). Bilet wiąże WYŁĄCZNIE
-- `tenant + exp + nonce`. Nie podpisujemy treści zamówienia (payload_hash),
-- choć technicznie moglibyśmy: kanonizacja tej samej struktury po stronie
-- Node i SQL to krucha powierzchnia (kolejność kluczy, format dat i liczb,
-- null vs brak klucza, sortowanie pozycji) i każdy rozjazd oznacza MASOWE
-- odrzucanie prawdziwych checkoutów — awarię sprzedaży, nie awarię
-- bezpieczeństwa. Jednorazowość nonce zamyka H-02 sama: bot bez sekretu nie
-- wyprodukuje ani jednego ważnego biletu, a przechwycony bilet działa raz.
-- Podpisanie treści dołożymy, gdy kanonizacja będzie osobno przetestowana.
--
-- DEV-SKIP I JEGO CENA. Brak aktywnego klucza w app.checkout_ticket_keys =
-- bramka przepuszcza, z ostrzeżeniem w logu. To ta sama semantyka, co
-- verifyTurnstile i bilet formularza kontaktu (ADR-095), i istnieje z tego
-- samego powodu: dev, CI i lokalna baza nie mają sekretów, a checkout ma tam
-- DZIAŁAĆ, nie być zepsuty. Cena jest realna i trzeba ją nazwać wprost:
-- PRODUKCJA BEZ ZASIANEGO KLUCZA JEDZIE Z BRAMKĄ OTWARTĄ, czyli z H-02.
-- Dlatego kolejność wdrożenia jest częścią tej migracji, nie dodatkiem:
-- migracja + seed sekretu PRZED merge.
--
-- ODMOWY: wyłącznie 22023 i wyłącznie JEDEN komunikat dla wszystkich przyczyn
-- (brak biletu / zły podpis / wygasły / zużyty). Rozróżnienie byłoby wyrocznią
-- czytaną z kanału błędu przez kogokolwiek z internetu: „ten podpis był
-- poprawny, ale bilet wygasł" mówi atakującemu, że zna sekret.
--
-- OPS (właściciel, PRZED merge — auto-deploy):
--   1. wygeneruj sekret:            openssl rand -hex 32
--   2. wstaw go do env Vercela storefrontu jako AVABLY_CHECKOUT_TICKET_SECRET
--      (serwerowy, BEZ NEXT_PUBLIC_), Production + Preview,
--   3. wstaw TĘ SAMĄ wartość do bazy:
--        insert into app.checkout_ticket_keys (key_version, secret, active)
--        values (1, '<ta sama wartość>', true);
--   4. dopiero potem merge PR-a.
-- Rotacja: dołóż wiersz z wyższym key_version (bramka bierze najwyższy
-- aktywny), podmień env, potem `update ... set active = false` na starym.

-- === BEGIN PROD MIGRATION 0059 ===

-- ---------------------------------------------------------------------
-- 1. app.checkout_ticket_keys — sekret podpisu biletu
-- ---------------------------------------------------------------------
--
-- ZERO GRANTÓW. To jedyna tabela w systemie, której odczyt przez kogokolwiek
-- poza właścicielem bazy jest równoznaczny z regresem do H-02: kto zna sekret,
-- ten bije sobie bilety. Schemat `app` jest wystawiony w PostgREST (RPC
-- checkoutu jedzie przez `.schema("app")`), więc brak grantów nie jest
-- teoretyczny — bez niego tabela byłaby czytelna zwykłym GET-em z kluczem anon.
-- RLS włączone dodatkowo, jako druga zapadka: gdyby ktoś kiedyś dodał grant
-- przez pomyłkę, brak polityk nadal zwraca zero wierszy. Właściciel tabeli
-- (definer) RLS omija, więc bramka czyta sekret normalnie.
--
-- CHECK na długości sekretu: 32 znaki to dolna granica sensu (hex z 16 bajtów).
-- Nie chroni przed złym sekretem, chroni przed POMYŁKĄ PRZY WKLEJANIU —
-- ucięta wartość albo pusty string byłyby cichą awarią podpisu, a nie błędem.

create table if not exists app.checkout_ticket_keys (
  key_version int primary key,
  secret text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint checkout_ticket_keys_secret_length check (length(btrim(secret)) >= 32)
);

alter table app.checkout_ticket_keys enable row level security;

revoke all on table app.checkout_ticket_keys from public;
revoke all on table app.checkout_ticket_keys from anon, authenticated, service_role;

comment on table app.checkout_ticket_keys is
  'Sekret podpisu biletu checkoutu (R13/H-02, ADR-125). ZERO grantów i RLS bez polityk: czyta wyłącznie właściciel przez app.assert_checkout_ticket (SECURITY DEFINER). Wartość NIE JEST W REPO — wstawia ją właściciel na prodzie i musi być IDENTYCZNA z AVABLY_CHECKOUT_TICKET_SECRET w env storefrontu. Brak aktywnego wiersza = bramka biletu wyłączona (dev-skip) i produkcja z otwartym H-02. Rotacja: nowy wiersz z wyższym key_version, potem active=false na starym.';

-- ---------------------------------------------------------------------
-- 2. app.checkout_ticket_nonces — zużyte bilety (jednorazowość)
-- ---------------------------------------------------------------------
--
-- HASH, NIE SUROWY NONCE (wzorzec token_hash z 0003 i 0053). Nonce jest
-- składnikiem podpisanego komunikatu, więc wyciek zawartości tej tabeli
-- razem z wyciekiem sekretu ułatwiałby analizę; przechowywanie skrótu nic nie
-- kosztuje i zdejmuje ten scenariusz. Klucz główny na haszu jest jednocześnie
-- BARIERĄ WYŚCIGU: dwie równoległe próby z tym samym biletem rozstrzyga
-- unikat, nie kolejność sprawdzeń.
--
-- BEZ KLUCZA OBCEGO NA tenant_id — świadomie. Bramka biletu stoi PRZED
-- sprawdzeniem tenanta (najtańsza odmowa), więc FK zamieniłby wywołanie
-- z biletem na nieistniejącego tenanta w 23503 zamiast w naszą nierozróżnialną
-- odmowę 22023. Kolumna jest tu do diagnostyki i do sprzątania, nie do
-- integralności referencyjnej; sam tenant i tak jest ZWIĄZANY PODPISEM.

create table if not exists app.checkout_ticket_nonces (
  nonce_hash text primary key,
  tenant_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now()
);

create index if not exists checkout_ticket_nonces_expires_at_idx
  on app.checkout_ticket_nonces (expires_at);

alter table app.checkout_ticket_nonces enable row level security;

revoke all on table app.checkout_ticket_nonces from public;
revoke all on table app.checkout_ticket_nonces from anon, authenticated, service_role;

comment on table app.checkout_ticket_nonces is
  'Zużyte bilety checkoutu (R13/H-02, ADR-125) — jednorazowość po HASZU nonce (wzorzec token_hash z 0003/0053). Klucz główny jest barierą wyścigu: powtórzone wywołanie tym samym biletem odbija się o unikat, nie o kolejność sprawdzeń. Wiersz powstaje w transakcji checkoutu, więc wycofany checkout zwalnia bilet — jednorazowość dotyczy UTRWALONEGO zamówienia. Bez FK na tenant_id (bramka stoi przed sprawdzeniem tenanta; tenant wiąże podpis). ZERO grantów, RLS bez polityk. Sprzątanie: app.purge_checkout_ticket_nonces.';

-- ---------------------------------------------------------------------
-- 3. app.assert_checkout_ticket — bramka biletu (wewnętrzna, bez grantów)
-- ---------------------------------------------------------------------
--
-- Lustro app.assert_checkout_custom_fields z 0058: wewnętrzna, bez grantów,
-- woła ją wyłącznie app.public_checkout jako właściciel. Wystawienie jej
-- anonowi byłoby wyrocznią „czy ten bilet jest ważny" — czyli darmowym
-- stanowiskiem do testowania podrobionych podpisów bez skutków ubocznych.
--
-- KOLEJNOŚĆ SPRAWDZEŃ JEST NOŚNA:
--   1. klucz (brak → dev-skip, patrz nagłówek),
--   2. komplet pól biletu,
--   3. PODPIS — przed czasem i przed nonce, bo bez podpisu `exp` i `nonce` są
--      wartościami, które ktoś sobie wymyślił; sprawdzanie ich wcześniej
--      wpisywałoby do tabeli nonce śmieci od dowolnego bota (darmowy zapis
--      dla anona = nowy wektor),
--   4. czas,
--   5. KONSUMPCJA nonce — na końcu, bo to jedyny krok z efektem ubocznym.
--
-- PORÓWNANIE PODPISU PO DIGEST OBU STRON. Postgres nie ma porównania
-- stałoczasowego dla tekstu, a gołe `=` na podpisach przecieka przez czas
-- porównania prefiksu. Porównanie SKRÓTÓW zdejmuje ten kanał: atakujący nie
-- kontroluje skrótu swojego wejścia, więc informacja „ile bajtów się zgadzało"
-- nie mówi mu nic o prawdziwym podpisie.
--
-- TOLERANCJA ZEGARA. Bilet bije Vercel, sprawdza Supabase — to dwa różne
-- zegary. 60 s luzu na `exp` po stronie przeszłości zdejmuje klasę fałszywych
-- odmów „ważny bilet odrzucony, bo baza spieszy się o sekundę". Górna granica
-- (2 h w przód) nie chroni przed atakującym z sekretem — ten i tak podpisze,
-- co zechce — tylko ogranicza szkodę z BŁĘDU KONFIGURACJI po naszej stronie:
-- bilet z absurdalnym terminem ważności nie zostanie zaakceptowany po cichu.
-- Wystawca (lib/checkout/ticket.ts) używa 15 minut; zmiana tamtego TTL powyżej
-- 2 h wymaga zmiany TUTAJ.

create or replace function app.assert_checkout_ticket(
  p_tenant_id uuid,
  p_exp bigint,
  p_nonce text,
  p_sig text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, app
as $$
declare
  -- JEDEN komunikat na wszystkie przyczyny — nie z lenistwa, tylko po to, żeby
  -- kanał błędu nie był wyrocznią. Stała, a nie cztery literały, żeby
  -- jednolitość była własnością konstrukcji, a nie dyscypliny edytowania.
  c_denied constant text :=
    'Sesja zamawiania wygasła — odśwież stronę i spróbuj ponownie.';
  c_skew_seconds constant bigint := 60;
  c_max_lifetime_seconds constant bigint := 7200;
  v_secret text;
  v_now bigint := floor(extract(epoch from now()))::bigint;
  v_message text;
  v_nonce_hash text;
begin
  select k.secret into v_secret
  from app.checkout_ticket_keys k
  where k.active
  order by k.key_version desc
  limit 1;

  -- DEV-SKIP: brak klucza = warstwa jawnie wyłączona (lustro verifyTurnstile).
  -- Ostrzeżenie, nie cisza — na prodzie ma być widoczne w logach bazy.
  if v_secret is null then
    raise warning '[0059] Brak aktywnego klucza w app.checkout_ticket_keys — bramka biletu checkoutu NIE DZIAŁA (H-02 otwarte).';
    return;
  end if;

  if p_exp is null
     or p_nonce is null or btrim(p_nonce) = ''
     or p_sig is null or btrim(p_sig) = '' then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  -- Komunikat rekonstruowany, nie przekazywany: baza podpisuje to, co SAMA
  -- wie o wywołaniu. `p_tenant_id` jest tu sednem wiązania tenanta — bilet
  -- wystawiony dla sklepu A daje inny podpis niż wołanie na sklep B.
  -- uuid::text jest w Postgresie już małymi literami; lower() jest jawnym
  -- kontraktem dla wystawcy po stronie Node, nie zabezpieczeniem.
  v_message := lower(p_tenant_id::text) || '.' || p_exp::text || '.' || p_nonce;

  if extensions.digest(encode(extensions.hmac(v_message, v_secret, 'sha256'), 'hex'), 'sha256')
     <> extensions.digest(lower(btrim(p_sig)), 'sha256') then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  if p_exp + c_skew_seconds < v_now or p_exp > v_now + c_max_lifetime_seconds then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  -- KONSUMPCJA ATOMOWA. `on conflict do nothing` + `not found` zamiast
  -- „sprawdź, czy jest, potem wstaw": to drugie ma okno między odczytem
  -- a zapisem, w którym dwa równoległe wywołania z tym samym biletem oba
  -- widzą pustkę. Tu rozstrzyga unikat klucza głównego, więc dokładnie jedno
  -- wywołanie przechodzi (wzorzec z app.accept_invitation, 0003).
  v_nonce_hash := encode(extensions.digest(p_nonce, 'sha256'), 'hex');
  insert into app.checkout_ticket_nonces (nonce_hash, tenant_id, expires_at)
  values (v_nonce_hash, p_tenant_id, to_timestamp(p_exp))
  on conflict (nonce_hash) do nothing;

  if not found then
    raise exception '%', c_denied using errcode = '22023';
  end if;
end;
$$;

comment on function app.assert_checkout_ticket(uuid, bigint, text, text) is
  'Bramka zaufanej granicy checkoutu (R13/H-02, ADR-125): wywołanie app.public_checkout musi nieść bilet HMAC bity przez serwer storefrontu PO zaliczonych bramkach (Turnstile albo klucz API v1). Sprawdza podpis nad (tenant, exp, nonce), termin ważności z tolerancją zegara i konsumuje nonce JEDNORAZOWO (insert on conflict do nothing — bariera wyścigu na kluczu głównym). Wszystkie cztery przyczyny odmowy (brak/zły podpis/wygasły/zużyty) dają JEDEN komunikat i jeden kod 22023 — rozróżnienie byłoby wyrocznią dla atakującego. Brak aktywnego klucza = przepuszcza z ostrzeżeniem (dev-skip, lustro verifyTurnstile). Wewnętrzna: brak grantów dla anon/authenticated.';

revoke all on function app.assert_checkout_ticket(uuid, bigint, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. app.purge_checkout_ticket_nonces — sprzątanie zużytych biletów
-- ---------------------------------------------------------------------
--
-- Tabela nonce rośnie o wiersz na KAŻDE utrwalone zamówienie i nigdy sama nie
-- maleje. Przy dzisiejszych wolumenach to nic, ale „nic" rosnące monotonicznie
-- jest długiem, nie stanem. Sprzątanie jest OSOBNĄ funkcją, a nie doklejone do
-- bramki: kasowanie w ścieżce checkoutu dokładałoby zapis i ryzyko zakleszczeń
-- do operacji, która ma być tania i przewidywalna.
--
-- Bezpieczny próg: kasujemy wyłącznie nonce, których termin ważności minął
-- z ZAPASEM (domyślnie 7 dni). Skasowanie nonce wciąż ważnego przywracałoby
-- możliwość powtórzenia biletu.

create or replace function app.purge_checkout_ticket_nonces(
  p_older_than interval default interval '7 days'
)
returns bigint
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_deleted bigint;
begin
  delete from app.checkout_ticket_nonces
  where expires_at < now() - greatest(p_older_than, interval '1 day');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function app.purge_checkout_ticket_nonces(interval) is
  'Sprzątanie zużytych biletów checkoutu (R13, ADR-125). Kasuje wyłącznie nonce wygasłe z zapasem (minimum doba, domyślnie 7 dni) — skasowanie nonce wciąż ważnego przywróciłoby możliwość powtórzenia biletu. Osobna funkcja, nie krok bramki: zapis w ścieżce checkoutu byłby kosztem i ryzykiem zakleszczenia w operacji, która ma być tania. Wewnętrzna: brak grantów dla anon/authenticated.';

revoke all on function app.purge_checkout_ticket_nonces(interval)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. app.public_checkout — redefinicja: bramka biletu na wejściu
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0058, wzorzec 0021/0029/0040/0049/0058).
-- Różnice merytoryczne wobec 0058 oznaczone [0059] i są DOKŁADNIE DWIE:
-- trzy nowe parametry biletu oraz jedno `perform app.assert_checkout_ticket`
-- jako pierwsza instrukcja ciała. Reszta jest przepisana bez zmian — łącznie
-- z komentarzami, żeby diff wobec 0058 dało się przeczytać wzrokiem.
--
-- SYGNATURA SIĘ ZMIENIA, więc wariant 20-argumentowy MUSI zniknąć. Gdyby
-- został, istniałby DRUGĄ ŚCIEŻKĄ ZAPISU BEZ BRAMKI — a to nie byłaby luka
-- teoretyczna, tylko dokładnie ta sama luka, którą ta migracja zamyka, tyle że
-- z inną liczbą argumentów w żądaniu. Drop idzie PRZED create; granty
-- i komentarz wracają jawnie, bo DROP zabiera je razem z funkcją.
--
-- GRANT DLA ANONA ZOSTAJE BEZ ZMIAN — to jest świadomy wybór wariantu C, nie
-- niedopatrzenie. Bramką jest bilet, nie uprawnienie; dzięki temu ani sklep,
-- ani API v1, ani wtyczka nie zmieniają sposobu wołania, a zmiana ma zerowy
-- promień rażenia poza samą funkcją.
--
-- PARAMETRY BILETU MAJĄ DEFAULT NULL, więc wołający sprzed 0059 jest
-- SKŁADNIOWO poprawny — i ZOSTANIE ODRZUCONY przez bramkę, gdy klucz jest
-- zasiany. Tak ma być: fail-closed dla starych wywołań (czyli i dla bota,
-- który skopiował żądanie sprzed tej migracji), bez błędu o niedopasowanej
-- sygnaturze, który sam w sobie byłby podpowiedzią.

drop function if exists app.public_checkout(
  uuid, text, text, text, date, date, text, uuid, jsonb, text,
  text, text, text, text, text, text, text, text, jsonb, jsonb
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
    v_total_rental, v_total_deposit, v_delivery, now(), btrim(p_terms_version),
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
  'Jedyna publiczna ścieżka powstania zamówienia (ADR-042): wycena SERWEROWA, przypisanie wolnych egzemplarzy, throttle w bazie, ban-lista (ADR-080), wybór metody płatności (0029) i waluta z wiersza zamówienia (0049). [0058] Przyjmuje wartości pól własnych w DWÓCH mapach (zamówienie, klient) — encję wybiera definicja, nie wołający. [0059] WYMAGA BILETU zaufanej granicy (R13/H-02, ADR-125): app.assert_checkout_ticket jest PIERWSZĄ instrukcją ciała, więc wywołanie rolą anon bez ważnego, niezużytego biletu nie tworzy ani klienta, ani zamówienia, ani pozycji. Grant dla anona ZOSTAJE bez zmian — bramką jest bilet, nie uprawnienie. SECURITY DEFINER.';

-- === END PROD MIGRATION 0059 ===
