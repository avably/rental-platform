-- =====================================================================
-- 0083 — ADRES SPRZĘTU: products.slug + historia adresów (ADR-182)
-- =====================================================================
--
-- Strona sprzętu stoi dziś pod `/product/{uuid}`. Dokument architektury stron
-- (2026-08-12) nazywa cenę tego stanu wprost: „bez sluga strona produktu nie ma
-- szans w Google". Adres z identyfikatorem nie niesie ani jednego słowa, po
-- którym ktokolwiek szuka sprzętu, a jest tym fragmentem strony, który
-- wyszukiwarka czyta jako pierwszy. Ta migracja daje sprzętowi własny adres
-- i pamięć adresów poprzednich.
--
-- ================== OKNO WDROŻENIOWE — NAJOSTRZEJSZY PUNKT ==================
--
-- Migracje jadą na produkcję PRZED kodem. Koperty publicznego odczytu są po
-- stronie sklepu parsowane schematami `.strict()` — nieznany klucz nie jest
-- ignorowany, tylko WYWRACA CAŁĄ STRONĘ. Dołożenie `slug` do koperty
-- `app.get_public_catalog` położyłoby sklepy WSZYSTKICH najemców na czas okna.
--
-- ROZSTRZYGNIĘCIE (wzorzec 0074/0079): NIE DOKŁADAMY DO ŻADNEJ ZASTANEJ
-- KOPERTY ANI JEDNEGO KLUCZA I NIE ZMIENIAMY ANI JEDNEJ ZASTANEJ SYGNATURY.
-- Adresy wychodzą WŁASNĄ, NOWĄ funkcją `app.get_public_product_slugs` — a nowa
-- funkcja nie ma jak niczego zepsuć w oknie, bo w oknie NIKT jej nie woła. To
-- jest dokładnie argument 0079 („nowa funkcja o własnej sygnaturze") postawiony
-- na wyborze 0074 („do tej koperty nie dokładamy ani jednego klucza”).
--
-- Rozważone i odrzucone:
--   (a) KLUCZ `slug` PRZY POZYCJI W `app.get_public_catalog`. Zero dodatkowych
--       podróży — i zero szans na przeżycie okna: backfill niżej daje adres
--       KAŻDEJ pozycji, więc „klucz warunkowy, gdy niepusty" (wzorzec 0076/0077
--       dla stylu i znaku) byłby w praktyce kluczem bezwarunkowym.
--   (b) DRUGI ARGUMENT `app.get_public_catalog(uuid, boolean)`. Zmiana funkcji,
--       którą w oknie woła STARY sklep — ta sama klasa ryzyka, przed którą
--       broniło się 0074.
--   (c) ODCZYT `public.products` WPROST PRZEZ POSTGREST. Anon nie ma na tej
--       tabeli grantu i mieć go nie powinien.
--
-- Koperta nowej funkcji niesie OD RAZU klucz `redirects` (wypełniony), tak jak
-- `app.get_tenant_pages` niesie `pages` i `redirects` jednym torem: proxy i
-- trasa sklepu nie mają robić drugiej podróży do bazy po to, żeby sprawdzić,
-- czy segment jest starym adresem.
--
-- ========================= PIĘĆ ROZSTRZYGNIĘĆ =========================
--
-- 1. ADRES TO `/produkt/{slug}`, A SŁOWO `produkt` WCHODZI NA LISTĘ
--    ZAREZERWOWANĄ. Sklep najemcy jest jednojęzyczny (oś marketingowa `/pl`
--    i `/en` to inna powierzchnia), więc segment jest polski. Konsekwencja jest
--    CICHA i kosztowna: w routingu Next statyczny segment zawsze wygrywa
--    z dynamicznym, więc strona treściowa najemcy o slugu `produkt` nie
--    wyświetliłaby się NIGDY — bez błędu i bez logu. Rezerwacja wchodzi do OBU
--    list w bazie (`app.reserved_page_slugs` i `app.reserved_store_paths`)
--    i do ich lustra w rdzeniu. Angielskie `product` ZOSTAJE na liście: stare
--    adresy mają dalej działać (patrz 308 w trasie sklepu).
--
-- 2. SLUG RODZI SIĘ Z NAZWY — W BAZIE, NIE W FORMULARZU. Panel sprzed tej
--    zmiany wstawia produkt BEZ sluga; gdyby adres powstawał wyłącznie
--    w formularzu, w oknie wdrożeniowym rodziłby się sprzęt bez adresu.
--    Dlatego pusty slug znaczy „wygeneruj z nazwy", a nie „brak adresu",
--    i robi to trigger. To jest cała treść zdania „zero zmian widocznych":
--    stary panel działa, a każdy jego produkt ma adres od pierwszej chwili.
--
-- 3. UNIKAT PER NAJEMCA, NIE GLOBALNY. Sklepy stoją na różnych hostach, więc
--    `rower-gorski` u dwóch najemców to dwa różne adresy i żaden z nich nie
--    ma prawa wskazać cudzego sprzętu. Bramką jest indeks
--    `products_slug_unique_idx (tenant_id, slug)` oraz jawne zawężenie
--    `tenant_id` w funkcji odczytu (SECURITY DEFINER — RLS w niej NIE
--    uczestniczy).
--
-- 4. ZMIANA ADRESU ZOSTAWIA ŚLAD, A WPIS ROBI TRIGGER `SECURITY DEFINER`
--    (rozstrzygnięcie 2 z 0075, przeniesione co do znaczenia). `authenticated`
--    dostaje na tabeli historii SAM `SELECT`. Gdyby dostał `INSERT`, członek
--    wstawiłby wiersz surowym PostgREST-em i przekierował adres, którego nigdy
--    nie miał — z pominięciem jedynej ścieżki, która ten adres nadaje.
--    Sprzęt przenoszony kilka razy zostawia N starych adresów i KAŻDY prowadzi
--    do bieżącego.
--
-- 5. STARY ADRES JEST ZABLOKOWANY DO PONOWNEGO UŻYCIA. Bez tego przekierowanie
--    zaczęłoby po cichu prowadzić pod INNY sprzęt: najemca przenosi „Rower
--    górski" z `/produkt/rower` na `/produkt/rower-gorski`, po miesiącu
--    wystawia inny rower pod `/produkt/rower`, a wszyscy ze starym linkiem
--    lądują nie tam, gdzie wskazywał. Sprzęt, który adres ZOSTAWIŁ, może pod
--    niego wrócić.
--
-- CZEGO TA MIGRACJA NIE RUSZA: `app.get_public_catalog` (bajtowo bez zmian —
-- to jest dowód okna wdrożeniowego), `app.get_public_catalog_availability`,
-- `app.get_public_availability*`, `app.public_checkout`, `app.import_catalog`
-- (wstawia produkt bez sluga, więc adres nadaje mu trigger), `app.publish_site`,
-- `app.get_tenant_pages`, polityki RLS tabeli `products`.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): nowa tabela dostaje RLS,
-- komplet polityk z predykatem żywego członkostwa (0060/ADR-126), jawne granty
-- i indeks od `tenant_id`; każda funkcja `app.*` dostaje
-- `revoke all ... from public` i jawne granty w TYM SAMYM pliku.

