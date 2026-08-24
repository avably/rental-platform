-- =====================================================================
-- 0101 — STRONY KATEGORII, fundament danych (Faza A, ADR-244):
--        (1) baner kategorii — kolumna public.catalog_categories.image_path,
--        (2) publiczny odczyt JEDNEJ STRONY kategorii —
--            app.get_public_category_page.
-- =====================================================================
--
-- STAN PRZED: taksonomia katalogu istnieje (0072/ADR-155) — kategorie per
-- najemca (nazwa, slug, opis, kolejność, PŁASKIE) i przypisanie M:N
-- product_categories. Publiczny odczyt niesie kategorie w kopercie katalogu
-- (`categories` + `category_ids` przy produkcie). Czego NIE MA: (a) miejsca na
-- baner kategorii pod kafel na home i hero na stronie kategorii, (b) wąskiego,
-- stronicowanego odczytu pod TRASĘ jednej kategorii (`/kategoria/{slug}`),
-- która nie chce ciągnąć całego katalogu, żeby pokazać jedną półkę oferty.
--
-- ================== OKNO WDROŻENIOWE — NAJOSTRZEJSZY PUNKT ==================
--
-- Migracje jadą na produkcję PRZED kodem. ROZSTRZYGNIĘCIE (wzorzec
-- 0074/0079/0083/0084/0085): NOWA funkcja o WŁASNEJ sygnaturze, której w oknie
-- wdrożenia NIKT nie woła. Ani jeden klucz nie dochodzi do żadnej zastanej
-- koperty i ani jedno ciało zastanej funkcji odczytu publicznego nie zmienia
-- się o bajt. Kolumna `image_path` jest DODATKOWA i NULLowalna, więc każdy
-- czytnik sprzed tej migracji ją po prostu pomija.
--
-- CZEGO TA MIGRACJA NIE RUSZA: app.get_public_catalog (0072), app.get_public_-
-- catalog_page (0085), app.get_public_product (0084), app.get_public_product_-
-- slugs (0083), funkcji dostępności (0081), żadnej polityki RLS, żadnego
-- istniejącego grantu, żadnej istniejącej kolumny. Silnika dostępności NIE
-- duplikuje: pozycje niosą DOKŁADNIE te same pola, z których dostępność liczy
-- już app.get_public_catalog_availability (datę dołoży Faza B).
--
-- ========================= ROZSTRZYGNIĘCIA =========================
--
-- 1. PROJEKCJA POZYCJI JEST LUSTREM KATALOGU, CO DO KLUCZA. Blok
--    `jsonb_build_object` opisujący pozycję jest przepisany co do znaku
--    z NAJŚWIEŻSZEJ definicji app.get_public_catalog_page (0085) / app.get_-
--    public_catalog (0072). To świadome powtórzenie, nie przeoczenie — ten sam
--    wybór, co w 0084/0085: cienka owijka wyprowadzałaby zapytanie spod
--    strażników strukturalnych. Rozjazd projekcji pilnuje test porównujący
--    kopertę kategorii z kopertą katalogu pozycja-po-pozycji na żywej bazie
--    (packages/db/test/category-page.test.ts) — nie komentarz. Dzięki temu
--    klient nie zobaczy na stronie kategorii innej ceny/zdjęcia niż w katalogu.
--
-- 2. TRZY ROZRÓŻNIALNE STANY, bo trasa buduje z nich TRZY różne widoki:
--      * najemca poza oknem handlowym  -> CAŁA koperta NULL (jak w 0085);
--      * slug nieznany u tego najemcy   -> koperta jest, ale `category` = NULL
--                                          i `products` = [] (trasa: 404);
--      * kategoria istnieje, lecz pusta -> `category` = {meta}, `products` = []
--                                          i `total` = 0 (trasa: pusty widok,
--                                          NIE 404 — „w tej kategorii nic nie ma"
--                                          to treść pod istniejącym adresem).
--    Rozróżnienie „brak kategorii vs pusta kategoria" niesie WYŁĄCZNIE
--    obecność obiektu `category` — pusta lista pozycji jest wspólna dla dwóch
--    ostatnich stanów, więc sama w sobie nie rozstrzyga 404.
--
-- 3. STRONICOWANIE JEST W BAZIE, NIE W PAMIĘCI PROCESU (jak 0085). Funkcja
--    oddaje OKNO wyników liczone z `p_page`/`p_page_size` plus `total`, więc
--    koszt odsłony jest O(strony kategorii), a nie O(katalogu). Numer strony
--    zaciśnięty do >= 1, rozmiar strony do <sufit> (48, lustro CATALOG_PAGE_-
--    MAX_SIZE z @avably/core) — bramka nie ODPOWIEDZIALNOŚCI ODCZYTU, nie
--    tajemnicy (katalog jest publiczny). Argument STRONY zamiast OFFSET-u:
--    strona kategorii ma własny numer strony w adresie, a arytmetykę offsetu
--    trzyma tu baza, żeby trasa nie powielała jej po swojej stronie.
--
-- 4. PORZĄDEK POZYCJI JEST TOTALNY I STEROWANY PARAMETREM `p_sort`.
--    Domyślnie (`catalog`/nieznana wartość) — `p.name, p.id`, identycznie
--    z katalogiem. Warianty: `price_asc`/`price_desc` (po cenie bazowej),
--    `newest` (po `created_at` malejąco). KAŻDY wariant domyka się na
--    `p.name, p.id`, więc jest deterministyczny: bez totalnego porządku ta
--    sama pozycja potrafiłaby wejść na dwie strony przy OFFSET. Nieznana
--    wartość `p_sort` NIE jest błędem — schodzi do porządku katalogu (trasa
--    waliduje kształt, baza nie wywraca sklepu za literówkę w adresie).
--    Kolejność w oknie i w projekcji jest TA SAMA (nadana raz przez
--    row_number()), więc adresy `slugs` idą dokładnie z pozycjami strony.
--
-- 5. `image_path` TO TEKSTOWA ŚCIEŻKA, luźno związana (NULL = brak banera).
--    Typ i luźny CHECK długości wzięte ze wzorca ścieżek obrazów w repo
--    (product_images.storage_path — text, length 1..1024). Świadomie NIE
--    przypinamy tu kształtu ścieżki do bucketa/segmentów: maszyneria uploadu
--    banera (bilet, podpisany URL, bucket) powstaje w Fazie C/D i to ona
--    ustali konwencję ścieżki; fundament danych daje wyłącznie miejsce na nią.
--
-- IZOLACJA: SECURITY DEFINER, więc RLS w tym odczycie NIE UCZESTNICZY — jedyną
-- bramką są jawne zawężenia `tenant_id` w KAŻDYM podzapytaniu (kategoria,
-- przypisania i pozycje wyłącznie wskazanego najemcy). `p_tenant_id` przychodzi
-- do sklepu WYŁĄCZNIE z nagłówka wstrzykniętego przez proxy po rozwiązaniu
-- hosta (ADR-039), więc odwiedzający nie ma czym go podmienić. Dowód izolacji
-- (kategoria/pozycje najemcy B nieosiągalne pod najemcą A, slug B pod hostem A
-- => category NULL) jest w packages/db/test/category-page.test.ts.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): `security definer`
-- z przypiętym `set search_path`, jawny filtr `tenant_id`, `revoke all ...
-- from public` + jawne granty w TYM SAMYM pliku, `comment on function`, wpis
-- w ANON_EXECUTE_ALLOWLIST (packages/db/test/function-acls.test.ts). Kolumna
-- dodana idempotentnie (`add column if not exists`, `drop constraint if
-- exists` przed `add constraint`), bez zmian polityk (dziedziczy RLS
-- catalog_categories z 0072).

