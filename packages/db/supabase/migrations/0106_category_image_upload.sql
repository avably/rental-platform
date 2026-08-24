-- =====================================================================
-- 0106 — BANER KATEGORII: UPLOAD DO catalog_categories.image_path
--        (Faza 7 B, ADR-260)
-- =====================================================================
--
-- Najemca wgrywa baner kategorii i widzi go na kaflu kategorii w sklepie.
-- Kolumnę `public.catalog_categories.image_path` dołożyła Faza A (0101/ADR-244),
-- a pełna koperta katalogu niesie ją od 0103/ADR-251. Brakowało DROGI WEJŚCIA:
-- czym najemca wgrywa plik i jak zapisuje ścieżkę. Ta migracja domyka tę drogę
-- — i robi to NIE budując drugiego mechanizmu wgrywania, tylko rozszerzając ten,
-- który wozi zdjęcia sekcji (0043) i logo najemcy (0076).
--
-- ============== TA SAMA DROGA, TRZECI RODZAJ BILETU ==============
--
-- Bajty idą tak samo jak przy logo: publiczny bucket `site-images`, prywatny
-- rejestr biletów `public.site_image_uploads`, wąskie RPC issue/claim/finish
-- i polityka Storage INSERT oparta o `app.can_upload_site_image`. Bilet dostał
-- oś `kind` już w 0076 (`section`/`logo`); tu dochodzi trzecia wartość
-- `category`. Baner kategorii — jak logo — NIE ma strony-rodzica, więc bilet
-- ma `site_id = null`, a jego ścieżka biegnie przez stały segment `category`:
-- `{tenant}/category/{upload}.{ext}`. Segment `category` nie zderzy się z żadnym
-- `site_id` (te są UUID-ami) ani z segmentem `logo`.
--
-- Równoważność kind↔site_id pilnuje istniejący CHECK
-- `site_image_uploads_kind_parent_check` = `(kind = 'section') = (site_id is
-- not null)`: dla `category` (site_id NULL) daje `false = false`, czyli przejście
-- — bez żadnej zmiany, bo baner należy do najemcy, nie do strony (jak logo).
--
-- ============== SUFIT 5 MiB, NIE 512 KiB (INACZEJ NIŻ LOGO) ==============
--
-- Logo dostało ostrzejszy sufit (512 KiB), bo renderuje się w pasku 36 px i jedzie
-- na KAŻDEJ podstronie sklepu. Baner kategorii jest czymś innym: to fotografia na
-- szerokość kafla/nagłówka kategorii, jedzie raz na widok kategorii — należy więc
-- do tej samej klasy, co zdjęcie sekcji, i zostaje przy sufcie bucketa 5 MiB.
-- Dokładamy własny CHECK tabeli `..._category_size_check` (kind <> 'category' or
-- <= 5 MiB) — nie po to, by zaostrzyć (bucket i tak przyjmuje 5 MiB), lecz by
-- sufit banera był WŁASNOŚCIĄ TABELI, tak jak 0076 uczyniło to dla logo.
--
-- SVG NIE WCHODZI (allowlista MIME bucketa go nie zna): aktywny dokument ze
-- skryptem serwowany z publicznego bucketa byłby składowanym XSS-em w sklepie.
--
-- ============== DWIE BRAMKI, JAK PRZY LOGO ==============
--
-- 1. WYSTAWIENIE biletu (`app.issue_category_image_upload`): ścieżki NIE podaje
--    wołający — buduje ją funkcja z `app.tenant_id()`, więc „bilet pod cudzą
--    ścieżkę" jest NIEWYRAŻALNY, nie tylko odmawiany. Tenant bierze się z
--    `app.tenant_id()`, a NIE z argumentu; argument `p_category_id` służy
--    wyłącznie temu, by odmówić biletu na kategorię spoza własnego najemcy.
-- 2. ZAPIS ścieżki (`app.set_category_image`): guard tenanta+członkostwa, a
--    ścieżka musi pasować do wzorca `{tenant}/category/{uuid}.{ext}` — wskazanie
--    cudzego pliku albo cudzej kategorii jest odmawiane 22023.
--
-- Kompletności biletu `set_category_image` NIE sprawdza (świadomie, jak
-- `set_tenant_logo`): sprzątacz kasuje domknięty bilet po dniach, więc warunek
-- „ścieżka ma bilet" odmawiałby zapisu samej zmiany banera po tygodniu. Bramką
-- uploadu jest polityka Storage; tutaj bramką jest POCHODZENIE ścieżki.
--
-- ============== NAJDROŻSZA POMYŁKA, GDYBY JEJ TU ZABRAKŁO ==============
--
-- Cron sierot (`apps/panel/src/jobs/cleanup-site-image-uploads.ts`) pyta
-- `app.site_image_paths_in_use`, które ze ścieżek bucketa `site-images` są
-- JESZCZE w użyciu, i kasuje CAŁĄ RESZTĘ. Baner kategorii leży w tym samym
-- buckecie, ale w kolumnie `catalog_categories.image_path` — dla funkcji sprzed
-- tej migracji jest ścieżką nieużywaną, czyli plikiem do skasowania. Żywy baner
-- zniknąłby ze sklepu. Dlatego funkcja dostaje TRZECIE źródło referencji obok
-- sekcji i logo: kolumnę `image_path` kategorii.
--
-- ============== CZEGO TU NIE MA ==============
--
-- Polityka Storage `site_images_tenant_insert` (0043) jest AGNOSTYCZNA wobec
-- `kind`: woła `app.can_upload_site_image(name)`, a ta od 0060/0076 przepuszcza
-- bilet z `site_id is null` (gałąź logo). Bilet kategorii też ma `site_id null`,
-- więc predykat działa dla niego BEZ ZMIAN — polityki i `can_upload_site_image`
-- ta migracja nie dotyka (potwierdzone testem: sonda izolacji, wektor 2).

