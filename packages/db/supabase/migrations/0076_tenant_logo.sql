-- =====================================================================
-- 0076 — LOGO NAJEMCY: ZNAK FIRMY NA POZIOMIE TENANTA (ADR-160)
-- =====================================================================
--
-- Najemca dostaje własny znak w nagłówku i w stopce sklepu. Ta migracja
-- odpowiada na jedno pytanie modelowe i trzy bezpieczeństwowe.
--
-- ============== DLACZEGO TENANT, A NIE STRONA ==============
--
-- Styl strony leży w `sites.style_draft/style_published` (0046) i wygląda na
-- naturalne miejsce także dla logo. PO FAZIE 2 (0073–0075, ADR-157/158/159)
-- wiersze `sites` przestały być wersjami jednej strony, a stały się osobnymi
-- STRONAMI (kontakt, o nas, landingi miast). Logo w stylu strony znaczyłoby
-- odtąd „osobne logo na każdej podstronie": N źródeł prawdy o znaku firmy
-- i nagłówek zmieniający się przy przejściu z „O nas" na „Kontakt".
--
-- Stąd para kolumn na `public.tenants`, w kanonie ADR-091 (bliźniak
-- opublikowany + wpis u strażnika kolumn opublikowanych).
--
-- ODRZUCONE: `public.tenant_settings` (0007), czyli tabela klucz→jsonb, do
-- której członek najemcy MA prawo zapisu. Kanon ADR-091 jest KOLUMNOWY:
-- strażnik `app.guard_published_columns` porównuje `new.<kolumna>` z
-- `old.<kolumna>`. Na tabeli ustawień nie ma czego porównać — stan opublikowany
-- i szkic byłyby dwoma WIERSZAMI, a członek zapisałby wiersz opublikowany
-- wprost przez PostgREST. To jest dokładnie ten wyciek, który 0046 zamknęło
-- dla `style_published`, więc powtarzać go dla znaku firmy nie ma po co.
--
-- ============== BILET UPLOADU BEZ STRONY ==============
--
-- Bajty idą TĄ SAMĄ drogą, co zdjęcia sekcji (0043): publiczny bucket
-- `site-images`, prywatny rejestr biletów `public.site_image_uploads`, wąskie
-- RPC issue/claim/finish i polityka Storage INSERT oparta o
-- `app.can_upload_site_image`. Drugi mechanizm wgrywania nie powstaje.
--
-- Rejestr biletów miał jednak rodzica `sites` (FK złożony + ścieżka
-- `{tenant}/{site}/{upload}.{ext}`), a logo żadnej strony nie ma. Dlatego
-- bilet dostaje oś `kind`, `site_id` staje się NULLOWALNY, a ścieżka biletu
-- logo brzmi `{tenant}/logo/{upload}.{ext}`. Segment `logo` nie może zderzyć
-- się z żadnym `site_id` — tamte są UUID-ami.
--
-- ============== SUFIT ROZMIARU: 512 KiB, NIE 5 MiB ==============
--
-- Bucket `site-images` przyjmuje 5 MiB, bo zdjęcie sekcji to fotografia na pół
-- ekranu. Logo jest czymś innym: renderuje się w pasku o wysokości 36 px, więc
-- przy DPR 3 potrzebuje 108 px wysokości, a przy hojnych proporcjach 8:1 —
-- około 1150 × 144 px. Taki PNG-24 z przezroczystością waży 50–120 kB, WebP
-- 20–40 kB. Sufit 512 KiB (524288 B) daje więc 4–10× zapasu nad porządnie
-- przygotowanym plikiem i zostaje sufitem, a nie normą.
--
-- Powód, dla którego sufit w ogóle jest ostrzejszy: logo jedzie na KAŻDEJ
-- podstronie sklepu i w DWÓCH miejscach dokumentu. Plik 5 MiB byłby wtedy
-- kilkoma megabajtami transferu na każdą wizytę z telefonu — koszt, którego
-- najemca nie zobaczy, a jego klient owszem.
--
-- SVG NIE WCHODZI (allowlista MIME bucketa go zresztą nie zna): to aktywny
-- dokument ze skryptem i odwołaniami zewnętrznymi, serwowany z publicznego
-- bucketa. Logo w SVG byłoby składowanym XSS-em o zasięgu całego sklepu.
--
-- ============== OKNO WDROŻENIOWE ==============
--
-- Koperta odczytu publicznego jest po stronie sklepu parsowana schematem
-- `.strict()` (packages/core/src/site/index.ts), a migracje wchodzą na
-- produkcję PRZED kodem. Klucz `logo` dokładamy więc WARUNKOWO — dokładnie tak
-- jak `style` w 0046. W chwili tej migracji `logo_published` = '{}' dla
-- wszystkich najemców (default niżej), więc koperta jest CO DO BAJTU taka jak
-- przed wdrożeniem i stary storefront niczego nie zauważy.

