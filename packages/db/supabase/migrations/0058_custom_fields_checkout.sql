-- 0058_custom_fields_checkout.sql
-- Pola własne w ZAMAWIANIU: publiczny odczyt definicji i publiczny zapis
-- wartości (C6-A3 część 3, ADR-121).
--
-- DLACZEGO MIGRACJA, SKORO CZĘŚĆ 2 OBESZŁA SIĘ BEZ NIEJ. Część 2 działała
-- wyłącznie w sesji ZALOGOWANEGO operatora, a tam obie drogi już były:
-- `custom_field_definitions` czyta polityka `tenant_select`, a wartości
-- zapisuje UPDATE pod RLS. Zamawianie jest ścieżką ANONIMOWĄ i nie ma ani
-- jednej z tych dróg:
--   * `anon` NIE MA grantu SELECT na `custom_field_definitions` (0057),
--     więc sklep nie ma jak się dowiedzieć, jakie pola wyrenderować;
--   * `anon` NIE MA prawa zapisu do `orders` ani `customers` — jedyną drogą
--     jest `app.public_checkout`, a jej sygnatura nie przyjmowała wartości.
-- Obejście po stronie aplikacji (service_role w publicznej apce) jest
-- zamknięte bramką `scripts/audit-service-role.sh` i konwencją „bramką jest
-- baza". Stąd 0058.
--
-- STAN PO:
--   * app.get_public_custom_fields — definicje WIDOCZNE W ZAMAWIANIU dla
--     sklepu, API v1 i wtyczki WordPress (SECURITY DEFINER, grant anon);
--   * app.get_public_catalog — redefinicja: niesie te definicje oraz wartości
--     pól własnych PRODUKTU oznaczonych „zamawianie";
--   * app.assert_checkout_custom_fields — bramka WIDOCZNOŚCI po stronie bazy
--     (wewnętrzna, bez grantów);
--   * app.public_checkout — redefinicja: przyjmuje dwie mapy wartości
--     (zamówienie i klient), zapisuje je i scala mapę klienta zamiast jej
--     nadpisywać.
--
-- ZERO ZMIAN W SCHEMACIE: żadnej tabeli, kolumny, indeksu ani polityki.
-- Wartości lądują w kolumnach `custom_fields` z 0057, a ich zgodność
-- z definicją pilnuje ten sam trigger `app.custom_fields_validate`, co przy
-- pracy lady. To jest cała pointa D3 z ADR-118: surowe API ma tę samą drogę
-- do kolumny co panel — także wtedy, gdy „surowe API" znaczy anonimowy
-- checkout.
--
-- CO PUBLICZNE, A CO NIE. Publiczny kształt definicji jest ŚCIŚLE WĘŻSZY od
-- wiersza: wychodzą `id`, `entity`, `field_type`, `label`, `help_text`,
-- `required`, `options`. Nie wychodzą flagi widoczności (funkcja zwraca
-- WYŁĄCZNIE pola oznaczone „zamawianie", więc flaga byłaby stałą), nie
-- wychodzi `archived_at` (zarchiwizowane nie wychodzą w ogóle) ani
-- `created_at` — moment konfiguracji sklepu nie jest niczyją sprawą.
-- KOLEJNOŚĆ niesie sama tablica: funkcja sortuje po (position, created_at,
-- id), dokładnie jak indeks z 0057 i jak `visibleCustomFields` w rdzeniu,
-- więc konsument odtwarza porządek panelu bez znajomości znacznika czasu.

-- ---------------------------------------------------------------------
-- 1. app.get_public_custom_fields — definicje do wypełnienia w zamawianiu
-- ---------------------------------------------------------------------
--
-- Bramka tenanta trialing|active jak w 0020: sklep nieaktywny jest
-- nieodróżnialny od nieistniejącego (pusta tablica, nie odmowa).
--
-- Zwracane są definicje WSZYSTKICH TRZECH ENCJI oznaczone „zamawianie", bo
-- konsument potrzebuje ich do dwóch różnych rzeczy: `customer` i `order` do
-- WYRENDEROWANIA pól formularza, `product` do OPISANIA wartości, które
-- przychodzą przy produkcie w katalogu. Rozdział robi konsument po polu
-- `entity` — a to, że pola produktu nie da się WYPEŁNIĆ z zamawiania,
-- egzekwuje bramka niżej, nie kształt tej odpowiedzi.

create or replace function app.get_public_custom_fields(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'entity', d.entity,
        'field_type', d.field_type,
        'label', d.label,
        'help_text', d.help_text,
        'required', d.required,
        'options', d.options
      )
      order by d.position, d.created_at, d.id
    )
    from public.custom_field_definitions d
    join public.tenants t on t.id = d.tenant_id
    where d.tenant_id = p_tenant_id
      and t.status in ('trialing', 'active')
      and d.archived_at is null
      and d.show_in_checkout
  ), '[]'::jsonb);
