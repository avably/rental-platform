-- =====================================================================
-- 0073 — ADRES STRONY: sites.slug + bliźniak slug_published (ADR-157)
-- =====================================================================
--
-- Faza 2 kreatora, krok 2.1. MIGRACJA BEZ ANI JEDNEJ ZMIANY WIDOCZNEJ:
-- po jej zastosowaniu sklep pokazuje dokładnie to samo, co przed nią, a panel
-- działa bez przebudowy. Kod korzystający ze sluga wchodzi dopiero w 0074.
-- Ta kolejność nie jest ostrożnością — jest wymuszona: migracje jadą na
-- produkcję PRZED kodem, a koperta publicznego odczytu jest `.strict()`, więc
-- nowy klucz dołożony bezwarunkowo wywróciłby KAŻDĄ stronę sklepu na czas
-- okna wdrożeniowego.
--
-- CO SIĘ ZMIENIA W ZNACZENIU TABELI. Do 0072 wiersz `sites` był WERSJĄ jednej
-- strony sklepu (ADR-093; `name` opisane wprost jako „nazwa wersji widoczna
-- wyłącznie w panelu"). Od tej migracji wiersz jest STRONĄ i ma własny adres.
-- ADR-093 przewidział ten ruch i nazwał jego kierunek wprost: „strona
-- dostałaby slug i unikat (tenant_id, slug), a get_published_site — drugi
-- argument albo osobną funkcję odczytu po ścieżce". Decyzja właściciela
-- (2026-08-12) uruchamia go teraz, bo dopóki nie ma płacącego najemcy, zmiana
-- znaczenia tabeli jest DARMOWA — nie ma danych do przemigrowania. Po pierwszym
-- płacącym najemcy przestaje być darmowa na zawsze.
--
-- ========================= CZTERY ROZSTRZYGNIĘCIA =========================
--
-- 1. STRONA GŁÓWNA TO SLUG PUSTY, NIE KOLUMNA `kind`. Adresem strony głównej
--    jest goły `/`, więc pusty slug niesie dokładnie tę informację i mieści
--    się w kolumnie, która i tak musiała powstać. Kolumna `kind` byłaby DANĄ
--    WIDOCZNĄ PUBLICZNIE, a kanon ADR-091 wycenia każdą taką kolumnę na
--    bliźniaka `*_published` + wpis u strażnika + test — komplet, za który
--    nie dostalibyśmy ani jednej informacji ponad tę, którą już mamy.
--    Wariant `tenants.home_site_id` ma tę samą cenę plus klucz obcy w drugą
--    stronę i trigger pilnujący przynależności do najemcy.
--
-- 2. UNIKAT „JEDNA ŻYWA STRONA" USTĘPUJE UNIKATOWI PO ADRESIE. Niezmiennik
--    zmienia się z „najwyżej jedna żywa strona na najemcę" na „najwyżej jedna
--    żywa strona na najemcę POD DANYM ADRESEM". Dla strony głównej (slug
--    pusty) to jest DOKŁADNIE ten sam niezmiennik, co dotąd — a to on chronił
--    odczyt publiczny przed cichym, niedeterministycznym wyborem wiersza
--    (`app.get_published_site` jest `language sql returns jsonb`, więc przy
--    dwóch żywych stronach nie pada, tylko oddaje pierwszy wiersz skanu).
--    Zmiana jest wyłącznie POTENCJALNA: `app.publish_site` do 0074 dalej gasi
--    każdą inną żywą stronę, więc żywa strona w tej migracji jest nadal jedna.
--
-- 3. KSZTAŁT SLUGA = CHECK, REZERWACJA = TRIGGER (wzorzec 0072/0023). Kształt
--    jest warunkiem stałym i deklaratywnym. Lista zarezerwowana rośnie razem
--    z drzewem tras sklepu i musi dać operatorowi ZDANIE, które przeczyta —
--    a 23514 z CHECK-a mówi wyłącznie nazwę ograniczenia.
--
-- 4. BRAMKA REZERWACJI PATRZY TYLKO NA ZMIANĘ SLUGA. Dopisanie wpisu do listy
--    (nowa trasa sklepu w przyszłej paczce) nie może zablokować operatorowi
--    zmiany NAZWY strony, która akurat siedzi pod adresem, który właśnie stał
--    się zarezerwowany. Blokujemy przejęcie adresu, nie edycję zastanego
--    wiersza.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): każda funkcja `app.*`
-- dostaje `revoke all ... from public` + jawne granty w TEJ SAMEJ migracji —
-- także `app.publish_site`, której 0048 grantów nie powtórzyło (przeżyły
-- `create or replace`, ale rozjazd z konwencją nie ma powodu trwać).
--
-- CZEGO TA MIGRACJA NIE RUSZA: `app.get_published_site` (bajtowo identyczna —
-- drugi argument dochodzi w 0074), `site_sections`, polityki RLS, granty
-- tabel, cache storefrontu.

