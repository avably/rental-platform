-- 0020_public_checkout.sql
-- Publiczna ścieżka checkoutu storefrontu (Faza 2, Zadanie 2.4a; ADR-042):
-- anonimowy kupujący czyta katalog, sprawdza dostępność i SKŁADA zamówienie
-- (płatność MVP: przelew/pobranie — Stripe to faza 3).
--
-- Zawartość (jedna migracja, wzorzec 0016/0018/0019 = tabela/kolumny + funkcje):
--   1. orders.terms_accepted_at + orders.terms_version — akceptacja regulaminu
--      utrwalona per zamówienie (dowód zgody w chwili złożenia),
--   2. app.get_public_catalog(tenant)      — SECURITY DEFINER STABLE, katalog
--      publiczny (produkty aktywne + zdjęcia + progi + punkty odbioru + metody
--      dostawy z JAWNIE publicznym cennikiem; ZERO danych wrażliwych),
--   3. app.get_public_availability(...)     — SECURITY DEFINER STABLE, liczba
--      wolnych egzemplarzy w terminie (bez numerów seryjnych i danych zamówień),
--   4. app.public_checkout(...)             — SECURITY DEFINER, JEDYNA publiczna
--      ścieżka ZAPISU: kwoty liczy SERWER, egzemplarze przypisuje SERWER,
--      zamówienie i pozycje wstawia przez ISTNIEJĄCE bramki 0010/0015.
--
-- OSIE BEZPIECZEŃSTWA (ADR-042):
--   * KWOTY NIGDY Z KLIENTA — wejście public_checkout NIE niesie żadnej kwoty;
--     ceny najmu, kaucji i dostawy wylicza ta funkcja SQL-em (lustro
--     calculatePrice / calculateDeliveryCost z @avably/core). Klient nie ma jak
--     zaniżyć ceny, bo nie ma parametru ceny.
--   * EGZEMPLARZE PRZYPISUJE SERWER — klient podaje wyłącznie product_id +
--     ilość; konkretną sztukę wybiera funkcja, a wyścig o ostatni egzemplarz
--     zatrzymuje bramka 0010 (app.assert_unit_available: advisory lock per
--     (tenant, egzemplarz) + re-check). ADR-024 pozostaje BEZ ZMIAN.
--   * IZOLACJA — wszystkie trzy funkcje bramkują tenanta do statusu
--     trialing|active (nieaktywny sklep nieodróżnialny od nieistniejącego,
--     spójnie z 0017/0019) i widzą wyłącznie dane wskazanego tenanta.
--
-- Wyłącznie standardowe SQLSTATE (nagłówek 0010/0011): 22023 (400) dla odmów
-- walidacyjnych/izolacyjnych, 23P01 (409) dla braku wolnego egzemplarza —
-- klasy, które PostgREST mapuje na kody HTTP; P0xxx zjadałby do gołego 500.

-- ---------------------------------------------------------------------
-- 1. orders.terms_accepted_at + orders.terms_version (ADR-042)
-- ---------------------------------------------------------------------
--
-- Akceptacja regulaminu należy do ZAMÓWIENIA, nie do klienta: klient może
-- złożyć wiele zamówień w czasie, a regulamin bywa wersjonowany — zgoda z
-- chwili złożenia musi zostać przy TYM zamówieniu, nawet gdy regulamin się
-- później zmieni. Stąd kolumny na orders, a nie na customers.
--
-- Oba NULLABLE: zamówienia sprzed tej migracji i zamówienia zakładane w panelu
-- (app.create_order — obsługa lady, akceptacja regulaminu nie dotyczy) ich nie
-- niosą. CHECK „oba albo żadne" czyni stan połowiczny (data bez wersji lub
-- odwrotnie) niereprezentowalnym — akceptacja bez wersji nie jest dowodem, a
-- wersja bez daty nie jest akceptacją.
alter table public.orders
  add column terms_accepted_at timestamptz,
  add column terms_version text
    check (terms_version is null or length(btrim(terms_version)) between 1 and 100);

alter table public.orders
  add constraint orders_terms_complete check (
    (terms_accepted_at is null) = (terms_version is null)
  );

comment on column public.orders.terms_accepted_at is
  'Moment akceptacji regulaminu przy publicznym checkoutcie (app.public_checkout). NULL = zamówienie zakładane w panelu / sprzed 0020. Komplet z terms_version wymusza CHECK orders_terms_complete (ADR-042).';