-- === BEGIN PROD MIGRATION 0083 ===

-- ---------------------------------------------------------------------
-- 1. app.slugify — normalizacja nazwy na adres (LUSTRO rdzenia)
-- ---------------------------------------------------------------------
--
-- Lustro `slugifyName` z packages/core/src/slug.ts, na którym stoją
-- `suggestProductSlug`, `suggestPageSlug` i `suggestCategorySlug`. Baza musi
-- mieć własną kopię, bo to ONA nadaje adres produktowi wstawionemu bez sluga
-- (rozstrzygnięcie 2) — a Postgres nie zaimportuje stałej z TypeScriptu.
-- Zgodności obu implementacji pilnuje packages/db/test/product-slug.test.ts.
--
-- Diakrytyki zdejmujemy rozkładem NFD i usunięciem znaków łączących
-- (U+0300..U+036F), dokładnie jak rdzeń. Zakres zapisany przez `chr()`, a nie
-- literałem: literalne znaki łączące w pliku migracji są NIEWIDOCZNE w edytorze
-- i w diffie, więc pierwsza „porządkująca" edycja skasowałaby je bez śladu.
-- „ł" nie ma postaci rozłożonej i wymaga jawnego podstawienia — inaczej
-- „łódki" dałoby „dki".
--
-- IMMUTABLE: wynik zależy wyłącznie od argumentu (żadnych tabel, żadnego
-- czasu), więc funkcja może stać w wyrażeniach indeksowanych i w CHECK-ach.