-- === BEGIN PROD MIGRATION 0106 ===

-- ---------------------------------------------------------------------
-- 1. Oś `kind` przyjmuje trzecią wartość `category`
-- ---------------------------------------------------------------------
alter table public.site_image_uploads
  drop constraint if exists site_image_uploads_kind_check;
alter table public.site_image_uploads
  add constraint site_image_uploads_kind_check
    check (kind in ('section', 'logo', 'category'));

-- Sufit banera jako WŁASNOŚĆ TABELI (jak logo w 0076, tylko luźniejszy: 5 MiB).
-- Bilet kategorii większy niż sufit jest niereprezentowalny niezależnie od tego,
-- kto go wystawia.
alter table public.site_image_uploads
  drop constraint if exists site_image_uploads_category_size_check;
alter table public.site_image_uploads
  add constraint site_image_uploads_category_size_check
    check (kind <> 'category' or declared_size <= 5242880);

-- Ścieżka rozgałęziona po `kind`. PRZEPISANA z 0076 (`coalesce(site_id, 'logo')`)
-- na jawny `case`, bo `coalesce` dla trzeciej gałęzi dałby błędnie 'logo' zamiast
-- 'category'. Podmiana jest BEZPIECZNA dla wierszy zastanych: dla `section`
-- gałąź daje `site_id::text` (site_id niepusty), dla `logo` — 'logo'; oba wyniki
-- co do znaku takie same, jak dawał poprzedni `coalesce`.
alter table public.site_image_uploads
  drop constraint if exists site_image_uploads_path_check;
alter table public.site_image_uploads
  add constraint site_image_uploads_path_check
    check (
      storage_path =
        tenant_id::text || '/' ||
        case kind
          when 'section' then site_id::text
          when 'logo' then 'logo'
          when 'category' then 'category'
        end
        || '/' || id::text || '.' ||
        case declared_mime
          when 'image/jpeg' then 'jpg'
          when 'image/png' then 'png'
          when 'image/webp' then 'webp'
          when 'image/avif' then 'avif'
        end
    );