-- === BEGIN PROD MIGRATION 0076 ===

-- ---------------------------------------------------------------------
-- 1. Para kolumn na public.tenants
-- ---------------------------------------------------------------------
--
-- NOT NULL DEFAULT '{}' (wzorzec `style_draft` z 0046): najemca zawsze ma
-- obiekt logo, a „brak znaku" to pusty obiekt, nie NULL — czytający nie musi
-- rozróżniać dwóch reprezentacji tej samej rzeczy. Brak logo jest stanem
-- NORMALNYM: sklep bez znaku wygląda dokładnie tak, jak wyglądał.
--
-- Kształt WNĘTRZA (`path`, `alt`, `inFooter`) pilnuje @avably/core/site, jak
-- przy stylu strony. Baza trzyma TYP (obiekt), GRANICĘ (rozmiar jsonb) oraz —
-- to jedyne, czego kodowi ufać nie wolno — POCHODZENIE ŚCIEŻKI (sekcja 4).

alter table public.tenants
  add column if not exists logo_draft jsonb not null default '{}'::jsonb;

alter table public.tenants
  add column if not exists logo_published jsonb not null default '{}'::jsonb;

alter table public.tenants
  drop constraint if exists tenants_logo_shape_check;
alter table public.tenants
  add constraint tenants_logo_shape_check check (
    jsonb_typeof(logo_draft) = 'object'
    and jsonb_typeof(logo_published) = 'object'
    -- Granica rozmiaru jsonb: `alt` jest napisem od najemcy, a jsonb bez limitu
    -- to zaproszenie do składowania czegokolwiek w kolumnie czytanej przy
    -- KAŻDYM renderze sklepu. 4 kB mieści ścieżkę, tekst zastępczy i zapas.
    and length(logo_draft::text) <= 4096
    and length(logo_published::text) <= 4096
  );

comment on column public.tenants.logo_draft is
  'Logo sklepu — stan roboczy najemcy (ADR-160). Pusty obiekt = brak znaku (stan normalny). Zapis WYŁĄCZNIE przez app.set_tenant_logo: członek nie ma UPDATE na tenants (RLS: superadmin_update).';
comment on column public.tenants.logo_published is
  'Logo sklepu w wersji publicznej — jedyne, co czyta app.get_published_page. Pisane WYŁĄCZNIE przez app.publish_tenant_logo (strażnik app.guard_published_columns, kanon ADR-091).';

