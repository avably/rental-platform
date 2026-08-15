-- =====================================================================
-- 0085 — STRONA KATALOGU: rezerwacja adresu `katalog` + odczyt JEDNEJ STRONY
--        wyników (ADR-186, faza 4b)
-- =====================================================================
--
-- Pełnej listy katalogu nie ma dziś w produkcie. Sekcja `products` pokazuje
-- najwyżej 24 pozycje (sufit `PRODUCTS_LIMITS`) i odsyła „do katalogu" pod
-- `/store` — czyli pod WEWNĘTRZNY adres strony głównej, na której odwiedzający
-- właśnie stoi. Przy 200 pozycjach to nie jest niedoróbka odnośnika, tylko
-- brakująca strona sklepu. Ta migracja daje jej adres i wąski odczyt.
--
-- ================== OKNO WDROŻENIOWE — NAJOSTRZEJSZY PUNKT ==================
--
-- Migracje jadą na produkcję PRZED kodem. ROZSTRZYGNIĘCIE (wzorzec
-- 0074/0079/0083/0084): NOWA funkcja o WŁASNEJ sygnaturze, której w oknie NIKT
-- nie woła. Ani jeden klucz nie dochodzi do żadnej zastanej koperty i ani jedno
-- ciało zastanej funkcji odczytu publicznego nie zmienia się o bajt.
--
-- Zmiana list zarezerwowanych (sekcja 1) jest w oknie NIEGROŹNA z konstrukcji:
-- obie funkcje oddają tablicę tekstów, którą czyta wyłącznie bramka ZAPISU
-- (trigger sluga strony i sluga kategorii). Sklep w oknie nie woła ich wcale,
-- a najgorszy możliwy skutek to odmowa zapisu strony o adresie `katalog` przez
-- panel sprzed tej zmiany — czyli dokładnie to, po co ta lista istnieje.
--
-- ========================= CZTERY ROZSTRZYGNIĘCIA =========================
--
-- 1. `katalog` WCHODZI NA OBIE LISTY ZAREZERWOWANE. W routingu Next statyczny
--    segment ZAWSZE wygrywa z dynamicznym, więc od chwili powstania trasy
--    `/katalog` strona treściowa najemcy o tym adresie nie wyświetliłaby się
--    NIGDY — bez błędu, bez logu i bez żadnego sygnału dla operatora, który
--    widzi ją w panelu jako opublikowaną. Odmowa musi paść w POLU FORMULARZA.
--    Wzorzec i uzasadnienie: 0083 dla słowa `produkt`. Rezerwacja wchodzi do
--    OBU list (`app.reserved_page_slugs`, `app.reserved_store_paths`) i do ich
--    lustra w rdzeniu (`RESERVED_CATEGORY_SLUGS`); rozjazd pali
--    `packages/db/test/site-page-slugs.test.ts` i `catalog-categories.test.ts`.
--
-- 2. STRONICOWANIE JEST W BAZIE, NIE W PAMIĘCI PROCESU. Odczyt całego katalogu
--    i pokazanie z niego 24 pozycji kosztuje przy 200 pozycjach 227 019 bajtów
--    na odsłonę (zmierzone, ADR-185) — czyli dokładnie ten koszt, który faza 4a
--    właśnie zdjęła ze strony sprzętu. Ta funkcja oddaje OKNO wyników
--    (`p_offset`, `p_limit`) plus `total`, więc koszt odsłony jest O(strony),
--    a nie O(katalogu), i nie rośnie razem z ofertą najemcy.
--
-- 3. PORZĄDEK POZYCJI JEST TEN SAM, CO W KATALOGU, I JEST TOTALNY.
--    `order by p.name, p.id` — identyczny z `app.get_public_catalog`. Sam
--    `p.name` nie wystarcza: dwie pozycje o tej samej nazwie dawałyby przy
--    OFFSET porządek niedeterministyczny, a wtedy jedna pozycja potrafi
--    pokazać się na dwóch stronach, a inna na żadnej — awaria cicha i widoczna
--    dopiero jako „nie mogę znaleźć sprzętu, który u was widziałem".
--
-- 4. ADRESY POZYCJI JADĄ RAZEM ZE STRONĄ WYNIKÓW. Rejestr
--    `app.get_public_product_slugs` jest O(katalogu) — użycie go do zbudowania
--    24 odnośników wracałoby do kosztu, który znosi rozstrzygnięcie 2. Koperta
--    niesie więc `slugs` DOKŁADNIE dla pozycji tej strony.
--
-- CZEGO TA MIGRACJA NIE RUSZA: `app.get_public_catalog`, `app.get_public_product`
-- (0084), `app.get_public_product_slugs` (0083), `app.get_public_availability`,
-- `_days`, `_catalog_availability` (0081 — DOSTĘPNOŚĆ zostaje nietknięta co do
-- bajtu i nie ma prawa przechodzić przez żaden cache), `app.public_checkout`,
-- `app.publish_site`, `app.get_tenant_pages`, żadnej tabeli, żadnej kolumny,
-- żadnego indeksu, żadnej polityki RLS, żadnego grantu tabelowego.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): `security definer`
-- z przypiętym `set search_path`, izolacja jawnym filtrem `tenant_id`
-- w KAŻDYM podzapytaniu (SECURITY DEFINER nie podlega RLS),
-- `revoke all ... from public` + jawne granty w TYM SAMYM pliku,
-- `comment on function`, wpis w `ANON_EXECUTE_ALLOWLIST`
-- (`packages/db/test/function-acls.test.ts`).