comment on column public.site_image_uploads.kind is
  'Przeznaczenie biletu: `section` — zdjęcie sekcji, rodzicem jest strona (0043); `logo` — znak firmy najemcy, bez rodzica, segment `logo` (0076/ADR-160); `category` — baner kategorii katalogu, bez rodzica, segment `category` (0106/ADR-260). Równoważność kind↔site_id pilnuje site_image_uploads_kind_parent_check (site_id niepusty WYŁĄCZNIE dla `section`).';

-- ---------------------------------------------------------------------
-- 2. app.issue_category_image_upload — bilet na baner kategorii
-- ---------------------------------------------------------------------
--
-- Lustro app.issue_site_logo_upload (0076) z jednym argumentem więcej:
-- `p_category_id`. Argument NIE wybiera tenanta ani ścieżki (te liczy funkcja
-- z app.tenant_id()) — służy wyłącznie temu, by ODMÓWIĆ biletu na kategorię,
-- która nie należy do najemcy wołającego. Bilet pod cudzą ścieżkę zostaje
-- niewyrażalny; bilet na cudzą kategorię — odmawiany.

create or replace function app.issue_category_image_upload(
  p_category_id uuid,
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
  -- nie ma prawa wgrać banera do sklepu.
  if not (select app.is_current_tenant_member()) then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  if p_declared_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
     or p_declared_size not between 1 and 5242880 then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  -- Kategoria MUSI należeć do najemcy wołającego. Bez tej bramki bilet
  -- (poprawny co do ścieżki własnego tenanta) powstałby dla kategorii, której
  -- najemca nie ma — a `set_category_image` i tak by go nie zapisała. Odmowa
  -- już tutaj oszczędza pusty bilet i trzyma spójność „bilet ma sens".
  if not exists (
    select 1 from public.catalog_categories c
    where c.id = p_category_id and c.tenant_id = v_tenant_id
  ) then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  v_extension := case p_declared_mime
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/avif' then 'avif'
  end;
  v_storage_path :=
    v_tenant_id::text || '/category/' || v_upload_id::text || '.' || v_extension;

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
    'category',
    v_user_id,
    v_storage_path,
    p_declared_mime,
    p_declared_size,
    clock_timestamp() + interval '15 minutes'
  );

  return query select v_upload_id, v_storage_path;
end;
$$;

comment on function app.issue_category_image_upload(uuid, text, bigint) is
  'Jednorazowy bilet uploadu BANERA KATEGORII (ADR-260): ścieżka {tenant}/category/{upload}.{ext} liczona z app.tenant_id(), więc bilet pod cudzą ścieżkę jest niewyrażalny. Sufit 5 MiB, cztery MIME rastrowe (bez SVG). p_category_id NIE wybiera tenanta — służy tylko odmowie biletu na kategorię spoza najemcy. Wymaga ŻYWEGO członkostwa. Odmowa: 22023, jednym zdaniem dla wszystkich powodów.';

