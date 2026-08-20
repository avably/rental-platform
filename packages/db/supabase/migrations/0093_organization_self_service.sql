-- 0093_organization_self_service.sql
-- U12 — samoobsługa danych organizacji: WŁAŚCICIEL zmienia NAZWĘ i JĘZYK
-- (locale) własnej organizacji, bez superadmina (ADR-225).
--
-- DEFEKT (audyt UX 2026-08-08). Ekran „Organizacja" jest READ-ONLY: „Zmiany
-- danych organizacji wprowadza wsparcie Avably." Powód jest w RLS — `tenants`
-- ma WYŁĄCZNIE `superadmin_update` (0001), więc członek (nawet owner) NIE MA
-- ścieżki UPDATE. Zmiana nazwy sklepu czy języka storefrontu wymaga dziś
-- zgłoszenia do wsparcia; to jest dług, nie decyzja produktowa.
--
-- CZEGO TA MIGRACJA NIE ROBI: nie otwiera polityki `for update` dla członka.
-- RLS ogranicza WIERSZE, nie KOLUMNY — polityka `own_update` owner-only
-- wpuściłaby ownera do CAŁEGO wiersza tenanta: sam zdjąłby sobie `suspended_at`
-- (gdyby kolumna była), przełączył `status`, `plan`, `slug` (adres sklepu!)
-- albo `trial_ends_at`. To jest dokładnie ta klasa eskalacji, przed którą
-- broni się model uprawnień. Ograniczenie KTÓRYCH kolumn wolno ruszyć da się
-- wyrazić jawnie tylko w ciele funkcji — stąd RPC, a nie polityka.
--
-- WZORZEC (kanon 0076/0077, ADR-160/161). `app.set_tenant_logo` i
-- `app.set_tenant_style` piszą POJEDYNCZE kolumny `tenants` przez SECURITY
-- DEFINER, bo `authenticated` ma GRANT UPDATE, ale RLS przepuszcza tam tylko
-- superadmina. Ta migracja idzie tą samą drogą, z DWIEMA różnicami:
--   1. PRÓG UPRAWNIENIA to OWNER, nie sam żywy członek. Nazwa i język
--      organizacji to decyzja właściciela (widnieją na dokumentach, w
--      rozliczeniach i w języku publicznego sklepu), nie praca lady — więc
--      bramką jest `app.is_tenant_owner()` (0060), a nie
--      `app.is_current_tenant_member()`. Odmowa nie-ownerowi: 42501, ten sam
--      SQLSTATE co RLS/grant.
--   2. Funkcja pisze DWIE kolumny naraz (name+locale) i ANI JEDNEJ innej.
--
-- IZOLACJA JEST W CIELE, NIE W ARGUMENCIE. Tenant bierze się z
-- `app.tenant_id()`, użytkownik z `auth.uid()` — nie z parametrów. „Zmień nazwę
-- cudzej organizacji" nie jest ODMAWIANE, jest NIEWYRAŻALNE: wołający nie ma
-- jak wskazać cudzego wiersza. To samo, co robi `set_tenant_style`.
--
-- TRIGGER `tenants_guard_published` (0076) NIETKNIĘTY. Strażnik broni WYŁĄCZNIE
-- kolumn stanu opublikowanego (`logo_published`); name/locale nie są w jego
-- polu widzenia, więc UPDATE tych dwóch kolumn przechodzi przez `new.logo_published
-- is distinct from old.logo_published = false`. Nadto funkcja jest SECURITY
-- DEFINER właściciela migracji (postgres ∈ service_role), więc strażnik i tak
-- zwraca `new` na pierwszej gałęzi (ścieżka serwisowa). Guard nie jest ani
-- obchodzony, ani osłabiany — po prostu nie dotyczy tych kolumn.
--
-- Bez nowej tabeli i bez nowej polityki RLS: UPDATE na istniejącej `tenants`.
-- Macierz izolacji (packages/db/test/rls-isolation.test.ts) nie wymaga nowej
-- fabryki. Dowód niezmiennika kolumn + izolacji + roli: osobny plik
-- packages/db/test/update-organization.test.ts.