-- ---------------------------------------------------------------------
-- 2. Strażnik kolumn opublikowanych przyjmuje gałąź `tenants`
-- ---------------------------------------------------------------------
--
-- Pełne ciało przepisane z 0073 (ostatnia definicja, odczytana z ŻYWEJ bazy
-- przez pg_get_functiondef) z JEDNĄ dołożoną gałęzią. `create or replace`
-- zastępuje całość, więc przepisanie ze starszej wersji cofnęłoby cicho
-- poprawki 0073 — ciało niżej jest kopią co do warunku, nie parafrazą.
--
-- CZEGO TA GAŁĄŹ BRONI, A CZEGO NIE. Na `sites` strażnik zamyka dziurę
-- oczywistą: `authenticated` ma tam GRANT UPDATE i politykę, więc bez triggera
-- członek przemalowałby żywą stronę jednym zapytaniem PostgREST. Na `tenants`
-- członek UPDATE-u nie ma w ogóle (0001: `superadmin_update`), więc gałąź
-- zamyka dziurę o piętro wyżej — SUPERADMINA, który jako jedyna rola
-- interaktywna może pisać do tej tabeli i którego RLS przepuszcza bez pytania,
-- co zmienia. Znak firmy najemcy nie jest rzeczą, którą platforma podmienia
-- mimochodem przy zmianie statusu.
--
-- Zawężeniem dla CZŁONKA jest sprawdzenie uprawnienia wewnątrz RPC z sekcji 4
-- i 5 — nie ten trigger. Dwie różne bramki, dwie różne role.

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

  elsif tg_table_name = 'tenants' then
    -- ADR-160. Najemca RODZI SIĘ bez znaku: tenant zakładany interaktywnie nie
    -- ma prawa przyjść na świat z gotowym stanem publicznym, tak samo jak
    -- strona (wyżej).
    if tg_op = 'INSERT' then
      if new.logo_published <> '{}'::jsonb then
        raise exception '%', c_denied using errcode = '42501';
      end if;
    elsif new.logo_published is distinct from old.logo_published then
      raise exception '%', c_denied using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.guard_published_columns() is
  'Strażnik kolumn stanu opublikowanego (ADR-091, rozszerzony o style_published w ADR-090, slug_published w ADR-157 i logo_published w ADR-160): zapis do *_published / published_at wyłącznie z wnętrza czasownika publikacji (flaga transakcyjna app.publishing) albo rolą serwisową. Odmowa: 42501 — ten sam SQLSTATE co odmowa RLS/grantu, żeby trigger BEFORE nie przykrywał oczekiwań macierzy izolacji.';

revoke all on function app.guard_published_columns() from public, anon, authenticated;

-- Trigger na `tenants` — wzorzec nazwy i kształtu z 0045 (sites_guard_published).
drop trigger if exists tenants_guard_published on public.tenants;
create trigger tenants_guard_published
  before insert or update on public.tenants
  for each row execute function app.guard_published_columns();

-- ---------------------------------------------------------------------
-- 3. Bilet uploadu bez strony: oś `kind` w site_image_uploads
-- ---------------------------------------------------------------------
--
-- `site_id` przestaje być wymagany, a jego obecność wiąże się z `kind`
-- RÓWNOWAŻNOŚCIĄ: bilet sekcji MA stronę, bilet logo jej NIE MA. Zapis
-- `(kind = 'section') = (site_id is not null)` zamyka obie pomyłki naraz —
-- sekcję bez rodzica i logo z rodzicem — jednym warunkiem zamiast dwóch.
--
-- FK złożony (tenant_id, site_id) → sites zostaje NIETKNIĘTY: MATCH SIMPLE
-- (domyślny) przepuszcza wiersz, w którym którakolwiek kolumna klucza jest
-- NULL-em, więc bilet logo go nie narusza, a bilet sekcji dalej nie ma jak
-- wskazać cudzej strony (23503).

alter table public.site_image_uploads
  add column if not exists kind text not null default 'section';

alter table public.site_image_uploads
  alter column site_id drop not null;

alter table public.site_image_uploads
  drop constraint if exists site_image_uploads_kind_check;
alter table public.site_image_uploads
  add constraint site_image_uploads_kind_check check (kind in ('section', 'logo'));

alter table public.site_image_uploads
  drop constraint if exists site_image_uploads_kind_parent_check;
alter table public.site_image_uploads
  add constraint site_image_uploads_kind_parent_check
    check ((kind = 'section') = (site_id is not null));