revoke all on function app.issue_category_image_upload(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function app.issue_category_image_upload(uuid, text, bigint)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. app.set_category_image — zapis (albo zdjęcie) banera
-- ---------------------------------------------------------------------
--
-- DLACZEGO SECURITY DEFINER, SKORO catalog_categories ma politykę UPDATE dla
-- członka (0072). Bo zawężenie ścieżki NIE MOŻE siedzieć w RLS: RLS zna wiersz,
-- nie zna wartości `image_path`. Członek z prawem UPDATE mógłby zapisać w
-- `image_path` DOWOLNY tekst — w tym ścieżkę pliku innego najemcy, przypinając
-- cudzy plik do własnej kategorii (i myląc sprzątacz sierot, który uznałby go za
-- używany). Definer z wąskim ciałem daje członkowi dokładnie jeden czasownik:
-- zapis WŁASNEJ ścieżki do WŁASNEJ kategorii, albo `null` (zdjęcie banera).
--
-- ZAWĘŻENIE JEST W CIELE. Funkcja nie ufa wołającemu ani co do tenanta (bierze
-- go z app.tenant_id()), ani co do ścieżki (wzorzec {tenant}/category/{uuid}.{ext}
-- zakotwiczony z obu stron — odcina cudzy prefiks i `..` w środku), ani co do
-- kategorii (UPDATE trafia wyłącznie wiersz własnego tenanta; brak trafienia =
-- 22023, jak przy cudzej kategorii).

create or replace function app.set_category_image(
  p_category_id uuid,
  p_path text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text := 'Nie można zapisać banera kategorii.';
  v_tenant_id uuid;
begin
  v_tenant_id := app.tenant_id();

  if auth.uid() is null or v_tenant_id is null then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  if not (select app.is_current_tenant_member()) then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  -- `null` = zdjęcie banera (stan normalny — kategoria bez banera wygląda tak,
  -- jak wyglądała). Niepusta ścieżka musi pochodzić z WŁASNEGO prefiksu: wzorzec
  -- pełny, nie fragment. `tenant_id` jest UUID-em, więc w wyrażeniu regularnym
  -- nie ma znaku o specjalnym znaczeniu, a zakotwiczenie z obu stron odcina
  -- cudzy katalog i `..`.
  if p_path is not null and p_path !~ (
    '^' || v_tenant_id::text || '/category/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|avif)$'
  ) then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  update public.catalog_categories
     set image_path = p_path
   where id = p_category_id
     and tenant_id = v_tenant_id;

  -- Brak trafienia = cudza (albo nieistniejąca) kategoria. Milczący sukces
  -- byłby ekranem, który potwierdza zapis, jakiego nie wykonał.
  if not found then
    raise exception '%', c_denied using errcode = '22023';
  end if;
end;
$$;

comment on function app.set_category_image(uuid, text) is
  'Zapis (albo zdjęcie: p_path null) BANERA KATEGORII (ADR-260). Tenant z app.tenant_id(); ścieżka musi pasować do wzorca {tenant}/category/{uuid}.{ext} — wskazanie cudzego pliku odmawiane TU (nie przez RLS, bo image_path to wartość, nie wiersz). Cudza/nieistniejąca kategoria → brak trafienia UPDATE → 22023. Odmowa: 22023.';

revoke all on function app.set_category_image(uuid, text)
  from public, anon, authenticated;
grant execute on function app.set_category_image(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. app.site_image_paths_in_use — BANER KATEGORII NIE JEST SIEROTĄ
-- ---------------------------------------------------------------------
--
-- Ciało przepisane z 0076 (OSTATNIA definicja) z dołożonym CZWARTYM źródłem
-- referencji: kolumna `catalog_categories.image_path`. Bez tego cron sierot
-- kasowałby żywy baner kategorii jako plik nieużywany (patrz nagłówek). Kategoria
-- nie ma bliźniaka draft/published — baner jest jednym stanem, czytanym wprost
-- z kolumny, więc źródło jest pojedyncze (inaczej niż logo/sekcje z parą kolumn).

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
  )
  or exists (
    select 1
    from public.catalog_categories c
    where c.image_path = cand.path
  );
$$;

comment on function app.site_image_paths_in_use(text[]) is
  'Prymityw crona sierot bucketa site-images (0043, logo w ADR-160, baner kategorii w ADR-260): które z podanych ścieżek są JESZCZE w użyciu. Cztery źródła referencji — zdjęcie sekcji (content_draft/_published), pozycja galerii (items[].imagePath), LOGO NAJEMCY (tenants.logo_draft/_published) oraz BANER KATEGORII (catalog_categories.image_path). Szkic liczy się jak stan opublikowany tam, gdzie para kolumn istnieje. Globalny odczyt (cron nie ma tenanta): SECURITY DEFINER, EXECUTE wyłącznie dla service_role.';

revoke all on function app.site_image_paths_in_use(text[])
  from public, anon, authenticated;
grant execute on function app.site_image_paths_in_use(text[])
  to service_role;

-- === END PROD MIGRATION 0106 ===
