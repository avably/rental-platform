-- Audyt skalowalności hot-ścieżek — seed w TRANSAKCJI z ROLLBACK (nic nie zostaje).
-- Uruchamiane na współdzielonej lokalnej bazie: WYŁĄCZNIE inserty (ROW EXCLUSIVE,
-- kompatybilne z innymi zapisami) + EXPLAIN; ZERO DDL na tabelach współdzielonych.
\set ON_ERROR_STOP on
\timing on
\pset pager off

BEGIN;

-- Świeży, izolowany tenant (własny UUID) — nie dotyka danych innych najemców.
SELECT gen_random_uuid() AS tid \gset
\echo '>>> TENANT:' :tid

INSERT INTO public.tenants (id, slug, name, status)
VALUES (:'tid', 'loadtest-'||substr(md5(random()::text),1,10), 'Loadtest Audit', 'active');

-- 1 klient (pod zamówienia)
INSERT INTO public.customers (id, tenant_id, email)
VALUES (gen_random_uuid(), :'tid', 'loadtest@example.test');

-- 30 kategorii
INSERT INTO public.catalog_categories (id, tenant_id, name, slug, position)
SELECT gen_random_uuid(), :'tid', 'Kategoria '||g, 'kategoria-'||g, g
FROM generate_series(1,30) g;

-- 800 produktów (aktywne), jawne unikalne slugi
INSERT INTO public.products (id, tenant_id, name, slug, base_price_day_grosze, active)
SELECT gen_random_uuid(), :'tid', 'Produkt '||lpad(g::text,4,'0'), 'produkt-'||g, 1000+g, true
FROM generate_series(1,800) g;

-- Przypisania M:N: każdy produkt do 1 kategorii „rozproszonej" (g%30)+1,
-- oraz pierwsze 220 produktów DODATKOWO do kategorii 1 (duża kategoria do testu sortu).
INSERT INTO public.product_categories (tenant_id, product_id, category_id)
SELECT :'tid', p.id, c.id
FROM public.products p
JOIN public.catalog_categories c
  ON c.tenant_id = :'tid'
 AND c.slug = 'kategoria-'|| ((right(p.slug, length(p.slug)-length('produkt-'))::int - 1) % 30 + 1)
WHERE p.tenant_id = :'tid';

INSERT INTO public.product_categories (tenant_id, product_id, category_id)
SELECT :'tid', p.id, c.id
FROM public.products p
JOIN public.catalog_categories c ON c.tenant_id = :'tid' AND c.slug = 'kategoria-1'
WHERE p.tenant_id = :'tid'
  AND (right(p.slug, length(p.slug)-length('produkt-'))::int) <= 220
ON CONFLICT DO NOTHING;

-- ~2 egzemplarze na produkt (1600 sztuk)
INSERT INTO public.product_units (id, tenant_id, product_id)
SELECT gen_random_uuid(), :'tid', p.id
FROM public.products p, generate_series(1,2) u
WHERE p.tenant_id = :'tid';

-- ~2 zdjęcia na 300 pierwszych produktów (per-produkt subquery images)
INSERT INTO public.product_images (id, tenant_id, product_id, storage_path, sort_order)
SELECT gen_random_uuid(), :'tid', p.id, :'tid'||'/'||p.id||'/'||gen_random_uuid()||'.jpg', u
FROM public.products p, generate_series(1,2) u
WHERE p.tenant_id = :'tid'
  AND (right(p.slug, length(p.slug)-length('produkt-'))::int) <= 300;

-- ~2 progi cenowe na 300 pierwszych produktów
INSERT INTO public.pricing_tiers (id, tenant_id, product_id, tier_days, multiplier)
SELECT gen_random_uuid(), :'tid', p.id, t*7, (t*6)::numeric
FROM public.products p, generate_series(1,2) t
WHERE p.tenant_id = :'tid'
  AND (right(p.slug, length(p.slug)-length('produkt-'))::int) <= 300;

-- 150 zamówień blokujących (status reserved) + pozycja z przypisanym egzemplarzem,
-- termin nachodzący na okno testu dostępności — żeby NOT EXISTS miał co skanować.
WITH cust AS (SELECT id FROM public.customers WHERE tenant_id=:'tid' LIMIT 1),
ord AS (
  INSERT INTO public.orders (id, tenant_id, order_number, customer_id, start_date, end_date,
                             delivery_method, currency, order_status)
  SELECT gen_random_uuid(), :'tid', 'LT-2026-'||lpad(g::text,3,'0'), (SELECT id FROM cust),
         current_date + (g%10), current_date + (g%10) + 3, 'courier', 'PLN', 'pending'
  FROM generate_series(1,150) g
  RETURNING id, order_number
),
units AS (
  SELECT pu.id, pu.product_id, row_number() OVER (ORDER BY pu.id) AS rn
  FROM public.product_units pu
  WHERE pu.tenant_id = :'tid'
)
INSERT INTO public.order_items (id, tenant_id, order_id, product_id, unit_id, rental_grosze)
SELECT gen_random_uuid(), :'tid', o.id, u.product_id, u.id, 5000
FROM ord o
JOIN units u ON u.rn = regexp_replace(o.order_number, '^LT-2026-0*', '')::int;

