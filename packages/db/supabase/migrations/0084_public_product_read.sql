-- ===== 0084 — WĄSKI ODCZYT JEDNEJ POZYCJI KATALOGU (ADR-185) =====
--
-- Do tej migracji strona sprzętu nie miała jak zapytać o SWOJĄ pozycję. Trasa
-- `/produkt/{slug}` wołała `app.get_public_catalog`, czyli CAŁY katalog
-- najemcy, i wyszukiwała w nim jeden wiersz w pamięci procesu. Zmierzone na
-- fiksturze 200 pozycji (3 zdjęcia i 2 progi na pozycję): 227 019 bajtów
-- koperty katalogu plus 15 440 bajtów rejestru adresów na KAŻDĄ odsłonę
-- KAŻDEJ strony sprzętu. Faza 5 zamieniła każdą pozycję katalogu w osobny,
-- indeksowalny adres, więc liczba takich odsłon rośnie z katalogiem.
--
-- Ta migracja dokłada JEDNĄ funkcję, która odpowiada na komplet pytań trasy
-- sprzętu naraz: czy ten adres istnieje, czy jest bieżący czy stary, dokąd
-- przekierować, i jaka jest pozycja pod nim. Dzięki temu strona sprzętu
-- przestaje potrzebować OBU odczytów O(N) — katalogu i rejestru adresów.
--
-- ===== OKNO WDROŻENIOWE — NAJOSTRZEJSZY PUNKT =====
--
-- Migracja wchodzi na produkcję PRZED kodem, a koperty publicznego odczytu są
-- po stronie sklepu parsowane schematami `.strict()`. ROZSTRZYGNIĘCIE (wzorzec
-- 0074/0079/0083): NOWA funkcja o WŁASNEJ sygnaturze, której w oknie nikt nie
-- woła. Ani jeden klucz nie dochodzi do żadnej istniejącej koperty i ani jedna
-- istniejąca funkcja nie zmienia ciała, więc sklep z `origin/main` działający
-- w oknie nie widzi tej migracji w ogóle.
--
-- Rozważone i odrzucone:
--   (a) klucz `slug` przy pozycji w `app.get_public_catalog` — odrzucone już
--       w ADR-182 D5 z tego samego powodu: nowy klucz w kopercie parsowanej
--       `.strict()` kładzie sklepy WSZYSTKICH najemców na czas okna;
--   (b) drugi argument `app.get_public_catalog` — zmiana sygnatury funkcji
--       wołanej w oknie przez stary kod (odrzucone w ADR-158 i ADR-171 D2b);
--   (c) odczyt `public.products` wprost przez PostgREST — wymagałby grantu
--       `anon` na tabelę, odrzucone imiennie w ADR-171 D2c i ADR-182 D5.
--
-- ===== DLACZEGO KOPERTA NIESIE ROZSTRZYGNIĘCIE ADRESU, A NIE SAM PRODUKT =====
--
-- Trasa `/produkt/{slug}` musi umieć TRZY odpowiedzi (ADR-182): adres bieżący
-- → render, adres stary → 308, adres nieznany → 404. Gdyby ta funkcja zwracała
-- sam produkt, „a może to stary adres?" kosztowałoby DRUGĄ podróż do bazy —
-- czyli dokładnie ten koszt, który znosimy. Rejestr adresów rozstrzygał to
-- jednym odczytem, ale płacił za to rozmiarem O(N); ta funkcja rozstrzyga to
-- samo w rozmiarze O(1).
--
-- ===== PROJEKCJA POZYCJI JEST LUSTREM KATALOGU, CO DO KLUCZA =====
--
-- Blok `jsonb_build_object` opisujący pozycję jest przepisany co do znaku
-- z NAJŚWIEŻSZEJ definicji `app.get_public_catalog` (0072, linie 425–470;
-- md5(pg_get_functiondef) tej definicji na bazie po komplecie migracji do 0083
-- zanotowane w ADR-185). To jest świadome powtórzenie, nie przeoczenie:
-- cienka owijka wyprowadzałaby zapytanie spod strażników strukturalnych, które
-- skanują `pg_get_functiondef` (ten sam argument, co ADR-178 dla
-- `get_published_product_template`). Rozjazd projekcji pilnuje test
-- porównujący OBIE koperty pozycja-po-pozycji na prawdziwej bazie
-- (`packages/db/test/public-product.test.ts`) — nie komentarz.
--
-- CZEGO TA MIGRACJA NIE RUSZA: `app.get_public_catalog` (bajtowo bez zmian),
-- `app.get_public_product_slugs`, `app.get_public_availability`,
-- `app.get_public_availability_days`, `app.get_public_catalog_availability`
-- (dostępność zostaje nietknięta — jest liczona per termin i nie wolno jej
-- buforować), `app.public_checkout`, żadnej tabeli, żadnej kolumny, żadnego
-- indeksu, żadnej polityki RLS, żadnego grantu tabelowego.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): `security definer`
-- z przypiętym `set search_path`, izolacja jawnym filtrem `tenant_id`
-- w KAŻDYM podzapytaniu (SECURITY DEFINER nie podlega RLS),
-- `revoke all ... from public` + jawne granty w TYM SAMYM pliku,
-- `comment on function`, wpis w `ANON_EXECUTE_ALLOWLIST`
-- (`packages/db/test/function-acls.test.ts`).