-- Sufit 512 KiB jest WŁASNOŚCIĄ TABELI, nie tylko jednej funkcji: bilet logo
-- większy niż sufit jest niereprezentowalny niezależnie od tego, kto go
-- wystawia. Bilet sekcji zostaje przy 5 MiB z CHECK-a `..._size_check` (0043).
alter table public.site_image_uploads
  drop constraint if exists site_image_uploads_logo_size_check;
alter table public.site_image_uploads
  add constraint site_image_uploads_logo_size_check
    check (kind <> 'logo' or declared_size <= 524288);

-- Ścieżka: drugi segment to strona ALBO stały napis `logo`. Podmiana CHECK-a
-- jest bezpieczna dla wierszy zastanych — dla nich `site_id` jest niepusty,
-- więc `coalesce` daje dokładnie to, co dawał poprzedni warunek.
alter table public.site_image_uploads
  drop constraint if exists site_image_uploads_path_check;
alter table public.site_image_uploads
  add constraint site_image_uploads_path_check
    check (
      storage_path =
        tenant_id::text || '/' || coalesce(site_id::text, 'logo') || '/' || id::text || '.' ||
        case declared_mime
          when 'image/jpeg' then 'jpg'
          when 'image/png' then 'png'
          when 'image/webp' then 'webp'
          when 'image/avif' then 'avif'
        end
    );

comment on column public.site_image_uploads.kind is
  'Przeznaczenie biletu (ADR-160): `section` — zdjęcie sekcji, rodzicem jest strona; `logo` — znak firmy najemcy, rodzica nie ma i ścieżka biegnie przez segment `logo`. Równoważność kind↔site_id pilnuje site_image_uploads_kind_parent_check.';

-- ---------------------------------------------------------------------
-- 4. app.issue_site_logo_upload — bilet na znak firmy
-- ---------------------------------------------------------------------
--
-- Lustro app.issue_site_image_upload (0043) bez argumentu strony. Sygnatury
-- zastanej NIE RUSZAMY (ani przez dodanie parametru z wartością domyślną):
-- w oknie wdrożeniowym woła ją STARY kod, a zmiana funkcji pod nim to ta sama
-- klasa błędu, przed którą broniło się 0074.
--
-- ŚCIEŻKI NIE PODAJE WOŁAJĄCY. Buduje ją funkcja z `app.tenant_id()`, więc
-- „bilet pod cudzą ścieżkę" nie jest odmawiany — jest NIEWYRAŻALNY. To jest
-- pierwsza z dwóch bramek uploadu; drugą (sekcja 6) jest predykat polityki
-- Storage, który wymaga OTWARTEGO biletu wołającego na tę dokładnie ścieżkę.

create or replace function app.issue_site_logo_upload(
  p_declared_mime text,
  p_declared_size bigint
)
returns table(upload_id uuid, storage_path text)
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text := 'Nie można wykonać tego uploadu zdjęcia.';
  v_user_id uuid;
  v_tenant_id uuid;
  v_upload_id uuid := gen_random_uuid();
  v_extension text;
  v_storage_path text;
begin
  v_user_id := auth.uid();
  v_tenant_id := app.tenant_id();

  if v_user_id is null or v_tenant_id is null then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  -- Żywe członkostwo, nie sam claim z tokenu (kanon ADR-126): po usunięciu
  -- z zespołu token żyje jeszcze do godziny, a przez tę godzinę były członek
  -- nie ma prawa podmienić znaku firmy.
  if not (select app.is_current_tenant_member()) then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  if p_declared_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
     or p_declared_size not between 1 and 524288 then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  v_extension := case p_declared_mime
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/avif' then 'avif'
  end;
  v_storage_path :=
    v_tenant_id::text || '/logo/' || v_upload_id::text || '.' || v_extension;

  insert into public.site_image_uploads (
    id,
    tenant_id,
    site_id,
    kind,
    requested_by,
    storage_path,
    declared_mime,
    declared_size,
    expires_at
  )
  values (
    v_upload_id,
    v_tenant_id,
    null,
    'logo',
    v_user_id,
    v_storage_path,
    p_declared_mime,
    p_declared_size,
    clock_timestamp() + interval '15 minutes'
  );

  return query select v_upload_id, v_storage_path;