$$;

comment on function app.get_public_custom_fields(uuid) is
  'Definicje pól własnych WIDOCZNYCH W ZAMAWIANIU (C6-A3, ADR-121) dla sklepu, API v1 i wtyczki WordPress. Kształt ŚCIŚLE WĘŻSZY od wiersza: bez flag widoczności, bez archived_at i bez created_at. Zarchiwizowane i nieoznaczone „zamawianie" nie wychodzą w ogóle. Kolejność (position, created_at, id) = kolejność panelu i umowy PDF, więc konsument odtwarza ją bez znacznika czasu. Pusta tablica dla tenanta poza trialing|active. SECURITY DEFINER, bo anon nie ma grantu SELECT na custom_field_definitions.';

revoke all on function app.get_public_custom_fields(uuid) from public;
grant execute on function app.get_public_custom_fields(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. app.assert_checkout_custom_fields — bramka WIDOCZNOŚCI w bazie
-- ---------------------------------------------------------------------
--
-- Trigger 0057 odpowiada na pytanie „czy ta wartość jest zgodna z definicją"
-- i celowo nie zna powierzchni: panel i lada zapisują tę samą kolumnę.
-- Zamawianie jest inne — to jedyne WEJŚCIE ANONIMOWE do tych kolumn, więc
-- tu powierzchnia musi być bramką, a nie konwencją formularza.
--
-- Odmowa jest JEDNA dla czterech różnych przyczyn (definicja nie istnieje /
-- należy do innego najemcy / opisuje inną encję / nie ma flagi „zamawianie" /
-- jest zarchiwizowana). To jest ta sama zasada co w D3 z ADR-118: rozróżnienie
-- byłoby wyrocznią o konfiguracji cudzego sklepu, odczytywaną przez kanał
-- błędu przez kogokolwiek z internetu.
--
-- BEZ GRANTÓW: funkcja jest wewnętrzna, woła ją wyłącznie app.public_checkout
-- (jako właściciel). Wystawienie jej anonowi zamieniłoby ją w dokładnie tę
-- wyrocznię, przed którą broni — pytanie „czy id X jest u was polem
-- zamawiania" dostawałoby odpowiedź TAK/NIE.
--
-- CO W TEJ BRAMCE JEST NOŚNE, A CO POWTÓRZONE (znalezisko dowodu mutacyjnego).
-- Nośny jest WYŁĄCZNIE warunek `show_in_checkout`: powierzchni nie zna żaden
-- inny mechanizm, więc jego zdjęcie natychmiast otwiera zapis do pól
-- oznaczonych tylko „panel" (dowód: mutacja pali sondę „pole BEZ flagi
-- zamawianie"). Warunki `tenant_id`, `entity` i `archived_at` są POWTÓRZENIEM
-- filtrów triggera 0057 — ich zdjęcie NIE pali żadnego testu, bo trigger i tak
-- odrzuca zapis. Zostają świadomie, z dwóch powodów: odmowa pada ZANIM
-- funkcja tknie klienta i wycenę (taniej i bez pracy do wycofania), a wszystkie
-- cztery przyczyny dają wtedy JEDEN komunikat zamiast dwóch różnych z dwóch
-- warstw. To jest defence-in-depth, nie druga bramka — i tak ma być czytane.

create or replace function app.assert_checkout_custom_fields(
  p_tenant_id uuid,
  p_entity text,
  p_values jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_key text;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'Pola własne muszą być obiektem.' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_values) loop
    -- Kształt klucza sprawdzamy PRZED rzutem na uuid: rzut nieudany oddałby
    -- 22P02 zamiast naszej nierozróżnialnej odmowy, czyli wyciekłby fakt
    -- „to nawet nie wyglądało na identyfikator".
    if v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Pole własne nie istnieje w tej organizacji.' using errcode = '22023';
    end if;

    perform 1
      from public.custom_field_definitions d
     where d.id = v_key::uuid
       and d.tenant_id = p_tenant_id
       and d.entity = p_entity
       and d.archived_at is null
       and d.show_in_checkout;

    if not found then
      raise exception 'Pole własne nie istnieje w tej organizacji.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

comment on function app.assert_checkout_custom_fields(uuid, text, jsonb) is
  'Bramka WIDOCZNOŚCI pól własnych na wejściu anonimowym (C6-A3, ADR-121): każdy klucz mapy musi wskazywać żywą definicję TEGO najemcy, TEJ encji i z flagą „zamawianie". Cztery przyczyny odmowy dają JEDEN komunikat i jeden kod (22023) — rozróżnienie byłoby wyrocznią o konfiguracji sklepu czytaną z kanału błędu. Wewnętrzna: woła ją wyłącznie app.public_checkout, brak grantów dla anon/authenticated.';

revoke all on function app.assert_checkout_custom_fields(uuid, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. app.get_public_catalog — redefinicja: pola własne w odczycie
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0020, sygnatura BEZ ZMIAN). Różnice
-- merytoryczne są dokładnie dwie, obie oznaczone [0058] i obie ADDYTYWNE:
--   * klucz `custom_fields` na poziomie sklepu — definicje z
--     app.get_public_custom_fields (JEDNO źródło prawdy o tym, co publiczne);
--   * klucz `custom_fields` przy produkcie — mapa jego wartości, ZAWĘŻONA do
--     definicji oznaczonych „zamawianie".
--
-- Wartości produktu wychodzą na zewnątrz i to jest decyzja, nie skutek
-- uboczny: flaga „zamawianie" na polu produktu nie miała dotąd żadnego
-- znaczenia (produktu nikt nie wypełnia w checkoucie), a od C6-A3 znaczy
-- „pokaż to kupującemu przy produkcie". Domyślka flagi to `false` (0057),
-- więc żadna istniejąca definicja nie zaczyna nagle świecić publicznie.
--
-- Zawężenie liczy się PO DEFINICJACH, nie po kluczach kolumny: pętla idzie po
-- wierszach `custom_field_definitions` i bierze te, które w mapie produktu
-- WYSTĘPUJĄ. Odwrotny kierunek wymagałby rzutu klucza kolumny na uuid, czyli
-- zaufania danym przy braku bramki — a tu w ogóle nie musimy ufać.

create or replace function app.get_public_catalog(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  with t as (
    select ten.id, ten.name, ten.locale
    from public.tenants ten
    where ten.id = p_tenant_id
      and ten.status in ('trialing', 'active')
  ),
  cur as (
    select coalesce(
      (select s.value #>> '{}'
       from public.tenant_settings s
       where s.tenant_id = p_tenant_id and s.key = 'currency'
         and jsonb_typeof(s.value) = 'string'
         and (s.value #>> '{}') in ('PLN', 'EUR', 'USD')),
      'PLN'
    ) as currency
  ),
  pricing as (
    select s.value as v
    from public.tenant_settings s
    where s.tenant_id = p_tenant_id and s.key = 'delivery_pricing'
      and jsonb_typeof(s.value) = 'object'
  )
  select case when t.id is null then null else jsonb_build_object(
    'tenant', jsonb_build_object('name', t.name, 'locale', t.locale, 'currency', cur.currency),
    -- [0058] Definicje pól własnych zamawiania — JEDNO źródło prawdy o tym,
    -- co jest publiczne (app.get_public_custom_fields), zamiast drugiej
    -- kopii listy kolumn, która rozjechałaby się przy pierwszej poprawce.
    'custom_fields', app.get_public_custom_fields(t.id),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'description', p.description,
          'base_price_day_grosze', p.base_price_day_grosze,
          'deposit_grosze', p.deposit_grosze,
          'auto_increment_multiplier', p.auto_increment_multiplier,
          'buffer_before_days', p.buffer_before_days,
          'buffer_after_days', p.buffer_after_days,
          -- [0058] Wartości pól własnych PRODUKTU — wyłącznie pod definicjami
          -- oznaczonymi „zamawianie". Pole opisujące sprzęt na użytek lady
          -- (koszt zakupu, numer w ewidencji) nie ma tędy drogi na zewnątrz.
          'custom_fields', coalesce((
            select jsonb_object_agg(d.id::text, p.custom_fields -> d.id::text)
            from public.custom_field_definitions d
            where d.tenant_id = p.tenant_id
              and d.entity = 'product'
              and d.archived_at is null
              and d.show_in_checkout
              and p.custom_fields ? d.id::text
          ), '{}'::jsonb),
          'pricing_tiers', coalesce((
            select jsonb_agg(
              jsonb_build_object('tier_days', pt.tier_days, 'multiplier', pt.multiplier, 'label', pt.label)
              order by pt.tier_days
            )
            from public.pricing_tiers pt
            where pt.tenant_id = p.tenant_id and pt.product_id = p.id
          ), '[]'::jsonb),
          'images', coalesce((
            select jsonb_agg(
              jsonb_build_object('storage_path', pi.storage_path, 'alt_text', pi.alt_text, 'sort_order', pi.sort_order)
              order by pi.sort_order, pi.created_at
            )
            from public.product_images pi
            where pi.tenant_id = p.tenant_id and pi.product_id = p.id
          ), '[]'::jsonb)
        )
        order by p.name, p.id
      )
      from public.products p
      where p.tenant_id = t.id and p.active
    ), '[]'::jsonb),
    'pickup_locations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pl.id, 'name', pl.name,
          'address_street', pl.address_street,
          'address_zip', pl.address_zip,
          'address_city', pl.address_city
        )
        order by pl.name, pl.id
      )
      from public.pickup_locations pl
      where pl.tenant_id = t.id and pl.active
    ), '[]'::jsonb),
    'delivery_methods', (
      jsonb_build_array(jsonb_build_object('method', 'pickup', 'price_grosze', 0))
      || coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'method', m.method,
            'price_grosze', (pricing.v -> m.method ->> 'price_grosze')::int,
            'free_above_grosze', (pricing.v -> m.method ->> 'free_above_grosze')::int
          )
          order by m.method
        )
        from pricing, unnest(array['courier', 'parcel_locker', 'own_delivery']) as m(method)
        where pricing.v ? m.method
          and jsonb_typeof(pricing.v -> m.method) = 'object'
      ), '[]'::jsonb)
    )
  ) end
  from cur left join t on true;