comment on column public.orders.terms_version is
  'Wersja zaakceptowanego regulaminu (dowód zgody utrwalony per zamówienie, nie per klient — regulamin bywa wersjonowany). Komplet z terms_accepted_at (ADR-042).';

-- ŹRÓDŁO ZAMÓWIENIA — jawna kolumna, nie wnioskowanie (ADR-042).
--
-- Throttle publicznego checkoutu (sekcja 4) musi odróżnić zamówienia złożone
-- publiczną ścieżką od pracy lady. Kandydatem było `terms_accepted_at IS NOT
-- NULL` (dziś ustawia je tylko public_checkout), ale to znaczenie POBOCZNE
-- innej kolumny: gdy panel zacznie kiedyś zbierać akceptację regulaminu (np.
-- przy zamówieniu telefonicznym), throttle po cichu objąłby pracę lady — a
-- bramka bezpieczeństwa nie może wisieć na cudzej semantyce. Jawna kolumna
-- z CHECK-iem czyni intencję nieusuwalną z modelu.
--
-- Default 'panel': wszystkie istniejące zamówienia i każda ścieżka, która
-- kolumny nie ustawia (create_order z panelu), są pracą lady. 'storefront'
-- ustawia WYŁĄCZNIE app.public_checkout.
alter table public.orders
  add column source text not null default 'panel'
    check (source in ('panel', 'storefront'));

comment on column public.orders.source is
  'Ścieżka powstania zamówienia: panel (praca lady, default) | storefront (app.public_checkout). Filtr throttle''u publicznego checkoutu (ADR-042) — jawna kolumna zamiast wnioskowania po terms_accepted_at.';