-- === BEGIN PROD MIGRATION 0085 ===

-- ---------------------------------------------------------------------
-- 1. LISTY ADRESÓW ZAREZERWOWANYCH przyjmują `katalog`
-- ---------------------------------------------------------------------
--
-- Obie listy przepisane w całości z OSTATNIEJ definicji (0083) z JEDNYM
-- dołożonym wpisem. `create or replace` zastępuje całość, więc przepisanie ze
-- starszej wersji cofnęłoby cicho poprawki — poniżej są kopie co do wpisu, nie
-- parafrazy.
--
-- Dlaczego OBIE, skoro zbiory są dziś równe: cykle życia list się rozjadą
-- (strony kategorii z Fazy 7 zejdą piętro niżej i przestaną rezerwować
-- korzeń), a sklejenie ich dziś jednym wywołaniem zamieniłoby jutrzejsze
-- rozdzielenie w migrację ZACHOWANIA zamiast migracji listy.

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
    -- [0085] adres pełnej listy sprzętu: /katalog (ADR-186). Bez tego wpisu
    -- kategoria o slugu `katalog` przejęłaby trasę, którą routing Next i tak
    -- rozstrzyga na korzyść segmentu statycznego.
    'katalog',
    'privacy',
    'product',
    -- [0083] adres strony sprzętu: /produkt/{slug} (ADR-182). Angielskie
    -- `product` ZOSTAJE — stare adresy dostają 308, więc trasa dalej istnieje.
    'produkt',
    'prywatnosc',
    'regulamin',
    'store',
    'terms',
    -- trasy platformowe w korzeniu KAŻDEGO hosta
    'api',
    'embed',
    -- dynamiczny segment [locale] osi marketingowej dopasowuje się także na
    -- hoście najemcy (patrz apps/storefront/proxy.ts)
    'en',
    'pl',
    -- prefiks stron kategorii (Faza 7)
    'category',
    'kategoria'
  ]::text[];
$$;

comment on function app.reserved_store_paths() is
  'Pierwsze segmenty ścieżki sklepu, których nie wolno wziąć slugiem KATEGORII. LUSTRO RESERVED_CATEGORY_SLUGS z @avably/core (packages/core/src/catalog/categories.ts) — zgodności obu zbiorów pilnuje packages/db/test/catalog-categories.test.ts.';

revoke all on function app.reserved_store_paths() from public, anon;
grant execute on function app.reserved_store_paths() to authenticated, service_role;