-- === BEGIN PROD MIGRATION 0101 ===

-- ---------------------------------------------------------------------
-- 1. public.catalog_categories.image_path — baner kategorii
-- ---------------------------------------------------------------------
--
-- NULL = brak banera (stan normalny — kafel/hero renderuje się bez obrazu).
-- Idempotentne: kolumna i ograniczenie dokładane warunkowo, więc powtórne
-- wykonanie migracji jest nieszkodliwe. Bez zmian RLS — kolumna dziedziczy
-- polityki catalog_categories (0072): odczyt/zapis członek tenanta, DELETE
-- właściciel. Zapis banera przez zwykły UPDATE, tą samą polityką co reszta
-- kolumn kategorii; osobna polityka byłaby zbędną powierzchnią do audytu.

alter table public.catalog_categories
  add column if not exists image_path text;

alter table public.catalog_categories
  drop constraint if exists catalog_categories_image_path_shape;
alter table public.catalog_categories
  add constraint catalog_categories_image_path_shape
    check (image_path is null or length(btrim(image_path)) between 1 and 1024);

comment on column public.catalog_categories.image_path is
  'Ścieżka banera kategorii (0101, ADR-244) — pod kafel kategorii na home i hero na stronie kategorii. NULL = brak banera (stan normalny). Tekstowa ścieżka jak product_images.storage_path; kształt ścieżki (bucket/segmenty) ustali maszyneria uploadu w Fazie C/D — tu wyłącznie miejsce na nią i luźny CHECK długości.';

