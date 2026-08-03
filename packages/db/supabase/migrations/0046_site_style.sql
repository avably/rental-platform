-- =====================================================================
-- 0046 — STYL STRONY: motyw, akcent i para krojów w modelu draft/publish
--        (ADR-090, na kanonie ADR-091)
-- =====================================================================
--
-- Kreator 2.0 domyka się galerią szablonów i panelem „Styl strony": tenant
-- wybiera ŚWIAT WIZUALNY (motyw), a w jego ramach akcent i parę krojów. Do K5
-- taki byt nie miał gdzie mieszkać:
--
--   * public.sites nie ma żadnego jsonb — są tam wyłącznie template,
--     template_published, published_at i klucze (0019 + 0045),
--   * jedyny jsonb draft/publish to site_sections.content_draft/_published, czyli
--     treść SEKCJI; styl strony wciśnięty w sekcję byłby zdenormalizowany
--     (n kopii tej samej wartości), znikałby razem z ostatnią sekcją i nie
--     zmieściłby się w schematach sekcji (.strict()),
--   * anon nie ma na public.sites ŻADNEGO grantu (0019: revoke all from anon),
--     więc sklep i tak nie odczytałby stylu inaczej niż kopertą
--     app.get_published_site.
--
-- Stąd kolumna, a nie obejście. Styl jest WERSJONOWANY tak samo jak reszta
-- stanu widocznego (ADR-091): style_draft to stan kreatora, style_published to
-- stan publiczny, a kopię robi WYŁĄCZNIE app.publish_site — pod tą samą flagą
-- transakcyjną i tym samym strażnikiem, co treść, kolejność i włączenie sekcji.
--
-- ---------------------------------------------------------------------
-- KANON ADR-091, ZASTOSOWANY CO DO LITERY
-- ---------------------------------------------------------------------
--
-- „Nowa kolumna publiczna = bliźniak *_published + wpis na liście
-- guard_published_columns". Sekcja 3 dopisuje `style_published` do strażnika
-- przez `create or replace` tej samej funkcji. Bez tego kroku kolumna byłaby
-- bliźniakiem TYLKO Z NAZWY: `authenticated` ma GRANT UPDATE na public.sites,
-- więc członek tenanta przemalowałby żywą stronę jednym zapytaniem PostgREST
-- (`update sites set style_published = ...`), bez publikacji — czyli odtworzyłby
-- dokładnie ten wyciek, który 0045 zamknęło dla szablonu i kolejności sekcji.
--
-- ---------------------------------------------------------------------
-- OKNO WDROŻENIOWE — DLACZEGO KLUCZ `style` JEST WARUNKOWY
-- ---------------------------------------------------------------------
--
-- Migracje wchodzą na produkcję PRZED merge'em kodu (merge = auto-deploy), więc
-- między jednym a drugim żyje STARY storefront. Stary storefront parsuje kopertę
-- publishedSiteEnvelopeSchema z `.strict()` — nieznany klucz nie jest ignorowany,
-- tylko wywraca CAŁĄ kopertę, a parsePublishedSite zwraca null. Bezwarunkowe
-- dodanie klucza `style` zgasiłoby więc każdy opublikowany sklep na czas okna.
--
-- Klucz dokładany jest zatem WYŁĄCZNIE wtedy, gdy styl faktycznie istnieje.
-- W chwili migracji style_published = '{}' dla wszystkich stron (default niżej),
-- a zapisać styl da się dopiero z interfejsu, który przyjeżdża razem z nowym
-- kodem — koperta w oknie wdrożeniowym jest więc CO DO BAJTU taka jak dziś.
-- To nie jest optymalizacja rozmiaru odpowiedzi, tylko warunek bezpiecznego
-- wdrożenia i dlatego stoi tu, a nie w kodzie aplikacji.

