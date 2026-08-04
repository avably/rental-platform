-- =====================================================================
-- 0048 — MODEL STRON: wiele wersji strony, jedna ŻYWA (K7, ADR-093)
-- =====================================================================
--
-- Do 0047 tenant miał DOKŁADNIE JEDNĄ stronę (unikat sites_tenant_unique).
-- Konsekwencja, którą zgłosił właściciel: „zacznij od nowa" na stronie
-- opublikowanej MUSI zostawić nagrobki (ADR-091 nie pozwala skasować treści,
-- którą widzi klient), więc operator nie ma jak zbudować nowej strony na
-- czysto, nie gasząc przy tym sklepu.
--
-- Ta migracja zamienia niezmiennik „jedna strona na tenanta" na „najwyżej
-- JEDNA ŻYWA strona na tenanta". Wersje robocze są zwykłymi wierszami `sites`
-- bez `published_at`; publikacja przełącza, która z nich jest żywa.
--
-- CZEGO TA MIGRACJA NIE RUSZA: app.get_published_site zostaje BAJTOWO
-- IDENTYCZNA. Już dziś wybiera stronę warunkiem `published_at is not null` —
-- brakowało jej wyłącznie gwarancji, że taka strona jest jedna. Gwarancję daje
-- unikat częściowy z sekcji 2. Bliźniaki *_published zostają tam, gdzie były.

-- === BEGIN PROD MIGRATION 0048 ===

-- ---------------------------------------------------------------------
-- 1. Nazwa strony (dana WYŁĄCZNIE szkicowa)
-- ---------------------------------------------------------------------
--
-- Lista stron bez etykiet jest nieużywalna. Kolumna nie jest czytana przez
-- app.get_published_site, więc nie dostaje bliźniaka ani wpisu u strażnika —
-- kanon ADR-091 dotyczy kolumn WIDOCZNYCH PUBLICZNIE, a ta nią nie jest.
-- Default obsługuje wiersze istniejące; backfill nie jest potrzebny.

alter table public.sites
  add column if not exists name text not null default 'Strona sklepu';

alter table public.sites
  drop constraint if exists sites_name_length_check;

alter table public.sites
  add constraint sites_name_length_check
  check (char_length(btrim(name)) between 1 and 80);

comment on column public.sites.name is
  'Nazwa wersji strony widoczna WYŁĄCZNIE w panelu (lista stron). Nie wchodzi do koperty publicznej, więc nie ma bliźniaka *_published (ADR-093).';

-- ---------------------------------------------------------------------
-- 2. Jedna ŻYWA strona na tenanta zamiast jednej strony na tenanta
-- ---------------------------------------------------------------------
--
-- Unikat CZĘŚCIOWY, nie zwykły: wersji roboczych może być wiele, żywa jest
-- najwyżej jedna. Predykat jest tą samą prawdą, którą czyta odczyt publiczny,
-- więc nie da się ich rozjechać.
--
-- DLACZEGO INDEKS, A NIE REGUŁA W AKCJI: przy dwóch żywych stronach
-- app.get_published_site NIE PADA — jest funkcją `language sql returns jsonb`,
-- więc cicho oddaje PIERWSZY wiersz niesortowanego skanu. Zmierzone sondą
-- przed napisaniem tej migracji. Bez indeksu „miks dwóch stron" nie byłby
-- awarią do zauważenia, tylko losowym wyborem przy każdym planie zapytania.
--
-- sites_tenant_id_key UNIQUE (tenant_id, id) ZOSTAJE — to cel złożonych FK
-- z site_sections i site_image_uploads, a nie ograniczenie liczby stron.

alter table public.sites
  drop constraint if exists sites_tenant_unique;

create unique index if not exists sites_one_live_per_tenant_idx
  on public.sites (tenant_id)
  where published_at is not null;

comment on index public.sites_one_live_per_tenant_idx is
  'Najwyżej JEDNA żywa strona na tenanta (ADR-093). Predykat jest lustrem warunku, którym app.get_published_site wybiera stronę — dwie żywe strony dałyby cichy, niedeterministyczny wybór, nie błąd.';

-- ---------------------------------------------------------------------
-- 3. STRONY ŻYWEJ NIE DA SIĘ SKASOWAĆ
-- ---------------------------------------------------------------------
--
-- Stan sprzed tej migracji (zmierzony sondą): `authenticated` ma DELETE na
-- public.sites, polityka tenant_delete przepuszcza własny wiersz, a triggera
-- BEFORE DELETE nie ma — więc członek gasił sklep jednym żądaniem PostgREST,
-- bez żadnego zdarzenia publikacji. Kanon ADR-091 mówi, że stan widoczny
-- publicznie zmienia WYŁĄCZNIE publikacja; kasowanie żywej strony jest taką
-- zmianą, więc musi być odmawiane w BAZIE.
--
-- Osobna funkcja, a nie gałąź w app.guard_published_columns: tamta jest
-- BEFORE INSERT OR UPDATE i w każdej gałęzi sięga po `new`, którego przy
-- DELETE nie ma. Rozszerzanie funkcji chronionej dziewiętnastoma testami
-- o rozłączną odpowiedzialność kosztowałoby więcej, niż daje.
--
-- service_role PRZEPUSZCZANY — kaskada z public.tenants (offboarding, sprzątanie
-- testów) idzie tą rolą, a strona kasowana razem z tenantem nie ma już komu
-- niczego pokazać. Ta sama przepustka i to samo uzasadnienie, co w 0045.
-- SQLSTATE 42501 — jak u strażnika bliźniaków: odmowa uprawnienia,
-- nieodróżnialna od odmowy RLS.

