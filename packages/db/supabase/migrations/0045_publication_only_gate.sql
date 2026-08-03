-- 0045_publication_only_gate.sql
-- PUBLIKACJA JEDYNĄ BRAMKĄ zmian na opublikowanej stronie sklepu (ADR-091).
--
-- STAN PRZED (0019 + 0043): jeden wiersz `site_sections` niesie SZKIC i STAN
-- OPUBLIKOWANY naraz, ale rozdzielona jest wyłącznie TREŚĆ (content_draft /
-- content_published). Wszystko inne, co czyta publiczny odczyt, jest WSPÓLNE:
-- `position` (kolejność i liczba w kopercie), `enabled` (bramka widoczności
-- w app.get_published_site), ISTNIENIE wiersza (usunięcie sekcji było twardym
-- DELETE) oraz `sites.template`. Skutek zmierzony na żywej bazie (audyt
-- w ADR-091): sześć operacji edytora zmieniało wynik app.get_published_site
-- NATYCHMIAST, bez publikacji — najostrzej usunięcie sekcji, które zdejmowało
-- ją z żywej strony klienta bezpowrotnie. Kreator obiecywał co innego wprost:
-- copy dialogu usunięcia mówiło „na opublikowanej stronie zniknie po następnej
-- publikacji", a wiersz znikał od razu.
--
-- ZASADA WPROWADZANA TĄ MIGRACJĄ (niezmiennik, ADR-091):
--   KAŻDA kolumna czytana przez app.get_published_site ma BLIŹNIAKA `*_published`,
--   pisanego WYŁĄCZNIE przez app.publish_site — i to „wyłącznie" jest
--   EGZEKWOWANE W BAZIE (trigger app.guard_published_columns, sekcja 3), a nie
--   powierzone konwencji kodu panelu: dopóki `authenticated` ma GRANT UPDATE na
--   tabelę, sam podział na kolumny nie broni niczego przed zapytaniem pisanym
--   wprost przez PostgREST. Odczyt publiczny nie dotyka ani jednej kolumny
--   szkicu — po tej migracji nie zna nawet słowa „draft".
--   Nowa kolumna widoczna publicznie (np. styl strony) MUSI dostać bliźniaka
--   w tej samej migracji, w której powstaje, ORAZ wejść na listę strażnika —
--   inaczej wraca dokładnie ten wyciek.
--
-- USUNIĘCIE PRZESTAJE BYĆ DELETE-em, a staje się ZNACZNIKIEM w szkicu
-- (`deleted_in_draft`). Sekcja usunięta w kreatorze dalej stoi na żywej stronie
-- (bo tam ją klient widzi) i dalej jest widoczna w kreatorze — oznaczona chipem,
-- z akcją „przywróć". Dopiero publikacja kasuje wiersz na dobre. Sekcja, która
-- NIGDY nie była opublikowana, nie ma czego chronić i ginie od razu twardym
-- DELETE-em (CHECK niżej czyni „nagrobek bez publikacji" niereprezentowalnym).
--
-- DLACZEGO KOLUMNY, A NIE OSOBNA TABELA STANU OPUBLIKOWANEGO. Rozważona i
-- odrzucona (uzasadnienie pełne w ADR-091): jedyną przewagą osobnej tabeli jest
-- możliwość PRZEŻYCIA stanu opublikowanego po skasowaniu wiersza szkicu — a my
-- wiersz szkicu i tak musimy zachować, bo sekcja usunięta ma być WIDOCZNA
-- w kreatorze z możliwością cofnięcia. Przewaga znika, a zostaje koszt: druga
-- tabela per-tenant (RLS, FK złożony, wpisy w macierzy izolacji), przeniesienie
-- danych content_published i rozdwojenie app.site_image_paths_in_use.
--
-- OKNO WDROŻENIOWE (migration-before-code, konwencje-migracji.md). Ta migracja
-- wchodzi na produkcję PRZED deployem kodu i sama w sobie NIE zmienia koperty
-- app.get_published_site ani o bajt: backfill kopiuje position→position_published,
-- enabled→enabled_published, template→template_published, więc odczyt oddaje
-- dokładnie to co przed. Stary kod panelu działa dalej — jego reorder, wyłączenie
-- i zmiana szablonu przestają tylko WYCIEKAĆ na żywą stronę (czyli robią to,
-- co jego własne copy obiecuje), a stary twardy DELETE sekcji zachowuje się jak
-- dotąd. Bez nowych tabel, więc bez nowych polityk RLS: sites i site_sections są
-- w macierzy izolacji od 0019, a nowe kolumny dziedziczą polityki tabeli.

-- === BEGIN PROD MIGRATION 0045 ===

-- ---------------------------------------------------------------------
-- 1. site_sections — bliźniaki stanu opublikowanego + znacznik usunięcia
-- ---------------------------------------------------------------------
--
-- NULLABLE bez defaultu, celowo: NULL znaczy „sekcja nigdy nie opublikowana",
-- dokładnie jak w content_published od 0019. Wartość domyślna (0 / true)
-- byłaby wygodną fikcją — twierdziłaby, że sekcja ma pozycję i widoczność
-- na stronie, na której jej nie ma.
alter table public.site_sections
  add column if not exists position_published int,
  add column if not exists enabled_published boolean,
  add column if not exists deleted_in_draft boolean not null default false;

-- Backfill PRZED CHECK-ami: stan opublikowany istniejących stron jest dziś
-- opisany kolumnami wspólnymi, więc bliźniaki dostają dokładnie ich wartości.
-- Warunek `content_published is not null` to obowiązująca od 0019 definicja
-- „sekcja jest opublikowana" — sekcja dodana po ostatniej publikacji zostaje
-- z NULL-ami, bo publicznie nie istnieje.
update public.site_sections
   set position_published = "position",
       enabled_published = enabled
 where content_published is not null
   and (position_published is null or enabled_published is null);

-- Trójka opublikowana jest KOMPLETNA albo jej nie ma. Bez tej bramki dałoby się
-- zapisać sekcję z treścią opublikowaną, ale bez pozycji — a wtedy `order by
-- position_published` sortowałby po NULL-u i kolejność strony zależałaby od
-- przypadku. Stan połowiczny nie ma sensu w żadnym kierunku, więc jest
-- niereprezentowalny.
alter table public.site_sections
  drop constraint if exists site_sections_published_complete;
alter table public.site_sections
  add constraint site_sections_published_complete
  check (
    (content_published is null
     and position_published is null
     and enabled_published is null)
    or
    (content_published is not null
     and position_published is not null
     and enabled_published is not null)
  );

-- Nagrobek ma sens WYŁĄCZNIE dla sekcji, która stoi na żywej stronie: to jej
-- istnienie chronimy do publikacji. Sekcja nigdy nieopublikowana nie ma czego
-- chronić — usuwa się ją wierszem, a nie znacznikiem (akcja panelu robi
-- dokładnie to). Bramka spójnościowa (wzorzec 0044): nie WYMAGA znacznika,
-- zabrania go tam, gdzie byłby kłamstwem.
alter table public.site_sections
  drop constraint if exists site_sections_tombstone_published;
alter table public.site_sections
  add constraint site_sections_tombstone_published
  check (not deleted_in_draft or content_published is not null);

comment on column public.site_sections.position_published is
  'Kolejność sekcji na OPUBLIKOWANEJ stronie (ADR-091). Pisana wyłącznie przez app.publish_site; NULL = sekcja nigdy nieopublikowana. Zmiana kolejności w kreatorze rusza `position`, nie tę kolumnę.';
comment on column public.site_sections.enabled_published is
  'Widoczność sekcji na OPUBLIKOWANEJ stronie (ADR-091). Pisana wyłącznie przez app.publish_site; NULL = sekcja nigdy nieopublikowana. Wyłączenie sekcji w kreatorze rusza `enabled`, nie tę kolumnę.';
comment on column public.site_sections.deleted_in_draft is
  'Sekcja USUNIĘTA W SZKICU (ADR-091): na opublikowanej stronie stoi dalej, w kreatorze jest oznaczona i da się ją przywrócić. Wiersz kasuje dopiero app.publish_site. Sekcja nigdy nieopublikowana nie może nosić tego znacznika (CHECK) — ginie zwykłym DELETE.';

comment on column public.site_sections.position is
  'Kolejność sekcji w SZKICU (kreator). Publicznie widoczna jest position_published, kopiowana przy publikacji (ADR-091).';
comment on column public.site_sections.enabled is
  'Widoczność sekcji w SZKICU (kreator). Publicznie widoczna jest enabled_published, kopiowana przy publikacji (ADR-091).';

-- ---------------------------------------------------------------------
-- 2. sites — bliźniak szablonu
-- ---------------------------------------------------------------------
--
-- `template` był ostatnią kolumną, którą edytor zmieniał na żywej stronie
-- natychmiast (akcja updateTemplate unieważniała nawet cache storefrontu, żeby
-- zmiana była widoczna od razu — świadomie, ale niezgodnie z decyzją, że
-- bramką jest publikacja).
alter table public.sites
  add column if not exists template_published text;

update public.sites
   set template_published = template
 where published_at is not null
   and template_published is null;

-- Lustro CHECK-a `template` (0019): bliźniak nie może przyjąć wartości, której
-- nie przyjmuje szablon szkicu. NULL dozwolony — strona nieopublikowana.
alter table public.sites
  drop constraint if exists sites_template_published_check;
alter table public.sites
  add constraint sites_template_published_check
  check (template_published is null or template_published in ('classic', 'bold'));

-- Strona opublikowana MA opublikowany szablon. Bez tej bramki koperta mogłaby
-- oddać `"template": null`, co po stronie sklepu jest błędem schematu i kładzie
-- całą stronę (parsePublishedSite jest fail-closed) — stan „opublikowana, ale
-- bez szablonu" nie ma prawa istnieć.
alter table public.sites
  drop constraint if exists sites_published_template_complete;
alter table public.sites
  add constraint sites_published_template_complete
  check (published_at is null or template_published is not null);

comment on column public.sites.template_published is
  'Szablon OPUBLIKOWANEJ strony (ADR-091). Pisany wyłącznie przez app.publish_site; NULL = strona nigdy nieopublikowana. Zmiana szablonu w kreatorze rusza `template` (szkic) i na żywą stronę wchodzi dopiero publikacją.';
comment on column public.sites.template is
  'Szablon strony w SZKICU (kreator). Publicznie widoczny jest template_published, kopiowany przy publikacji (ADR-091).';

-- ---------------------------------------------------------------------
-- 3. STRAŻNIK KOLUMN OPUBLIKOWANYCH — niezmiennik egzekwowany W BAZIE
-- ---------------------------------------------------------------------
--
-- Same bliźniaki `*_published` NIE tworzą jeszcze bramki: dopóki `authenticated`
-- ma GRANT UPDATE na tabelę, członek tenanta może pisać po nich WPROST przez
-- PostgREST (`update site_sections set enabled_published = false`) i zdjąć
-- sekcję z żywej strony bez publikacji — czyli odtworzyć dokładnie ten wyciek,
-- który ta migracja zamyka. Rozdzielenie kolumn opisuje INTENCJĘ; ten trigger
-- czyni ją PRAWEM tabeli, niezależnym od tego, co robi kod panelu.
--
-- MECHANIZM. `app.publish_site` stawia na czas swojego ciała transakcyjną flagę
-- `app.publishing` (set_config z is_local = true) i zdejmuje ją przed
-- zwróceniem wyniku; trigger przepuszcza zapis tylko wtedy, gdy flaga stoi.
-- Okno jest więc ciałem funkcji publikacji, a nie całą transakcją wołającego.
--
-- 42501 (insufficient_privilege), NIE 23514. To jest reguła UPRAWNIENIA („tej
-- kolumny nie wolno ci pisać"), a nie kształtu danych — i ma jeszcze jedną,
-- praktyczną zaletę: odmowa triggera jest NIEODRÓŻNIALNA od odmowy RLS/grantu.
-- Trigger BEFORE wykonuje się PRZED politykami WITH CHECK, więc gdyby rzucał
-- własnym kodem, potrafiłby przykryć 42501 oczekiwane przez macierz izolacji
-- (lekcja z 0033). Ten sam SQLSTATE czyni tę kolizję niemożliwą.
--
-- service_role PRZEPUSZCZANY (standard repo: joby, cron, webhooki i migracje
-- pracują tą rolą; sam backfill wyżej też). Superuser wchodzi w to samo
-- sprawdzenie przez `pg_has_role`. Konsekwencja jest jawna: strażnik broni
-- ścieżki użytkownika (PostgREST: CRUD na tabelach + wystawione funkcje),
-- a nie ścieżki serwisowej, która i tak omija RLS z definicji.
--
-- GRANICA TEGO ŚRODKA, napisana wprost: flaga jest ODCZYTYWALNA i ustawialna
-- przez kogoś, kto potrafi wykonać DOWOLNY SQL w tej samej sesji. Przez
-- PostgREST taka ścieżka nie istnieje (`set_config` siedzi w pg_catalog, poza
-- schematami wystawionymi), więc dla realnej powierzchni ataku bramka trzyma.
-- Mocniejszy wariant — REVOKE UPDATE na wybranych KOLUMNACH dla `authenticated`
-- + kopiowanie w osobnej funkcji SECURITY DEFINER — odrzucony świadomie:
-- wymagałby rozdzielenia publikacji na INVOKER-a (bramka własności = RLS,
-- ADR-041) i DEFINER-a robiącego kopię, a ten drugi musiałby SAM powtórzyć
-- sprawdzenie własności, bo `authenticated` musi mieć na niego EXECUTE.
-- Dokładałby więc drugie miejsce, w którym można pomylić się co do własności —
-- w zamian za odporność na scenariusz, którego architektura nie dopuszcza.

create or replace function app.guard_published_columns()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text :=
    'Kolumny stanu opublikowanego zapisuje wyłącznie app.publish_site.';
begin
  -- Ścieżka serwisowa (joby, cron, migracje) — patrz nagłówek.
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
    -- `published_at` wchodzi tu razem z szablonem: 0019 mówiło o nim
    -- „stawiane WYŁĄCZNIE przez app.publish_site", ale nikt tego nie pilnował.
    if tg_op = 'INSERT' then
      if new.template_published is not null or new.published_at is not null then
        raise exception '%', c_denied using errcode = '42501';
      end if;
    elsif new.template_published is distinct from old.template_published
       or new.published_at is distinct from old.published_at then
      raise exception '%', c_denied using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.guard_published_columns() is
  'Strażnik kolumn stanu opublikowanego (ADR-091): zapis do *_published / published_at wyłącznie z wnętrza app.publish_site (flaga transakcyjna app.publishing) albo rolą serwisową. Odmowa: 42501 — ten sam SQLSTATE co odmowa RLS/grantu, żeby trigger BEFORE nie przykrywał oczekiwań macierzy izolacji.';

drop trigger if exists site_sections_guard_published on public.site_sections;
create trigger site_sections_guard_published
  before insert or update on public.site_sections
  for each row execute function app.guard_published_columns();

drop trigger if exists sites_guard_published on public.sites;
create trigger sites_guard_published
  before insert or update on public.sites
  for each row execute function app.guard_published_columns();

-- ---------------------------------------------------------------------
-- 4. app.publish_site — publikacja przenosi KOMPLET stanu widocznego
-- ---------------------------------------------------------------------
--
-- Trzy zapisy w JEDNEJ transakcji funkcji (powód niezmieniony od 0019:
-- publikacja połowiczna zostawiłaby stronę-hybrydę):
--   1. sites: znacznik publikacji + szablon,
--   2. site_sections: skasowanie sekcji usuniętych w szkicu (dopiero TU sekcja
--      znika z żywej strony),
--   3. site_sections: kopia szkic→opublikowane dla treści, pozycji i widoczności.
-- Kolejność 2 przed 3 jest istotna tylko dla czytelności (skasowanego wiersza
-- nie ma po co przepisywać).
--
-- SECURITY INVOKER bez zmian: bramką pozostaje RLS wołającego — także dla
-- DELETE-a nagrobków, który idzie polityką `tenant_delete` członka tenanta.
--
-- FLAGA `app.publishing` otwiera strażnika z sekcji 3 na czas TEGO ciała
-- i zamyka go przed zwróceniem wyniku. Gdyby została podniesiona do końca
-- transakcji, wołający mógłby po udanej publikacji dopisać do kolumn
-- opublikowanych cokolwiek — okno ma trwać tyle, co kopia.
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

  update public.sites
     set published_at = v_published_at,
         template_published = template
   where id = p_site_id;

  if not found then
    -- Strona nie istnieje ALBO należy do innego tenanta (RLS tnie wiersz) —
    -- celowo ta sama odmowa, żeby nie zdradzać istnienia cudzej strony.
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
  'Publikacja strony storefrontu: atomowe przeniesienie KOMPLETU stanu widocznego — treść, kolejność, włączenie i szablon (kopia szkic→opublikowane) oraz skasowanie sekcji usuniętych w szkicu (ADR-041/ADR-091). SECURITY INVOKER — bramką jest RLS wołającego. JEDYNA droga zapisu kolumn *_published i published_at: na czas ciała podnosi flagę app.publishing, której wymaga trigger app.guard_published_columns. Odmowa (brak strony / cudza strona): 22023.';

revoke all on function app.publish_site(uuid) from public;
grant execute on function app.publish_site(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. app.get_published_site — odczyt WYŁĄCZNIE ze stanu opublikowanego
-- ---------------------------------------------------------------------
--
-- Jedyna zmiana merytoryczna wobec 0019: trzy kolumny wspólne zamienione na
-- bliźniaki (`template_published`, `position_published`, `enabled_published`).
-- Funkcja nie czyta odtąd ŻADNEJ kolumny szkicu — `deleted_in_draft` też nie,
-- i to jest właściwe: sekcja usunięta w szkicu ma stać na żywej stronie do
-- publikacji, a odczyt publiczny nie ma prawa wiedzieć, co się dzieje w edytorze.
--
-- KOPERTA BEZ ZMIAN: te same klucze, ta sama kolejność sortowania
-- (position_published, id) i te same wartości dla każdej strony, której szkicu
-- nikt nie ruszył po migracji (backfill wyżej).
create or replace function app.get_published_site(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'template', s.template_published,
    'published_at', s.published_at,
    'sections', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', sec.id,
            'type', sec.type,
            'position', sec.position_published,
            'content', sec.content_published
          )
          order by sec.position_published, sec.id
        )
        from public.site_sections sec
        where sec.tenant_id = s.tenant_id
          and sec.site_id = s.id
          and sec.enabled_published
          and sec.content_published is not null
      ),
      '[]'::jsonb
    )
  )
  from public.sites s
  join public.tenants t on t.id = s.tenant_id
  where s.tenant_id = p_tenant_id
    and s.published_at is not null
    and t.status in ('trialing', 'active');
$$;

comment on function app.get_published_site(uuid) is
  'Publiczny odczyt storefrontu: opublikowane, włączone sekcje (position_published, id) + opublikowany szablon — TYLKO dla aktywnego tenanta i opublikowanej strony, inaczej NULL. SECURITY DEFINER — jedyna ścieżka anonowa. Od ADR-091 czyta WYŁĄCZNIE kolumny *_published, więc żadna operacja kreatora nie zmienia jej wyniku przed publikacją.';

revoke all on function app.get_published_site(uuid) from public;
grant execute on function app.get_published_site(uuid) to anon, authenticated;

-- === END PROD MIGRATION 0045 ===