-- ---------------------------------------------------------------------
-- app.update_organization — WŁAŚCICIEL zmienia name + locale własnej org
-- ---------------------------------------------------------------------
create or replace function app.update_organization(p_name text, p_locale text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  -- Odmowa UPRAWNIENIA — ten sam SQLSTATE, co RLS i grant (kanon ADR-091),
  -- żeby bramka ownera nie odróżniała się kodem od odmowy dostępu.
  c_denied constant text := 'Nie masz uprawnień do zmiany danych organizacji.';
  -- Odmowa WALIDACJI — jedno zdanie dla wszystkich powodów (wzorzec 0076/0077).
  c_invalid constant text := 'Nieprawidłowe dane organizacji.';
  v_tenant_id uuid := app.tenant_id();
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
begin
  -- Tożsamość MUSI istnieć — anon i sesja bez claimu tenanta nie mają czego
  -- edytować. 42501: brak dostępu, nie „zły parametr".
  if v_user is null or v_tenant_id is null then
    raise exception '%', c_denied using errcode = '42501';
  end if;

  -- BRAMKA WŁAŚCICIELA. `app.is_tenant_owner()` (SECURITY DEFINER, 0060) pyta
  -- WPROST o wiersz public.members z role='owner' dla (app.tenant_id(),
  -- auth.uid()) — czyli o ŻYWE właścicielstwo, nie o claim z tokenu. Staff i
  -- były owner (członkostwo odebrane) dostają tu odmowę.
  if not (select app.is_tenant_owner()) then
    raise exception '%', c_denied using errcode = '42501';
  end if;

  -- Walidacja nazwy: przycięta, niepusta, rozsądna długość. Kolumna jest
  -- NOT NULL bez limitu (0001) — limit stawia funkcja, żeby nazwa nie urosła
  -- do rozmiaru, którego żaden dokument ani nagłówek sklepu nie udźwignie.
  if v_name = '' or length(v_name) > 200 then
    raise exception '%', c_invalid using errcode = '22023';
  end if;

  -- Walidacja języka: zamknięty zbiór {pl, en} — LUSTRO CHECK-u kolumny (0005:
  -- `locale in ('en','pl')`) i LOCALES z @avably/core. Sprawdzamy tu, żeby
  -- oddać czytelne 22023 zamiast surowego 23514 z CHECK-u bazy.
  if p_locale is null or p_locale not in ('pl', 'en') then
    raise exception '%', c_invalid using errcode = '22023';
  end if;

  -- UPDATE WYŁĄCZNIE name + locale WŁASNEGO tenanta. Żadnej innej kolumny —
  -- to jest cała różnica między tą funkcją a polityką `for update`, która
  -- oddałaby ownerowi status/plan/slug. `id = v_tenant_id` domyka izolację:
  -- wiersz bierze się z claimu, nie z argumentu.
  update public.tenants
     set name = v_name,
         locale = p_locale
   where id = v_tenant_id;

  -- `not found` po przejściu bramki ownera znaczy, że wiersz zniknął między
  -- sprawdzeniem a zapisem (kasacja tenanta) — traktujemy jak odmowę dostępu.
  if not found then
    raise exception '%', c_denied using errcode = '42501';
  end if;
end;
$$;

comment on function app.update_organization(text, text) is
  'U12/ADR-225: WŁAŚCICIEL zmienia NAZWĘ i JĘZYK (locale) WŁASNEJ organizacji. '
  'SECURITY DEFINER, bo authenticated nie ma UPDATE na tenants przez RLS '
  '(superadmin_update, 0001). Bramka: app.is_tenant_owner() — nie-owner dostaje '
  '42501. UPDATE obejmuje WYŁĄCZNIE kolumny name+locale (nie status/plan/slug/…): '
  'RLS nie ogranicza kolumn, funkcja tak. Tenant z app.tenant_id(), więc zmiana '
  'cudzej org jest NIEWYRAŻALNA, a nie odmawiana. Walidacja: name niepusty do 200 '
  'znaków, locale in (pl,en). Odmowa uprawnienia: 42501; odmowa walidacji: 22023.';

revoke all on function app.update_organization(text, text) from public, anon, authenticated;
grant execute on function app.update_organization(text, text) to authenticated, service_role;
