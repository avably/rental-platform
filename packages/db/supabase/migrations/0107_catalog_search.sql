-- =====================================================================
-- 0107 — WYSZUKIWARKA KATALOGU: opcjonalny filtr tekstowy w JEDNEJ STRONIE
--        wyników (domknięcie B1, ADR-263; buduje na 0085/ADR-186).
-- =====================================================================
--
-- STAN PRZED: strona `/katalog` (0085) oddaje JEDNĄ stronę wyników
-- (`app.get_public_catalog_page`) — stronicowanie, sort i projekcja są, nie ma
-- WYSZUKIWANIA. Katalog rósł do setek pozycji, a jedyną drogą do znalezienia
-- sprzętu było przewijanie stron. Ta migracja dokłada OPCJONALNY filtr po
-- nazwie i opisie, nie ruszając ani jednego z zastanych rozstrzygnięć 0085.
--
-- ================== OKNO WDROŻENIOWE — NAJOSTRZEJSZY PUNKT ==================
--
-- Migracje jadą na produkcję PRZED kodem. Argument `p_query` jest OPCJONALNY
-- (`default null`), a `null`/pusty schodzi do zachowania zastanego CO DO BAJTU
-- (pełny katalog, jak 0085). Stary czytnik sklepu woła funkcję z TRZEMA
-- argumentami (`p_tenant_id`, `p_offset`, `p_limit`) — nazwanymi, jak PostgREST
-- — i po tej migracji dalej trafia w tę funkcję z `p_query = null`.
--
-- DLACZEGO `drop function` + `create`, a nie samo `create or replace`. Dodanie
-- argumentu ZMIENIA sygnaturę, więc `create or replace` nie zastąpiłoby starej
-- funkcji, tylko dołożyło DRUGIE przeciążenie (3-arg + 4-arg). Wywołanie
-- 3-argumentowe pasowałoby wtedy do OBU (drugie przez default) i Postgres
-- odmawia: „function ... is not unique" — czyli stary sklep leżałby przez całe
-- okno wdrożeniowe. Dlatego zdejmujemy starą sygnaturę i stawiamy JEDNĄ nową
-- (zweryfikowane empirycznie na PG17: po drop+create wywołanie 3-arg, pozycyjne
-- i nazwane, rozwiązuje się jednoznacznie do nowej funkcji z `p_query = null`).
-- Wzorzec `drop function if exists` przy dodawaniu argumentu jest w repo
-- zastany (0029/0058/0059 dla app.public_checkout).
--
-- ========================= ROZSTRZYGNIĘCIA =========================
--
-- 1. PROJEKCJA / SORT / PAGINACJA SĄ LUSTREM 0085 CO DO BAJTU. Blok
--    `jsonb_build_object` opisujący pozycję, porządek `order by p.name, p.id`,
--    zaciski `p_offset`/`p_limit` i kształt koperty (`total`/`tenant`/
--    `custom_fields`/`products`/`slugs`) są PRZEPISANE z najświeższej definicji
--    (0085) bez zmiany. Jedyna różnica to DOŁOŻONY predykat wyszukiwania w
--    dwóch miejscach: oknie wyników i liczniku `total`. Rozjazd projekcji z
--    katalogiem pilnuje `packages/db/test/catalog-page.test.ts` (na żywej
--    bazie), a zachowanie filtra — `packages/db/test/catalog-search.test.ts`.
--
-- 2. `total` LICZY PRZEFILTROWANY ZBIÓR, nie cały katalog. Bez tego nawigacja
--    stron przy aktywnym zapytaniu obiecywałaby strony, których nie ma, a trasa
--    nie umiałaby oddać 404 dla numeru spoza zakresu wyników. Pusty wynik daje
--    `total = 0` i pustą listę — trasa rysuje na stronie pierwszej „brak
--    wyników" (jak katalog pusty daje „katalog w przygotowaniu").
--
-- 3. ZAPYTANIE JEST WEJŚCIEM UŻYTKOWNIKA — PARAMETRYZOWANE, NIGDY SKLEJANE.
--    `p_query` wchodzi WYŁĄCZNIE jako wartość związana w `ilike` (zero
--    konkatenacji do treści zapytania). Metaznaki `LIKE` (`\`, `%`, `_`) są
--    ESKEJPOWANE, więc szukanie „50%" nie dopasowuje wszystkiego, a `_` nie jest
--    dziką kartą — wzorzec składamy jako `'%' || escape(btrim(query)) || '%'` z
--    jawną klauzulą `escape '\'`. Puste/samą-spacją zapytanie schodzi do NULL
--    (brak filtra), więc `?q=` bez treści = pełny katalog.
--
-- 4. CASE-INSENSITIVE PRZEZ `ilike`. `unaccent` i `pg_trgm` NIE są włączone na
--    tej bazie (sprawdzone: `pg_extension` puste dla obu), więc — konserwatywnie
--    — NIE włączamy rozszerzenia w tej migracji: `ilike` jest już
--    nierozróżniające wielkości liter, a katalog jest mały (setki pozycji na
--    najemcę), więc skan bez indeksu jest tani. DŁUG (follow-up, do decyzji
--    właściciela): przy dużych katalogach włączyć `pg_trgm` + indeks GIN
--    trigram (i ewentualnie `unaccent` dla dopasowania bez znaków
--    diakrytycznych) — osobna migracja, bo `create extension` to zmiana schematu
--    o własnym ryzyku. Filtry FASETOWE (cena/wiele kategorii) ŚWIADOMIE
--    ODŁOŻONE — to większy UX do decyzji właściciela (ADR-263).
--
-- IZOLACJA: bez zmian wobec 0085. SECURITY DEFINER, więc RLS w tym odczycie NIE
-- UCZESTNICZY — jedyną bramką są jawne zawężenia `tenant_id` w KAŻDYM
-- podzapytaniu (okno, `total`, projekcja). `p_query` NIE rozluźnia zakresu: jest
-- dodatkowym `AND` po już zawężonym tenancie, więc wyszukiwanie nie ma jak
-- wynieść pozycji innego najemcy. `p_tenant_id` przychodzi WYŁĄCZNIE z nagłówka
-- wstrzykniętego przez proxy po rozwiązaniu hosta (ADR-039), więc odwiedzający
-- nie ma czym go podmienić. Dowód izolacji z zapytaniem (wynik u najemcy A nie
-- niesie pozycji B pasującej nazwą) jest w packages/db/test/catalog-search.test.ts.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): `security definer` z
-- przypiętym `set search_path`, jawny filtr `tenant_id`, `revoke all ... from
-- public` + jawne granty w TYM SAMYM pliku (po `drop`+`create` ACL powstaje od
-- zera — grant to warunek działania anona, nie kosmetyka), `comment on
-- function`. Wpis w ANON_EXECUTE_ALLOWLIST (packages/db/test/function-acls.test.ts)
-- jest keyed po NAZWIE funkcji, więc zmiana sygnatury go nie rusza.

