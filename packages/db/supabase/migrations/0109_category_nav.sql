-- =====================================================================
-- 0109 — MENU KATEGORII NA /katalog i /kategoria (ADR-266):
--        app.get_public_category_nav — WĄSKI odczyt „kategorie z licznikiem".
-- =====================================================================
--
-- STAN PRZED: menu kategorii w nagłówku sklepu (ADR-247/249) buduje się
-- z PEŁNEGO katalogu (`categoryNavItems` na kopercie `app.get_public_catalog`)
-- i stoi WYŁĄCZNIE na stronie głównej `/store` — bo tylko ona ma pełny katalog
-- pod ręką. Trasy `/katalog` (ADR-186) i `/kategoria/{slug}` (ADR-244) czytają
-- ŚWIADOMIE tylko JEDNĄ stronę wyników (`get_public_catalog_page` /
-- `get_public_category_page`), więc menu kategorii na nich znika — dokładnie
-- w chwili, w której klient zaczyna przeglądać ofertę.
--
-- Doczytanie pełnego katalogu na tych trasach, żeby zbudować menu, wraca do
-- kosztu O(katalogu) na odsłonę, który stronicowanie właśnie zdjęło (ADR-185/186):
-- pozycja spoza strony wyników przyjechałaby do procesu, choć nie ma jej na
-- ekranie. Bramką jest `apps/storefront/test/koszt-odslony.integration.test.ts`
-- („/katalog NIE POBIERA pozycji spoza swojej strony wyników"). Menu potrzebuje
-- WYŁĄCZNIE nazwy, adresu i LICZBY pozycji per kategoria — nie samych pozycji.
--
-- ROZSTRZYGNIĘCIE: WĄSKA funkcja, która liczy pozycje per kategoria PO STRONIE
-- BAZY i oddaje same liczby. Koszt odczytu jest O(kategorii), a nie O(katalogu),
-- i ani jedna nazwa pozycji nie przekracza granicy procesu. To ten sam wzorzec,
-- co `get_public_catalog_page` (0085) i `get_public_category_page` (0101):
-- zamiast filtrować pełny katalog w pamięci, pytamy bazę dokładnie o to, co
-- trasa rysuje.
--
-- ================== OKNO WDROŻENIOWE — DLACZEGO BEZPIECZNE ==================
--
-- Migracje jadą na produkcję PRZED kodem. To NOWA funkcja o WŁASNEJ sygnaturze
-- (`app.get_public_category_nav(uuid)`), której w oknie wdrożenia NIKT jeszcze
-- nie woła (wzorzec 0084/0085/0101): ani jeden zastany czytnik nie zmienia
-- zachowania, bo funkcja pojawia się przed kodem, który jej używa. Zdjęcie
-- funkcji przy rollbacku kodu jest równie bezpieczne — nikt inny jej nie woła.
--
-- ========================= ROZSTRZYGNIĘCIA =========================
--
-- 1. GUARD PUSTYCH KATEGORII PO STRONIE BAZY. Kategoria bez ani jednej AKTYWNEJ
--    pozycji NIE wchodzi do wyniku — to ta sama reguła, którą trzyma
--    `categoryNavItems` w storefroncie (pozycja menu obiecuje półkę oferty,
--    a półka bez sprzętu to ślepy zaułek). Guard jest tu naturalny: INNER JOIN
--    po `product_categories` i `products` z filtrem `active` sprawia, że
--    kategoria bez aktywnych pozycji nie produkuje ani jednego wiersza, więc nie
--    ma grupy. `count` w wyniku jest zawsze >= 1.
--
-- 2. KOLEJNOŚĆ NAJEMCY. Wynik idzie `order by position, name, id` — dokładnie
--    tak, jak katalog porządkuje `categories` (0072/0103), żeby menu na
--    `/katalog` i `/kategoria` stało w tej samej kolejności, co na `/store`.
--
-- 3. LICZBA AKTYWNYCH POZYCJI. `count(*)` po złączeniu z `products` filtrowanym
--    `p.active` liczy dokładnie te pozycje, które katalog publiczny pokazuje
--    (`get_public_catalog` bierze `where p.active`), więc licznik menu zgadza się
--    z tym, co klient realnie zobaczy na półce. Produkt w wielu kategoriach jest
--    liczony w każdej z nich — pozycja menu mówi „ile jest w TEJ kategorii".
--
-- 4. IZOLACJA: jawny filtr `t.id = p_tenant_id` plus bramka statusu
--    `app.tenant_commercially_active(t.status)` (jak `get_public_catalog`), a
--    każde złączenie niesie `tenant_id` w warunku. RLS nie dotyczy SECURITY
--    DEFINER — izolację daje TYLKO ten jawny filtr. `p_tenant_id` przychodzi do
--    sklepu WYŁĄCZNIE z nagłówka wstrzykniętego przez proxy po rozwiązaniu hosta
--    (ADR-039), więc odwiedzający nie ma czym go podmienić. Najemca poza oknem
--    handlowym => zero wierszy => `[]` (dla powłoki: brak menu). Dowód izolacji
--    (menu najemcy A nie niesie kategorii B) jest w
--    packages/db/test/category-nav.test.ts.
--
-- 5. IDEMPOTENTNA: `create or replace` + `revoke`/`grant` bez `if not exists`
--    (grant jest idempotentny z natury). Ponowne wykonanie nie zmienia stanu.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): `security definer`
-- z przypiętym `set search_path`, jawny filtr `tenant_id`, `revoke all ... from
-- public` + jawne granty w TYM SAMYM pliku, `comment on function`, wpis
-- w ANON_EXECUTE_ALLOWLIST (packages/db/test/function-acls.test.ts).
-- =====================================================================

-- === BEGIN PROD MIGRATION 0109 ===

-- ---------------------------------------------------------------------
-- app.get_public_category_nav — kategorie NIEPUSTE z licznikiem
-- ---------------------------------------------------------------------
--
-- Kształt wyniku (JSON array; `[]`, gdy najemca poza oknem / bez kategorii
-- z pozycjami):
--   [ {"id": uuid, "name": text, "slug": text, "count": int}, ... ]
--   w kolejności najemcy (position, name, id).

create or replace function app.get_public_category_nav(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', n.id,
        'name', n.name,
        'slug', n.slug,
        'count', n.cnt
      )
      order by n.position, n.name, n.id
    ),
    '[]'::jsonb
  )
  from (
    select c.id, c.name, c.slug, c.position, count(*) as cnt
    from public.tenants t
    join public.catalog_categories c
      on c.tenant_id = t.id
    join public.product_categories pc
      on pc.tenant_id = c.tenant_id and pc.category_id = c.id
    join public.products p
      on p.tenant_id = pc.tenant_id and p.id = pc.product_id and p.active
    where t.id = p_tenant_id
      and app.tenant_commercially_active(t.status)
    group by c.id, c.name, c.slug, c.position
  ) n;
$$;

comment on function app.get_public_category_nav(uuid) is
  'Menu kategorii sklepu (0109, ADR-266): kategorie NIEPUSTE najemcy w kolejności position z liczbą AKTYWNYCH pozycji per kategoria — pod nagłówek tras /katalog i /kategoria, bez ciągnięcia całego katalogu (koszt O(kategorii)). SECURITY DEFINER — izolację daje jawny filtr tenant_id w każdym złączeniu plus bramka statusu, nie RLS. [] dla najemcy poza oknem handlowym albo bez kategorii z pozycjami.';

revoke all on function app.get_public_category_nav(uuid) from public;
grant execute on function app.get_public_category_nav(uuid) to anon, authenticated;

-- === END PROD MIGRATION 0109 ===
