-- =====================================================================
-- 0090 — NAJEMCA WYŁĄCZA GLOBALNĄ PIGUŁKĘ TERMINU W PASKU SKLEPU (ADR-203)
-- =====================================================================
--
-- FAZA B pigułki terminu z ADR-194 („wyłączalność pigułki przez najemcę =
-- osobna decyzja i panel; domyślnie widoczna"). Ta migracja dokłada JEDNĄ
-- kolumnę i DWIE funkcje; nie rusza ani jednej istniejącej tabeli, polityki,
-- grantu tabelowego ani sygnatury zastanej.
--
-- ============== CO TA FLAGA WYŁĄCZA, A CZEGO NIE ==============
--
-- Wyłącza WYŁĄCZNIE globalny wyzwalacz terminu w powłoce sklepu: pigułkę
-- w belce (desktop) i wiersz pod belką (mobile) z aneksu ADR-194. Widget
-- rezerwacji na stronie sprzętu (ProductBooking) zostaje NIETKNIĘTY — ma
-- własne pole terminu i własne okno wyboru, więc klient dalej wybiera termin
-- na karcie sprzętu, a checkout dalej dostaje komplet dat z tego samego
-- stanu koszyka (CartState, ADR-179). Reguła „flaga off → term=null" stoi
-- po stronie sklepu; baza wystawia sam FAKT.
--
-- ============== DLACZEGO KOLUMNA Z DEFAULT TRUE ==============
--
-- `true` = zachowanie dzisiejsze, więc migracja jest NEUTRALNA w oknie
-- wdrożeniowym: żaden istniejący najemca nie traci pigułki, a stary kod
-- sklepu (który flagi nie czyta) renderuje dokładnie to, co przed migracją.
-- Wzorzec kolumny z neutralnym defaultem — buffer_*_days (0007),
-- min_rental_days (0089).
--
-- ============== DLACZEGO OSOBNA FUNKCJA ODCZYTU, NIE KLUCZ W KATALOGU ==============
--
-- Rozważone i odrzucone:
--
--   (a) DOŁOŻENIE FLAGI DO `app.get_public_catalog` (i pochodnych). Koperty
--       publicznych odczytów są po stronie sklepu parsowane `.strict()`,
--       a migracje wchodzą na produkcję PRZED kodem — nowy klucz kładłby
--       sklep KAŻDEGO najemcy na czas okna. Ta sama krawędź, przed którą
--       broniły się 0074, 0079, 0083 i sekcja „czego nie zmienia" w 0089.
--   (b) DOŁOŻENIE FLAGI DO `app.get_tenant_appearance`. Koperta powłoki jest
--       parsowana fail-soft, więc okna by nie wywróciła — ale flaga nie jest
--       wyglądem: to przełącznik ZACHOWANIA powłoki, a doklejanie go do
--       koperty stylu i znaku mieszałoby dwa kontrakty w jednej odpowiedzi
--       (następna flaga powłoki znowu stanęłaby przed tym samym pytaniem).
--   (c) ODCZYT `public.tenants` WPROST PRZEZ POSTGREST. Anon nie ma na tej
--       tabeli grantu i mieć go nie powinien: wiersz najemcy niesie e-mail
--       rozliczeniowy, status subskrypcji i identyfikator konta płatności
--       (dokładnie argument 0079).
--
-- Zostaje własna funkcja `app.get_public_store_flags` o własnej sygnaturze —
-- wzorzec 0074/0079/0083: nowa funkcja nie ma jak niczego zepsuć w oknie
-- wdrożeniowym, bo w oknie NIKT jej nie woła. Koperta jest ROZSZERZALNA
-- (jsonb z nazwanymi kluczami): następna flaga powłoki dokłada klucz do TEJ
-- odpowiedzi, a sklep — który parsuje ją fail-soft po znanych kluczach —
-- nowego klucza po prostu nie zauważy, zamiast się wywrócić.
--
-- ============== IZOLACJA ==============
--
-- ODCZYT: SECURITY DEFINER, więc RLS w nim NIE UCZESTNICZY — jedyną bramką
-- jest jawne zawężenie `t.id = p_tenant_id` w ciele (wzorzec ADR-170 D3:
-- bramka w ciele daje się udowodnić mutacją). `p_tenant_id` przychodzi do
-- sklepu WYŁĄCZNIE z nagłówka wstrzykniętego przez proxy po rozwiązaniu
-- hosta (ADR-039). Okno handlowe (`app.tenant_commercially_active`) jest tym
-- samym warunkiem, co w `get_tenant_appearance` i `get_public_catalog`:
-- najemca po zamknięciu konta znika CAŁY, nieodróżnialnie od nieistniejącego.
--
-- ZAPIS: SECURITY DEFINER z tenantem WYŁĄCZNIE z `app.tenant_id()` (claim
-- sesji) — „zapisz flagę cudzemu najemcy" nie jest odmawiane, jest
-- NIEWYRAŻALNE, bo wołający nie ma jak wskazać wiersza (wzorzec
-- `set_tenant_style`, 0077). Próg uprawnienia: ŻYWE członkostwo
-- (`app.is_current_tenant_member`, kanon ADR-126), nie sam claim z tokenu.
-- Definer jest konieczny z tego samego powodu, co w 0077: `authenticated` ma
-- GRANT UPDATE na `public.tenants`, ale RLS przepuszcza tam wyłącznie
-- superadmina — zapis invokerem kończyłby się cichym „zero wierszy".
--
-- Strażnik `app.guard_published_columns` NIE zapala się na tym zapisie:
-- pilnuje wyłącznie kolumn *_published, a te w tym UPDATE nie zmieniają się
-- (`is distinct from` = false). Flaga świadomie NIE MA pary szkic/publikacja:
-- to przełącznik zachowania, nie treść — działa od zapisania, jak ustawienia
-- w tenant_settings.
--
-- ============== OKNO WDROŻENIOWE ==============
--
-- Migracja jedzie na produkcję PRZED kodem (wdraża ją PM). Kolumna z default
-- true jest neutralna; obu nowych funkcji w oknie nikt nie woła. Bezpieczne
-- w obie strony.

-- === BEGIN PROD MIGRATION 0090 ===

-- ---------------------------------------------------------------------
-- 1. Kolumna tenants.store_term_calendar_enabled (default true = zero regresu)
-- ---------------------------------------------------------------------

alter table public.tenants
  add column store_term_calendar_enabled boolean not null default true;

comment on column public.tenants.store_term_calendar_enabled is
  'Globalna pigułka wyboru terminu w pasku powłoki sklepu (ADR-194). true = pigułka widoczna (stan sprzed 0090); false = najemca ją wyłączył i klient wybiera termin wyłącznie w widgecie strony sprzętu (ProductBooking — NIEZALEŻNY od tej flagi). Czytana publicznie WYŁĄCZNIE przez app.get_public_store_flags, zapisywana WYŁĄCZNIE przez app.set_store_term_calendar (ADR-203).';

-- ---------------------------------------------------------------------
-- 2. app.get_public_store_flags — publiczny odczyt flag powłoki sklepu
-- ---------------------------------------------------------------------
--
-- Klucz `term_calendar_enabled` jest BEZWARUNKOWY: kolumna jest `not null`,
-- więc NULL nie ma jak trafić pod klucz. Następne flagi powłoki dokładają
-- kolejne klucze do TEJ koperty (funkcja jest po to, żeby nie ruszać
-- koperty katalogu) — sklep parsuje po znanych kluczach, fail-soft.

create or replace function app.get_public_store_flags(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object('term_calendar_enabled', t.store_term_calendar_enabled)
  from public.tenants t
  where t.id = p_tenant_id
    and app.tenant_commercially_active(t.status);
$$;

comment on function app.get_public_store_flags(uuid) is
  'FLAGI POWŁOKI SKLEPU (ADR-203): publiczny odczyt przełączników zachowania powłoki najemcy — na start term_calendar_enabled (globalna pigułka terminu w pasku, ADR-194 faza B). Wyłącznie dla najemcy w oknie handlowym (0065); NULL dla nieistniejącego albo poza oknem — nieodróżnialnie. SECURITY DEFINER: jedyną bramką izolacji jest jawne zawężenie t.id = p_tenant_id w ciele, nie RLS (wzorzec 0079). Osobna funkcja zamiast klucza w get_public_catalog, bo koperty publicznych odczytów są parsowane .strict() po stronie sklepu, a migracje jadą przed kodem (lekcja 0074/0079/0083).';

revoke all on function app.get_public_store_flags(uuid) from public;
grant execute on function app.get_public_store_flags(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. app.set_store_term_calendar — zapis flagi przez operatora panelu
-- ---------------------------------------------------------------------
--
-- Wzorzec set_tenant_style (0077): definer, tenant z claimu (niewyrażalny
-- zapis cudzemu), żywe członkostwo, stała odmowa 22023 bez rozróżniania
-- przyczyn (brak sesji / brak członkostwa / złe wejście odpowiadają tym
-- samym zdaniem — funkcja nie jest wyrocznią o stanie konta).

create or replace function app.set_store_term_calendar(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text := 'Nie można zapisać ustawienia kalendarza terminu.';
  v_tenant_id uuid;
begin
  v_tenant_id := app.tenant_id();

  if auth.uid() is null or v_tenant_id is null then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  if not (select app.is_current_tenant_member()) then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  -- Boolean przychodzi z PostgREST już zrzutowany; NULL to jedyny śmieć,
  -- jaki tu dociera — a „nie wiadomo, czy pigułka ma być" nie jest stanem.
  if p_enabled is null then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  update public.tenants
     set store_term_calendar_enabled = p_enabled
   where id = v_tenant_id;

  if not found then
    raise exception '%', c_denied using errcode = '22023';
  end if;
end;
$$;

comment on function app.set_store_term_calendar(boolean) is
  'Zapis flagi globalnej pigułki terminu w pasku sklepu (ADR-203). Tenant WYŁĄCZNIE z app.tenant_id() — zapis cudzemu najemcy jest NIEWYRAŻALNY, nie odmawiany (wzorzec set_tenant_style, 0077). Wymaga ŻYWEGO członkostwa (ADR-126). Bez pary szkic/publikacja: przełącznik zachowania działa od zapisania. Odmowa: 22023.';

revoke all on function app.set_store_term_calendar(boolean)
  from public, anon, authenticated;
grant execute on function app.set_store_term_calendar(boolean)
  to authenticated, service_role;

-- === END PROD MIGRATION 0090 ===