$$;

comment on function app.get_public_catalog(uuid) is
  'Publiczny katalog storefrontu (ADR-042): produkty aktywne (+ zdjęcia, progi, bufory, kaucja), punkty odbioru aktywne, metody dostawy z JAWNIE publicznym cennikiem (delivery_pricing). [0058] Dodatkowo definicje pól własnych zamawiania (app.get_public_custom_fields) oraz wartości pól własnych PRODUKTU zawężone do definicji z flagą „zamawianie" (C6-A3, ADR-121). NULL dla tenanta poza trialing|active. SECURITY DEFINER — jedyna ścieżka anonowa; ZERO credentiali kurierskich/nadawcy/e-mail.';

-- ---------------------------------------------------------------------
-- 4. app.public_checkout — redefinicja: zapis pól własnych z zamawiania
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0049, wzorzec 0021/0029/0040/0041/0049).
-- Różnice merytoryczne oznaczone [0058]: dwa nowe parametry, bramka
-- widoczności przed jakimkolwiek zapisem, mapa na wstawianym zamówieniu,
-- SCALENIE mapy na kliencie.
--
-- SYGNATURA SIĘ ZMIENIA, więc wariant 18-argumentowy MUSI zniknąć — inaczej
-- istniałby drugą, nieaktualną ścieżką zapisu (wołanie 18 argumentami byłoby
-- niejednoznaczne, a przez domyślki mogłoby trafić na stare ciało, które nie
-- zna kolumny `custom_fields`). Drop idzie PRZED create; granty i komentarz
-- wracają jawnie, bo DROP zabiera je razem z funkcją.

