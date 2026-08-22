-- 0095_drop_nav_favorites.sql
-- REWERT ULUBIONYCH NAWIGACJI (ADR-233, C1) — odwrócenie 0094_nav_favorites.sql.
--
-- DLACZEGO. Właściciel po obejrzeniu ulubionych na żywo: „ulubione są bez sensu,
-- niepotrzebne". Warstwa personalizacji (ADR-232: pasek skrótów + gwiazdki na
-- liściach drzewa) zdjęta W CAŁOŚCI — z nią znika jedyny konsument tabeli
-- `app.user_nav_favorites` i RPC `app.set_nav_favorites`. Kod (odczyt/provider/
-- pasek/gwiazdki/akcja) usunięty w tym samym PR; ta migracja sprząta bazę.
--
-- BEZPIECZEŃSTWO KOLEJNOŚCI. Odczyt ulubionych był fail-silent (readNavFavorites
-- → pusta lista przy każdym błędzie), więc zdjęcie tabeli PRZED wdrożeniem kodu
-- co najwyżej dawało pustą listę — nic się nie psuło. Kolejność destrukcyjną
-- (po merge kodu czy przed) ustala PM; ta migracja jest bezpieczna w obie strony.
--
-- POZA MACIERZĄ IZOLACJI TENANTÓW. Tabela była kluczowana po `user_id` (nie
-- `tenant_id`), więc stała POZA automatyczną macierzą RLS (`listTenantTables`
-- filtruje `table_schema = 'public'`, a to schemat `app`). Jej usunięcie nie
-- rusza macierzy izolacji ani seed-tenants — nic tam jej nie znało.
--
-- IDEMPOTENTNA (`drop … if exists`) — PM wdraża plik na prod Z PLIKU (md5 w
-- raporcie); ponowne wykonanie nie może się wywrócić. NIE wdrażana automatycznie
-- z merge kodu — wdrożenie ręczne po stronie PM.

-- 1. Najpierw jedyny zapis (RPC SECURITY DEFINER) — jego ciało odwoływało się
--    do tabeli, więc gaśnie razem z konsumentem.
drop function if exists app.set_nav_favorites(jsonb);

-- 2. Potem tabela. Jej RLS-owa polityka `own_select` oraz granty znikają wraz
--    z nią (drop kaskaduje zależne obiekty tabeli); FK do auth.users przestaje
--    istnieć. Żadna inna tabela nie odwołuje się do user_nav_favorites, więc
--    `cascade` jest zbędne.
drop table if exists app.user_nav_favorites;