-- ---------------------------------------------------------------------
-- 2. app.get_public_catalog — publiczny katalog (SECURITY DEFINER STABLE)
-- ---------------------------------------------------------------------
--
-- Wzorzec app.get_published_site (0019, ADR-041): anonimowy odwiedzający nie ma
-- grantów na products/product_images/pricing_tiers/pickup_locations/
-- tenant_settings, a polityka SELECT dla anona wystawiłaby przez PostgREST CAŁE
-- wiersze (RLS tnie wiersze, nie kolumny) — w tym kolumny kosztowe planów i
-- CREDENTIALE kurierskie z tenant_settings. Funkcja zwraca JAWNIE wybrane
-- kolumny i nic poza tym.
--
-- ZERO DANYCH WRAŻLIWYCH: z tenant_settings wychodzi WYŁĄCZNIE delivery_pricing
-- (cena metody + próg darmowej dostawy) — nigdy globkurier_credentials,
-- courier_sender ani email_sender. Metody dostawy składamy z jawnej listy:
-- 'pickup' (zawsze wolny, cena 0) + metody obecne w delivery_pricing.
--
-- Bramka: tenant trialing|active, inaczej NULL (nieaktywny sklep nieodróżnialny
-- od nieistniejącego). STABLE + przypięty search_path — konwencja 0017/0019.
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
  -- Waluta operacyjna tenanta: tenant_settings key='currency', fallback PLN
  -- (lustro getTenantCurrency z panelu). Skalar JSON czytany przez #>> '{}'.
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
  -- Cennik dostaw — WYŁĄCZNIE publiczne pola (price_grosze, free_above_grosze).
  pricing as (
    select s.value as v
    from public.tenant_settings s
    where s.tenant_id = p_tenant_id and s.key = 'delivery_pricing'
      and jsonb_typeof(s.value) = 'object'
  )
  select case when t.id is null then null else jsonb_build_object(
    'tenant', jsonb_build_object('name', t.name, 'locale', t.locale, 'currency', cur.currency),
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
      -- 'pickup' zawsze dostępny i darmowy (nie podlega konfiguracji —
      -- lustro calculateDeliveryCost). Metody płatne wchodzą wyłącznie z
      -- delivery_pricing i tylko z polami publicznymi.
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
  -- cur ma zawsze 1 wiersz (fallback PLN); t ma 0 wierszy dla tenanta poza
  -- trialing|active. LEFT JOIN zachowuje wiersz z t.* = NULL → CASE zwraca NULL
  -- (nieodróżnialnie od nieistniejącego), inaczej pełny katalog.
  from cur left join t on true;
$$;

comment on function app.get_public_catalog(uuid) is
  'Publiczny katalog storefrontu (ADR-042): produkty aktywne (+ zdjęcia, progi, bufory, kaucja), punkty odbioru aktywne, metody dostawy z JAWNIE publicznym cennikiem (delivery_pricing). NULL dla tenanta poza trialing|active. SECURITY DEFINER — jedyna ścieżka anonowa; ZERO credentiali kurierskich/nadawcy/e-mail.';

revoke all on function app.get_public_catalog(uuid) from public;
grant execute on function app.get_public_catalog(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. app.get_public_availability — dostępność egzemplarzy (SECURITY DEFINER)
-- ---------------------------------------------------------------------
--
-- KSZTAŁT (rozstrzygnięcie ADR-042): zwraca WYŁĄCZNIE liczby —
-- {available_units, total_units} — a nie listę egzemplarzy, numerów seryjnych
-- ani zakresów cudzych zamówień. Kalendarzowi storefrontu wystarczy „ile sztuk
-- wolnych w tym terminie" (pokazanie dostępności, ograniczenie ilości w
-- koszyku); KTÓRE sztuki i CZYJE zamówienia je blokują to dane wewnętrzne
-- najemcy, których publiczność nie ma prawa poznać. Zwrócenie zajętych zakresów
-- ujawniłoby kalendarz najmu tenanta (kto/kiedy wynajmuje) — świadomie nie.
--
-- Liczenie jest LUSTREM checkAvailability / assert_unit_available: egzemplarz
-- wolny = poza oknem serwisowym (surowy termin) i bez kolizji z najmem
-- blokującym (żądany termin rozszerzony o bufory produktu vs surowe terminy).
-- To ODCZYT (bez advisory locka — lock należy do ZAPISU w public_checkout);
-- liczba jest orientacyjna w chwili odczytu, a wiążącą bramką pozostaje bramka
-- przypisania przy składaniu zamówienia.
--
-- NULL dla: tenant poza trialing|active, produkt cudzy/nieaktywny/nieistniejący,
-- zakres odwrócony — nieodróżnialnie, bez wycieku istnienia. STABLE.
create or replace function app.get_public_availability(
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
    when p.id is null or p_start_date is null or p_end_date is null or p_end_date < p_start_date
      then null
    else jsonb_build_object(
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
  end
  from (
    select pr.id, pr.tenant_id, pr.buffer_before_days, pr.buffer_after_days
    from public.products pr
    join public.tenants t on t.id = pr.tenant_id
    where pr.tenant_id = p_tenant_id
      and pr.id = p_product_id
      and pr.active
      and t.status in ('trialing', 'active')
    union all
    select null::uuid, null::uuid, null::int, null::int
    limit 1
  ) p;
$$;

comment on function app.get_public_availability(uuid, uuid, date, date) is
  'Publiczna dostępność produktu (ADR-042): {available_units, total_units} w terminie [start,end] INCLUSIVE, lustro checkAvailability (okno serwisowe surowe, kolizje z buforami). Zwraca WYŁĄCZNIE liczby — bez numerów seryjnych, bez zakresów cudzych zamówień. NULL: tenant/produkt nieosiągalny lub zakres odwrócony. SECURITY DEFINER.';

revoke all on function app.get_public_availability(uuid, uuid, date, date) from public;
grant execute on function app.get_public_availability(uuid, uuid, date, date) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. app.public_checkout — jedyna publiczna ścieżka zapisu (SECURITY DEFINER)
-- ---------------------------------------------------------------------
--
-- Wzorzec join_waitlist (0006): ścieżka publiczna nie ma grantów tabelarycznych,
-- więc definer jest jedyną furtką, a walidacja jest JAWNA i pełna (RLS omijamy
-- z definicji — CHECK-i tabel i triggery 0010/0015 są ostatnią bramką).
--
-- W ODRÓŻNIENIU od create_order (0010, SECURITY INVOKER): tam wołał członek
-- tenanta z claimem app.tenant_id() i kwotami policzonymi w panelu; tu woła
-- ANONIM bez claimu, więc:
--   * tenant_id wstawiamy z parametru p_tenant_id (app.tenant_id() byłoby NULL),
--   * kwoty liczymy TUTAJ (klient nie ma parametru ceny — nie zaniży),
--   * egzemplarze wybiera funkcja (klient podaje product_id + ilość).
-- Reszta jest IDENTYCZNA: INSERT orders + order_items w jednej transakcji
-- przechodzi orders_write_gate (status pending, płatność unpaid),
-- order_items_assignment_gate → assert_unit_available (advisory lock + re-check:
-- wyścig o ostatni egzemplarz ZATRZYMANY), generate_order_number.
--
-- ATOMOWOŚĆ / SIEROTY: cała funkcja to jedna transakcja (wzorzec create_order) —
-- odmowa dowolnej bramki (egzemplarz zajęty, zły status) wycofuje CAŁOŚĆ, więc
-- nie zostaje ani zamówienie-sierota, ani zużyty numer, ani na wpół przypisane
-- pozycje.
--
-- BEZPOŚREDNIE WYWOŁANIE RPC (ADR-042, znaleziska recenzji 2.4a): grant dla
-- anon znaczy, że wołający NIE MUSI przejść przez warstwę storefrontu — goły
-- anon key przez PostgREST omija honeypot, rate-limit per IP i Turnstile.
-- Dlatego funkcja broni się SAMA na dwóch osiach:
--   * THROTTLE W BAZIE (niżej): zamówienia pending blokują egzemplarze w
--     dostępności, więc spam bezpośrednim RPC zdejmowałby cały inwentarz
--     tenanta z oferty (DoS magazynu). Limity: 3 pending+unpaid ze storefrontu
--     per (tenant, klient) / 24 h oraz 30 per tenant / 1 h → odmowa 22023
--     komunikatem neutralnym. Stałe w funkcji — tuning później.
--   * ZERO PII SPOZA INTENCJI OPERATORA w zwrocie: odpowiedź RPC trafia do
--     KAŻDEGO wołającego, nie tylko do naszej server action — nie może nieść
--     danych, których operator jawnie nie upublicznił (patrz notify_email).
--
-- Zwraca jsonb: order_number + podsumowanie zamówienia + KONTEKST WYSYŁKI
-- e-maili — konsumowany po stronie serwera (server action storefrontu), bo
-- storefront NIE ma klucza service-role (twarda konwencja, patrz
-- apps/storefront/lib/supabase-server.ts), więc RPC jest jedyną
-- uprzywilejowaną ścieżką do tych danych. notify_email pochodzi WYŁĄCZNIE z
-- email_sender.reply_to — adresu biznesowego wskazanego przez operatora do
-- korespondencji z klientem (i tak jawnego w Reply-To e-maili klienta). BEZ
-- fallbacku na e-mail ownera z auth.users: to prywatny adres konta, a
-- odpowiedź RPC czyta każdy bezpośredni wołający — fallback byłby wyciekiem
-- PII jednym żądaniem. Brak reply_to → notify_email = null, a warstwa e-maili
-- raportuje uczciwie powód niewysłania (wzorzec 8b). Kontekst NIE trafia do
-- przeglądarki — kontrakt CheckoutResult 2.4b go nie zawiera.
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
  v_order_id uuid;
  v_order_number text;
  v_reply_to text;
  v_sender jsonb;
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
  -- zamiast chronić (lekcja ADR-024/ADR-035). Stałe (3/24h, 30/1h) w funkcji
  -- z komentarzem — tuning później, gdy będzie ruch produkcyjny.
  --
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
  -- Limit per tenant: 30 publicznych pending/unpaid na godzinę.
  if v_tenant_recent >= 30 then
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
  -- Limit per klient: 3 publiczne pending/unpaid na dobę.
  if v_customer_recent >= 3 then
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
    delivery_grosze, terms_accepted_at, terms_version, source
  )
  values (
    p_tenant_id, v_customer_id, p_start_date, p_end_date, p_delivery_method,
    v_pickup, nullif(btrim(coalesce(p_notes, '')), ''),
    v_total_rental, v_total_deposit, v_delivery, now(), btrim(p_terms_version),
    'storefront'
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
    'notify_email', v_reply_to
  );
end;
$$;

comment on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text) is
  'Publiczny checkout storefrontu (ADR-042): jedyna anonowa ścieżka ZAPISU zamówienia. Kwoty i egzemplarze liczy/przypisuje SERWER (klient nie niesie kwot); INSERT orders+items przez bramki 0010/0015 (pending/unpaid, wyścig o egzemplarz zatrzymany advisory lockiem); throttle w bazie (3/24h per klient, 30/1h per tenant — bezpośrednie RPC omija bramki storefrontu). SECURITY DEFINER, tenant_id z parametru. Zwraca order_number + podsumowanie + kontekst wysyłki e-maili (server-only; notify_email wyłącznie z email_sender.reply_to — zero PII z auth.users). Odmowy: 22023 / 23P01.';

revoke all on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text) from public;
grant execute on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text) to anon, authenticated;