create or replace function app.slugify(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(
           left(
             regexp_replace(
               regexp_replace(
                 replace(
                   lower(
                     regexp_replace(
                       normalize(coalesce(p_text, ''), nfd),
                       '[' || chr(768) || '-' || chr(879) || ']', '', 'g'
                     )
                   ),
                   'ł', 'l'
                 ),
                 '[^a-z0-9]+', '-', 'g'
               ),
               '(^-+)|(-+$)', '', 'g'
             ),
             60
           ),
           '-+$', ''
         );
$$;

comment on function app.slugify(text) is
  'Nazwa → kandydat na adres (0083, ADR-182): NFD + zdjęcie znaków łączących, „ł"→„l", małe litery, nieliterowe znaki na myślnik, przycięcie do 60. LUSTRO slugifyName z packages/core/src/slug.ts — zgodności pilnuje packages/db/test/product-slug.test.ts. Wynikiem MOŻE być pusty string (nazwa złożona wyłącznie ze znaków, które odpadają) — wołający musi to sprawdzić.';

revoke all on function app.slugify(text) from public, anon;
-- authenticated: funkcję wykonuje trigger nadający adres, a ten jest SECURITY
-- INVOKER i biegnie w kontekście roli PISZĄCEJ wiersz produktu — bez tego
-- grantu INSERT do products padałby na braku EXECUTE.
grant execute on function app.slugify(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. LISTY ADRESÓW ZAREZERWOWANYCH przyjmują `produkt`
-- ---------------------------------------------------------------------
--
-- Obie listy przepisane w całości z ostatnich definicji (0072 i 0073) z JEDNYM
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
-- 3. products.slug — adres sprzętu
-- ---------------------------------------------------------------------
--
-- BEZ BLIŹNIAKA `*_published` i to jest różnica względem stron (0073). Kanon
-- ADR-091 żąda bliźniaka dla danych, które mają DWA stany: roboczy w panelu
-- i widoczny w sklepie. Pozycja katalogu takich dwóch stanów nie ma — nazwa,
-- cena i zdjęcia idą do sklepu w chwili zapisu, bez publikacji — więc bliźniak
-- adresu byłby jedyną daną produktu wymagającą publikacji i wprowadzałby stan
-- „adres w panelu inny niż w sklepie", którego operator nie ma gdzie zobaczyć.
--
-- `default ''` obsługuje wiersze istniejące bez osobnego backfillu W KODZIE
-- i — co ważniejsze — sprawia, że PANEL SPRZED TEJ ZMIANY dalej działa: wstawia
-- produkt bez sluga, a adres nadaje mu trigger z sekcji 7.

alter table public.products
  add column if not exists slug text not null default '';

-- ---------------------------------------------------------------------
-- 4. public.product_slug_history — stare adresy sprzętu
-- ---------------------------------------------------------------------
--
-- Tabela powstaje PRZED backfillem (sekcja 6), bo generator wolnego adresu
-- omija także adresy leżące w historii — a w chwili backfillu musi mieć czego
-- omijać, nawet jeśli historia jest wtedy pusta.

create table if not exists public.product_slug_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  -- STARY adres sprzętu.
  slug text not null,
  created_at timestamptz not null default now(),

  -- FK ZŁOŻONY, jak w site_slug_history (0075) i product_categories (0072):
  -- wiersz z poprawnym tenant_id nie może wskazać sprzętu CUDZEGO najemcy.
  -- Sam product_id przepuściłby taki wiersz-łącznik dwóch najemców, bo RLS
  -- sprawdza tenant_id WSTAWIANEGO wiersza, a nie rodzica.
  constraint product_slug_history_product_fkey
    foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade,

  -- Lustro CHECK-a `products_slug_shape`.
  constraint product_slug_history_slug_shape
    check (char_length(slug) between 1 and 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- Adres należy do NAJWYŻEJ JEDNEGO sprzętu najemcy — także jako adres stary.
-- To jest ograniczenie, na którym stoi blokada ponownego użycia (sekcja 6).
create unique index if not exists product_slug_history_slug_unique_idx
  on public.product_slug_history (tenant_id, slug);

create index if not exists product_slug_history_product_idx
  on public.product_slug_history (tenant_id, product_id);

comment on table public.product_slug_history is
  'Stare adresy sprzętu najemcy — źródło przekierowań 308 (0083, ADR-182). Wiersze wstawia WYŁĄCZNIE trigger products_record_slug_history przy zmianie products.slug; `authenticated` ma tu sam SELECT, żeby historia nie stała się kanałem przejęcia cudzego adresu.';

alter table public.product_slug_history enable row level security;

revoke all on public.product_slug_history from anon, authenticated;
-- SELECT: panel pokazuje operatorowi, które stare adresy dalej prowadzą do
-- jego sprzętu, a bramka sluga (SECURITY INVOKER) czyta tę tabelę rolą piszącą.
-- Zapisu NIE MA ŚWIADOMIE — patrz rozstrzygnięcie 4 nagłówka.
grant select on public.product_slug_history to authenticated;
grant select, insert, update, delete on public.product_slug_history to service_role;

-- Polityki w kształcie 0060/ADR-126: przy każdym członie tenantowym predykat
-- ŻYWEGO członkostwa, superadmin osobnym członem, owijka (select …) obowiązkowa.
drop policy if exists tenant_select on public.product_slug_history;
create policy tenant_select on public.product_slug_history
  for select to authenticated
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );

-- ---------------------------------------------------------------------
-- 5. app.product_slug_candidate — WOLNY adres dla nazwy
-- ---------------------------------------------------------------------
--
-- Jedno miejsce, w którym „nazwa sprzętu" zamienia się w „adres, którego nikt
-- u tego najemcy nie zajmuje" — używa go i backfill (sekcja 4), i trigger
-- nadający adres (sekcja 7).
--
-- ZAJĘTY znaczy: stoi przy INNYM sprzęcie ALBO leży w historii jako
-- przekierowanie do innego sprzętu. Drugi człon jest tu po to, żeby
-- automatycznie nadany adres nie przejął cudzego przekierowania — bramka
-- z sekcji 7 broni przed tym ręcznych wpisów, ale generator musi omijać te
-- adresy SAM, inaczej wstawienie sprzętu padałoby odmową, której operator
-- niczym nie wywołał.
--
-- SUFIKS LICZBOWY, nie losowy: `rower-gorski-2` jest adresem, który operator
-- rozumie i poprawi jednym ruchem. Skracanie podstawy przed doklejeniem
-- sufiksu pilnuje limitu 60 znaków z CHECK-a.
--
-- SUFIT 1000 OBROTÓW: przy tysiącu sprzętów o tej samej nazwie oddajemy
-- kandydata mimo kolizji i pozwalamy paść indeksowi unikalnemu (23505).
-- Pętla bez sufitu byłaby w tym miejscu zawieszeniem zapisu, a nie obroną.
--
-- SECURITY INVOKER (domyślny) świadomie: funkcja czyta wyłącznie wiersze,
-- które wołający i tak widzi. Wywołana rolą bez dostępu do cudzego najemcy nie
-- ma jak ujawnić, czy adres jest tam zajęty.

create or replace function app.product_slug_candidate(
  p_tenant_id uuid,
  p_product_id uuid,
  p_name text
)
returns text
language plpgsql
stable
set search_path = pg_catalog, public, app
as $$
declare
  -- Nazwa złożona wyłącznie ze znaków, które odpadają („???"), daje pusty
  -- wynik normalizacji. Adresu pustego nie ma — zostaje rzeczownik rodzajowy.
  v_base text := coalesce(nullif(app.slugify(p_name), ''), 'sprzet');
  v_candidate text;
  v_n int := 1;
begin
  v_candidate := v_base;

  while v_n < 1000 and exists (
    select 1
      from public.products p
     where p.tenant_id = p_tenant_id
       and p.slug = v_candidate
       and (p_product_id is null or p.id is distinct from p_product_id)
    union all
    select 1
      from public.product_slug_history h
     where h.tenant_id = p_tenant_id
       and h.slug = v_candidate
       and (p_product_id is null or h.product_id is distinct from p_product_id)
  ) loop
    v_n := v_n + 1;
    v_candidate :=
      rtrim(left(v_base, greatest(1, 60 - (char_length(v_n::text) + 1))), '-')
      || '-' || v_n::text;
  end loop;

  return v_candidate;
end;
$$;

comment on function app.product_slug_candidate(uuid, uuid, text) is
  'Wolny adres sprzętu dla podanej nazwy (0083, ADR-182): app.slugify + sufiks liczbowy, dopóki adres stoi przy innym sprzęcie albo leży w historii jako przekierowanie do innego sprzętu. SECURITY INVOKER — czyta wyłącznie wiersze widoczne dla wołającego.';

revoke all on function app.product_slug_candidate(uuid, uuid, text) from public, anon;
-- authenticated: woła go trigger nadający adres (SECURITY INVOKER) w kontekście
-- roli piszącej wiersz produktu.
grant execute on function app.product_slug_candidate(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. BACKFILL — każdy zastany sprzęt dostaje adres z nazwy
-- ---------------------------------------------------------------------
--
-- WIERSZ PO WIERSZU, nie jednym `update ... from (row_number)`. Powód jest
-- konkretny: zapytanie zbiorcze widzi TEN SAM snapshot dla wszystkich wierszy,
-- więc dwa sprzęty o nazwie „Rower" dostałyby ten sam adres, a kolizja
-- wyszłaby dopiero na indeksie unikalnym niżej. Pętla widzi adresy nadane
-- w poprzednich obrotach, bo każdy `update` jest osobnym poleceniem.
--
-- Pętla biegnie ZANIM powstanie trigger nadający adres (sekcja 7) — gdyby było
-- odwrotnie, ten sam snapshot wróciłby tylnymi drzwiami, bo trigger też czyta
-- `products`.

do $$
declare
  v_row record;
begin
  for v_row in
    select id, tenant_id, name
      from public.products
     where slug = ''
     order by tenant_id, id
  loop
    update public.products
       set slug = app.product_slug_candidate(v_row.tenant_id, v_row.id, v_row.name)
     where id = v_row.id;
  end loop;
end;
$$;

-- KSZTAŁT ADRESU dopiero PO backfillu: pusty slug jest stanem przejściowym
-- jednej chwili między sekcją 3 a tym miejscem, a nie stanem legalnym.
-- Lustro PRODUCT_SLUG_PATTERN z @avably/core — bez gałęzi pustego stringa,
-- bo sprzęt nie ma odpowiednika strony głównej.

alter table public.products
  drop constraint if exists products_slug_shape;

alter table public.products
  add constraint products_slug_shape
  check (char_length(slug) between 1 and 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

comment on column public.products.slug is
  'Adres sprzętu w sklepie najemcy: `/produkt/{slug}` (0083, ADR-182). Lustro PRODUCT_SLUG_PATTERN z @avably/core. Unikat PER NAJEMCA (products_slug_unique_idx) — sklepy stoją na różnych hostach, więc ten sam adres u dwóch najemców to dwa różne adresy. Pusta wartość na wejściu znaczy „wygeneruj z nazwy" i jest zamieniana przez trigger products_slug_guard; w zapisanym wierszu pusty slug jest niereprezentowalny (CHECK products_slug_shape).';

-- Unikat PEŁNY, nie częściowy: adres pusty jest niereprezentowalny, więc nie
-- ma czego wyłączać z indeksu. Kolejność kolumn od `tenant_id` — ten sam
-- indeks obsługuje odczyt rejestru adresów najemcy.
create unique index if not exists products_slug_unique_idx
  on public.products (tenant_id, slug);

comment on index public.products_slug_unique_idx is
  'Adres sprzętu jest unikalny W OBRĘBIE NAJEMCY (0083, ADR-182). Dwa sprzęty pod jednym adresem dałyby w sklepie cichy, niedeterministyczny wybór wiersza, a nie błąd.';

-- ---------------------------------------------------------------------
-- 7. app.product_slug_guard — nadanie adresu + blokada ponownego użycia
-- ---------------------------------------------------------------------
--
-- SECURITY INVOKER (domyślny): funkcja nie potrzebuje żadnego przywileju ponad
-- wołającego — czyta wyłącznie wiersze jego najemcy.
--
-- ODMOWA 22023, NIE 42501: to jest walidacja wartości, a nie reguła
-- uprawnienia. 42501 przykryłby odmowę oczekiwaną przez macierz izolacji RLS
-- (trigger BEFORE wykonuje się PRZED politykami WITH CHECK) — ta sama pułapka,
-- którą nazwało 0073.
--
-- CZEGO TA BRAMKA NIE ROBI: nie sprawdza listy adresów zarezerwowanych. Adres
-- sprzętu jest DRUGIM segmentem ścieżki (`/produkt/{slug}`), a pod `/produkt`
-- nie stoi ani jedna trasa systemowa — `/produkt/cart` nie ma z czym kolidować.
-- Rezerwacja odbierałaby najemcy adres, nie broniąc niczego.

create or replace function app.product_slug_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  -- (1) PUSTY SLUG ZNACZY „WYGENERUJ", nie „brak adresu" (rozstrzygnięcie 2).
  -- Obejmuje INSERT ze starego panelu, import CSV i wyczyszczenie pola
  -- w formularzu.
  if btrim(coalesce(new.slug, '')) = '' then
    new.slug := app.product_slug_candidate(new.tenant_id, new.id, new.name);
    return new;
  end if;

  -- (2) Adres niezmieniony — bramka nie rusza wiersza. Rozrost historii nie
  -- może zablokować operatorowi zmiany CENY sprzętu, który akurat stoi pod
  -- adresem objętym przekierowaniem (wzorzec 0073, rozstrzygnięcie 4).
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug then
    return new;
  end if;

  -- (3) Adres trzymany przez historię prowadzi GDZIE INDZIEJ. To nie jest
  -- „zajęty" w sensie kolizji (od tego jest 23505 z indeksu unikalnego), tylko
  -- „prowadzi pod inny sprzęt" — dwie różne sytuacje i dwa różne ruchy
  -- naprawcze, więc dwa różne komunikaty.
  if exists (
    select 1
      from public.product_slug_history h
     where h.tenant_id = new.tenant_id
       and h.slug = lower(btrim(new.slug))
       and h.product_id is distinct from new.id
  ) then
    raise exception
      'Adres „%" przekierowuje do innego sprzętu. Najpierw zdejmij to przekierowanie.',
      lower(btrim(new.slug))
      using errcode = '22023';
  end if;

  return new;
end;
$$;

comment on function app.product_slug_guard() is
  'Bramka adresu sprzętu (0083, ADR-182): pusty slug zamienia na wolny adres z nazwy (app.product_slug_candidate), a próbę przejęcia adresu, który historia trzyma jako przekierowanie do INNEGO sprzętu, odrzuca kodem 22023. Patrzy wyłącznie na ZMIANĘ adresu — zapis nieruszający sluga przechodzi zawsze.';

revoke all on function app.product_slug_guard() from public, anon, authenticated;

drop trigger if exists products_slug_guard on public.products;

create trigger products_slug_guard
  before insert or update on public.products
  for each row execute function app.product_slug_guard();

-- ---------------------------------------------------------------------
-- 8. app.record_product_slug_history — jedyna droga wpisu
-- ---------------------------------------------------------------------
--
-- SECURITY DEFINER, bo `authenticated` nie ma i nie ma mieć INSERT-u na tabeli
-- historii (rozstrzygnięcie 4). Uzbrojenie jest wąskie z konstrukcji: trigger
-- patrzy WYŁĄCZNIE na zmianę `products.slug`, a RLS na `products` odcina cudze
-- wiersze, zanim trigger w ogóle wystartuje. Członek może więc zapisać w tej
-- tabeli wyłącznie adres, który przed chwilą sam nosił na własnym sprzęcie.
--
-- KASOWANIE WPISU DLA ADRESU WŁAŚNIE ZAJĘTEGO: sprzęt wracający pod swój dawny
-- adres musi przestać się na niego przekierowywać, inaczej rejestr widziałby
-- ten sam slug i w `products`, i w `redirects`. Pierwszeństwo ma sprzęt, ale
-- pętla „adres → sam do siebie" w kopercie byłaby miną dla każdego kolejnego
-- czytnika.

create or replace function app.record_product_slug_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
begin
  -- Adres, który sprzęt właśnie zajął, przestaje być przekierowaniem.
  delete from public.product_slug_history
   where tenant_id = new.tenant_id
     and slug = new.slug;

  -- Stary adres wchodzi do historii, o ile istniał. Przekierowanie jest tu
  -- BEZWARUNKOWE i to jest świadoma różnica względem stron (0075 miało
  -- checkbox `sites.redirect_old_slug`): adres sprzętu powstaje AUTOMATYCZNIE
  -- z nazwy, więc jego zmiana jest zwykle poprawką literówki albo nazwy, a nie
  -- decyzją „ten adres był pomyłką, niech zniknie". Bezpieczne dla SEO
  -- zachowanie jest w 0075 domyślne; tutaj jest jedyne.
  if old.slug is not null and old.slug <> '' then
    insert into public.product_slug_history (tenant_id, product_id, slug)
    values (new.tenant_id, new.id, old.slug)
    on conflict (tenant_id, slug) do update
      set product_id = excluded.product_id,
          created_at = now();
  end if;

  return new;
end;
$$;

comment on function app.record_product_slug_history() is
  'Zapis starego adresu sprzętu do public.product_slug_history przy zmianie products.slug (0083, ADR-182). SECURITY DEFINER, bo authenticated nie ma INSERT-u na tabeli historii — to jedyna droga wpisu i jest uzbrojona wyłącznie zmianą kolumny, którą RLS tabeli products i tak zawęża do własnego najemcy.';

revoke all on function app.record_product_slug_history() from public, anon, authenticated;

drop trigger if exists products_record_slug_history on public.products;

create trigger products_record_slug_history
  after update of slug on public.products
  for each row
  when (new.slug is distinct from old.slug)
  execute function app.record_product_slug_history();

-- ---------------------------------------------------------------------
-- 9. app.get_public_product_slugs — REJESTR ADRESÓW SPRZĘTU
-- ---------------------------------------------------------------------
--
-- NOWA funkcja o własnej sygnaturze — patrz „OKNO WDROŻENIOWE" w nagłówku.
-- Koperta: {"products":[{"id","slug"}...], "redirects":[{"from","to"}...]}.
--
-- Zakres pozycji jest DOKŁADNIE ten sam, co w `app.get_public_catalog`
-- (aktywne pozycje najemcy w oknie handlowym) — rejestr, który wypuszczałby
-- adres pozycji nieobecnej w katalogu, produkowałby linki prowadzące na 404.
--
-- PRZEKIEROWANIE WYCHODZI TYLKO DLA ŻYWEJ POZYCJI: 308 prowadzące pod adres,
-- który sam oddaje 404, jest gorsze niż jego brak (rozstrzygnięcie 0075).
--
-- IZOLACJA: SECURITY DEFINER, więc RLS w tym odczycie NIE UCZESTNICZY —
-- jedyną bramką są jawne zawężenia `tenant_id` w ciele. `p_tenant_id`
-- przychodzi do sklepu WYŁĄCZNIE z nagłówka wstrzykniętego przez proxy po
-- rozwiązaniu hosta (ADR-039; lib/tenant/headers.ts zdejmuje nagłówki
-- przychodzące bezwarunkowo), więc odwiedzający nie ma czym go podmienić.
-- Dowód mutacyjny (podmiana zawężenia na `true` wynosi cudze adresy) jest
-- w packages/db/test/product-slug.test.ts.

create or replace function app.get_public_product_slugs(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'products', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', p.id, 'slug', p.slug)
          order by p.slug
        )
        from public.products p
        where p.tenant_id = t.id
          and p.active
      ),
      '[]'::jsonb
    ),
    'redirects', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('from', h.slug, 'to', p.slug)
          order by h.slug
        )
        from public.product_slug_history h
        join public.products p
          on p.tenant_id = h.tenant_id
         and p.id = h.product_id
        where h.tenant_id = t.id
          and p.active
      ),
      '[]'::jsonb
    )
  )
  from public.tenants t
  where t.id = p_tenant_id
    and app.tenant_commercially_active(t.status);
$$;

comment on function app.get_public_product_slugs(uuid) is
  'Rejestr ADRESÓW SPRZĘTU najemcy dla sklepu (0083, ADR-182): {"products":[{"id","slug"}...], "redirects":[{"from","to"}...]}. Zakres pozycji identyczny z app.get_public_catalog (aktywne, najemca w oknie handlowym); przekierowanie wychodzi wyłącznie dla pozycji, która dalej jest w katalogu. NULL dla najemcy poza oknem handlowym. SECURITY DEFINER: bramką izolacji jest jawny filtr tenant_id, a nie RLS. Osobna funkcja, a nie klucz w kopercie katalogu — koperty czytane w oknie wdrożeniowym nie mogą zmieniać kształtu (ADR-158/171).';

revoke all on function app.get_public_product_slugs(uuid) from public;
-- anon: to JEST odczyt publiczny sklepu — kafel katalogu buduje adres tą samą
-- drogą, którą bierze sam katalog (app.get_public_catalog).
grant execute on function app.get_public_product_slugs(uuid) to anon, authenticated;

-- === END PROD MIGRATION 0083 ===