-- ---------------------------------------------------------------------
-- 1. Kolumny stylu na public.sites
-- ---------------------------------------------------------------------
--
-- NOT NULL DEFAULT '{}' (wzorzec content_draft z 0019): strona zawsze ma obiekt
-- stylu, a „brak wyboru" to pusty obiekt, nie NULL — czytający nie musi
-- rozróżniać dwóch reprezentacji tej samej rzeczy. Kształt WNĘTRZA (dozwolone
-- identyfikatory motywów, akcentów i par krojów) pilnuje @avably/core/site, jak
-- przy treści sekcji: baza trzyma jsonb i jego typ, allowlistę wartości trzyma
-- jedno źródło prawdy w kodzie. CHECK-a na klucze celowo NIE MA — lustro
-- rejestru motywów w bazie rozjechałoby się z rejestrem przy pierwszym
-- dopisanym motywie, a rejestr ma urosnąć do piętnastu.

alter table public.sites
  add column if not exists style_draft jsonb not null default '{}'::jsonb;

alter table public.sites
  add column if not exists style_published jsonb not null default '{}'::jsonb;

comment on column public.sites.style_draft is
  'Styl strony w kreatorze (motyw, akcent, para krojów) — stan roboczy. NIGDY nie serwowany publicznie; granicy pilnuje app.get_published_site (ADR-090).';
comment on column public.sites.style_published is
  'Styl strony w wersji publicznej. Pisany WYŁĄCZNIE przez app.publish_site (strażnik app.guard_published_columns, ADR-091). Pusty obiekt = strona nigdy nie zapisała stylu — render bierze wtedy motyw zastany z kolumny template.';
comment on column public.sites.template is
  'ZASTANE (przed ADR-090): szablon graficzny sprzed wprowadzenia motywów. Kolumna szkicu w rozumieniu ADR-091, ale panel już do niej NIE PISZE — nowy zapis idzie w style_draft->>''theme''. Zostaje jako fallback stron bez zapisanego stylu; plan wygaszenia w ADR-090.';

-- ---------------------------------------------------------------------
-- 2. Strażnik kolumn opublikowanych — `style_published` na liście
-- ---------------------------------------------------------------------
--
-- `create or replace` tej samej funkcji, co 0045: treść niżej jest jej kopią
-- z JEDNĄ zmianą — gałąź `sites` sprawdza dodatkowo `style_published`.
-- Przepisujemy całość zamiast „łatać", bo funkcja w PostgreSQL nie ma innej
-- formy podmiany, a rozjazd między tym plikiem a 0045 byłby wtedy niewidoczny.
--
-- Reszta kontraktu bez zmian i celowo powtórzona w komentarzu, żeby czytający
-- TĘ migrację nie musiał wracać do poprzedniej:
--   * ścieżka serwisowa (service_role) przechodzi — joby, cron i migracje
--     pracują tą rolą, a RLS omijają z definicji;
--   * zapis z wnętrza app.publish_site poznaje się po transakcyjnej fladze
--     `app.publishing`, którą ta funkcja podnosi na czas swojego ciała;
--   * odmowa to 42501 (insufficient_privilege), NIE 23514: to jest reguła
--     UPRAWNIENIA, a trigger BEFORE wykonuje się PRZED politykami WITH CHECK,
--     więc własny SQLSTATE przykryłby odmowę oczekiwaną przez macierz izolacji.

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
    -- `style_published` dołącza tu do `template_published` i `published_at`
    -- (ADR-090 na kanonie ADR-091). INSERT z niepustym stylem opublikowanym
    -- jest odmawiany razem z nimi: strona rodzi się nieopublikowana, więc nie
    -- ma prawa przyjść na świat z gotowym stanem publicznym.
    if tg_op = 'INSERT' then
      if new.template_published is not null
         or new.published_at is not null
         or new.style_published <> '{}'::jsonb then
        raise exception '%', c_denied using errcode = '42501';
      end if;
    elsif new.template_published is distinct from old.template_published
       or new.published_at is distinct from old.published_at
       or new.style_published is distinct from old.style_published then
      raise exception '%', c_denied using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.guard_published_columns() is
  'Strażnik kolumn stanu opublikowanego (ADR-091, rozszerzony o style_published w ADR-090): zapis do *_published / published_at wyłącznie z wnętrza app.publish_site (flaga transakcyjna app.publishing) albo rolą serwisową. Odmowa: 42501 — ten sam SQLSTATE co odmowa RLS/grantu, żeby trigger BEFORE nie przykrywał oczekiwań macierzy izolacji.';

