-- =====================================================================
-- 0074 — ODCZYT PUBLICZNY PO ADRESIE + REJESTR STRON (ADR-158)
-- =====================================================================
--
-- Faza 2 kreatora, krok 2.2. Ta migracja otwiera najemcy wiele stron naraz:
-- publikacja przestaje gasić pozostałe, a odczyt publiczny umie wskazać stronę
-- ADRESEM, nie samym najemcą.
--
-- ========================== KOPERTA `.strict()` ==========================
--
-- Koperta `app.get_published_site` jest po stronie sklepu parsowana schematem
-- `.strict()` — nieznany klucz nie jest ignorowany, tylko WYWRACA CAŁĄ STRONĘ
-- (packages/core/src/site/index.ts, publishedSiteEnvelopeSchema). Migracja
-- wchodzi na produkcję PRZED kodem, więc bezwarunkowy nowy klucz położyłby
-- każdy sklep na czas okna wdrożeniowego.
--
-- ROZSTRZYGNIĘCIE: NIE DOKŁADAMY DO TEJ KOPERTY ANI JEDNEGO KLUCZA. Adres nie
-- musi wracać z odczytu, bo wołający go PODAJE — trasa sklepu zna slug, którym
-- pytała, i z niego liczy kanon (`pagePathFromSlug`). Klucz `slug` w kopercie
-- byłby echem argumentu: koszt (warunkowe dokładanie, drugi kształt do
-- parsowania, ryzyko okna) bez ani jednej nowej informacji. To jest tańsze
-- i pewniejsze niż „dokładamy warunkowo".
--
-- SYGNATURA `app.get_published_site(uuid)` TEŻ ZOSTAJE NIETKNIĘTA. Dołożenie
-- drugiego parametru z wartością domyślną zmieniłoby funkcję, którą w oknie
-- wdrożeniowym woła STARY kod; zamiast tego rdzeń odczytu przenosi się do nowej
-- `app.get_published_page(uuid, text)`, a dotychczasowa funkcja staje się jej
-- wywołaniem dla strony głównej. Jedno ciało, dwa wejścia, zero zmian
-- w kontrakcie zastanym.
--
-- ======================= REJESTR STRON DLA PROXY =======================
--
-- Rozstrzyganie adresu MUSI dziać się w middleware, bo trasy `app/(tenant)/[slug]`
-- NIE DA SIĘ dodać obok `app/[locale]` — Next 16 rzuca twardy błąd builda przy
-- dwóch różnych nazwach parametru na tym samym poziomie ścieżki. Middleware
-- potrzebuje więc listy adresów najemcy: `app.get_tenant_pages`.
--
-- Koperta rejestru niesie od razu KLUCZ `redirects`, choć 0074 zawsze oddaje go
-- pustego. To nie jest zapas na wyrost, tylko warunek z ADR-159: historia
-- slugów ma być czytana TYM SAMYM TOREM co rozstrzyganie adresu, bez drugiej
-- podróży do bazy. Gdyby klucz dochodził dopiero w 0075, mielibyśmy w oknie
-- wdrożeniowym dokładnie ten problem, którego wyżej unikamy.
--
-- Rejestr jest ZAWĘŻONY ARGUMENTEM, nie RLS-em: funkcja jest SECURITY DEFINER,
-- więc jedyną bramką izolacji są jawne filtry `tenant_id` — tak samo jak
-- w `app.get_public_catalog` (0072). Middleware podaje id rozwiązane
-- SERWEROWO z hosta; nagłówek tenanta przychodzący od klienta jest zdejmowany
-- bezwarunkowo (apps/storefront/lib/tenant/headers.ts).
--
-- CZEGO TA MIGRACJA NIE RUSZA: `sites` (kolumny z 0073 wystarczają), strażnik
-- kolumn opublikowanych, polityki RLS, granty tabel, `app.get_public_catalog`.

-- === BEGIN PROD MIGRATION 0074 ===

-- ---------------------------------------------------------------------
-- 1. app.get_published_page — RDZEŃ odczytu publicznego, po ADRESIE
-- ---------------------------------------------------------------------
--
-- Ciało przepisane z ostatniej definicji `app.get_published_site` (0065),
-- odczytanej z ŻYWEJ bazy przez pg_get_functiondef — nie z migracji o pasującym
-- numerze. Jedyna różnica merytoryczna: warunek `s.slug_published = p_slug`.
--
-- `p_slug` bez wartości domyślnej ŚWIADOMIE: wołający ma podjąć decyzję, którą
-- stronę czyta. Domyślny pusty slug ukryłby pomyłkę „zapomniałem podać adres"
-- pod cichym zwróceniem strony głównej.

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
  from public.sites s
  join public.tenants t on t.id = s.tenant_id
  where s.tenant_id = p_tenant_id
    and s.slug_published = p_slug
    and s.published_at is not null
    and app.tenant_commercially_active(t.status);
$$;

comment on function app.get_published_page(uuid, text) is
  'Opublikowana strona najemcy POD WSKAZANYM ADRESEM (0074, ADR-158): pusty slug = strona główna. Czyta WYŁĄCZNIE kolumny *_published (kanon ADR-091) i wyłącznie dla najemcy w oknie handlowym (0065). SECURITY DEFINER — jedyną bramką izolacji są jawne filtry tenant_id/slug_published, nie RLS. Koperta identyczna co do klucza z app.get_published_site: storefront parsuje ją schematem .strict().';

