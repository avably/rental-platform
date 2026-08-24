# Audyt skalowalności publicznych hot-ścieżek sklepu (PRZED-LAUNCH)

**Data:** 2026-08-24 · **Autor:** Avably · **ADR:** ADR-250 · **Gałąź:** `feat/loadtest-audit`

## TL;DR

- **Ścieżki stronicowane są zdrowe.** `/katalog` (`get_public_catalog_page`),
  `/kategoria/{slug}` (`get_public_category_page`) i `/produkt/{slug}`
  (`get_public_product`) schodzą end-to-end w **1–6 ms** na wolumenie
  **800 produktów / 30 kategorii / 1600 egzemplarzy**. Nowa ścieżka kategorii
  (join M:N przez `product_categories`) trafia w **istniejący** indeks
  `product_categories_tenant_category_idx` — **założona w briefie luka nie
  istnieje**.
- **Jedyny wyraźny outlier: pełny katalog** `get_public_catalog` (home
  `/store`) — **~109 ms** na 800 produktów, bo materializuje CAŁY katalog
  z 4 skorelowanymi pod-zapytaniami na pozycję. **Fronton to cache Redis
  międzyżądaniowy (ADR-185)** — płaci go tylko zimny cache / pierwszy gość /
  po unieważnieniu. To koszt **architektoniczny (O(katalogu))**, nie brak
  indeksu.
- **Dostępność** (`get_public_catalog_availability`) i **join M:N** są dobrze
  zaindeksowane (`order_items_tenant_unit_idx`, `product_units_tenant_product_idx`,
  `product_categories_tenant_category_idx`).
- **Jedna additywna, bezpieczna rekomendacja indeksu** (DRAFT `0103`,
  NIE wdrożony): pokrycie porządku `(name, id)` katalogu — zdejmuje węzeł
  `Sort` z okna stronicowanego. Dziś zysk mały (Sort ~0,33 ms), ale rośnie
  z wolumenem i jest **znacząco większy na produkcji multi-tenant**
  (wiodący `tenant_id` daje selektywność, której jednonajemcowy seed nie
  pokazuje). Dowód na klonie: Sort → Index Scan, ~2,5× krótsze okno.
- **Realnego runu k6 NIE wykonano** — `k6` niedostępne w PATH, a jedyna
  lokalna baza jest **współdzielona** z aktywnymi sesjami. Zostawiam **gotowy
  harness k6 + README** do uruchomienia na izolowanym stacku. Statyczny audyt
  (EXPLAIN na zasianym wolumenie, w transakcji z ROLLBACK) — **wykonany**.

## Metoda i bezpieczeństwo pomiaru

- **Zwiad read-only** na `origin/main` (`96ed1cfd`): odczyt definicji RPC
  (0072, 0081, 0084, 0085, 0101), indeksów tabel (0007, 0018, 0057, 0072, 0083)
  i warstwy wywołań storefrontu (`apps/storefront/lib/checkout/catalog.ts`,
  `lib/storefront/context.ts`).
- **Seed + EXPLAIN w JEDNEJ transakcji z `ROLLBACK`** na lokalnym Supabase
  (`supabase_db_db`, 54322). Wyłącznie `INSERT` (blokady `ROW EXCLUSIVE`
  kompatybilne z zapisami innych sesji) + `ANALYZE` (`SHARE UPDATE EXCLUSIVE`,
  nie blokuje odczytu/zapisu) + `EXPLAIN`. **Zero DDL na tabelach
  współdzielonych, zero `db reset`, nic nie utrwalone.** Skrypt:
  [`explain-audit.sql`](explain-audit.sql).
- Eksperyment naprawczy (indeks) wykonany na **klonie `TEMP TABLE`**
  (session-private, `ON COMMIT DROP`) — zero locka na `public.products`.