end;
$$;

comment on function app.issue_site_logo_upload(text, bigint) is
  'Jednorazowy bilet uploadu LOGO najemcy (ADR-160): ścieżka {tenant}/logo/{upload}.{ext} liczona z app.tenant_id(), więc bilet pod cudzą ścieżkę jest niewyrażalny. Sufit 512 KiB, cztery MIME rastrowe (bez SVG). Wymaga ŻYWEGO członkostwa, nie samego claimu. Odmowa: 22023, jednym zdaniem dla wszystkich powodów.';

revoke all on function app.issue_site_logo_upload(text, bigint)
  from public, anon, authenticated;
grant execute on function app.issue_site_logo_upload(text, bigint)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. app.set_tenant_logo / app.publish_tenant_logo
-- ---------------------------------------------------------------------
--
-- DLACZEGO SECURITY DEFINER, SKORO `sites` PISZE SIĘ INVOKEREM. `authenticated`
-- ma GRANT UPDATE na `public.tenants`, ale RLS przepuszcza tam wyłącznie
-- superadmina (0001: `superadmin_update`). Zapis invokerem skończyłby się więc
-- cichym „zero wierszy", a otwarcie polityki UPDATE dla członka oznaczałoby
-- otwarcie CAŁEGO wiersza tenanta — łącznie ze `status` i `slug`. Definer
-- z wąskim ciałem jest tu jedyną formą, która daje członkowi dokładnie dwa
-- czasowniki i ani jednego więcej.
--
-- ZAWĘŻENIE JEST W CIELE, NIE W RLS. `set_tenant_logo` nie ufa wołającemu ani
-- co do tenanta (bierze go z `app.tenant_id()`), ani co do ścieżki: ta musi
-- pasować do wzorca `{tenant}/logo/{uuid}.{ext}` dokładnie, więc znak najemcy
-- nie ma jak wskazać pliku innego najemcy. Bez tego warunku wystarczyłoby
-- znać cudzą ścieżkę, żeby postawić cudzy znak we własnym sklepie — a przy
-- okazji przypiąć cudzy plik do WŁASNEGO wiersza, przez co sprzątacz sierot
-- uznałby go za używany.
--
-- Kompletności biletu ta funkcja NIE sprawdza świadomie: sprzątacz kasuje
-- wiersz domkniętego biletu po siedmiu dniach, więc warunek „ścieżka ma bilet"
-- odmawiałby ósmego dnia zapisu samego tekstu zastępczego. Bramką uploadu jest
-- polityka Storage (sekcja 6); tutaj bramką jest POCHODZENIE ścieżki.