revoke all on function app.get_published_page(uuid, text) from public;
-- anon: to JEST publiczny odczyt sklepu — jedyna droga treści do przeglądarki
-- klienta najemcy (ADR-041). authenticated: podgląd panelu chodzi tą samą
-- funkcją co sklep, żeby nie powstała druga ścieżka odczytu.
grant execute on function app.get_published_page(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. app.get_published_site — WEJŚCIE dla strony głównej
-- ---------------------------------------------------------------------
--
-- Sygnatura i koperta bez zmian; ciało staje się wywołaniem rdzenia z pustym
-- slugiem. Do 0073 „opublikowana strona najemcy" była jedna, więc warunku po
-- adresie tu nie było — od 0074 stron żywych bywa wiele i BEZ tego warunku
-- funkcja `language sql` cicho oddałaby pierwszy wiersz niesortowanego skanu
-- (zmierzone sondą przed 0048; to nie jest hipoteza).

create or replace function app.get_published_site(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select app.get_published_page(p_tenant_id, '');
$$;

comment on function app.get_published_site(uuid) is
  'Opublikowana STRONA GŁÓWNA sklepu najemcy (`/`). Od 0074 (ADR-158) jest to wywołanie app.get_published_page(p_tenant_id, '''') — rdzeń odczytu ma jedno ciało, a ta sygnatura zostaje nietknięta, bo woła ją kod sprzed wdrożenia.';

revoke all on function app.get_published_site(uuid) from public;
grant execute on function app.get_published_site(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. app.get_tenant_pages — REJESTR ADRESÓW dla proxy
-- ---------------------------------------------------------------------
--
-- Zwraca komplet ŻYWYCH adresów najemcy jednym zapytaniem, żeby middleware
-- rozstrzygał ścieżkę bez zgadywania i bez podróży po jednym slugu naraz.
-- Wynik jest cache'owany po stronie sklepu POD KLUCZEM ZAWIERAJĄCYM NAJEMCĘ
-- (apps/storefront/lib/tenant/pages.ts) — klucz bez najemcy oddawałby cudzy
-- rejestr i jest to klasyczne miejsce na wyciek, więc pilnuje go osobny test.
--
-- Adresy, nie identyfikatory: middleware potrzebuje odpowiedzi „czy ten segment
-- jest stroną", a nie wiedzy o wierszach. Identyfikator strony nie wychodzi
-- z tej funkcji ani razu.

create or replace function app.get_tenant_pages(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'pages', coalesce(
      (
        select jsonb_agg(s.slug_published order by s.slug_published)
        from public.sites s
        where s.tenant_id = p_tenant_id
          and s.published_at is not null
      ),
      '[]'::jsonb
    ),
    -- HISTORIA ADRESÓW (ADR-159) — w 0074 zawsze pusta. Klucz stoi tu od razu,
    -- bo przekierowania mają jechać TYM SAMYM TOREM co rozstrzyganie adresu:
    -- middleware nie może pozwolić sobie na drugą podróż do bazy tylko po to,
    -- żeby sprawdzić, czy segment jest starym adresem.
    'redirects', '[]'::jsonb
  )
  from public.tenants t
  where t.id = p_tenant_id
    and app.tenant_commercially_active(t.status);
$$;

comment on function app.get_tenant_pages(uuid) is
  'Rejestr ŻYWYCH adresów stron najemcy dla proxy sklepu (0074, ADR-158): {"pages": [slug...], "redirects": []}. Pusty slug = strona główna. NULL dla najemcy poza oknem handlowym — sklep gaśnie razem z odczytem strony. SECURITY DEFINER: bramką izolacji jest jawny filtr tenant_id, a nie RLS. Klucz `redirects` wypełnia dopiero 0075 (ADR-159); stoi tu od 0074, bo koperty czytane w middleware nie mogą zmieniać kształtu w oknie wdrożeniowym.';

revoke all on function app.get_tenant_pages(uuid) from public;
-- anon: middleware sklepu chodzi wyłącznie kluczem publikowalnym (ta sama
-- droga co app.resolve_tenant_by_slug z 0017).
grant execute on function app.get_tenant_pages(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. PUBLIKACJA PRZESTAJE GASIĆ POZOSTAŁE STRONY
-- ---------------------------------------------------------------------
--
-- Do 0073 publikacja PRZEŁĄCZAŁA żywą wersję, bo żywa strona mogła być jedna.
-- Od tej migracji strony współistnieją, więc publikacja `Kontaktu` nie ma prawa
-- zdjąć strony głównej ze sklepu. Zdanie gaszące ZNIKA — i to jest cała zmiana
-- w tej funkcji.
--
-- Co przejmuje po nim ochronę: unikat `sites_live_slug_unique_idx` z 0073.
-- Publikacja drugiej strony pod adresem już zajętym pada 23505 — panel tłumaczy
-- ten kod na zdanie o zajętym adresie. To jest właściwa odmowa: dwie żywe
-- strony pod jednym adresem dałyby cichy, niedeterministyczny wybór wiersza.
--
-- Ciało przepisane z 0073 (ostatnia definicja publish_site w historii).

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
         slug_published = slug,
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
  'Publikacja strony storefrontu: atomowe przeniesienie kompletu stanu widocznego TEJ strony — treść, kolejność, włączenie, szablon, ADRES i styl — plus skasowanie sekcji usuniętych w szkicu (ADR-041/090/091/093/157/158). Od 0074 NIE gasi pozostałych stron najemcy: strony współistnieją, a przed dwiema żywymi pod jednym adresem broni unikat sites_live_slug_unique_idx (23505). SECURITY INVOKER — bramką jest RLS wołającego. JEDYNA droga zapisu kolumn *_published i published_at. Odmowa (brak strony / cudza strona): 22023.';

revoke all on function app.publish_site(uuid) from public, anon;
grant execute on function app.publish_site(uuid) to authenticated;

-- === END PROD MIGRATION 0074 ===