-- Triggery bez zmian — `create or replace function` podmienia ciało w miejscu,
-- a oba wyzwalacze z 0045 dalej na nie wskazują. Powtórne `create trigger`
-- byłoby tu zbędnym rozjazdem definicji.

-- ---------------------------------------------------------------------
-- 3. app.publish_site — styl publikuje się razem z resztą stanu widocznego
-- ---------------------------------------------------------------------
--
-- Jedyna zmiana względem 0045: ten sam UPDATE, który stawia published_at
-- i template_published, kopiuje style_draft → style_published. Kopia MUSI iść
-- tą transakcją, a nie osobnym wywołaniem: publikacja, po której treść jest
-- nowa, a styl stary (albo odwrotnie), to dokładnie ta strona-hybryda, przed
-- którą 0019 broniło się RPC.
--
-- Flaga `app.publishing` otwiera strażnika na czas TEGO ciała i zamyka go przed
-- zwróceniem wyniku — gdyby została podniesiona do końca transakcji, wołający
-- mógłby po udanej publikacji dopisać do kolumn opublikowanych cokolwiek.

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
         template_published = template,
         style_published = style_draft
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
  'Publikacja strony storefrontu: atomowe przeniesienie KOMPLETU stanu widocznego — treść, kolejność, włączenie, szablon i STYL (kopia szkic→opublikowane) oraz skasowanie sekcji usuniętych w szkicu (ADR-041/ADR-090/ADR-091). SECURITY INVOKER — bramką jest RLS wołającego. JEDYNA droga zapisu kolumn *_published i published_at: na czas ciała podnosi flagę app.publishing, której wymaga trigger app.guard_published_columns. Odmowa (brak strony / cudza strona): 22023.';

revoke all on function app.publish_site(uuid) from public;
grant execute on function app.publish_site(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. app.get_published_site — styl w kopercie (warunkowo)
-- ---------------------------------------------------------------------
--
-- Jedyna zmiana względem 0045: koperta dostaje klucz `style` — i tylko wtedy,
-- gdy styl opublikowany jest niepusty (patrz nagłówek: okno wdrożeniowe
-- i `.strict()` po stronie storefrontu).
--
-- Funkcja dalej czyta WYŁĄCZNIE kolumny opublikowane: `style_draft` nie
-- występuje w tym zapytaniu tak samo, jak nie występuje `content_draft`.
-- Bramki widoczności (tenant aktywny, published_at, enabled_published +
-- content_published per sekcja) bez zmian — ta migracja nie rusza tego, KTO co
-- widzi, tylko dokłada pole do już widocznej odpowiedzi.

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
  -- Scalenie zamiast czwartego argumentu jsonb_build_object: pusty styl ma NIE
  -- ZOSTAWIĆ po sobie klucza (nawet z wartością '{}'), bo stary storefront
  -- odrzuca kopertę z nieznanym kluczem niezależnie od jego zawartości.
  || case
       when s.style_published = '{}'::jsonb then '{}'::jsonb
       else jsonb_build_object('style', s.style_published)
     end
  from public.sites s
  join public.tenants t on t.id = s.tenant_id
  where s.tenant_id = p_tenant_id
    and s.published_at is not null
    and t.status in ('trialing', 'active');
$$;

comment on function app.get_published_site(uuid) is
  'Publiczny odczyt storefrontu: opublikowane, włączone sekcje (position_published, id) + opublikowany szablon + styl strony (klucz `style` tylko dla niepustego stylu) — TYLKO dla aktywnego tenanta i opublikowanej strony, inaczej NULL. SECURITY DEFINER — jedyna ścieżka anonowa. Czyta WYŁĄCZNIE kolumny *_published, więc żadna operacja kreatora nie zmienia jej wyniku przed publikacją (ADR-041/ADR-090/ADR-091).';

revoke all on function app.get_published_site(uuid) from public;
grant execute on function app.get_published_site(uuid) to anon, authenticated;

-- === END PROD MIGRATION 0046 ===