drop function if exists app.public_checkout(
  uuid, text, text, text, date, date, text, uuid, jsonb, text,
  text, text, text, text, text, text, text, text
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
  p_customer_custom_fields jsonb default '{}'::jsonb
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

revoke all on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb) from public;
grant execute on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb) to anon, authenticated;

comment on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb) is
  'Jedyna publiczna ścieżka powstania zamówienia (ADR-042): wycena SERWEROWA, przypisanie wolnych egzemplarzy, throttle w bazie, ban-lista (ADR-080), wybór metody płatności (0029) i waluta z wiersza zamówienia (0049). [0058] Przyjmuje wartości pól własnych w DWÓCH mapach (zamówienie, klient) — encję wybiera definicja, nie wołający. Widoczności („zamawianie") pilnuje app.assert_checkout_custom_fields PRZED jakimkolwiek zapisem; zgodności z definicją — trigger 0057, ten sam co dla panelu. Mapa klienta jest SCALANA operatorem ||, nie nadpisywana: stały klient panelu ma na wierszu wartości pod polami, których sklep nie pokazuje. SECURITY DEFINER, grant anon.';

-- ---------------------------------------------------------------------
-- 5. app.import_catalog — redefinicja: pola własne w formacie wymiany
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0055). SYGNATURA NIETKNIĘTA — dane pól
-- własnych jadą WEWNĄTRZ wiersza (`custom_fields`, `custom_field_columns`),
-- więc nie ma drugiego wariantu funkcji do usunięcia ani grantów do
-- odtwarzania. Różnice merytoryczne oznaczone [0058].