create or replace function app.reserved_page_slugs()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  -- LUSTRO RESERVED_PAGE_SLUGS z packages/core/src/site/page-slug.ts.
  -- Zmiana po jednej stronie bez drugiej pali
  -- packages/db/test/site-page-slugs.test.ts.
  select array[
    -- trasy sklepu najemcy: apps/storefront/app/(tenant)/*
    'cart',
    'checkout',
    -- [0085] adres pełnej listy sprzętu: /katalog (ADR-186). Bez tego wpisu
    -- strona treściowa najemcy o adresie `katalog` zapisałaby się bez błędu
    -- i NIGDY nie wyświetliła — statyczna trasa Next wygrywa z dynamiczną.
    'katalog',
    'privacy',
    'product',
    -- [0083] adres strony sprzętu: /produkt/{slug} (ADR-182). Bez tego wpisu
    -- strona treściowa najemcy o adresie `produkt` zapisałaby się bez błędu
    -- i NIGDY nie wyświetliła — statyczna trasa Next wygrywa z dynamiczną.
    'produkt',
    'prywatnosc',
    'regulamin',
    'store',
    'terms',
    -- trasy platformowe w korzeniu KAŻDEGO hosta
    'api',
    'embed',
    -- dynamiczny segment [locale] osi marketingowej dopasowuje się także na
    -- hoście najemcy (patrz apps/storefront/proxy.ts)
    'en',
    'pl',
    -- prefiks stron kategorii (Faza 7)
    'category',
    'kategoria'
  ]::text[];
$$;

comment on function app.reserved_page_slugs() is
  'Pierwsze segmenty ścieżki sklepu, których nie wolno wziąć slugiem STRONY. LUSTRO RESERVED_PAGE_SLUGS z @avably/core/site (packages/core/src/site/page-slug.ts) — zgodności obu zbiorów pilnuje packages/db/test/site-page-slugs.test.ts.';

revoke all on function app.reserved_page_slugs() from public, anon;
grant execute on function app.reserved_page_slugs() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. app.get_public_catalog_page — JEDNA STRONA WYNIKÓW
-- ---------------------------------------------------------------------
--
-- Koperta:
--   {"total": int,
--    "tenant": {"name","locale","currency"},
--    "custom_fields": [...],
--    "products": [ ...pozycje TEJ strony... ],
--    "slugs": [{"id","slug"}...] }
--
-- PROJEKCJA POZYCJI JEST LUSTREM KATALOGU, CO DO KLUCZA. Blok
-- `jsonb_build_object` opisujący pozycję jest przepisany co do znaku
-- z NAJŚWIEŻSZEJ definicji `app.get_public_catalog` (0072). To jest świadome
-- powtórzenie, nie przeoczenie — ten sam wybór, co w 0084: cienka owijka
-- wyprowadzałaby zapytanie spod strażników strukturalnych skanujących
-- `pg_get_functiondef`. Rozjazd projekcji pilnuje test porównujący OBIE koperty
-- pozycja-po-pozycji na prawdziwej bazie (`packages/db/test/catalog-page.test.ts`)
-- — nie komentarz.
--
-- CZEGO KOPERTA NIE NIESIE: `categories`, `pickup_locations`,
-- `delivery_methods`. Strona katalogu ich nie rysuje, a wąski odczyt, który
-- dokłada dane „na wszelki wypadek", przestaje być wąski. Powierzchnia, która
-- ich potrzebuje (kasa, koszyk), czyta pełną kopertę katalogu jak dotąd.
--
-- ZACISK `p_limit`: strona wyników ma kosztować O(strony), niezależnie od tego,
-- co poda wołający. Sufit 48 to LUSTRO `CATALOG_PAGE_MAX_SIZE` z @avably/core;
-- zgodności pilnuje test. To nie jest bramka tajemnicy — katalog jest publiczny
-- i `app.get_public_catalog` oddaje go w całości — tylko bramka
-- ODPOWIEDZIALNOŚCI ODCZYTU.
--
-- `p_offset` UJEMNY jest zaciskany do zera zamiast odrzucany: OFFSET < 0 to
-- w Postgresie błąd 2201X, czyli 500 na trasie sklepu za wpisanie znaku minus
-- w adresie. Kształt numeru strony rozstrzyga trasa (`parseCatalogPageParam`
-- → 404), a baza ma się z tego wywiązać bez wywracania sklepu.
--
-- IZOLACJA: SECURITY DEFINER, więc RLS w tym odczycie NIE UCZESTNICZY —
-- jedyną bramką są jawne zawężenia `tenant_id` w KAŻDYM podzapytaniu.
-- `p_tenant_id` przychodzi do sklepu WYŁĄCZNIE z nagłówka wstrzykniętego przez
-- proxy po rozwiązaniu hosta (ADR-039; lib/tenant/headers.ts zdejmuje nagłówki
-- przychodzące bezwarunkowo), więc odwiedzający nie ma czym go podmienić.
-- Dowód mutacyjny (podmiana zawężenia na `true` wynosi cudze pozycje) jest
-- w packages/db/test/catalog-page.test.ts.

create or replace function app.get_public_catalog_page(
  p_tenant_id uuid,
  p_offset integer,
  p_limit integer
)
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
  -- OKNO WYNIKÓW. Zbiór pozycji jest DOKŁADNIE ten sam, co w
  -- `app.get_public_catalog` (aktywne pozycje najemcy w oknie handlowym),
  -- a porządek — ten sam i totalny (rozstrzygnięcie 3).
  okno as (
    select p.id, p.name, p.slug
    from public.products p
    join t on t.id = p.tenant_id
    where p.active
    order by p.name, p.id
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 24), 1), 48)
  )
  select case when t.id is null then null else jsonb_build_object(
    -- LICZBA WSZYSTKICH pozycji, nie tylko tej strony: bez niej nawigacja nie
    -- wie, ile jest stron, a trasa nie wie, czy numer wypada poza zakres.
    'total', (
      select count(*)
      from public.products p
      where p.tenant_id = t.id and p.active
    ),
    'tenant', jsonb_build_object('name', t.name, 'locale', t.locale, 'currency', cur.currency),
    -- Definicje pól własnych zamawiania — JEDNO źródło prawdy o tym, co jest
    -- publiczne (app.get_public_custom_fields), tak jak w kopercie katalogu.
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
      join okno o on o.id = p.id
      where p.tenant_id = t.id and p.active
    ), '[]'::jsonb),
    -- [0083] ADRESY POZYCJI TEJ STRONY (rozstrzygnięcie 4). Rejestr adresów
    -- jest O(katalogu); kafel potrzebuje adresu wyłącznie dla pozycji, które
    -- naprawdę rysuje.
    'slugs', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'slug', o.slug) order by o.name, o.id)
      from okno o
    ), '[]'::jsonb)
  ) end
  from cur left join t on true;
$$;

comment on function app.get_public_catalog_page(uuid, integer, integer) is
  'JEDNA STRONA katalogu publicznego dla trasy /katalog (0085, ADR-186): {"total","tenant","custom_fields","products","slugs"}. Zbiór i porządek pozycji identyczne z app.get_public_catalog (aktywne, najemca w oknie handlowym, order by name, id); projekcja pozycji jest jego lustrem co do klucza — pilnuje tego packages/db/test/catalog-page.test.ts. p_limit zaciśnięty do 48 (lustro CATALOG_PAGE_MAX_SIZE z @avably/core), p_offset do zera. NULL dla najemcy poza oknem handlowym. SECURITY DEFINER: bramką izolacji jest jawny filtr tenant_id, a nie RLS. Osobna funkcja, a nie argument katalogu — koperty czytane w oknie wdrożeniowym nie zmieniają kształtu (ADR-158/171/182/185).';

revoke all on function app.get_public_catalog_page(uuid, integer, integer) from public;
-- anon: to JEST odczyt publiczny sklepu — strona katalogu buduje z niego kafle
-- tą samą drogą, którą pozostałe trasy biorą app.get_public_catalog.
grant execute on function app.get_public_catalog_page(uuid, integer, integer) to anon, authenticated;

-- === END PROD MIGRATION 0085 ===
