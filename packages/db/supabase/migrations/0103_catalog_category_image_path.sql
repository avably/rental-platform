-- =====================================================================
-- 0103 — BANER KATEGORII W KOPERCIE KATALOGU (Faza 7 D, ADR-251):
--        app.get_public_catalog projektuje c.image_path w bloku kategorii.
-- =====================================================================
--
-- STAN PRZED: taksonomia katalogu (0072/ADR-155) niesie w publicznej kopercie
-- katalogu PEŁNE obiekty kategorii (`id,name,slug,description,position`) raz, na
-- górze koperty, a przy każdej pozycji same `category_ids`. Faza A (0101/ADR-244)
-- DOŁOŻYŁA kolumnę `public.catalog_categories.image_path` (baner kategorii) i
-- projektuje ją WYŁĄCZNIE w wąskiej kopercie strony kategorii
-- (`app.get_public_category_page`). Kafel kategorii na home i przyszła sekcja
-- „kategorie" czytają PEŁNY katalog (`app.get_public_catalog`) — a ten bloku
-- kategorii bez `image_path` nie niesie, więc kafel nie ma skąd wziąć banera.
-- To domknięcie punktu (4) odłożonego w ADR-249 („baner na kaflach home").
--
-- ================== OKNO WDROŻENIOWE — DLACZEGO BEZPIECZNE ==================
--
-- Migracje jadą na produkcję PRZED kodem. Ta migracja — inaczej niż 0101 — NIE
-- dokłada nowej funkcji, tylko WZBOGACA istniejącą o JEDEN klucz w bloku
-- kategorii. Jest to bezpieczne, bo:
--   * SYGNATURA funkcji jest BEZ ZMIAN (`app.get_public_catalog(uuid)`), więc
--     żaden wołający nie musi się zmieniać;
--   * NOWY klucz siedzi WEWNĄTRZ obiektu kategorii, a nie na szczycie koperty
--     ani przy pozycji produktu — a storefront czyta blok kategorii POLAMI
--     (`categoryNavItems` bierze `id/name/slug`), NIE parsuje go schematem
--     odrzucającym nieznane klucze. Zastany czytnik po prostu pomija `image_path`
--     (to samo, co gwarantuje NULLowalna kolumna z 0101 dla starego kodu).
-- To ten sam warunek bezpieczeństwa, co przy dokładaniu `category_ids`/`categories`
-- w 0072 (klucz wewnątrz koperty, projekcja bogatsza), a nie ryzyko z 0083, gdzie
-- BEZWARUNKOWY nowy klucz PRZY POZYCJI kładł sklep parsujący pozycję `.strict()`.
--
-- ========================= ROZSTRZYGNIĘCIA =========================
--
-- 1. CIAŁO PRZEPISANE W CAŁOŚCI z NAJŚWIEŻSZEJ definicji (0072 — 0101 jej NIE
--    nadpisała, tylko dodała OSOBNĄ funkcję strony kategorii). `create or replace`
--    nie umie „dołożyć linii", więc całe ciało wraca tu co do znaku, z JEDNĄ
--    zmianą merytoryczną: `'image_path', c.image_path` w bloku `categories`
--    (po `description`, jak w `PublicCategoryMeta`). Reszta — waluta, pola
--    własne, produkty, punkty odbioru, cennik dostaw — bez zmian.
--
-- 2. GRANT/REVOKE i COMMENT bez zmian merytorycznych (grant anon+authenticated
--    jak w 0072). Funkcja dalej SECURITY DEFINER, `stable`, `language sql`.
--
-- 3. IZOLACJA BEZ ZMIAN: filtr `c.tenant_id = t.id` w bloku kategorii jest tu
--    JEDYNĄ bramką (RLS nie dotyczy SECURITY DEFINER). `image_path` jedzie tym
--    SAMYM podzapytaniem, co reszta pól kategorii, więc dziedziczy ten sam
--    tenant-scope — koperta najemcy A nie może nieść banera kategorii najemcy B
--    (dowód: packages/db/test/public-catalog.test.ts, izolacja cross-tenant).
--
-- 4. IDEMPOTENTNA: `create or replace` + `revoke`/`grant` bez `if not exists`
--    (grant jest idempotentny z natury). Ponowne wykonanie nie zmienia stanu.
-- =====================================================================

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
    -- koperty; produkt niesie same identyfikatory. [0103] Blok wzbogacony
    -- o `image_path` (baner kategorii z 0101) pod kafel kategorii na home.
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'slug', c.slug,
          'description', c.description,
          'image_path', c.image_path,
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
  'Publiczny katalog sklepu (0020, bramka statusu 0065): tenant, pola własne zamawiania (0058), KATEGORIE (z banerem image_path — 0103/ADR-251) i produkty z ich identyfikatorami kategorii (0072/ADR-155), punkty odbioru, cennik dostaw. SECURITY DEFINER — izolację daje jawny filtr tenant_id w każdym podzapytaniu, nie RLS. NULL dla najemcy poza oknem handlowym.';

revoke all on function app.get_public_catalog(uuid) from public;
grant execute on function app.get_public_catalog(uuid) to anon, authenticated;