create or replace function app.import_catalog(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_created int := 0;
  v_updated int := 0;
  v_tiers int := 0;
  v_row jsonb;
  v_tier jsonb;
  v_product_id uuid;
  v_existing uuid;
  -- [0058] Pola własne produktu: wartości z pliku oraz LISTA KOLUMN, które
  -- plik obejmuje. Dwie rzeczy, nie jedna — patrz komentarz przy zapisie.
  v_cf jsonb;
  v_cf_cols text[];
begin
  if v_tenant is null then
    raise exception 'Brak kontekstu najemcy.' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Import wymaga co najmniej jednego produktu.' using errcode = '22023';
  end if;

  -- Siostra limitu eksportu (ADR-111/112): jawna odmowa, nigdy cichy obcinek.
  if jsonb_array_length(p_rows) > 10000 then
    raise exception 'Import przekracza limit 10000 wierszy.' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_product_id := nullif(v_row ->> 'product_id', '')::uuid;

    if v_row -> 'tiers' is not null and jsonb_typeof(v_row -> 'tiers') <> 'array' then
      raise exception 'Pole tiers musi być tablicą.' using errcode = '22023';
    end if;

    -- [0058] --- POLA WŁASNE PRODUKTU (C6-A3, ADR-121) ---
    --
    -- `custom_fields` to wartości z pliku; `custom_field_columns` to zbiór
    -- definicji, dla których plik JEST AUTORYTATYWNY. Rozdzielenie ich jest
    -- konieczne, bo pusta komórka i brak kolumny znaczą co innego: pierwsze
    -- to „operator wyczyścił pole", drugie to „plik o tym polu nic nie mówi".
    -- Bez tej różnicy import katalogu wyeksportowanego przed dodaniem pola
    -- kasowałby wartości, których nawet nie widział.
    v_cf := coalesce(v_row -> 'custom_fields', '{}'::jsonb);
    if jsonb_typeof(v_cf) <> 'object' then
      raise exception 'Pole custom_fields musi być obiektem.' using errcode = '22023';
    end if;
    if v_row -> 'custom_field_columns' is not null
       and jsonb_typeof(v_row -> 'custom_field_columns') <> 'array' then
      raise exception 'Pole custom_field_columns musi być tablicą.' using errcode = '22023';
    end if;
    v_cf_cols := coalesce(
      (select array_agg(value #>> '{}')
         from jsonb_array_elements(coalesce(v_row -> 'custom_field_columns', '[]'::jsonb))),
      array[]::text[]
    );

    if v_product_id is not null then
      -- Jawny filtr tenanta OBOK RLS — patrz nagłówek (dwie warstwy).
      select p.id into v_existing
        from public.products p
       where p.id = v_product_id
         and p.tenant_id = v_tenant;
      if v_existing is null then
        raise exception 'Produkt % nie istnieje w katalogu tego najemcy.', v_product_id
          using errcode = '22023';
      end if;

      update public.products set
        name = v_row ->> 'name',
        description = v_row ->> 'description',
        base_price_day_grosze = (v_row ->> 'base_price_day_grosze')::int,
        deposit_grosze = (v_row ->> 'deposit_grosze')::int,
        auto_increment_multiplier = (v_row ->> 'auto_increment_multiplier')::numeric,
        buffer_before_days = (v_row ->> 'buffer_before_days')::int,
        buffer_after_days = (v_row ->> 'buffer_after_days')::int,
        active = (v_row ->> 'active')::boolean,
        -- [0058] Klucze OBJĘTE plikiem zdejmujemy i wstawiamy na nowo; klucze
        -- poza nim zostają nietknięte. Zgodność wartości z definicją sprawdza
        -- trigger 0057 — ta funkcja nie powtarza jego reguł i nie ma prawa
        -- ich osłabić.
        custom_fields = (coalesce(custom_fields, '{}'::jsonb) - v_cf_cols) || v_cf
      where id = v_product_id
        and tenant_id = v_tenant;

      -- Progi ZASTĄPIONE kompletem z pliku (kontrakt ADR-112).
      delete from public.pricing_tiers
       where product_id = v_product_id
         and tenant_id = v_tenant;

      v_updated := v_updated + 1;
    else
      insert into public.products (
        tenant_id, name, description, base_price_day_grosze, deposit_grosze,
        auto_increment_multiplier, buffer_before_days, buffer_after_days, active,
        -- Produkt POWSTAJE tutaj, więc nie ma czego scalać.
        custom_fields
      ) values (
        v_tenant,
        v_row ->> 'name',
        v_row ->> 'description',
        (v_row ->> 'base_price_day_grosze')::int,
        (v_row ->> 'deposit_grosze')::int,
        (v_row ->> 'auto_increment_multiplier')::numeric,
        (v_row ->> 'buffer_before_days')::int,
        (v_row ->> 'buffer_after_days')::int,
        (v_row ->> 'active')::boolean,
        v_cf
      )
      returning id into v_product_id;
      v_created := v_created + 1;
    end if;

    for v_tier in
      select value from jsonb_array_elements(coalesce(v_row -> 'tiers', '[]'::jsonb))
      order by (value ->> 'tier_days')::int
    loop
      insert into public.pricing_tiers (
        tenant_id, product_id, tier_days, multiplier, label, sort_order
      ) values (
        v_tenant,
        v_product_id,
        (v_tier ->> 'tier_days')::int,
        (v_tier ->> 'multiplier')::numeric,
        v_tier ->> 'label',
        coalesce((v_tier ->> 'sort_order')::int, 0)
      );
      v_tiers := v_tiers + 1;
    end loop;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'tiers', v_tiers);
end;
$$;

comment on function app.import_catalog(jsonb) is
  'Atomowy import katalogu z CSV (C3, ADR-112): nowe produkty + aktualizacje + wymiana progów w JEDNEJ transakcji. [0058] Dodatkowo pola własne produktu z dynamicznych kolumn cf_<id>: klucze OBJĘTE kolumnami pliku są zastępowane (także pustką), klucze poza nimi zostają nietknięte — plik sprzed dodania pola nie kasuje danych, których nie widział. SECURITY INVOKER — RLS 0007 obowiązuje wewnątrz; tenant wyłącznie z claimu (app.tenant_id()), jawny filtr tenant_id w każdym zapytaniu (dwie warstwy, wzorzec 0054). Odmowy: 22023 (walidacja/cudzy id), 42501 (brak kontekstu najemcy).';

-- === END PROD MIGRATION 0058 ===
