-- 0094_nav_favorites.sql
-- ULUBIONE nawigacji — przypięte ekrany panelu PER UŻYTKOWNIK (ADR-232, C1 lane 2).
--
-- CO TO JEST. Operator przypina ekrany panelu gwiazdką w drzewie nawigacji
-- (ADR-231) i widzi je jako skróty w pasku na górze. Właściciel wybrał
-- przechowywanie PER-UŻYTKOWNIK (cross-device), więc preferencja mieszka
-- w tabeli z RLS — nie w ciasteczku jak stan rozwinięcia akordeonu
-- (nav-tree-collapse.ts) czy zwinięcia paska przewodnika (launch-guide-collapse.ts).
--
-- WZORZEC — DOKŁADNIE app.user_active_tenant (0092, ADR-224, L7). Tabela
-- kluczowana po `user_id`, w schemacie `app`:
--   1. RLS SELECT wyłącznie własnego wiersza (`user_id = auth.uid()`),
--   2. ZERO polityk write dla PostgREST — zapis TYLKO przez RPC SECURITY
--      DEFINER (`app.set_nav_favorites`) oraz service_role,
--   3. izolacja Z KONSTRUKCJI: RPC bierze usera z `auth.uid()`, NIE z argumentu
--      — „zapisz cudze ulubione" jest NIEWYRAŻALNE.
--
-- DLACZEGO SCHEMA `app`, A NIE `public`. Jak app.user_active_tenant (0092)
-- i app.superadmins (0003): tabela jest kluczowana po `user_id`, nie po
-- `tenant_id` — to preferencja UŻYTKOWNIKA, nie byt per-tenant. Stoi więc POZA
-- automatyczną macierzą izolacji RLS tenantów (`listTenantTables` filtruje
-- `table_schema = 'public'`, packages/db/test/helpers/seed-tenants.ts) — i
-- słusznie: nie ma tu OSI TENANTA do izolowania. Nie dokładamy fabryki ani
-- mutation-patcha do seed-tenants; izolację UŻYTKOWNIKA daje RLS `own` niżej
-- + bramka `auth.uid()` w RPC. Izolacja użytkownika A↔B ma własny test wprost
-- + dowód mutacyjny: packages/db/test/nav-favorites.test.ts.
--
-- DB AGNOSTYCZNA WOBEC TREŚCI. `favorites` to UPORZĄDKOWANA tablica JSON
-- NIEPRZEZROCZYSTYCH identyfikatorów pozycji nav (kolejność = kolejność chipów
-- w pasku). Baza nie wie, czym są te stringi — waliduje WYŁĄCZNIE, że to
-- tablica i że nie przekracza rozmiaru. Sprawdzenie „czy to ZNANY ekran" żyje
-- w UI (filtr do PANEL_NAV_ITEMS przy renderze), żeby nie sprzęgać bazy ze
-- strukturą nawigacji — usunięty/dodany ekran nie wymaga migracji.
--
-- IDEMPOTENTNA (`if not exists` / `drop policy if exists` / `create or replace`)
-- — PM wdraża plik na prod Z PLIKU przed merge (md5 w raporcie); ponowne
-- wykonanie nie może się wywrócić.

-- ---------------------------------------------------------------------
-- 1. Tabela ulubionych (per użytkownik)
-- ---------------------------------------------------------------------

create table if not exists app.user_nav_favorites (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- UPORZĄDKOWANA tablica nieprzezroczystych ID pozycji nav. CHECK trzyma
  -- WYŁĄCZNIE niezmienniki agnostyczne wobec treści: „to tablica" oraz granica
  -- rozmiaru (ochrona przed rozdęciem wiersza). Domyślnie pusta.
  favorites jsonb not null default '[]'::jsonb
    constraint user_nav_favorites_is_array check (jsonb_typeof(favorites) = 'array'),
  updated_at timestamptz not null default now(),
  constraint user_nav_favorites_len check (length(favorites::text) <= 2048)
);

alter table app.user_nav_favorites enable row level security;