create or replace function app.guard_live_site_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text :=
    'Strony widocznej w sklepie nie można usunąć — najpierw opublikuj inną.';
begin
  if pg_has_role(current_user, 'service_role', 'USAGE') then
    return old;
  end if;

  if old.published_at is not null then
    raise exception '%', c_denied using errcode = '42501';
  end if;

  return old;
end;
$$;

comment on function app.guard_live_site_delete() is
  'Strażnik ŻYWEJ strony (ADR-093): wiersz z published_at nie null kasuje wyłącznie rola serwisowa (kaskada z tenants). Odmowa: 42501 — ten sam SQLSTATE co odmowa RLS i co strażnik bliźniaków.';

drop trigger if exists sites_guard_live_delete on public.sites;
create trigger sites_guard_live_delete
  before delete on public.sites
  for each row execute function app.guard_live_site_delete();

-- ---------------------------------------------------------------------
-- 4. PUBLIKACJA PRZEŁĄCZA ŻYWĄ STRONĘ — jednym zdarzeniem
-- ---------------------------------------------------------------------
--
-- Jedyna zmiana względem 0046: przed podniesieniem nowej strony gasimy
-- poprzednią. Kolejność wymusza unikat częściowy z sekcji 2 (dwie żywe strony
-- nie mogą współistnieć nawet przez jedno zdanie SQL).
--
-- BRAK OKNA MIKSU wynika z izolacji transakcji, nie z ostrożności:
-- app.get_published_site czyta sites i site_sections JEDNYM zapytaniem, więc
-- widzi jedną migawkę — albo sprzed tej transakcji, albo po niej. Wyjątek
-- w środku (site_not_found) wycofuje także zgaszenie starej strony, więc
-- nieudana publikacja nie zostawia sklepu bez strony.
--
-- Bliźniaki strony gaszonej ZOSTAJĄ nietknięte: nikt ich nie czyta (bo
-- published_at jest już null), strażnik dalej broni ich przed zapisem spoza
-- tej funkcji, a ponowna publikacja tej strony nadpisze je ze szkicu.
-- Czyszczenie ich wymagałoby skasowania nagrobków (inaczej pada CHECK
-- site_sections_tombstone_published), czyli utraty danych przy operacji,
-- która ma być odwracalna.

create or replace function app.publish_site(p_site_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_published_at timestamptz := now();
begin
  perform set_config('app.publishing', '1', true);

  -- Zgaszenie poprzedniej żywej strony TEGO SAMEGO tenanta. RLS zawęża zasięg
  -- do stron wołającego, więc zdanie nie ma jak dosięgnąć cudzego sklepu.
  update public.sites
     set published_at = null
   where tenant_id = app.tenant_id()
     and id <> p_site_id
     and published_at is not null;

  update public.sites
     set published_at = v_published_at,
         template_published = template,
         style_published = style_draft
   where id = p_site_id;

  if not found then
    -- Strona nie istnieje ALBO należy do innego tenanta (RLS tnie wiersz) —
    -- celowo ta sama odmowa, żeby nie zdradzać istnienia cudzej strony.
    -- Wyjątek wycofuje transakcję razem ze zgaszeniem wyżej.
    raise exception 'site_not_found' using errcode = '22023';
  end if;

  -- Sekcje usunięte w szkicu znikają z żywej strony DOPIERO teraz.
  delete from public.site_sections
   where site_id = p_site_id
     and deleted_in_draft;

  update public.site_sections
     set content_published = content_draft,
         position_published = "position",
         enabled_published = enabled,
         updated_at = v_published_at
   where site_id = p_site_id;

  perform set_config('app.publishing', '0', true);
  return v_published_at;
end;
$$;

comment on function app.publish_site(uuid) is
  'Publikacja strony storefrontu: PRZEŁĄCZENIE żywej strony tenanta (gaszenie poprzedniej + podniesienie wskazanej) oraz atomowe przeniesienie kompletu stanu widocznego tej strony — treść, kolejność, włączenie, szablon i styl — plus skasowanie sekcji usuniętych w szkicu (ADR-041/090/091/093). SECURITY INVOKER — bramką jest RLS wołającego. JEDYNA droga zapisu kolumn *_published i published_at. Odmowa (brak strony / cudza strona): 22023.';

-- === END PROD MIGRATION 0048 ===