-- === BEGIN PROD MIGRATION 0107 ===

-- ---------------------------------------------------------------------
-- Zdjęcie starej sygnatury 3-argumentowej (patrz nagłówek: bez tego nowa
-- funkcja byłaby DRUGIM przeciążeniem, a wywołanie 3-arg — niejednoznaczne).
-- ---------------------------------------------------------------------
drop function if exists app.get_public_catalog_page(uuid, integer, integer);

create or replace function app.get_public_catalog_page(
  p_tenant_id uuid,
  p_offset integer,
  p_limit integer,
  -- [0107] OPCJONALNY filtr tekstowy. NULL/pusty = pełny katalog (zachowanie
  -- zastane 0085 co do bajtu). Default czyni stary czytnik 3-argumentowy
  -- poprawnym w oknie wdrożeniowym.
  p_query text default null
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
  -- [0107] WZORZEC WYSZUKIWANIA liczony RAZ. NULL, gdy zapytanie puste albo samą
  -- spacją — wtedy predykat niżej degeneruje do `true` i katalog wraca w całości
  -- (zachowanie 0085). Metaznaki LIKE eskejpowane (rozstrzygnięcie 3): `\` musi
  -- pójść pierwszy, żeby nie eskejpować własnych eskejpów `%`/`_`.
  q as (
    select case
      when p_query is null or btrim(p_query) = '' then null
      else '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    end as pattern
  ),
  -- OKNO WYNIKÓW. Zbiór i porządek jak w 0085 (aktywne pozycje najemcy w oknie
  -- handlowym, `order by p.name, p.id`), zawężony DODATKOWO o predykat
  -- wyszukiwania: przy NULL-owym wzorcu predykat jest `true` (pełny katalog).
  okno as (
    select p.id, p.name, p.slug
    from public.products p
    join t on t.id = p.tenant_id
    where p.active
      and (
        (select pattern from q) is null
        or p.name ilike (select pattern from q) escape '\'
        or coalesce(p.description, '') ilike (select pattern from q) escape '\'
      )
    order by p.name, p.id
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 24), 1), 48)
  )
  select case when t.id is null then null else jsonb_build_object(
    -- [0107] LICZBA WSZYSTKICH pozycji PASUJĄCYCH DO ZAPYTANIA (rozstrzygnięcie
    -- 2), nie całego katalogu: nawigacja stron i bramka 404 trasy liczą z niej
    -- przy aktywnym filtrze. Ten sam predykat, co w oknie.
    'total', (
      select count(*)
      from public.products p
      where p.tenant_id = t.id and p.active
        and (
          (select pattern from q) is null
          or p.name ilike (select pattern from q) escape '\'
          or coalesce(p.description, '') ilike (select pattern from q) escape '\'
        )
    ),
    'tenant', jsonb_build_object('name', t.name, 'locale', t.locale, 'currency', cur.currency),
    -- Definicje pól własnych zamawiania — JEDNO źródło prawdy (jak 0085).
    'custom_fields', app.get_public_custom_fields(t.id),
    -- PROJEKCJA POZYCJI == 0085 co do klucza (rozstrzygnięcie 1). Filtr działa
    -- przez `join okno` — projekcja nie powtarza predykatu, bo `okno` już go
    -- naniosło; re-join do products z jawnym zawężeniem tenanta.
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
        order by p.name, p.id
      )
      from public.products p
      join okno o on o.id = p.id
      where p.tenant_id = t.id and p.active
    ), '[]'::jsonb),
    -- ADRESY POZYCJI TEJ STRONY (0083) — dla pozycji, które strona naprawdę
    -- rysuje (po filtrze i po zacisku okna).
    'slugs', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'slug', o.slug) order by o.name, o.id)
      from okno o
    ), '[]'::jsonb)
  ) end
  from cur left join t on true;
$$;

comment on function app.get_public_catalog_page(uuid, integer, integer, text) is
  'JEDNA STRONA katalogu publicznego dla trasy /katalog (0085/0107, ADR-186/263): {"total","tenant","custom_fields","products","slugs"}. Zbiór/porządek/projekcja pozycji identyczne z app.get_public_catalog (order by name, id); lustro projekcji pilnuje packages/db/test/catalog-page.test.ts. [0107] OPCJONALNY p_query: gdy niepusty, filtruje po name/description (ILIKE, case-insensitive, metaznaki LIKE eskejpowane, parametryzowane) i liczy total po przefiltrowanym zbiorze; NULL/pusty = pełny katalog (zachowanie 0085 co do bajtu, deploy-before-code dla czytnika 3-argumentowego). p_limit zaciśnięty do 48 (lustro CATALOG_PAGE_MAX_SIZE), p_offset do zera. NULL dla najemcy poza oknem handlowym. SECURITY DEFINER: bramką izolacji jest jawny filtr tenant_id, a nie RLS; p_query jest dodatkowym AND po zawężeniu tenanta.';

revoke all on function app.get_public_catalog_page(uuid, integer, integer, text) from public;
-- anon: to JEST odczyt publiczny sklepu — strona katalogu buduje z niego kafle
-- tą samą drogą, którą pozostałe trasy biorą app.get_public_catalog.
grant execute on function app.get_public_catalog_page(uuid, integer, integer, text) to anon, authenticated;

-- === END PROD MIGRATION 0107 ===
