-- =====================================================================
-- 0103 — DRAFT (ADR-250): INDEKS PORZĄDKU KATALOGU pod hot-odczyty sklepu.
--        NIE WDROŻONY. Plik przygotowany przez audyt skalowalności
--        (docs/operacje/loadtest/2026-08-24-audyt-skalowalnosci.md).
--        PM rewiduje, sprawdza wolny numer na origin/main + otwarte PR,
--        wdraża z pliku PRZED merge (auto-deploy) i puszcza pełną suitę
--        @avably/db. Autor audytu NIE stosuje tej migracji na współdzielonej
--        lokalnej bazie (dyscyplina shared-supabase).
-- =====================================================================
--
-- PO CO. Publiczne odczyty listy sklepu porządkują aktywne pozycje po
-- (name, id):
--   * app.get_public_catalog_page (0085) — okno /katalog:
--       from public.products p where p.active order by p.name, p.id
--       offset ... limit ...;
--   * app.get_public_catalog (0072) — pełny katalog /store (home).
-- Dziś jedyny indeks na to trafienie to products_tenant_active_idx
-- (tenant_id, active) — pokrywa FILTR, ale NIE porządek. Planer domyka
-- ORDER BY węzłem Sort nad całym aktywnym zbiorem najemcy (dowód: EXPLAIN
-- w raporcie audytu, węzeł „Sort  Sort Key: name, id" przy każdej odsłonie).
--
-- Ten indeks daje btree już-uporządkowany po (name, id) w obrębie najemcy,
-- więc okno stronicowane schodzi z „Seq Scan + Sort" na „Index Scan"
-- z wczesnym zatrzymaniem po offset+limit wierszach. Dowód behawioralny
-- (klon tymczasowy zasianego wolumenu, 800 pozycji): przed — Sort quicksort
-- 81 kB; po zbudowaniu TEGO indeksu — Index Scan, ZERO węzła Sort, ~2,5×
-- krótszy czas okna. Sekcja C raportu.
--
-- DLACZEGO WARUNKOWY `WHERE active`. Sklep czyta WYŁĄCZNIE pozycje aktywne
-- (p.active w każdym odczycie publicznym). Indeks częściowy jest mniejszy
-- (pozycje zdjęte z oferty go nie obciążają) i celuje dokładnie w predykat
-- hot-ścieżki. `id` jako trzecia kolumna domyka porządek TOTALNY (name nie
-- jest unikatem) — dokładnie klucz sortu funkcji, więc porządek indeksu jest
-- jej lustrem i przy OFFSET żadna pozycja nie wejdzie na dwie strony.
--
-- ADDYTYWNY I TENANT-AGNOSTYCZNY. Sam dokłada strukturę odczytu: zero zmian
-- RLS, grantów, kolumn, żadnej funkcji ani polityki. tenant_id jest kolumną
-- WIODĄCĄ (nie zawężeniem widoczności) — na produkcji, gdzie public.products
-- niesie wiersze WSZYSTKICH najemców, wiodący tenant_id jest tym, co czyni
-- indeks selektywnym; w jednonajemcowym seedzie audytu ta korzyść jest
-- niedoszacowana (planer i tak seq-scanuje małą tabelę), więc realny zysk na
-- prodzie jest WIĘKSZY niż w pomiarze. Nie zmienia wyniku żadnego zapytania,
-- tylko plan.
--
-- ========================= OKNO WDROŻENIOWE =========================
--
-- BUDOWA W TRANSAKCJI vs CONCURRENTLY — ROZSTRZYGA PM PRZY WDROŻENIU.
-- Wariant zapisany niżej to zwykłe `create index if not exists` (spójne
-- z całym repo — żadna migracja nie używa dotąd CONCURRENTLY, migracje jadą
-- w transakcji). Na dzisiejszej skali (setki–niskie tysiące pozycji/najemcę)
-- budowa jest podsekundowa, a SHARE-lock na public.products trwa tyle co
-- budowa — pomijalny. GDY tabela urośnie, PM może zamiast tego wykonać
-- z pliku, POZA transakcją migracyjną:
--
--   create index concurrently if not exists products_tenant_name_active_idx
--     on public.products (tenant_id, name, id) where active;
--
-- (CONCURRENTLY nie blokuje zapisów katalogu w panelu, ale NIE MOŻE biec
-- w transakcji — stąd osobny krok wdrożenia, nie ten plik w batchu). Efekt
-- końcowy identyczny; różnica jest wyłącznie w locku podczas budowy.
--
-- KONWENCJE (docs/konwencje-migracji.md): idempotentne (`if not exists`),
-- comment on index, zero zmian RLS/grantów.

-- === BEGIN PROD MIGRATION 0103 ===

create index if not exists products_tenant_name_active_idx
  on public.products (tenant_id, name, id)
  where active;

comment on index public.products_tenant_name_active_idx is
  'Porządek listy sklepu (0103, ADR-250): pokrywa ORDER BY (name, id) aktywnych pozycji najemcy w app.get_public_catalog_page (0085) i app.get_public_catalog (0072). Częściowy (WHERE active) — sklep czyta wyłącznie aktywne. Zdejmuje węzeł Sort z okna stronicowanego (Index Scan z wczesnym zatrzymaniem po offset+limit). Additywny, tenant-agnostyczny, bez zmian RLS.';

-- === END PROD MIGRATION 0103 ===