- Wolumen seedu: **800 aktywnych produktów, 30 kategorii, ~1012 przypisań M:N**
  (kategoria „kategoria-1" celowo duża — **239 pozycji**), **1600 egzemplarzy**,
  **150 zamówień** blokujących + pozycje z przypisanym egzemplarzem, zdjęcia
  i progi cenowe na pierwszych 300 produktach.

> Uwaga o reprezentatywności: seed jest **jednonajemcowy**. Na produkcji
> `public.products`/`product_categories`/`orders` niosą wiersze **wszystkich**
> najemców, więc wiodący `tenant_id` w indeksach staje się krytyczny dla
> selektywności. Bezwzględne czasy z EXPLAIN są więc **dolnym** oszacowaniem
> korzyści z indeksów wiodących po `tenant_id` — w tym rekomendowanego 0103.

## Wyniki end-to-end (EXPLAIN ANALYZE na wywołaniu RPC)

| # | Ścieżka publiczna | RPC | Exec time | Ocena |
|---|---|---|---|---|
| A1 | `/katalog` str. 1 | `get_public_catalog_page(_,0,24)` | **5,5 ms** | zdrowa |
| A2 | `/katalog` str. głęboka (offset 480) | `get_public_catalog_page(_,480,24)` | **4,3 ms** | zdrowa |
| A3 | `/kategoria/{slug}` duża, sort=nazwa | `get_public_category_page(_,slug,1,24,'catalog')` | **6,2 ms** | zdrowa |
| A4 | `/kategoria/{slug}` duża, sort=cena↑ | `get_public_category_page(_,slug,1,24,'price_asc')` | **6,1 ms** | zdrowa |
| A5 | **home `/store` (pełny katalog)** | `get_public_catalog(_)` | **108,9 ms** | **outlier (cache!)** |
| A6 | `/produkt/{slug}` | `get_public_product(_,slug,NULL)` | **1,3 ms** | zdrowa |
| A7 | dostępność całego katalogu (7 dni) | `get_public_catalog_availability(_,d,d+7)` | **5,7 ms** | zdrowa |

## Analiza wnętrza (EXPLAIN na gorących pod-zapytaniach)

RPC są `language sql` z CTE i **nie inline-ują się** — EXPLAIN na wywołaniu
podaje realny czas ściany, ale nie plan wnętrza. Plan wnętrza zmierzony
osobno na tych samych danych.

| # | Ścieżka → plan → wąskie gardło | Rekomendacja |
|---|---|---|
| **B1** | **okno `get_public_catalog_page`**: `Seq Scan products (800)` → **`Sort` (quicksort 81 kB) name,id** → Limit. Brak indeksu na PORZĄDEK (jest tylko `(tenant_id, active)`). Koszt Sortu dziś **0,33 ms** (mały, bo okno projektuje 3 kolumny), ale to O(n log n) po CAŁYM aktywnym zbiorze i rośnie z wolumenem. | **DRAFT 0103**: `products (tenant_id, name, id) WHERE active` → Index Scan, znika Sort. |
| **B2** | **okno `get_public_category_page`** (join M:N): `Bitmap Index Scan` **`product_categories_tenant_category_idx`** → 239 wierszy → `products_pkey` per wiersz → top-N heapsort → **0,55 ms**. Join M:N **w pełni zaindeksowany**. Sort członków JEDNEJ kategorii jest ograniczony (dziesiątki–setki), więc tani także dla `price_*`/`newest`. | Bez zmian. Założona luka indeksu M:N **nie istnieje**. |
| **B3** | **`total` count `get_public_category_page`**: ten sam join, **0,25 ms**. | Bez zmian. |
| **B4** | **dostępność, per-egzemplarz `NOT EXISTS`** (`order_items`→`orders`): przy tym wolumenie planer składa `Hash Right Anti Join` na małych seq-scanach → **0,89 ms**. W realnej funkcji (korelowany per-egzemplarz) na dużej, wspólnej tabeli `order_items` trafienie idzie w **`order_items_tenant_unit_idx (tenant_id, unit_id) WHERE unit_id is not null`** — istnieje. | Bez zmian. Monitorować przy dużym wolumenie zamówień. |

### A5 — dlaczego pełny katalog to 109 ms i dlaczego to NIE indeks

`get_public_catalog` (0072) zwraca **cały** aktywny katalog i buduje dla
**każdej** pozycji 4 skorelowane pod-zapytania (`custom_fields`, `category_ids`
join do `catalog_categories`, `pricing_tiers`, `images`) plus agregację JSONB.
Na 800 pozycjach to ~3200 wykonań pod-zapytań + duża koperta JSONB. **Każde
pod-zapytanie trafia we własny indeks** — koszt jest w **liczbie wykonań
i rozmiarze JSONB**, czyli **O(katalogu)**, nie w braku indeksu. Dlatego indeks
tego nie ruszy.

**Ekspozycja jest ograniczona z konstrukcji:**
- home `/store` czyta ten pełny katalog przez **cache Redis międzyżądaniowy**
  (`resolvePublicCatalog` → `getCachedCatalog`/`setCachedCatalog`, ADR-185)
  + dedup `cache()` Reacta w obrębie żądania. Płaci go **tylko** zimny cache /
  pierwszy gość / po jawnym unieważnieniu z panelu przy zmianie katalogu;
- listowanie klienta (`/katalog`, `/kategoria`) idzie ścieżkami
  **stronicowanymi** (5–6 ms), które **na produkcji biją do bazy na każde
  żądanie** (nie przez ten cache).

**Ryzyko resztkowe:** stampede po unieważnieniu cache pod szczytem ruchu —
wielu równoczesnych „chybień" odpala po jednym zapytaniu 109 ms. Follow-up
niżej.

## Eksperyment naprawczy 0103 (klon tymczasowy, przed/po)

Na `TEMP TABLE` z 800 zasianych produktów, zapytanie okna
(`ORDER BY name,id OFFSET 480 LIMIT 24`):

| Wariant | Plan | Exec time |
|---|---|---|
| **C1 — bez indeksu** | `Seq Scan` + **`Sort` quicksort 81 kB** | 0,238 ms |
| **C2 — z `(tenant_id, name, id) WHERE active`** | **`Index Scan`, ZERO węzła Sort** | **0,092 ms** |

Zdejmuje węzeł `Sort` i daje wczesne zatrzymanie po `offset+limit` — dowód
behawioralny, że rekomendowany indeks działa i jest additywny (zbudował się
i został użyty przez planer).

## Rekomendacja indeksu — DRAFT `0103` (NIE wdrożony)

**Plik:** `packages/db/supabase/migrations/0103_catalog_page_order_index.sql`

```sql
create index if not exists products_tenant_name_active_idx
  on public.products (tenant_id, name, id)
  where active;
```

- **md5 pełnego pliku:** `2ccf49961a575c64a9aebb0a7e3b2e84`
- **md5 ciała `BEGIN..END PROD MIGRATION`:** `abec3af6bebdec6a3cebd8570638f235`
- **Status:** DRAFT, **NIE zastosowany** na żadnej bazie (ani lokalnej,
  ani prod). Additywny, tenant-agnostyczny, **zero zmian RLS/grantów/kolumn**.
- **Idempotentny** (`if not exists`).
- **Budowa in-transaction vs CONCURRENTLY:** wariant w pliku to zwykłe
  `create index` (spójne z repo — brak precedensu CONCURRENTLY, migracje jadą
  w transakcji). Na dzisiejszej skali budowa jest podsekundowa, SHARE-lock
  pomijalny. Gdy `products` urośnie, PM może wykonać z pliku **poza**
  transakcją migracyjną:
  `create index concurrently if not exists products_tenant_name_active_idx on public.products (tenant_id, name, id) where active;`
  (CONCURRENTLY nie blokuje zapisów katalogu, ale nie może biec w transakcji).
- **Decyzja PM przy wdrożeniu:** sprawdzić wolny numer na `origin/main` +
  otwarte PR (w chwili audytu najwyższa migracja to `0102`, więc `0103` wolny;
  brak otwartych PR), zastosować z pliku PRZED merge (auto-deploy), puścić
  pełną suitę `@avably/db`.

> Dlaczego audyt nie odpalił pełnej suity `@avably/db`: indeks **nie jest
> zastosowany** (żaden test go nie oczekuje — `schema.test.ts` pokrywa wyłącznie
> rdzeń 0001), a suita to ciężkie testy integracyjne bijące we współdzieloną
> bazę (bcrypt GoTrue, kilkanaście rund/tenant), które kolidowałyby z aktywnymi
> sesjami równoległymi przy zerowej wartości walidacyjnej dla NIEwdrożonego
> pliku. Suitę uruchamia PM w kontrolowanym oknie wdrożenia. Poprawność DDL
> potwierdzona niezależnie na klonie (C2).

## Follow-upy (posortowane po wpływie)

1. **[Śr/Wys, przy wzroście ruchu] Ochrona przed stampede pełnego katalogu.**
   Po unieważnieniu cache Redis (ADR-185) pod szczytem, wiele równoczesnych
   chybień odpala zapytanie 109 ms równolegle. Rozważyć single-flight /
   stale-while-revalidate na `resolvePublicCatalog`, żeby chybienie liczył
   jeden proces, a reszta czekała/dostała nieświeże. **Nie blokuje launchu.**
2. **[Śr, architektura] Przepisanie pod-zapytań pełnego katalogu na set-based
   (LATERAL/agregaty grupowe)** zamiast 4 skorelowanych pod-zapytań na pozycję —
   ścina O(katalogu) w liczbie wykonań. Ostrożnie: kontrakt projekcji jest
   pilnowany testami (`catalog-page.test.ts`, `category-page.test.ts`) — każda
   zmiana musi trzymać kopertę co do klucza. **Nie blokuje launchu.**
3. **[Nis, additywne] Wdrożyć DRAFT 0103** — hardening porządku katalogu.
   Największa wartość przy wzroście liczby produktów i na produkcji multi-tenant.
4. **[Nis, obserwowalność] Realny run k6** na izolowanym stacku/stagingu przed
   otwarciem ruchu — potwierdzić p95/p99 i throughput oraz zachowanie cache
   pod współbieżnością. Harness gotowy: [`k6/`](k6/).
5. **[Nis, monitoring] Dostępność przy dużym wolumenie zamówień** — obserwować
   `get_public_catalog_availability`, gdy `order_items`/`orders` urosną
   (dziś zaindeksowane, ale to najbardziej „rozgałęziona" ścieżka).

## Czy był realny run k6

**Nie.** Powód: `k6` (ani `autocannon`) nie jest w PATH, a jedyna lokalna baza
(`supabase_db_db`:54322) jest **współdzielona** z aktywnymi sesjami — ciężki run
zabiłby ich pracę (kontencja puli/CPU, 500 od GoTrue). Zgodnie z dyscypliną
„nie ryzykuj cudzej pracy" zostawiam **gotowy harness k6 + README** do
uruchomienia na **izolowanym** stacku/stagingu, a skalowalność zmierzyłem
**statycznie** (EXPLAIN na zasianym wolumenie w transakcji z ROLLBACK) — metoda
lekka i bezpieczna dla współdzielonej bazy.

## Artefakty

- [`explain-audit.sql`](explain-audit.sql) — seed + EXPLAIN, transakcja z ROLLBACK (reprodukcja statycznego audytu).
- [`k6/catalog-hotpaths.js`](k6/catalog-hotpaths.js) — harness obciążeniowy.
- [`k6/README.md`](k6/README.md) — jak i GDZIE (izolacja) uruchamiać.
- `packages/db/supabase/migrations/0103_catalog_page_order_index.sql` — DRAFT indeksu (NIE wdrożony).