-- ---------------------------------------------------------------------
-- 2. app.get_public_category_page — JEDNA STRONA jednej kategorii
-- ---------------------------------------------------------------------
--
-- Koperta (NULL, gdy najemca poza oknem handlowym — rozstrzygnięcie 2):
--   {"category": {"id","name","slug","description","image_path"} | null,
--    "tenant": {"name","locale","currency"},
--    "page": int, "page_size": int, "total": int,
--    "custom_fields": [...],
--    "products": [ ...pozycje TEJ strony, projekcja == get_public_catalog_page... ],
--    "slugs": [{"id","slug"}...] }

create or replace function app.get_public_category_page(
  p_tenant_id uuid,
  p_slug text,
  p_page integer default 1,
  p_page_size integer default null,
  p_sort text default 'catalog'
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
  -- Zaciski wejścia liczone RAZ. Numer strony >= 1; rozmiar strony w [1, 48]
  -- (48 = lustro CATALOG_PAGE_MAX_SIZE z @avably/core), domyślnie 24 = lustro
  -- CATALOG_PAGE_SIZE. NULL w p_page_size znaczy „użyj domyślnego rozmiaru".
  prm as (
    select
      greatest(coalesce(p_page, 1), 1) as page,
      least(greatest(coalesce(p_page_size, 24), 1), 48) as page_size
  ),
  -- KATEGORIA po (tenant, slug). Zawężenie tenanta jest jawne (join t) — to
  -- jedyna bramka izolacji w SECURITY DEFINER. Zero wierszy = slug nieznany
  -- u tego najemcy (koperta odda `category` = NULL).
  cat as (
    select c.id, c.tenant_id, c.name, c.slug, c.description, c.image_path
    from public.catalog_categories c
    join t on t.id = c.tenant_id
    where c.slug = p_slug
  ),
  -- OKNO WYNIKÓW: aktywne pozycje TEJ kategorii TEGO najemcy, w porządku
  -- sterowanym p_sort i totalnym (rozstrzygnięcie 4). Numer porządkowy rn
  -- nadany RAZ — czyta go i projekcja pozycji, i lista adresów, więc obie idą
  -- tą samą koleją. Slice strony po offsetcie liczonym z prm.
  okno as (
    select
      p.id,
      p.tenant_id,
      row_number() over (
        order by
          case when p_sort = 'price_asc'  then p.base_price_day_grosze end asc,
          case when p_sort = 'price_desc' then p.base_price_day_grosze end desc,
          case when p_sort = 'newest'     then p.created_at end desc,
          p.name, p.id
      ) as rn
    from public.products p
    join cat on cat.tenant_id = p.tenant_id
    join public.product_categories pc
      on pc.tenant_id = cat.tenant_id
     and pc.category_id = cat.id
     and pc.product_id = p.id
    where p.tenant_id = cat.tenant_id and p.active
    order by rn
    offset (select (page - 1) * page_size from prm)
    limit  (select page_size from prm)
  )
  select case when t.id is null then null else jsonb_build_object(
    -- Obecność `category` rozstrzyga 404 na trasie (rozstrzygnięcie 2): brak
    -- wiersza w `cat` => scalar subquery zwraca NULL => "category": null.
    'category', (
      select jsonb_build_object(
        'id', cat.id,
        'name', cat.name,
        'slug', cat.slug,
        'description', cat.description,
        'image_path', cat.image_path
      )
      from cat
    ),
    'tenant', jsonb_build_object('name', t.name, 'locale', t.locale, 'currency', cur.currency),
    'page', (select page from prm),
    'page_size', (select page_size from prm),
    -- LICZBA WSZYSTKICH aktywnych pozycji kategorii, nie tylko tej strony: bez
    -- niej nawigacja nie wie, ile jest stron. Zero, gdy kategorii nie ma albo
    -- jest pusta.
    'total', coalesce((
      select count(*)::int
      from cat
      join public.product_categories pc
        on pc.tenant_id = cat.tenant_id and pc.category_id = cat.id
      join public.products p
        on p.tenant_id = cat.tenant_id and p.id = pc.product_id
      where p.active
    ), 0),
    -- Definicje pól własnych zamawiania — JEDNO źródło prawdy (jak w kopercie
    -- katalogu i strony katalogu).
    'custom_fields', app.get_public_custom_fields(t.id),
    -- PROJEKCJA POZYCJI == app.get_public_catalog_page (0085) co do klucza
    -- (rozstrzygnięcie 1). Re-join do products z jawnym zawężeniem tenanta,
    -- porządek z rn okna.
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
          'custom_fields', coalesce((
            select jsonb_object_agg(d.id::text, p.custom_fields -> d.id::text)
            from public.custom_field_definitions d
            where d.tenant_id = p.tenant_id
              and d.entity = 'product'
              and d.archived_at is null
              and d.show_in_checkout
              and p.custom_fields ? d.id::text
          ), '{}'::jsonb),
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
        order by o.rn
      )
      from okno o
      join public.products p on p.id = o.id and p.tenant_id = o.tenant_id and p.active
    ), '[]'::jsonb),
    -- ADRESY POZYCJI TEJ STRONY — dokładnie dla pozycji, które strona rysuje,
    -- w tej samej kolejności (rn okna).
    'slugs', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug) order by o.rn)
      from okno o
      join public.products p on p.id = o.id and p.tenant_id = o.tenant_id and p.active
    ), '[]'::jsonb)
  ) end
  from cur left join t on true;