-- Statystyki na potrzeby planera dla ŚWIEŻO zasianych wierszy (transakcyjne,
-- cofane wraz z ROLLBACK). ANALYZE bierze SHARE UPDATE EXCLUSIVE — nie blokuje
-- ani odczytu, ani zapisu innych sesji.
ANALYZE public.products;
ANALYZE public.product_categories;
ANALYZE public.product_units;
ANALYZE public.order_items;
ANALYZE public.orders;
ANALYZE public.catalog_categories;

SELECT count(*) AS produkty FROM public.products WHERE tenant_id=:'tid';
SELECT count(*) AS przypisania_kat1 FROM public.product_categories pc
  JOIN public.catalog_categories c ON c.id=pc.category_id AND c.slug='kategoria-1'
  WHERE pc.tenant_id=:'tid';

\echo ''
\echo '========================================================================'
\echo '  A) END-TO-END: EXPLAIN ANALYZE na WYWOŁANIACH RPC (realny czas ściany)'
\echo '========================================================================'

\echo '--- A1. get_public_catalog_page: STRONA 1 (offset 0, limit 24) ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING) SELECT app.get_public_catalog_page(:'tid', 0, 24);

\echo '--- A2. get_public_catalog_page: STRONA GŁĘBOKA (offset 480, limit 24) ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING) SELECT app.get_public_catalog_page(:'tid', 480, 24);

\echo '--- A3. get_public_category_page: DUŻA kategoria (kategoria-1), sort=catalog ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING) SELECT app.get_public_category_page(:'tid', 'kategoria-1', 1, 24, 'catalog');

\echo '--- A4. get_public_category_page: DUŻA kategoria, sort=price_asc ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING) SELECT app.get_public_category_page(:'tid', 'kategoria-1', 1, 24, 'price_asc');

\echo '--- A5. get_public_catalog: PEŁNY katalog (home /store) ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING) SELECT app.get_public_catalog(:'tid');

\echo '--- A6. get_public_product: strona produktu po slugu ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING) SELECT app.get_public_product(:'tid', 'produkt-500', NULL);

\echo '--- A7. get_public_catalog_availability: cały katalog, okno 7 dni ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING) SELECT app.get_public_catalog_availability(:'tid', current_date, current_date+7);

\echo ''
\echo '========================================================================'
\echo '  B) WNĘTRZE: EXPLAIN na gorących pod-zapytaniach (RPC się NIE inline-uje)'
\echo '========================================================================'

\echo '--- B1. okno get_public_catalog_page: sort CAŁEGO aktywnego katalogu ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, p.name, p.slug
FROM public.products p
WHERE p.tenant_id = :'tid' AND p.active
ORDER BY p.name, p.id
OFFSET 480 LIMIT 24;

\echo '--- B2. okno get_public_category_page: join M:N + sort członków kategorii ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id,
  row_number() OVER (ORDER BY p.name, p.id) AS rn
FROM public.products p
JOIN public.catalog_categories cat ON cat.tenant_id=:'tid' AND cat.slug='kategoria-1'
JOIN public.product_categories pc
  ON pc.tenant_id=cat.tenant_id AND pc.category_id=cat.id AND pc.product_id=p.id
WHERE p.tenant_id=cat.tenant_id AND p.active
ORDER BY rn
OFFSET 0 LIMIT 24;

\echo '--- B3. total count get_public_category_page ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM public.catalog_categories cat
JOIN public.product_categories pc ON pc.tenant_id=cat.tenant_id AND pc.category_id=cat.id
JOIN public.products p ON p.tenant_id=cat.tenant_id AND p.id=pc.product_id
WHERE cat.tenant_id=:'tid' AND cat.slug='kategoria-1' AND p.active;

\echo '--- B4. dostępność: per-egzemplarz NOT EXISTS (order_items -> orders) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM public.product_units u
JOIN public.products p ON p.tenant_id=u.tenant_id AND p.id=u.product_id
WHERE u.tenant_id=:'tid'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi
    JOIN public.orders o ON o.tenant_id=oi.tenant_id AND o.id=oi.order_id
    WHERE oi.tenant_id=:'tid' AND oi.unit_id=u.id
      AND o.order_status IN ('pending','reserved','ready_for_pickup','picked_up')
      AND o.start_date <= current_date+7 + p.buffer_after_days
      AND o.end_date   >= current_date - p.buffer_before_days
  );

\echo ''
\echo '========================================================================'
\echo '  C) EKSPERYMENT NAPRAWCZY na KLONIE TYMCZASOWYM (temp, zero locka na public)'
\echo '========================================================================'

CREATE TEMP TABLE products_seed ON COMMIT DROP AS
SELECT id, tenant_id, name, slug, active FROM public.products WHERE tenant_id=:'tid';
ANALYZE products_seed;

\echo '--- C1. Klon BEZ indeksu: ORDER BY name,id OFFSET 480 (spodziewany Sort) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, slug FROM products_seed
WHERE tenant_id=:'tid' AND active
ORDER BY name, id OFFSET 480 LIMIT 24;

CREATE INDEX products_seed_cover_idx ON products_seed (tenant_id, name, id) WHERE active;
ANALYZE products_seed;

\echo '--- C2. Klon Z indeksem (tenant_id,name,id) WHERE active (spodziewany Index Scan, brak Sort) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, slug FROM products_seed
WHERE tenant_id=:'tid' AND active
ORDER BY name, id OFFSET 480 LIMIT 24;

ROLLBACK;
\echo '>>> ROLLBACK wykonany — baza współdzielona NIETKNIĘTA.'