-- Odczyt: użytkownik widzi WYŁĄCZNIE swój wiersz. Zapis (ustawienie ulubionych)
-- NIE jest samoobsługą przez PostgREST — jedyną drogą jest app.set_nav_favorites
-- (SECURITY DEFINER, user z auth.uid()) oraz service_role. Brak polityk/grantów
-- insert/update/delete dla authenticated jest CELOWY (wzorzec app.superadmins /
-- app.user_active_tenant): każdy zapis przechodzi przez RPC, więc bezpośredni
-- upsert authenticated nie istnieje. FK on delete cascade na auth.users sprząta
-- ulubione po skasowaniu konta.
drop policy if exists own_select on app.user_nav_favorites;
create policy own_select on app.user_nav_favorites for select
  using (user_id = auth.uid());

grant select on app.user_nav_favorites to authenticated, service_role;
grant insert, update, delete on app.user_nav_favorites to service_role;

comment on table app.user_nav_favorites is
  'ADR-232: przypięte (ulubione) ekrany panelu użytkownika — uporządkowana '
  'tablica nieprzezroczystych ID pozycji nav (kolejność = kolejność w pasku). '
  'RLS SELECT tylko własnego wiersza; zapis wyłącznie przez app.set_nav_favorites '
  '(auth.uid(), nie z argumentu) i service_role. Poza macierzą izolacji tenantów '
  '(per-user, nie per-tenant — jak app.user_active_tenant/0092).';

-- ---------------------------------------------------------------------
-- 2. app.set_nav_favorites — jedyny zapis (SECURITY DEFINER, self-only)
-- ---------------------------------------------------------------------
-- Upsert WŁASNEGO wiersza wołającego. Izolacja Z KONSTRUKCJI: `v_user_id`
-- pochodzi z `auth.uid()`, nie z żadnego argumentu — RPC nie przyjmuje user_id,
-- więc „zapisz cudze ulubione" jest niewyrażalne. Walidacja agnostyczna wobec
-- treści (jak CHECK tabeli): tablica + granica rozmiaru, odmowa 22023. Anonim
-- (brak `auth.uid()`) → odmowa 42501.

create or replace function app.set_nav_favorites(p_favorites jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, app
as $$
declare
  v_user_id uuid := auth.uid();
begin
  -- BRAMKA TOŻSAMOŚCI (oś izolacji). Bez zalogowania nie ma czyjego wiersza
  -- zapisać. 42501 (insufficient_privilege) jest standardowym SQLSTATE, który
  -- PostgREST mapuje na 403 z zachowanym komunikatem.
  if v_user_id is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '42501';
  end if;

  -- WALIDACJA AGNOSTYCZNA WOBEC TREŚCI. Baza nie zna struktury nav — sprawdza
  -- tylko kształt: musi być tablicą JSON (NULL/obiekt/skalar → 22023). `is
  -- distinct from` łapie też SQL NULL (jsonb_typeof(NULL) = NULL).
  if jsonb_typeof(p_favorites) is distinct from 'array' then
    raise exception 'Ulubione muszą być tablicą JSON.' using errcode = '22023';
  end if;

  -- Granica rozmiaru — lustro CHECK-u tabeli, żeby dać czytelne 22023 zanim
  -- wpisze się w constraint (który dałby 23514).
  if length(p_favorites::text) > 2048 then
    raise exception 'Lista ulubionych przekracza dozwolony rozmiar.' using errcode = '22023';
  end if;

  insert into app.user_nav_favorites (user_id, favorites, updated_at)
  values (v_user_id, p_favorites, now())
  on conflict (user_id) do update
    set favorites = excluded.favorites,
        updated_at = now();
end;
$$;

comment on function app.set_nav_favorites(jsonb) is
  'ADR-232: zapisuje ulubione (przypięte ekrany) WOŁAJĄCEGO. User z auth.uid() '
  '(nie z argumentu — zapis cudzych ulubionych niewyrażalny). Walidacja: tablica '
  'JSON + rozmiar ≤ 2048 znaków, inaczej 22023; anonim → 42501. DB agnostyczna '
  'wobec treści ID (walidacja „znany ekran" jest w UI).';

-- REVOKE public/anon, GRANT authenticated/service_role (jak app.set_active_tenant).
revoke all on function app.set_nav_favorites(jsonb) from public, anon;
grant execute on function app.set_nav_favorites(jsonb) to authenticated, service_role;