-- === BEGIN PROD MIGRATION 0073 ===

-- ---------------------------------------------------------------------
-- 1. app.reserved_page_slugs() — LUSTRO stałej z rdzenia
-- ---------------------------------------------------------------------
--
-- IMMUTABLE i bez dostępu do tabel: to stała, nie zapytanie. Osobna funkcja
-- (zamiast literału w warunku) po to, by test mógł ODCZYTAĆ zbiór i porównać
-- go z RESERVED_PAGE_SLUGS — bramka anty-rozjazdowa potrzebuje czegoś, co da
-- się zapytać (dokładnie jak app.reserved_subdomains w 0023 i
-- app.reserved_store_paths w 0072).
--
-- DLACZEGO OSOBNA FUNKCJA, SKORO ZBIÓR JEST DZIŚ RÓWNY reserved_store_paths().
-- Bo cykle życia obu list się rozjadą: strony kategorii z Fazy 7 schodzą piętro
-- niżej (`/kategoria/{slug}`) i przestaną rezerwować korzeń, a strony treściowe
-- będą go rezerwować dalej. Sklejenie ich dziś jednym wywołaniem oznaczałoby,
-- że rozdzielenie ich jutro jest migracją zachowania, a nie migracją listy.

create or replace function app.reserved_page_slugs()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  -- LUSTRO RESERVED_PAGE_SLUGS z packages/core/src/site/page-slug.ts.
  -- Zmiana po jednej stronie bez drugiej pali
  -- packages/db/test/site-page-slugs.test.ts.
  select array[
    -- trasy sklepu najemcy: apps/storefront/app/(tenant)/*
    'cart',
    'checkout',
    'privacy',
    'product',
    'prywatnosc',
    'regulamin',
    'store',
    'terms',
    -- trasy platformowe w korzeniu KAŻDEGO hosta
    'api',
    'embed',
    -- dynamiczny segment [locale] osi marketingowej dopasowuje się także na
    -- hoście najemcy (patrz apps/storefront/proxy.ts)
    'en',
    'pl',
    -- prefiks stron kategorii (Faza 7)
    'category',
    'kategoria'
  ]::text[];
$$;

comment on function app.reserved_page_slugs() is
  'Pierwsze segmenty ścieżki sklepu, których nie wolno wziąć slugiem STRONY. LUSTRO RESERVED_PAGE_SLUGS z @avably/core/site (packages/core/src/site/page-slug.ts) — zgodności obu zbiorów pilnuje packages/db/test/site-page-slugs.test.ts.';

revoke all on function app.reserved_page_slugs() from public, anon;
-- authenticated: funkcję wykonuje trigger guard w kontekście roli PISZĄCEJ
-- wiersz strony (guard jest SECURITY INVOKER), więc bez tego grantu UPDATE
-- sites padałby na braku EXECUTE.
grant execute on function app.reserved_page_slugs() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. sites.slug — adres SZKICU
-- ---------------------------------------------------------------------
--
-- `not null default ''` obsługuje wiersze istniejące bez osobnego backfillu
-- i — co ważniejsze — sprawia, że PANEL SPRZED 0074 dalej działa: strona
-- utworzona bez podania sluga jest kolejnym szkicem strony GŁÓWNEJ, czyli
-- dokładnie tym, czym wiersz `sites` był do tej migracji. To jest cała
-- treść zdania „zero zmian widocznych".

alter table public.sites
  add column if not exists slug text not null default '';

alter table public.sites
  drop constraint if exists sites_slug_shape;

alter table public.sites
  add constraint sites_slug_shape
  check (
    slug = ''
    or (char_length(slug) <= 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
  );

comment on column public.sites.slug is
  'Adres SZKICU strony w sklepie: pusty string = strona główna (`/`), inaczej `/{slug}`. Lustro PAGE_SLUG_PATTERN i HOME_PAGE_SLUG z @avably/core/site. Slug jest daną PUBLICZNĄ, więc do sklepu wchodzi wyłącznie bliźniakiem slug_published, przez app.publish_site (ADR-091).';

-- ---------------------------------------------------------------------
-- 3. sites.slug_published — adres OPUBLIKOWANY (bliźniak)
-- ---------------------------------------------------------------------
--
-- Bez bliźniaka zmiana sluga w panelu przenosiłaby żywą stronę pod nowy adres
-- NATYCHMIAST, bez publikacji — czyli wyciekiem tej samej klasy, którą 0045
-- zamknęła dla treści, kolejności i włączenia sekcji. Slug jest widoczny
-- publicznie w najostrzejszym możliwym sensie: JEST adresem.

alter table public.sites
  add column if not exists slug_published text;

alter table public.sites
  drop constraint if exists sites_slug_published_shape;

alter table public.sites
  add constraint sites_slug_published_shape
  check (
    slug_published is null
    or slug_published = ''
    or (char_length(slug_published) <= 60 and slug_published ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
  );

-- Backfill PRZED CHECK-iem kompletności: każda strona żywa dostaje adres
-- strony głównej, bo dokładnie nią do tej pory była (sklep miał jedną stronę
-- pod `/`). Migracja jedzie rolą serwisową, więc strażnik kolumn
-- opublikowanych ją przepuszcza — to jego jedyna przewidziana furtka.
update public.sites
   set slug_published = slug
 where published_at is not null
   and slug_published is null;

alter table public.sites
  drop constraint if exists sites_published_slug_complete;

alter table public.sites
  add constraint sites_published_slug_complete
  check (published_at is null or slug_published is not null);

comment on column public.sites.slug_published is
  'Adres OPUBLIKOWANY strony (0073, kanon ADR-091): jedyna wartość, po której odczyt publiczny wskazuje stronę. Pisze go WYŁĄCZNIE app.publish_site. CHECK sites_published_slug_complete: strona opublikowana MA opublikowany adres, więc „strona bez adresu w kopercie" jest niereprezentowalna.';

-- ---------------------------------------------------------------------
-- 4. UNIKAT PO ADRESIE zamiast unikatu „jedna żywa strona"
-- ---------------------------------------------------------------------
--
-- Unikat CZĘŚCIOWY, jak poprzednik: szkiców pod tym samym adresem może być
-- wiele (to są wersje robocze), żywa strona pod danym adresem jest jedna.
-- Predykat jest tą samą prawdą, którą czyta odczyt publiczny, więc nie da się
-- ich rozjechać.
--
-- Dla sluga pustego to jest CO DO ZNACZENIA stary indeks: najwyżej jedna żywa
-- strona główna na najemcę. Różnica dotyczy wyłącznie stron treściowych,
-- których do tej migracji nie było.

drop index if exists public.sites_one_live_per_tenant_idx;

create unique index if not exists sites_live_slug_unique_idx
  on public.sites (tenant_id, slug_published)
  where published_at is not null;

comment on index public.sites_live_slug_unique_idx is
  'Najwyżej JEDNA żywa strona najemcy pod danym adresem (0073, ADR-157; następca sites_one_live_per_tenant_idx z 0048). Predykat jest lustrem warunku, którym app.get_published_site wybiera stronę — dwie żywe strony pod tym samym slugiem dałyby cichy, niedeterministyczny wybór, nie błąd.';

-- ---------------------------------------------------------------------
-- 5. app.site_slug_guard — bramka sluga zarezerwowanego
-- ---------------------------------------------------------------------
--
-- SECURITY INVOKER (domyślny) świadomie: funkcja nie potrzebuje żadnego
-- przywileju ponad wołającego — czyta wyłącznie stałą.
--
-- `lower(btrim(...))` przed porównaniem, choć CHECK kształtu i tak dopuszcza
-- wyłącznie małe litery bez spacji: normalizacja sprawia, że bramka nie zależy
-- od tego, czy CHECK kiedyś zelżeje (wzorzec 0023).
--
-- ODMOWA 22023, NIE 42501: to jest walidacja wartości, a nie reguła
-- uprawnienia. 42501 przykryłby odmowę oczekiwaną przez macierz izolacji RLS
-- (trigger BEFORE wykonuje się PRZED politykami WITH CHECK), a tego błędu
-- ta baza już raz o mało nie kupiła.
--
-- WYJŚCIE WCZEŚNIEJ PRZY NIEZMIENIONYM SLUGU: patrz rozstrzygnięcie 4 nagłówka.

create or replace function app.site_slug_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug then
    return new;
  end if;

  if lower(btrim(new.slug)) = any (app.reserved_page_slugs()) then
    raise exception
      'Adres „%" jest zarezerwowany przez sklep — wybierz inny.', lower(btrim(new.slug))
      using errcode = '22023';
  end if;

  return new;
end;
$$;

comment on function app.site_slug_guard() is
  'Bramka sluga strony (0073, ADR-157): odmawia (22023) przejęcia pierwszego segmentu ścieżki zajętego przez trasę sklepu — patrz app.reserved_page_slugs(). Statyczna trasa Next zawsze wygrywa z dynamiczną, więc strona o takim slugu nie wyświetliłaby się NIGDY, bez żadnego błędu. Patrzy wyłącznie na ZMIANĘ sluga: rozrost listy nie może zablokować edycji zastanego wiersza.';

revoke all on function app.site_slug_guard() from public, anon, authenticated;

drop trigger if exists sites_slug_guard on public.sites;

create trigger sites_slug_guard
  before insert or update on public.sites
  for each row execute function app.site_slug_guard();

-- ---------------------------------------------------------------------
-- 6. STRAŻNIK KOLUMN OPUBLIKOWANYCH przyjmuje slug_published
-- ---------------------------------------------------------------------
--
-- Pełne ciało przepisane z 0046 (ostatnia definicja) z JEDNYM dołożeniem
-- w każdej z dwóch gałęzi tabeli `sites`. `create or replace` zastępuje
-- całość, więc przepisanie ze starszej wersji cofnęłoby cicho poprawki —
-- ciało poniżej jest kopią 0046 co do warunku, nie parafrazą.

create or replace function app.guard_published_columns()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text :=
    'Kolumny stanu opublikowanego zapisuje wyłącznie app.publish_site.';
begin
  -- Ścieżka serwisowa (joby, cron, migracje).
  if pg_has_role(current_user, 'service_role', 'USAGE') then
    return new;
  end if;

  -- Zapis z WNĘTRZA app.publish_site.
  if coalesce(current_setting('app.publishing', true), '0') = '1' then
    return new;
  end if;

  if tg_table_name = 'site_sections' then
    if tg_op = 'INSERT' then
      -- Sekcja nie może URODZIĆ SIĘ opublikowana (spójnie z CHECK-iem nagrobka:
      -- stan opublikowany powstaje wyłącznie z publikacji, nie z wstawienia).
      if new.content_published is not null
         or new.position_published is not null
         or new.enabled_published is not null then
        raise exception '%', c_denied using errcode = '42501';
      end if;
    elsif new.content_published is distinct from old.content_published
       or new.position_published is distinct from old.position_published
       or new.enabled_published is distinct from old.enabled_published then
      raise exception '%', c_denied using errcode = '42501';
    end if;

  elsif tg_table_name = 'sites' then
    -- `slug_published` dołącza tu do `template_published`, `published_at`
    -- i `style_published` (ADR-157 na kanonie ADR-091). Adres jest daną
    -- publiczną w najostrzejszym sensie — JEST tym, co widzi klient w pasku —
    -- więc zmienia się wyłącznie publikacją.
    if tg_op = 'INSERT' then
      if new.template_published is not null
         or new.published_at is not null
         or new.slug_published is not null
         or new.style_published <> '{}'::jsonb then
        raise exception '%', c_denied using errcode = '42501';
      end if;
    elsif new.template_published is distinct from old.template_published
       or new.published_at is distinct from old.published_at
       or new.slug_published is distinct from old.slug_published
       or new.style_published is distinct from old.style_published then
      raise exception '%', c_denied using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.guard_published_columns() is
  'Strażnik kolumn stanu opublikowanego (ADR-091, rozszerzony o style_published w ADR-090 i o slug_published w ADR-157): zapis do *_published / published_at wyłącznie z wnętrza app.publish_site (flaga transakcyjna app.publishing) albo rolą serwisową. Odmowa: 42501 — ten sam SQLSTATE co odmowa RLS/grantu, żeby trigger BEFORE nie przykrywał oczekiwań macierzy izolacji.';

-- Triggery bez zmian — `create or replace function` podmienia ciało w miejscu,
-- a oba wyzwalacze z 0045 dalej na nie wskazują.

revoke all on function app.guard_published_columns() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. PUBLIKACJA PRZENOSI TAKŻE ADRES
-- ---------------------------------------------------------------------
--
-- Jedyna zmiana względem 0048: `slug_published = slug` w zdaniu podnoszącym
-- stronę. Zgaszenie poprzedniej żywej strony ZOSTAJE — znika dopiero w 0074,
-- razem z kodem, który umie pokazać wiele stron. Dzięki temu ta migracja
-- niczego w zachowaniu sklepu nie zmienia.
--
-- Ciało przepisane z 0048 (ostatnia definicja publish_site w historii),
-- nie z 0046.

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
         slug_published = slug,
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
  'Publikacja strony storefrontu: PRZEŁĄCZENIE żywej strony tenanta (gaszenie poprzedniej + podniesienie wskazanej) oraz atomowe przeniesienie kompletu stanu widocznego tej strony — treść, kolejność, włączenie, szablon, ADRES i styl — plus skasowanie sekcji usuniętych w szkicu (ADR-041/090/091/093/157). SECURITY INVOKER — bramką jest RLS wołającego. JEDYNA droga zapisu kolumn *_published i published_at. Odmowa (brak strony / cudza strona): 22023.';

revoke all on function app.publish_site(uuid) from public, anon;
grant execute on function app.publish_site(uuid) to authenticated;

-- === END PROD MIGRATION 0073 ===
