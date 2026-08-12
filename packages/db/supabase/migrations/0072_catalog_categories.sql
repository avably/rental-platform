-- 0072_catalog_categories.sql
-- Taksonomia katalogu: kategorie per najemca + przypisanie produktów (ADR-155).
--
-- STAN PRZED: katalog jest PŁASKĄ listą. Nie ma ani tabeli kategorii, ani
-- kolumny na `products` — zero trafień na „categor" we wszystkich migracjach.
-- Skutek widać w dwóch miejscach naraz: najemca z 200 pozycjami nie ma jak
-- pogrupować oferty w panelu, a sklep nie ma czego pokazać na stronie
-- kategorii (Faza 7 kreatora jest zablokowana U FUNDAMENTU, nie w kreatorze).
--
-- STAN PO:
--   * public.catalog_categories — kategorie per najemca (nazwa, slug, opis,
--     kolejność), PŁASKIE (bez rodzica),
--   * public.product_categories — przypisanie WIELE-DO-WIELU produkt↔kategoria,
--   * app.reserved_store_paths() — lista pierwszych segmentów ścieżki sklepu,
--     których slug kategorii nie może przejąć (lustro RESERVED_CATEGORY_SLUGS
--     z @avably/core),
--   * app.catalog_category_guard — trigger odrzucający slug zarezerwowany (22023),
--   * app.get_public_catalog — ADDYTYWNIE: `categories` w kopercie i
--     `category_ids` przy produkcie,
--   * app.import_catalog — ADDYTYWNIE: klucz `categories` (slugi) w wierszu.
--
-- ========================= TRZY ROZSTRZYGNIĘCIA =========================
--
-- 1. TAKSONOMIA PŁASKA, NIE DRZEWO. Zagnieżdżenie kosztuje rekurencję
--    w KAŻDYM zapytaniu (strona kategorii musi zebrać potomków), w UI (drzewo
--    z przeciąganiem zamiast listy) i w regułach (czy produkt z podkategorii
--    liczy się do rodzica? czy usunięcie rodzica kasuje dzieci?) — a katalog
--    wypożyczalni sprzętu ma rząd wielkości 10–40 kategorii, gdzie drzewo nie
--    zwraca się nigdy. Gdy zawoła rynek, kolumna `parent_id` dojdzie migracją
--    do tabeli, która już istnieje; odwrotna droga (rozbicie drzewa na płasko
--    po tym, jak najemcy zbudowali w nim strukturę) jest migracją DANYCH.
--
-- 2. WIELE KATEGORII NA PRODUKT. „Namiot 4-osobowy" należy do „Namiotów"
--    i do „Zestawów rodzinnych" naraz — wymuszenie jednej kategorii zmusiłoby
--    najemcę do duplikowania pozycji katalogu, czyli do rozdwojenia stanu
--    magazynowego. Kosztem jest tabela łącząca zamiast kolumny; to jest tania
--    cena za brak duplikatów sprzętu.
--
-- 3. DELETE KATEGORII: WYŁĄCZNIE WŁAŚCICIEL (jak products/pickup_locations,
--    a NIE jak pricing_tiers). Próg cenowy jest konfiguracją odwracalną
--    wpisem — pracownik musi móc poprawić własną pomyłkę w cenniku. Kategoria
--    jest czymś innym: od Fazy 7 niesie ADRES w sklepie, więc jej usunięcie
--    gasi publiczny URL (i to taki, który zdążył się zaindeksować), a przy
--    okazji zdejmuje przypisanie z każdego produktu kaskadą. To nie jest
--    czynność lady. PRZYPISANIE produktu do kategorii jest odwrotnie: to
--    codzienne porządkowanie oferty, więc `product_categories` wstawia
--    i kasuje KAŻDY członek.
--
-- SLUG ZAREZERWOWANY — BRAMKA STOI W BAZIE. Zod w panelu nie chroni niczego:
-- surowe API PostgREST ma tę samą drogę do tabeli co formularz. Wzorzec
-- w całości z 0023 (`app.reserved_subdomains`): lista w JEDNEJ funkcji
-- (żeby test mógł ją ODCZYTAĆ i porównać z TS-em), odmowa kodem 22023
-- (PostgREST mapuje na 400), komunikat po polsku i bezpieczny do pokazania
-- wprost w formularzu.
--
-- DLACZEGO TRIGGER, A NIE CHECK. CHECK nie może wołać funkcji, która ma
-- pokazać sensowny komunikat — jego 23514 mówi wyłącznie nazwę ograniczenia.
-- Guard jest tu wzorcem repo (app.custom_field_definitions_guard z 0057)
-- i daje operatorowi zdanie, które da się przeczytać. KSZTAŁT sluga zostaje
-- deklaratywnym CHECK-iem: to warunek stały, nie lista, która się zmienia.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md):
--   * tabele per-tenant: tenant_id + indeks od tenant_id + RLS w tej samej
--     migracji + wpisy w SAMPLE_ROW_FACTORIES/MUTATION_PATCHES (macierz RLS),
--   * polityki wg 0060/ADR-126: przy KAŻDYM członie `tenant_id = app.tenant_id()`
--     stoi `(select app.is_current_tenant_member())`, superadmin przez
--     `(select app.is_current_superadmin())`, owner przez `(select app.is_tenant_owner())`,
--   * revoke all PRZED grantami na nowej tabeli,
--   * funkcje z przypiętym search_path + revoke from public w tym samym pliku,
--   * kody odmów wyłącznie standardowe: 22023 (slug zarezerwowany, nieznana
--     kategoria w imporcie), 23505 (duplikat sluga/nazwy), 23514 (kształt),
--     42501 (RLS). Zero P0xxx — PostgREST zamienia je na gołe 500.

