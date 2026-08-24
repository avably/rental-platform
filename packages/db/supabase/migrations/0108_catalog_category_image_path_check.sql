-- =====================================================================
-- 0108 — CHECK PREFIKSU TENANTA NA catalog_categories.image_path
--        (defense-in-depth izolacji, ADR-264)
-- =====================================================================
--
-- STAN PRZED: baner kategorii (kolumna public.catalog_categories.image_path,
-- 0101/ADR-244) zapisuje app.set_category_image (0106/ADR-260), która ŚWIADOMIE
-- zawęża ścieżkę w CIELE funkcji: tenant z app.tenant_id(), a wartość musi
-- pasować do wzorca {tenant}/category/{uuid}.{ext} zakotwiczonego z obu stron.
-- To bramka PROCEDURY, nie TABELI.
--
-- ================== LUKA, KTÓRĄ TA MIGRACJA DOMYKA ==================
--
-- catalog_categories niesie dla roli `authenticated` GRANT UPDATE (0072), a
-- polityka RLS `tenant_update` bramkuje WIERSZ (tenant_id = app.tenant_id() +
-- żywe członkostwo), NIE wartość kolumny. Trigger `catalog_category_guard`
-- (0072) sprawdza wyłącznie slug i stempluje updated_at. W efekcie członek
-- najemcy A może OMINĄĆ RPC i bezpośrednim UPDATE-em PostgREST na własnym
-- wierszu zapisać w `image_path` DOWOLNY tekst — w tym:
--   * ścieżkę spoza własnego prefiksu (przypięcie pliku innego najemcy do
--     własnej kategorii; myli też sprzątacz sierot site-images, ADR-260, który
--     uznałby cudzy plik za „w użyciu"),
--   * łańcuch spoza wzorca (np. `{tenant}/category/../../etc/passwd` — prefiks
--     się zgadza, ale to traversal, którego sam warunek prefiksu NIE złapie).
--
-- Zawężenia ścieżki NIE da się wyrazić w RLS (RLS zna wiersz, nie zna wartości
-- `image_path`) — dlatego 0106 posadziło je w SECURITY DEFINER. Ta migracja
-- dokłada je RÓWNIEŻ jako WŁASNOŚĆ TABELI: CHECK broni niezależnie od ścieżki
-- zapisu (RPC, bezpośredni UPDATE, przyszły kod), a nie tylko na drodze przez
-- funkcję. To ta sama figura co 0106 (`site_image_uploads_path_check`), gdzie
-- kształt ścieżki jest CHECK-iem tabeli budowanym z kolumn TEGO SAMEGO wiersza.
--
-- ================== ZAKRES WZORCA — PEŁNY, NIE SAM PREFIKS ==================
--
-- Minimum wymagane przez audyt to prefiks tenanta (split_part = tenant_id).
-- Bierzemy MOCNIEJSZY wariant: pełny wzorzec {tenant}/category/{uuid}.{ext},
-- CO DO ZNAKU lustro app.set_category_image. Powód: sam prefiks nie odcina
-- „łańcucha spoza wzorca" (traversal `..` po zgodnym prefiksie), a audyt
-- wymienia to jako ryzyko. Pełny wzorzec zamyka OBA ryzyka jednym warunkiem.
-- Wyrażenie jest immutable (konkatenacja `||`, cast uuid→text, regex `~`), więc
-- legalne w CHECK — dokładnie jak path_check w 0106.
--
-- ================== OKNO WDROŻENIOWE — DLACZEGO BEZPIECZNE ==================
--
-- Migracja jedzie na produkcję PRZED kodem (deploy-before-code). CHECK jest
-- ADDITYWNY i WZMACNIA izolację (nie rozluźnia): żadna nowa kolumna, żadna
-- zmiana sygnatury, żaden istniejący czytnik/pisarz zgodny z 0106 nie musi się
-- zmieniać. JEDYNY pisarz `catalog_categories.image_path` to app.set_category_image
-- (zweryfikowano na origin/main — nigdzie w kodzie nie ma bezpośredniego zapisu
-- tej kolumny), a ta zapisuje wyłącznie wartości zgodne z tym wzorcem (albo NULL).
-- Dlatego CHECK dodajemy WPROST (VALIDATED): istniejące wiersze go spełniają.
--
-- KONTROLA WSTĘPNA (warunek zamknięcia briefu): przed dodaniem CHECK-a policz
-- wiersze naruszające warunek. Na lokalnej bazie weryfikacyjnej: 0 wierszy
-- z niepustym image_path spoza wzorca (funkcja świeża, kolumna wypełniana tylko
-- RPC-em). Gdyby na prod wyszło >0 — NIE dodawać VALIDATED; wtedy `not valid`
-- + osobny raport. Tu >0 jest niemożliwe przy jedynym pisarzu = RPC.
--
-- IDEMPOTENTNA: drop-if-exists przed add (Postgres nie ma `add constraint if
-- not exists` dla CHECK — wzorzec 0106). Ponowne wykonanie nie zmienia stanu.
-- =====================================================================

-- === BEGIN PROD MIGRATION 0108 ===

alter table public.catalog_categories
  drop constraint if exists catalog_categories_image_path_tenant_scope;

alter table public.catalog_categories
  add constraint catalog_categories_image_path_tenant_scope
    check (
      image_path is null
      or image_path ~ (
        '^' || tenant_id::text ||
        '/category/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|avif)$'
      )
    );

comment on constraint catalog_categories_image_path_tenant_scope
  on public.catalog_categories is
  'Baner kategorii ZAWSZE pod ścieżką własnego tenanta: image_path NULL albo '
  '{tenant_id}/category/{uuid}.{jpg|png|webp|avif} (lustro app.set_category_image, '
  '0106/ADR-260). Warstwa TABELI broni niezależnie od drogi zapisu — bezpośredni '
  'UPDATE PostgREST (grant authenticated + RLS wierszowy z 0072) nie wskaże '
  'ścieżki spoza prefiksu ani łańcucha spoza wzorca. Odmowa: 23514 (ADR-264).';

-- === END PROD MIGRATION 0108 ===