-- === BEGIN PROD MIGRATION 0084 ===

create or replace function app.get_public_product(
  p_tenant_id uuid,
  p_slug text,
  p_product_id uuid
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
  -- ADRES BIEŻĄCY. Wskazanie identyfikatorem (trasa zastana `/product/{uuid}`)
  -- i wskazanie slugiem (trasa kanoniczna) schodzą się w jednym miejscu —
  -- dwie gałęzie znaczyłyby dwa zbiory pozycji osiągalnych publicznie.
  biezacy as (
    select p.id, p.slug
    from public.products p, t
    where p.tenant_id = t.id
      and p.active
      and (
        (p_product_id is not null and p.id = p_product_id)
        or (p_product_id is null and p_slug is not null and p.slug = p_slug)
      )
    limit 1
  ),
  -- ADRES STARY → dokąd przekierować. Liczony WYŁĄCZNIE wtedy, gdy adres
  -- bieżący nie trafił: pozycja, która odzyskała swój dawny adres, ma się
  -- renderować, a nie przekierowywać sama na siebie.
  stary as (
    select p.slug
    from public.product_slug_history h
    join public.products p
      on p.tenant_id = h.tenant_id and p.id = h.product_id
    cross join t
    where h.tenant_id = t.id
      and h.slug = p_slug
      and p.active
      and p_product_id is null
      and p_slug is not null
      and not exists (select 1 from biezacy)
    limit 1
  )
  select case when t.id is null then null else jsonb_build_object(
    -- ROZSTRZYGNIĘCIE ADRESU jest częścią odpowiedzi, nie domysłem wołającego.
    'match', case
      when exists (select 1 from biezacy) then 'current'
      when exists (select 1 from stary) then 'redirect'
      else 'none'
    end,
    -- ADRES BIEŻĄCY pozycji: cel 308 dla adresu starego, kanon dla bieżącego.
    'slug', coalesce((select b.slug from biezacy b), (select s.slug from stary s)),
    'tenant', jsonb_build_object('name', t.name, 'locale', t.locale, 'currency', cur.currency),
    -- Definicje pól własnych — TĄ SAMĄ funkcją, co katalog. Druga kopia listy
    -- kolumn rozjechałaby się przy pierwszej poprawce.
    'custom_fields', app.get_public_custom_fields(t.id),
    'product', (
      select jsonb_build_object(
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
      from public.products p
      join biezacy b on b.id = p.id
      where p.tenant_id = t.id and p.active
    )
  ) end
  from cur left join t on true;
$$;

comment on function app.get_public_product(uuid, text, uuid) is
  'Wąski odczyt JEDNEJ pozycji katalogu publicznego dla strony sprzętu (0084, ADR-185): rozstrzygnięcie adresu (bieżący/stary/nieznany, ADR-182), adres bieżący, najemca, definicje pól własnych i pozycja w kształcie IDENTYCZNYM z wpisem w app.get_public_catalog. Wskazanie slugiem (trasa kanoniczna) albo identyfikatorem (trasa zastana). Zastępuje na tej trasie DWA odczyty O(N): pełny katalog i rejestr adresów. SECURITY DEFINER: bramką izolacji jest jawny filtr tenant_id w każdym podzapytaniu, a nie RLS. NULL dla najemcy poza oknem handlowym. Osobna funkcja, a nie klucz w kopercie katalogu — koperty czytane w oknie wdrożeniowym nie mogą zmieniać kształtu (ADR-158/171/182).';

revoke all on function app.get_public_product(uuid, text, uuid) from public;
-- anon: to JEST odczyt publiczny sklepu — oddaje WYŁĄCZNIE tę samą pozycję
-- i te same kolumny, które `app.get_public_catalog` i tak pokazuje anonimowemu
-- odwiedzającemu, tylko węziej. Izolacja stoi na jawnym zawężeniu tenant_id
-- w ciele (SECURITY DEFINER) — pilnuje tego public-product.test.ts.
grant execute on function app.get_public_product(uuid, text, uuid) to anon, authenticated;

-- === END PROD MIGRATION 0084 ===