$$;

comment on function app.get_public_category_page(uuid, text, integer, integer, text) is
  'JEDNA STRONA jednej kategorii publicznej dla trasy /kategoria/{slug} (0101, ADR-244): {"category"|null,"tenant","page","page_size","total","custom_fields","products","slugs"}. Projekcja pozycji identyczna z app.get_public_catalog_page co do klucza (pilnuje category-page.test.ts). NULL dla najemcy poza oknem handlowym; category=NULL dla sluga nieznanego (trasa: 404); category={meta}+total 0 dla kategorii pustej (trasa: pusty widok, nie 404). p_page zaciśnięty do >=1, p_page_size do 48 (lustro CATALOG_PAGE_MAX_SIZE). p_sort: catalog(domyślnie)/price_asc/price_desc/newest — porządek totalny, nieznana wartość schodzi do katalogu. SECURITY DEFINER: bramką izolacji jest jawny filtr tenant_id, nie RLS. Osobna sygnatura (deploy-before-code) — koperty czytane w oknie wdrożeniowym nie zmieniają kształtu.';

revoke all on function app.get_public_category_page(uuid, text, integer, integer, text) from public;
-- anon: to JEST odczyt publiczny sklepu — strona kategorii buduje z niego kafle
-- tą samą drogą, którą strona katalogu bierze app.get_public_catalog_page.
grant execute on function app.get_public_category_page(uuid, text, integer, integer, text) to anon, authenticated;

-- === END PROD MIGRATION 0101 ===