create or replace function app.set_tenant_logo(p_logo jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text := 'Nie można zapisać logo sklepu.';
  v_tenant_id uuid;
  v_path text;
begin
  v_tenant_id := app.tenant_id();

  if auth.uid() is null or v_tenant_id is null then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  if not (select app.is_current_tenant_member()) then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  if p_logo is null or jsonb_typeof(p_logo) <> 'object' or length(p_logo::text) > 4096 then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  if p_logo <> '{}'::jsonb then
    v_path := p_logo ->> 'path';
    -- Wzorzec pełny, nie prefiks: `tenant_id` jest UUID-em, więc w wyrażeniu
    -- regularnym nie ma znaku o specjalnym znaczeniu, a zakotwiczenie z obu
    -- stron odcina zarówno cudzy katalog, jak i `..` w środku ścieżki.
    if v_path is null or v_path !~ (
      '^' || v_tenant_id::text || '/logo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|avif)$'
    ) then
      raise exception '%', c_denied using errcode = '22023';
    end if;
  end if;

  update public.tenants
     set logo_draft = p_logo
   where id = v_tenant_id;

  if not found then
    raise exception '%', c_denied using errcode = '22023';
  end if;
end;
$$;

comment on function app.set_tenant_logo(jsonb) is
  'Zapis SZKICU logo najemcy (ADR-160). Pusty obiekt = zdjęcie znaku. Tenant bierze się z app.tenant_id(), a ścieżka musi pasować do wzorca {tenant}/logo/{uuid}.{ext} — wskazanie cudzego pliku jest odmawiane TU, a nie przez RLS (tenants nie ma polityki UPDATE dla członka). Kształtu wnętrza poza `path` pilnuje @avably/core/site. Odmowa: 22023.';

revoke all on function app.set_tenant_logo(jsonb)
  from public, anon, authenticated;
grant execute on function app.set_tenant_logo(jsonb)
  to authenticated, service_role;

-- Publikacja znaku ma WŁASNY czasownik, a nie doczepkę do app.publish_site.
-- Powód jest ten sam, dla którego logo nie leży w stronie: najemca ma N stron,
-- więc „logo wchodzi na żywo przy publikacji strony" znaczyłoby, że publikacja
-- Kontaktu podmienia znak w całym sklepie. Odwrotnie też: najemca, który
-- zmienił wyłącznie logo, nie ma powodu publikować niezwiązanej strony.
create or replace function app.publish_tenant_logo()
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text := 'Nie można opublikować logo sklepu.';
  v_tenant_id uuid;
  v_published_at timestamptz := now();
begin
  v_tenant_id := app.tenant_id();

  if auth.uid() is null or v_tenant_id is null then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  if not (select app.is_current_tenant_member()) then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  -- Flaga transakcyjna jak w app.publish_site. Dziś ta funkcja przechodzi
  -- przez strażnika także bez niej — właściciel funkcji definera jest członkiem
  -- service_role, a strażnik przepuszcza ścieżkę serwisową pierwszym warunkiem.
  -- Flaga jest tu po to, żeby przejście NIE ZALEŻAŁO od tego zbiegu ról:
  -- zmiana właściciela funkcji ma zmienić uprawnienia, a nie zepsuć publikację.
  perform set_config('app.publishing', '1', true);

  update public.tenants
     set logo_published = logo_draft
   where id = v_tenant_id;

  if not found then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  perform set_config('app.publishing', '0', true);
  return v_published_at;
end;
$$;

comment on function app.publish_tenant_logo() is
  'Publikacja logo najemcy (ADR-160): kopia logo_draft → logo_published pod flagą app.publishing. Osobny czasownik od app.publish_site, bo znak jest własnością NAJEMCY, a stron najemca ma wiele — publikacja jednej z nich nie ma prawa podmienić znaku w całym sklepie. Odmowa: 22023.';

revoke all on function app.publish_tenant_logo()
  from public, anon, authenticated;
grant execute on function app.publish_tenant_logo()
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. app.can_upload_site_image — bilet bez strony też jest biletem
-- ---------------------------------------------------------------------
--
-- Ciało przepisane z 0060 — OSTATNIEJ definicji tej funkcji w historii, nie
-- z 0043, która ją utworzyła. Różnica jest jednym zdaniem i całą bramką:
-- 0060 (ADR-126) dokleiło `and app.is_current_tenant_member()`, czyli warunek
-- ŻYWEGO członkostwa. Przepisanie z 0043 cofnęłoby go po cichu i przez godzinę
-- po usunięciu z zespołu były członek dalej wgrywałby pliki do sklepu.
-- W diffie migracji tego nie widać — widać to dopiero w bramce
-- packages/db/test/live-membership-predicates.test.ts, która ten regres złapała.
--
-- Zmiana merytoryczna jest jedna: join na `sites` przestaje być warunkiem
-- BEZWZGLĘDNYM. Zostawiony bez zmian odciąłby upload logo po cichu — bilet
-- logo ma `site_id` NULL, więc INNER JOIN nie oddałby ani jednego wiersza
-- i polityka Storage odmawiałaby zawsze.
--
-- Spójność (tenant_id, site_id) dla biletu SEKCJI zostaje sprawdzana dokładnie
-- tak, jak była; dla biletu logo rodzicem jest sam najemca i sprawdzać nie ma
-- czego poza tenantem, który i tak jest w warunku wyżej.

create or replace function app.can_upload_site_image(
  p_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select exists (
    select 1
    from public.site_image_uploads u
    where u.storage_path = p_storage_path
      and u.tenant_id = app.tenant_id()
      and u.requested_by = auth.uid()
      and u.status = 'pending'
      and u.expires_at > clock_timestamp()
      and (
        u.site_id is null
        or exists (
          select 1
          from public.sites s
          where s.tenant_id = u.tenant_id
            and s.id = u.site_id
        )
      )
  )
  and app.is_current_tenant_member();
$$;

comment on function app.can_upload_site_image(text) is
  'Predykat polityki Storage INSERT dla bucketa site-images (0043, predykat żywego członkostwa z 0060/ADR-126, bilet bez strony w ADR-160): obiekt można wgrać wyłącznie na ścieżkę OTWARTEGO biletu wołającego (pending, nieprzeterminowany) i wyłącznie przez ŻYWEGO członka tenanta. Bilet sekcji dodatkowo musi wskazywać istniejącą stronę tego samego tenanta; bilet logo strony nie ma z definicji.';

revoke all on function app.can_upload_site_image(text)
  from public, anon, authenticated;
grant execute on function app.can_upload_site_image(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. app.site_image_paths_in_use — ŻYWE LOGO NIE JEST SIEROTĄ
-- ---------------------------------------------------------------------
--
-- TO JEST NAJDROŻSZA POMYŁKA TEJ ZMIANY, GDYBY JEJ TU ZABRAKŁO. Sprzątacz
-- sierot (`apps/panel/src/jobs/cleanup-site-image-uploads.ts`) pyta tą funkcją,
-- które z kandydujących ścieżek są jeszcze w użyciu, i kasuje CAŁĄ RESZTĘ.
-- Logo nie leży w sekcjach, więc dla funkcji sprzed tej migracji jest ścieżką
-- nieużywaną — czyli plikiem do skasowania. Żywy znak firmy najemcy zniknąłby
-- ze sklepu, a jedynym śladem byłby licznik `removedObjects` w logu crona.
--
-- Ciało przepisane z 0043 (ostatnia definicja) z dołożonym trzecim źródłem
-- referencji: para kolumn `tenants`. Szkic liczy się tak samo jak stan
-- opublikowany — najemca, który wgrał znak i jeszcze go nie opublikował, ma
-- prawo wrócić do panelu następnego dnia i zastać swój plik.

create or replace function app.site_image_paths_in_use(
  p_paths text[]
)
returns setof text
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select cand.path
  from unnest(p_paths) as cand(path)
  where exists (
    select 1
    from public.site_sections s
    where cand.path in (
           s.content_draft ->> 'imagePath',
           s.content_published ->> 'imagePath'
         )
       or exists (
         select 1
         from jsonb_array_elements(
           case when jsonb_typeof(s.content_draft -> 'items') = 'array'
                then s.content_draft -> 'items' else '[]'::jsonb end
         ) as e
         where e ->> 'imagePath' = cand.path
       )
       or exists (
         select 1
         from jsonb_array_elements(
           case when jsonb_typeof(s.content_published -> 'items') = 'array'
                then s.content_published -> 'items' else '[]'::jsonb end
         ) as e
         where e ->> 'imagePath' = cand.path
       )
  )
  or exists (
    select 1
    from public.tenants t
    where cand.path in (
           t.logo_draft ->> 'path',
           t.logo_published ->> 'path'
         )
  );
$$;

comment on function app.site_image_paths_in_use(text[]) is
  'Prymityw crona sierot bucketa site-images (0043, rozszerzony w ADR-160): które z podanych ścieżek są JESZCZE w użyciu. Trzy źródła referencji — zdjęcie sekcji (content_draft/_published), pozycja galerii (items[].imagePath) oraz LOGO NAJEMCY (tenants.logo_draft/_published). Szkic liczy się jak stan opublikowany. Globalny odczyt (cron nie ma tenanta): SECURITY DEFINER, EXECUTE wyłącznie dla service_role.';

revoke all on function app.site_image_paths_in_use(text[])
  from public, anon, authenticated;
grant execute on function app.site_image_paths_in_use(text[])
  to service_role;

-- ---------------------------------------------------------------------
-- 8. app.get_published_page — klucz `logo` w kopercie, warunkowo
-- ---------------------------------------------------------------------
--
-- Ciało przepisane z 0074 (ostatnia definicja, odczytana z ŻYWEJ bazy) z jedną
-- zmianą: drugie scalenie `||`, bliźniaczo do stylu. Warunek pustego obiektu
-- jest warunkiem OKNA WDROŻENIOWEGO, nie oszczędnością bajtów — patrz nagłówek.
--
-- Logo jedzie TĄ KOPERTĄ, a nie własnym odczytem, i to jest decyzja
-- bezpieczeństwa, nie wygody. Koperta jest zawężona `p_tenant_id`, a sklep
-- czyta ją bez cache'u pośredniego (trasy tenanckie są force-dynamic).
-- Osobny odczyt znaczyłby drugi klucz do cache'owania, a klucz cache'u bez
-- najemcy to klasyczne miejsce, w którym logo najemcy A trafia na sklep B.
--
-- `app.get_published_site(uuid)` dziedziczy zmianę bez dotykania: od 0074 jest
-- wywołaniem tej funkcji dla pustego sluga.

create or replace function app.get_published_page(p_tenant_id uuid, p_slug text)
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
          -- Sekcje przypięte (dziś: stopka) schodzą na koniec NIEZALEŻNIE od
          -- zapisanej pozycji. `false < true` w Postgresie, więc wyrażenie
          -- boolowskie sortuje zwykłe sekcje przed przypiętymi bez CASE.
          order by (sec.type = 'footer'), sec.position_published, sec.id
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
  -- Znak firmy najemcy (ADR-160) — ten sam warunek i z tego samego powodu.
  -- Czyta się WYŁĄCZNIE kolumnę opublikowaną; kolumna szkicu nie występuje
  -- w tym zapytaniu tak samo, jak nie występuje treść szkicu sekcji.
  --
  -- Nazwy kolumny szkicu NIE MA też w komentarzu, i to nie jest kosmetyka:
  -- strażnik strukturalny (packages/db/test/tenant-logo.test.ts) skanuje
  -- pg_get_functiondef, a ten oddaje ciało RAZEM z komentarzami. Wzmianka
  -- w komentarzu paliłaby bramkę, która ma pilnować ZAPYTANIA.
  || case
       when t.logo_published = '{}'::jsonb then '{}'::jsonb
       else jsonb_build_object('logo', t.logo_published)
     end
  from public.sites s
  join public.tenants t on t.id = s.tenant_id
  where s.tenant_id = p_tenant_id
    and s.slug_published = p_slug
    and s.published_at is not null
    and app.tenant_commercially_active(t.status);
$$;

comment on function app.get_published_page(uuid, text) is
  'Opublikowana strona najemcy POD WSKAZANYM ADRESEM (0074, ADR-158; logo w ADR-160): pusty slug = strona główna. Czyta WYŁĄCZNIE kolumny *_published (kanon ADR-091) i wyłącznie dla najemcy w oknie handlowym (0065). SECURITY DEFINER — jedyną bramką izolacji są jawne filtry tenant_id/slug_published, nie RLS. Koperta jest po stronie sklepu parsowana schematem .strict(), więc klucze `style` i `logo` dokładają się WARUNKOWO — pusta wartość nie zostawia po sobie klucza.';

revoke all on function app.get_published_page(uuid, text) from public;
grant execute on function app.get_published_page(uuid, text) to anon, authenticated;

-- === END PROD MIGRATION 0076 ===