-- === BEGIN PROD MIGRATION 0072 ===

-- ---------------------------------------------------------------------
-- 1. app.reserved_store_paths() — jedno źródło prawdy po stronie bazy
-- ---------------------------------------------------------------------
--
-- IMMUTABLE i bez dostępu do tabel: to stała, nie zapytanie. Osobna funkcja
-- (zamiast literału w warunku) po to, by test mógł ODCZYTAĆ zbiór i porównać
-- go z RESERVED_CATEGORY_SLUGS — bramka anty-rozjazdowa potrzebuje czegoś,
-- co da się zapytać (dokładnie jak app.reserved_subdomains w 0023).

create or replace function app.reserved_store_paths()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  -- LUSTRO RESERVED_CATEGORY_SLUGS z packages/core/src/catalog/categories.ts.
  -- Zmiana po jednej stronie bez drugiej pali
  -- packages/db/test/catalog-categories.test.ts.
  select array[
    -- trasy sklepu najemcy: apps/storefront/app/(tenant)/*
    'cart',
    'checkout',
    'privacy',
    'product',
    'prywatnosc',
    'regulamin',
    'store',
    'terms',
    -- trasy platformowe w korzeniu KAŻDEGO hosta
    'api',
    'embed',
    -- dynamiczny segment [locale] osi marketingowej dopasowuje się także na
    -- hoście tenanta (patrz apps/storefront/proxy.ts)
    'en',
    'pl',
    -- prefiks przyszłych stron kategorii (Faza 7) — rezerwacja z wyprzedzeniem
    -- kosztuje jedno słowo, odebranie działającego adresu kosztuje SEO najemcy
    'category',
    'kategoria'
  ]::text[];
$$;

comment on function app.reserved_store_paths() is
  'Pierwsze segmenty ścieżki sklepu, których nie wolno wziąć slugiem kategorii. LUSTRO RESERVED_CATEGORY_SLUGS z @avably/core (packages/core/src/catalog/categories.ts) — zgodności obu zbiorów pilnuje packages/db/test/catalog-categories.test.ts.';

revoke all on function app.reserved_store_paths() from public, anon;
-- authenticated: funkcję wykonuje trigger guard w kontekście roli PISZĄCEJ
-- wiersz kategorii (guard jest SECURITY INVOKER), więc bez tego grantu
-- INSERT do catalog_categories padałby na braku EXECUTE.
grant execute on function app.reserved_store_paths() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. public.catalog_categories
-- ---------------------------------------------------------------------
create table public.catalog_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  name text not null,
  -- Slug jest częścią ADRESU, nie etykietą: małe litery ASCII, cyfry
  -- i pojedyncze myślniki w środku. Bez diakrytyków świadomie — „ą" w połowie
  -- klientów kończy jako procentowa papka w linku wklejonym na Facebooku.
  slug text not null,
  description text,
  position int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Klucz kandydujący dla FK ZŁOŻONYCH z product_categories: przypisanie nie
  -- może wskazać kategorii innego najemcy (wzorzec 0007 — to jest bramka
  -- spójności tenanta, której RLS nie zapewnia).
  constraint catalog_categories_tenant_id_key unique (tenant_id, id),

  constraint catalog_categories_name_length
    check (length(btrim(name)) between 1 and 80),
  constraint catalog_categories_slug_shape
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  -- Pusty opis jest NIEREPREZENTOWALNY, żeby „brak opisu" miał jedną postać
  -- (NULL) — inaczej strona kategorii musiałaby rozróżniać NULL od ''.
  constraint catalog_categories_description_length
    check (description is null or length(btrim(description)) between 1 and 500),
  constraint catalog_categories_position_range
    check (position between 0 and 9999)
);

-- Listowanie w panelu i w sklepie idzie DOKŁADNIE tym porządkiem.
create index catalog_categories_tenant_position_idx
  on public.catalog_categories (tenant_id, position, name);

-- Slug jest adresem — dwie kategorie o tym samym slugu to dwie strony pod
-- jednym URL-em, czyli wynik zależny od kolejności odczytu.
create unique index catalog_categories_tenant_slug_key
  on public.catalog_categories (tenant_id, slug);

-- Nazwa jest tym, co operator widzi na liście i w wyborze przy produkcie.
-- Dwie żywe kategorie o tej samej nazwie dają wybór, którego nie da się
-- rozstrzygnąć okiem. Bez względu na wielkość liter i otaczające spacje.
create unique index catalog_categories_tenant_name_key
  on public.catalog_categories (tenant_id, lower(btrim(name)));

comment on table public.catalog_categories is
  'Kategoria katalogu per najemca (ADR-155). Taksonomia PŁASKA (bez rodzica), produkt może należeć do wielu. Odczyt i zapis: każdy członek tenanta (porządkowanie oferty to praca lady). DELETE: wyłącznie właściciel — od Fazy 7 kategoria niesie publiczny adres sklepu.';
comment on column public.catalog_categories.slug is
  'Segment adresu strony kategorii (Faza 7: /kategoria/{slug}). Kształt wymusza CHECK catalog_categories_slug_shape, kolizję ze ścieżką systemową sklepu — trigger catalog_categories_guard (22023, app.reserved_store_paths).';
comment on column public.catalog_categories.position is
  'Kolejność prezentacji kategorii (0..9999). Numeracja GĘSTA nadawana przez panel; remisy rozstrzyga nazwa.';

-- ---------------------------------------------------------------------
-- 3. public.product_categories — przypisanie wiele-do-wielu
-- ---------------------------------------------------------------------
--
-- Bez własnego `id`: wiersz JEST faktem („ten produkt należy do tej
-- kategorii"), a nie encją o własnym życiu. Klucz główny (tenant_id,
-- product_id, category_id) daje przy okazji indeks od tenant_id wymagany
-- konwencją i czyni podwójne przypisanie niereprezentowalnym.
--
-- KOLUMNA created_at NIE JEST OZDOBĄ: macierz izolacji RLS wymaga dla każdej
-- tabeli per-tenant PATCHA mutacji, czyli kolumny, której skuteczna zmiana
-- byłaby WIDOCZNA. Tabela z samymi kolumnami kluczowymi nie miałaby takiej
-- kolumny i wypadłaby z połowy macierzy (patrz MUTATION_PATCHES).
create table public.product_categories (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  category_id uuid not null,
  created_at timestamptz not null default now(),

  constraint product_categories_pkey primary key (tenant_id, product_id, category_id),

  constraint product_categories_product_fk
    foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete cascade,

  constraint product_categories_category_fk
    foreign key (tenant_id, category_id)
    references public.catalog_categories (tenant_id, id) on delete cascade
);

-- „Które produkty są w tej kategorii" — zapytanie strony kategorii (Faza 7).
-- Klucz główny obsługuje kierunek odwrotny (produkt → kategorie).
create index product_categories_tenant_category_idx
  on public.product_categories (tenant_id, category_id, product_id);

comment on table public.product_categories is
  'Przypisanie produktu do kategorii katalogu (ADR-155), wiele-do-wielu. FK ZŁOŻONE po (tenant_id, …) — przypisanie do cudzego produktu lub cudzej kategorii jest niereprezentowalne. Bez UPDATE: wiersz jest faktem, zmiana = usunięcie i wstawienie.';

-- ---------------------------------------------------------------------
-- 4. app.catalog_category_guard — bramka sluga zarezerwowanego
-- ---------------------------------------------------------------------
--
-- SECURITY INVOKER (domyślny) świadomie: funkcja nie potrzebuje żadnego
-- przywileju ponad wołającego — czyta wyłącznie stałą.
--
-- `lower(btrim(...))` przed porównaniem, choć CHECK kształtu i tak dopuszcza
-- wyłącznie małe litery bez spacji: normalizacja sprawia, że bramka nie zależy
-- od tego, czy CHECK kiedyś zelżeje (wzorzec 0023). Rozluźnienie kształtu bez
-- tej normalizacji otworzyłoby po cichu furtkę `Checkout`.
--
-- `updated_at` stemplujemy tu, a nie osobnym triggerem: jedno przejście po
-- wierszu zamiast dwóch, a kolumna i tak nie ma innego źródła prawdy.
create or replace function app.catalog_category_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  if lower(btrim(new.slug)) = any (app.reserved_store_paths()) then
    raise exception
      'Adres „%" jest zarezerwowany przez sklep — wybierz inny.', lower(btrim(new.slug))
      using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

comment on function app.catalog_category_guard() is
  'Trigger BEFORE INSERT OR UPDATE na public.catalog_categories: odrzuca slug kolidujący ze ścieżką systemową sklepu (22023, app.reserved_store_paths) i stempluje updated_at przy aktualizacji.';

-- Funkcja wyzwalacza NIE dostaje EXECUTE dla ról API: uprawnienie sprawdza się
-- przy `create trigger` względem właściciela tabeli (docs/konwencje-migracji.md).
-- Sam revoke jest obowiązkowy — bez niego `create function` zostawia EXECUTE
-- dla PUBLIC, a schemat `app` jest wystawiony przez PostgREST (bramka
-- packages/db/test/function-acls.test.ts).
revoke all on function app.catalog_category_guard() from public, anon, authenticated;

create trigger catalog_categories_guard
  before insert or update on public.catalog_categories
  for each row execute function app.catalog_category_guard();

-- ---------------------------------------------------------------------
-- 5. RLS + granty
-- ---------------------------------------------------------------------
alter table public.catalog_categories enable row level security;
alter table public.product_categories enable row level security;

-- REVOKE PRZED GRANT-em (wzorzec 0006/0007): bez tego `alter default
-- privileges` zostawia rolom API komplet uprawnień, w tym TRUNCATE — które
-- NIE PODLEGA RLS i czyści tabelę mimo najszczelniejszych polityk.
revoke all on public.catalog_categories from anon, authenticated;
revoke all on public.product_categories from anon, authenticated;

-- anon nie dostaje NIC: sklep publiczny czyta kategorie WYŁĄCZNIE przez
-- app.get_public_catalog (SECURITY DEFINER, jawnie wybrane kolumny) — grant
-- na tabelę wystawiłby przez PostgREST także kategorie najemców, których
-- sklep jest wyłączony.
grant select, insert, update, delete on public.catalog_categories to authenticated, service_role;

-- product_categories BEZ UPDATE dla kogokolwiek: wiersz nie ma kolumny, którą
-- dałoby się sensownie zmienić (klucz + znacznik czasu). Brak grantu jest tu
-- pierwszą z dwóch bramek; drugą jest brak polityki UPDATE niżej.
grant select, insert, delete on public.product_categories to authenticated, service_role;

-- --- Polityki (kształt wg 0060/ADR-126) ---

-- catalog_categories
create policy tenant_select on public.catalog_categories for select
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
create policy tenant_insert on public.catalog_categories for insert
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
create policy tenant_update on public.catalog_categories for update
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
-- DELETE zastrzeżone dla właściciela — patrz rozstrzygnięcie 3 w nagłówku.
create policy tenant_delete on public.catalog_categories for delete
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );

-- product_categories: BRAK polityki UPDATE jest CELOWY i jest połową
-- mechanizmu (drugą połową jest brak grantu wyżej). RLS jest fail-closed,
-- więc brak polityki = brak dostępu.
create policy tenant_select on public.product_categories for select
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
create policy tenant_insert on public.product_categories for insert
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
create policy tenant_delete on public.product_categories for delete
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- ---------------------------------------------------------------------
-- 6. app.get_public_catalog — kategorie w odczycie publicznym (ADDYTYWNIE)
-- ---------------------------------------------------------------------
--
-- Ciało przepisane w całości z 0065 (create or replace nie umie „dołożyć
-- linii"). JEDYNE zmiany merytoryczne względem tamtej definicji:
--   * klucz `categories` w kopercie — lista kategorii najemcy w JEGO
--     kolejności,
--   * klucz `category_ids` przy produkcie — identyfikatory, nie powtórzone
--     obiekty.
--
-- DLACZEGO IDENTYFIKATORY, A NIE ZAGNIEŻDŻONE OBIEKTY: przy 200 produktach
-- i 3 kategoriach na produkt kopiowanie nazwy i opisu do każdego produktu
-- rozdmuchuje kopertę o rząd wielkości, a konsument i tak buduje mapę
-- `id → kategoria` z listy na górze. To jest ten sam wybór, co przy
-- `custom_fields`: definicje raz, wartości przy encji.
--
-- KATEGORIE PUSTE WYCHODZĄ ŚWIADOMIE. Kategoria bez produktów jest stanem
-- normalnym (operator zakłada ją przed uzupełnieniem oferty), a strona
-- kategorii ma pokazać „pusto", nie 404 — 404 dla adresu, który najemca
-- właśnie utworzył i wkleił do posta, jest gorsze niż pusta lista.
--
-- IZOLACJA: `c.tenant_id = t.id` i `pc.tenant_id = p.tenant_id` — te filtry
-- są tu jedyną bramką, bo funkcja jest SECURITY DEFINER i RLS jej nie dotyczy
-- (dowód mutacyjny: podmiana `c.tenant_id = t.id` na `true` wynosi kategorie
-- cudzego najemcy i pali packages/db/test/catalog-categories.test.ts).
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
      and app.tenant_commercially_active(ten.status)
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
    -- [0072] Kategorie katalogu (ADR-155) — pełne obiekty RAZ, na górze
    -- koperty; produkt niesie same identyfikatory.
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'slug', c.slug,
          'description', c.description,
          'position', c.position
        )
        order by c.position, c.name, c.id
      )
      from public.catalog_categories c
      where c.tenant_id = t.id
    ), '[]'::jsonb),
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
          -- [0072] Kategorie produktu — identyfikatory w kolejności kategorii
          -- (nie w kolejności przypisania), więc pierwsza pozycja jest tą
          -- najwyżej postawioną przez najemcę.
          'category_ids', coalesce((
            select jsonb_agg(pc.category_id order by c.position, c.name, c.id)
            from public.product_categories pc
            join public.catalog_categories c
              on c.tenant_id = pc.tenant_id and c.id = pc.category_id
            where pc.tenant_id = p.tenant_id and pc.product_id = p.id
          ), '[]'::jsonb),
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
  'Publiczny katalog sklepu (0020, bramka statusu 0065): tenant, pola własne zamawiania (0058), KATEGORIE i produkty z ich identyfikatorami kategorii (0072/ADR-155), punkty odbioru, cennik dostaw. SECURITY DEFINER — izolację daje jawny filtr tenant_id w każdym podzapytaniu, nie RLS. NULL dla najemcy poza oknem handlowym.';

revoke all on function app.get_public_catalog(uuid) from public;
grant execute on function app.get_public_catalog(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. app.import_catalog — kategorie w imporcie CSV (ADDYTYWNIE)
-- ---------------------------------------------------------------------
--
-- Ciało przepisane w całości z 0055. JEDYNA zmiana merytoryczna: obsługa
-- klucza `categories` (tablica SLUGÓW) w wierszu.
--
-- KONTRAKT, KTÓRY RÓŻNI SIĘ OD PROGÓW — i to jest świadome:
--   * klucz `categories` NIEOBECNY → przypisania produktu zostają NIETKNIĘTE,
--   * klucz obecny (także pusta tablica) → komplet przypisań ZASTĄPIONY.
-- Progi działają inaczej (brak klucza = progi skasowane), bo istniały od
-- pierwszego dnia formatu wymiany. Kategorie dochodzą do formatu PÓŹNIEJ,
-- więc w obiegu są pliki wyeksportowane BEZ tej kolumny — gdyby ich brak
-- kasował przypisania, pierwszy re-import starego eksportu rozsypałby
-- najemcy całą taksonomię, po cichu i bez błędu.
--
-- SLUG NIEZNANY = ODMOWA CAŁEGO PLIKU (22023), a NIE ciche założenie
-- kategorii. Import jest AKTUALIZACJĄ katalogu, nie miejscem, w którym
-- powstaje taksonomia: literówka w arkuszu tworzyłaby kategorię-widmo
-- z własnym adresem w sklepie. To ta sama granica, co przy cudzym
-- `product_id` — plik odrzucamy w całości i mówimy, którego sluga brakuje.
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
  v_categories int := 0;
  v_row jsonb;
  v_tier jsonb;
  v_slug text;
  v_category_id uuid;
  v_product_id uuid;
  v_existing uuid;
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

    if v_row ? 'categories' and jsonb_typeof(v_row -> 'categories') <> 'array' then
      raise exception 'Pole categories musi być tablicą.' using errcode = '22023';
    end if;

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
        active = (v_row ->> 'active')::boolean
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
        auto_increment_multiplier, buffer_before_days, buffer_after_days, active
      ) values (
        v_tenant,
        v_row ->> 'name',
        v_row ->> 'description',
        (v_row ->> 'base_price_day_grosze')::int,
        (v_row ->> 'deposit_grosze')::int,
        (v_row ->> 'auto_increment_multiplier')::numeric,
        (v_row ->> 'buffer_before_days')::int,
        (v_row ->> 'buffer_after_days')::int,
        (v_row ->> 'active')::boolean
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

    -- [0072] Kategorie: wyłącznie gdy kolumna jest w pliku (patrz nagłówek).
    if v_row ? 'categories' then
      delete from public.product_categories
       where tenant_id = v_tenant
         and product_id = v_product_id;

      for v_slug in
        select lower(btrim(value #>> '{}'))
        from jsonb_array_elements(v_row -> 'categories')
      loop
        if v_slug is null or v_slug = '' then
          continue;
        end if;

        select c.id into v_category_id
          from public.catalog_categories c
         where c.tenant_id = v_tenant
           and c.slug = v_slug;
        if v_category_id is null then
          raise exception 'Kategoria „%" nie istnieje w katalogu tego najemcy.', v_slug
            using errcode = '22023';
        end if;

        -- ON CONFLICT: ten sam slug dwa razy w jednej komórce jest pomyłką
        -- arkusza, nie powodem do odrzucenia pliku — przypisanie i tak jest
        -- jedno (klucz główny), a operator nie ma jak zobaczyć różnicy.
        insert into public.product_categories (tenant_id, product_id, category_id)
        values (v_tenant, v_product_id, v_category_id)
        on conflict do nothing;
        v_categories := v_categories + 1;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'tiers', v_tiers,
    'categories', v_categories
  );
end;
$$;

comment on function app.import_catalog(jsonb) is
  'Atomowy import katalogu z CSV (C3, ADR-112): nowe produkty + aktualizacje + wymiana progów + przypisanie kategorii po slugu (0072/ADR-155) w JEDNEJ transakcji. SECURITY INVOKER — RLS 0007/0072 obowiązuje wewnątrz; tenant wyłącznie z claimu (app.tenant_id()), jawny filtr tenant_id w każdym zapytaniu (dwie warstwy, wzorzec 0054). Odmowy: 22023 (walidacja/cudzy id/nieznana kategoria), 42501 (brak kontekstu najemcy).';

revoke all on function app.import_catalog(jsonb) from public, anon;
grant execute on function app.import_catalog(jsonb) to authenticated;
