-- =====================================================================
-- 0080 — ROLA STRONY: SZABLON STRONY PRODUKTU (ADR-178)
-- =====================================================================
--
-- Faza 5 kreatora. Do tej migracji strona pojedynczego sprzętu była ZASZYTA
-- W KODZIE: `apps/storefront/app/(tenant)/product/[id]/page.tsx` składał ją
-- z gotowych komponentów i najemca nie miał na nią żadnego wpływu. Silnik,
-- który to odblokowuje, stoi w repo od fazy 3 (`BINDING_RECORD_KINDS`
-- z wariantem `pageProduct`, `SiteRenderer` z propsem `record`) — brakowało
-- WIERSZA, który byłby tym szablonem, i ŚCIEŻKI ODCZYTU, którą sklep by go
-- wziął. Ta migracja dokłada jedno i drugie.
--
-- MIGRACJA BEZ ANI JEDNEJ ZMIANY WIDOCZNEJ. Po jej zastosowaniu sklep pokazuje
-- dokładnie to samo, co przed nią: kolumna roli rodzi się z wartością „zwykła
-- strona" dla WSZYSTKICH wierszy zastanych, więc każdy warunek dołożony niżej
-- jest dla nich prawdziwy. Kod korzystający z szablonu wchodzi razem z mergem.
-- Ta kolejność nie jest ostrożnością — jest wymuszona: migracje jadą na
-- produkcję PRZED kodem, a koperta publicznego odczytu jest `.strict()`.
--
-- ==================== KOPERTA: ANI JEDNEGO NOWEGO KLUCZA ====================
--
-- Rola NIE WCHODZI do koperty odczytywanej po adresie. Wchodzi wyłącznie do
-- warunku WHERE — czyli tam, gdzie już siedzą `tenant_id` i `slug_published`.
-- To rozróżnienie jest całą treścią rozstrzygnięcia 1: klient nie dostaje ani
-- bajtu więcej niż dostawał, a odczyt przestaje móc trafić w wiersz, który nie
-- jest stroną. Nowa ścieżka odczytu (`app.get_published_product_template`)
-- oddaje kopertę o kształcie IDENTYCZNYM z `app.get_published_page`, więc
-- sklep parsuje ją tym samym schematem i nie powstaje drugi kształt do
-- pilnowania.
--
-- ========================= CZTERY ROZSTRZYGNIĘCIA =========================
--
-- 1. ROLA TO KOLUMNA, BO SLUG TEJ INFORMACJI UNIEŚĆ NIE MOŻE. Migracja 0073
--    ODRZUCIŁA kolumnę `kind` dla odróżnienia strony głównej i miała rację:
--    adresem strony głównej jest goły `/`, więc pusty slug niósł tę informację
--    ZA DARMO, a kolumna byłaby daną widoczną publicznie — czyli kompletem
--    ADR-091 (bliźniak `*_published`, wpis u strażnika, test) za informację,
--    którą już mieliśmy. Tutaj rachunek jest odwrotny i to jest powód, dla
--    którego ta migracja w ogóle istnieje:
--      • szablon NIE MA ADRESU, więc slug nie ma czego o nim powiedzieć;
--      • slug `product` jest NA LIŚCIE ZAREZERWOWANEJ (app.reserved_page_slugs)
--        i bramka `app.site_slug_guard` odrzuca go już przy INSERT (22023) —
--        wyjście wcześniej ma wyłącznie `tg_op = 'UPDATE'` przy niezmienionym
--        slugu, a trigger stoi na `before insert or update`;
--      • każdy inny slug dałby szablonowi PUBLICZNY ADRES, pod którym klient
--        zobaczyłby półprodukt z pustymi wiązaniami.
--    Enumeracja wszystkich `add column` na `sites` przez całą historię migracji
--    (`template`, `published_at`, `created_at`, `template_published`,
--    `style_draft`, `style_published`, `name`, `slug`, `slug_published`,
--    `redirect_old_slug`) nie daje ani jednej kolumny wolnej ani o właściwym
--    znaczeniu. Kolumna jest jedynym wyjściem, nie preferencją.
--
-- 2. ROLA NIE DOSTAJE BLIŹNIAKA `*_published`, I TO NIE JEST OSZCZĘDNOŚĆ.
--    Kanon ADR-091 chroni stan WIDOCZNY, który się ZMIENIA: treść, kolejność,
--    włączenie, szablon, adres, styl. Rola jest TOŻSAMOŚCIĄ wiersza — ustala
--    się przy utworzeniu i nie zmienia, więc nie ma czego publikować.
--    `app.guard_published_columns` wymienia chronione kolumny JAWNIE
--    (0073, sekcja 6), więc kolumna spoza tej listy jest poza jego
--    zainteresowaniem i funkcji nie trzeba dotykać.
--    Zamiast bliźniaka rola dostaje coś tańszego i mocniejszego: NIEZMIENNOŚĆ
--    (sekcja 4). Bliźniak pozwalałby roli się zmieniać i tylko odraczał skutek
--    do publikacji; niezmienność odbiera jej prawo do zmiany w ogóle — a to
--    jest dokładnie ta własność, którą deklarujemy zdaniem „rola jest
--    tożsamością". Deklaracja bez bramki byłaby komentarzem, nie regułą.
--
-- 3. JEDEN ŻYWY SZABLON NA NAJEMCĘ — UNIKAT CZĘŚCIOWY, NIE REGUŁA W AKCJI.
--    Ten sam powód, co przy żywej stronie w 0048 i przy żywym adresie w 0073:
--    odczyt publiczny jest `language sql returns jsonb`, więc przy dwóch
--    pasujących wierszach NIE PADA — cicho oddaje pierwszy wiersz
--    niesortowanego skanu. Bez indeksu „miks dwóch szablonów" nie byłby awarią
--    do zauważenia, tylko losowym wyborem przy każdym planie zapytania.
--    Szablon nie ma adresu, więc siada na pustym slugu — a tam siedzi strona
--    główna. Unikat `sites_live_slug_unique_idx` (0073) MUSI więc zejść
--    z drogi, inaczej najemca nie może mieć jednocześnie strony głównej
--    i szablonu. Rozwiązaniem są DWA indeksy częściowe zamiast jednego
--    szerszego (sekcja 3): każdy wyraża swój niezmiennik WPROST i każdy da się
--    obalić osobną mutacją. Indeks `(tenant_id, kind, slug_published)` dawałby
--    ten sam skutek POŚREDNIO — przez CHECK wymuszający pusty slug szablonu —
--    czyli niezmiennik szablonu przestałby być własnością indeksu i zacząłby
--    zależeć od tego, czy CHECK obok kiedyś nie zelżeje.
--
-- 4. SZABLON NIE MA ADRESU I MA TEGO NIE MÓC MIEĆ. CHECK wiąże rolę z pustym
--    slugiem po obu stronach (szkic i bliźniak). Bez niego operator mógłby
--    wpisać szablonowi adres, który nigdzie nie prowadzi: odczyt po adresie
--    i tak filtruje po roli, więc strona pod tym adresem oddawałaby 404, a
--    panel pokazywałby ścieżkę. To jest dokładnie ta klasa cichego kłamstwa
--    interfejsu, którą zamknęły ADR-171 i ADR-172.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): każda funkcja `app.*`
-- tworzona lub podmieniana w tym pliku dostaje `revoke all ... from public`
-- + jawne granty w TEJ SAMEJ migracji, z uzasadnieniem per rola.
--
-- CZEGO TA MIGRACJA NIE RUSZA: `app.publish_site` i `app.unpublish_site`
-- (szablon publikuje się i gaśnie tą samą drogą, co każda strona — `slug` ma
-- pusty, więc `slug_published = slug` daje pusty adres i nie ma tu żadnej
-- gałęzi do dopisania), `app.guard_published_columns` (patrz rozstrzygnięcie
-- 2), `app.record_slug_history` (trigger patrzy na zmianę `slug_published`,
-- a szablon idzie NULL → '' i wpada w gałąź `old.slug_published is not null
-- and <> ''`, czyli nie wstawia ani jednego wiersza historii), polityki RLS
-- `sites` (rola nie zmienia zasięgu wiersza — chroni go ten sam `tenant_id`),
-- granty tabel, `app.get_public_catalog`, `app.get_tenant_appearance`.

-- === BEGIN PROD MIGRATION 0080 ===

-- ---------------------------------------------------------------------
-- 1. sites.kind — ROLA wiersza
-- ---------------------------------------------------------------------
--
-- Tekst + CHECK, nie enum — wzorzec statusów z 0001/0007/0019. Enum wymagałby
-- `alter type` przy każdej kolejnej roli (kategorie z Fazy 7), a to jest
-- operacja, której nie da się cofnąć w tej samej transakcji.
--
-- `not null default 'page'` obsługuje wiersze istniejące bez osobnego
-- backfillu i jest całą treścią zdania „zero zmian widocznych": każdy warunek
-- `kind = 'page'` dołożony niżej jest dla wiersza zastanego prawdziwy.

alter table public.sites
  add column if not exists kind text not null default 'page';

alter table public.sites
  drop constraint if exists sites_kind_check;

alter table public.sites
  add constraint sites_kind_check
  check (kind in ('page', 'product'));

comment on column public.sites.kind is
  'ROLA wiersza strony (0080, ADR-178): `page` = zwykła strona sklepu pod własnym adresem (`sites.slug`), `product` = SZABLON strony pojedynczego sprzętu, renderowany raz na pozycję katalogu przez trasę /product/[id]. Lustro SITE_KINDS z @avably/core/site. Rola jest TOŻSAMOŚCIĄ wiersza: ustala się przy utworzeniu i nie zmienia (trigger sites_kind_guard), więc nie ma bliźniaka *_published — nie ma czego publikować. Do koperty odczytu publicznego NIE WCHODZI: bierze udział wyłącznie w warunku WHERE.';

-- ---------------------------------------------------------------------
-- 2. SZABLON NIE MA ADRESU — CHECK po obu stronach
-- ---------------------------------------------------------------------
--
-- Patrz rozstrzygnięcie 4 nagłówka. Dwa osobne CHECK-i, bo `slug`
-- i `slug_published` mają w tej tabeli osobne CHECK-i kształtu od 0073 —
-- odmowa ma wskazywać kolumnę, której dotyczy.
--
-- Gałąź `slug_published is null` jest konieczna: szablon nieopublikowany ma
-- bliźniaka pustego, a CHECK `sites_published_slug_complete` (0073) domyka to
-- z drugiej strony — szablon OPUBLIKOWANY musi mieć `slug_published`, czyli
-- pusty string.

alter table public.sites
  drop constraint if exists sites_product_template_no_slug;

alter table public.sites
  add constraint sites_product_template_no_slug
  check (kind = 'page' or slug = '');

alter table public.sites
  drop constraint if exists sites_product_template_no_slug_published;

alter table public.sites
  add constraint sites_product_template_no_slug_published
  check (kind = 'page' or slug_published is null or slug_published = '');

-- ---------------------------------------------------------------------
-- 3. DWA NIEZMIENNIKI, DWA INDEKSY CZĘŚCIOWE
-- ---------------------------------------------------------------------
--
-- Patrz rozstrzygnięcie 3 nagłówka.
--
-- Pierwszy indeks jest niezmiennikiem z 0073 ZAWĘŻONYM do stron: „najwyżej
-- jedna żywa STRONA najemcy pod danym adresem". Dla wierszy zastanych (wszystkie
-- mają `kind = 'page'`) predykat jest równoważny poprzedniemu co do zbioru, więc
-- migracja nie ma jak obalić żadnego istniejącego wiersza.
--
-- Drugi wyraża niezmiennik szablonu WPROST — bez kolumny `slug_published`
-- w kluczu, bo szablon nie ma adresu i nie ma po czym go rozróżniać. Klucz to
-- sam najemca: jeden żywy szablon, kropka.

drop index if exists public.sites_live_slug_unique_idx;

create unique index if not exists sites_live_slug_unique_idx
  on public.sites (tenant_id, slug_published)
  where published_at is not null and kind = 'page';

comment on index public.sites_live_slug_unique_idx is
  'Najwyżej JEDNA żywa STRONA najemcy pod danym adresem (0073 ADR-157, zawężony do roli `page` w 0080 ADR-178). Predykat jest lustrem warunku, którym app.get_published_page wybiera stronę — dwie żywe strony pod tym samym slugiem dałyby cichy, niedeterministyczny wybór, nie błąd. Szablon strony produktu stoi poza tym indeksem, bo nie ma adresu; jego niezmiennik pilnuje sites_live_product_template_idx.';

create unique index if not exists sites_live_product_template_idx
  on public.sites (tenant_id)
  where published_at is not null and kind = 'product';

comment on index public.sites_live_product_template_idx is
  'Najwyżej JEDEN żywy szablon strony produktu na najemcę (0080, ADR-178). Klucz to sam najemca, bo szablon nie ma adresu, po którym dałoby się rozróżnić dwa. Predykat jest lustrem warunku, którym app.get_published_product_template wybiera wiersz — bez indeksu dwa żywe szablony dałyby cichy wybór pierwszego wiersza niesortowanego skanu, dokładnie jak przed 0048.';

-- ---------------------------------------------------------------------
-- 4. app.site_kind_guard — ROLA JEST NIEZMIENNA
-- ---------------------------------------------------------------------
--
-- Patrz rozstrzygnięcie 2 nagłówka. Bez tej bramki zdanie „rola nie zmienia
-- się, więc nie potrzebuje bliźniaka" jest komentarzem, a nie regułą — a luka,
-- którą zostawia, jest dokładnie tej klasy, którą kanon ADR-091 zamyka:
--
--   • żywa STRONA GŁÓWNA (kind `page`, slug pusty) przełączona na `product`
--     znika z korzenia sklepu i W TEJ SAMEJ CHWILI staje się szablonem
--     wszystkich stron sprzętu — dwie zmiany widoczne publicznie, zero
--     zdarzeń publikacji;
--   • żywy SZABLON przełączony na `page` przejmuje adres `/`.
--
-- CHECK z sekcji 2 zatrzymuje wyłącznie przypadek strony z NIEPUSTYM slugiem.
-- Strona główna ma slug pusty, więc przechodzi przez niego bez oporu — to jest
-- powód, dla którego bramka musi istnieć osobno.
--
-- OSOBNA FUNKCJA, a nie gałąź w `app.guard_published_columns`: tamta jest
-- chroniona kompletem testów kanonu ADR-091 i mówi o kolumnach, które
-- PUBLIKACJA przenosi. Ta mówi o kolumnie, której NIE PRZENOSI NIKT.
-- Rozszerzanie tamtej o rozłączną odpowiedzialność kosztowałoby więcej,
-- niż daje (ten sam rachunek, co przy `app.guard_live_site_delete` w 0048).
--
-- SECURITY INVOKER (domyślny) świadomie: funkcja nie potrzebuje żadnego
-- przywileju ponad wołającego — porównuje dwie wartości z wiersza.
--
-- service_role PRZEPUSZCZANY — ta sama przepustka i to samo uzasadnienie, co
-- w 0045 i 0048: migracje, joby i sprzątanie testów jadą tą rolą, a rola
-- serwisowa nie jest powierzchnią, przed którą ten strażnik broni.
--
-- ODMOWA 42501: to jest reguła UPRAWNIENIA („tej kolumny nie zmienia nikt"),
-- a nie walidacja wartości — ten sam SQLSTATE, co u strażnika bliźniaków
-- i u strażnika kasowania żywej strony. Macierz izolacji RLS nie ma z tym
-- kolizji: jej patch na `sites` dotyczy kolumny `template`, więc `new.kind`
-- jest tam równe `old.kind` i bramka nie startuje.

create or replace function app.site_kind_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text :=
    'Roli strony nie można zmienić — załóż nową stronę we właściwej roli.';
begin
  if pg_has_role(current_user, 'service_role', 'USAGE') then
    return new;
  end if;

  if new.kind is distinct from old.kind then
    raise exception '%', c_denied using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function app.site_kind_guard() is
  'Strażnik ROLI strony (0080, ADR-178): sites.kind ustala się przy utworzeniu i nie zmienia. Bez tej bramki żywa strona główna dałaby się przełączyć w szablon strony produktu — dwie zmiany widoczne publicznie bez ani jednego zdarzenia publikacji, czyli dokładnie to, przed czym broni kanon ADR-091. Rola nie ma bliźniaka *_published właśnie dlatego, że jest niezmienna; ta funkcja jest drugą połową tamtej decyzji. Odmowa: 42501 — ten sam SQLSTATE co odmowa RLS i co strażnik kolumn opublikowanych.';

revoke all on function app.site_kind_guard() from public, anon, authenticated;

drop trigger if exists sites_kind_guard on public.sites;

create trigger sites_kind_guard
  before update on public.sites
  for each row execute function app.site_kind_guard();

-- ---------------------------------------------------------------------
-- 5. app.get_published_page — ODCZYT PO ADRESIE WIDZI WYŁĄCZNIE STRONY
-- ---------------------------------------------------------------------
--
-- Ciało przepisane z 0077 (OSTATNIA definicja w historii — 0074 jest starsza
-- i czyta wygląd z wiersza STRONY, a nie najemcy; przepisanie z niej cofnęłoby
-- cicho ADR-171). Jedyna różnica merytoryczna: `and s.kind = 'page'`.
--
-- DLACZEGO TEN WARUNEK JEST KONIECZNY, A NIE OSTROŻNOŚCIOWY. Szablon ma pusty
-- `slug_published` — czyli dokładnie ten sam adres, co strona główna. Bez tego
-- warunku żądanie korzenia sklepu trafiałoby w DWA wiersze, a funkcja
-- `language sql` cicho oddałaby pierwszy z niesortowanego skanu: najemca
-- z opublikowanym szablonem dostawałby pod `/` raz stronę główną, raz szablon
-- z pustymi wiązaniami — bez błędu i bez śladu.
--
-- ROLA NIE WCHODZI DO KOPERTY, tylko do warunku. Klucze odpowiedzi są co do
-- znaku te same, co przed migracją, więc kod sprzed wdrożenia parsuje ją
-- schematem `.strict()` bez zmian.
--
-- `s.kind` NIE JEST kolumną szkicu w rozumieniu strażnika strukturalnego
-- (packages/db/test/site-publication-gate.test.ts): kolumny szkicu to te,
-- które mają bliźniaka i których odczyt wypuściłby do sklepu niezapisany stan.
-- Rola bliźniaka nie ma i mieć nie może — jest tożsamością wiersza, tej samej
-- klasy co `s.id` i `s.tenant_id`, które ta funkcja czyta od 0019.

create or replace function app.get_published_page(p_tenant_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    -- Klucz BEZWARUNKOWY, parsowany po stronie sklepu `z.enum` — `null` kładzie
    -- stronę tak samo, jak klucz nieznany. `coalesce` na wartość domyślną
    -- rdzenia jest tu warunkiem OKNA WDROŻENIOWEGO, nie kosmetyką: najemca,
    -- który nigdy nie publikował wyglądu, ma dostać dokładnie to, co dostawał.
    'template', coalesce(t.template_published, 'classic'),
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
  --
  -- Nazwy kolumny szkicu NIE MA też w komentarzu, i to nie jest kosmetyka:
  -- strażnik strukturalny (packages/db/test) skanuje pg_get_functiondef, a ten
  -- oddaje ciało RAZEM z komentarzami. Wzmianka w komentarzu paliłaby bramkę,
  -- która ma pilnować ZAPYTANIA.
  || case
       when t.style_published = '{}'::jsonb then '{}'::jsonb
       else jsonb_build_object('style', t.style_published)
     end
  -- Znak firmy najemcy (ADR-160) — ten sam warunek i z tego samego powodu.
  || case
       when t.logo_published = '{}'::jsonb then '{}'::jsonb
       else jsonb_build_object('logo', t.logo_published)
     end
  from public.sites s
  join public.tenants t on t.id = s.tenant_id
  where s.tenant_id = p_tenant_id
    and s.kind = 'page'
    and s.slug_published = p_slug
    and s.published_at is not null
    and app.tenant_commercially_active(t.status);
$$;

comment on function app.get_published_page(uuid, text) is
  'Opublikowana STRONA najemcy POD WSKAZANYM ADRESEM (0074, ADR-158; znak firmy w ADR-160, wygląd sklepu w ADR-161; zawężenie do roli `page` w ADR-178): pusty slug = strona główna. Czyta WYŁĄCZNIE kolumny *_published (kanon ADR-091) i wyłącznie dla najemcy w oknie handlowym (0065). Szablon strony produktu ma ten sam pusty adres, co strona główna, więc bez warunku po roli korzeń sklepu trafiałby w dwa wiersze i oddawał pierwszy z niesortowanego skanu. SECURITY DEFINER — jedyną bramką izolacji są jawne filtry tenant_id/slug_published oraz warunek złączenia t.id = s.tenant_id, nie RLS. Koperta jest po stronie sklepu parsowana schematem .strict(), więc klucze `style` i `logo` dokładają się WARUNKOWO, a `template` przechodzi przez coalesce — pusta wartość nie zostawia po sobie klucza, a NULL nie ma jak trafić pod klucz bezwarunkowy.';

revoke all on function app.get_published_page(uuid, text) from public;
grant execute on function app.get_published_page(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. app.get_tenant_pages — REJESTR ADRESÓW WIDZI WYŁĄCZNIE STRONY
-- ---------------------------------------------------------------------
--
-- Ciało przepisane z 0075 (ostatnia definicja) z dwoma dołożonymi warunkami
-- `s.kind = 'page'` — po jednym w każdym z dwóch podzapytań.
--
-- Bez nich najemca z opublikowanym szablonem miałby w rejestrze pusty adres
-- DRUGI RAZ (albo — przy nieopublikowanej stronie głównej — pusty adres mimo
-- pustego korzenia), więc proxy uznałoby `/` za istniejącą stronę i wpuściło
-- żądanie na trasę, która po sekcji 5 oddaje 404. Rejestr ma mówić prawdę
-- o tym, co sklep NAPRAWDĘ pokazuje pod adresem.
--
-- Drugi warunek (gałąź `redirects`) jest ostrożnością konstrukcyjną, nie
-- ozdobą: historia adresów szablonu jest dziś niereprezentowalna (CHECK z
-- sekcji 2 wymusza pusty slug, a trigger historii pomija pusty stary adres),
-- ale rejestr nie ma prawa zależeć od tego, że dwie inne reguły dalej stoją.
--
-- Kształt koperty BEZ ZMIAN — zmienia się wyłącznie zawartość, więc okno
-- wdrożeniowe nie ma czego zepsuć w middleware.

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
          and s.kind = 'page'
          and s.published_at is not null
      ),
      '[]'::jsonb
    ),
    'redirects', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('from', h.slug, 'to', s.slug_published)
          order by h.slug
        )
        from public.site_slug_history h
        join public.sites s
          on s.tenant_id = h.tenant_id
         and s.id = h.site_id
        where h.tenant_id = p_tenant_id
          and s.kind = 'page'
          and s.published_at is not null
      ),
      '[]'::jsonb
    )
  )
  from public.tenants t
  where t.id = p_tenant_id
    and app.tenant_commercially_active(t.status);
$$;

comment on function app.get_tenant_pages(uuid) is
  'Rejestr ŻYWYCH adresów STRON najemcy dla proxy sklepu (0074/0075, ADR-158/159; zawężenie do roli `page` w ADR-178): {"pages": [slug...], "redirects": [{"from","to"}...]}. Pusty slug = strona główna. Szablon strony produktu do rejestru NIE WCHODZI — nie ma adresu, a jego pusty slug udawałby w rejestrze żywy korzeń sklepu. Przekierowanie wychodzi wyłącznie dla strony, która dalej jest żywa. NULL dla najemcy poza oknem handlowym. SECURITY DEFINER: bramką izolacji jest jawny filtr tenant_id, a nie RLS.';

revoke all on function app.get_tenant_pages(uuid) from public;
grant execute on function app.get_tenant_pages(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. app.get_published_product_template — ODCZYT PUBLICZNY SZABLONU
-- ---------------------------------------------------------------------
--
-- OSOBNA ŚCIEŻKA ODCZYTU, nie drugi argument `app.get_published_page`. Powody,
-- w kolejności wagi:
--
--   1. SZABLON NIE MA ADRESU, więc funkcja, której jedynym wejściem poza
--      najemcą jest adres, nie ma jak go wskazać. Domyślny argument znaczyłby
--      „adres, którego nie ma" — czyli sentinel w miejscu, w którym 0074
--      świadomie odmówiło nawet domyślki dla strony głównej.
--   2. WOŁAJĄCY SĄ ROZŁĄCZNI. Po adresie pyta trasa treściowa i proxy; o
--      szablon pyta WYŁĄCZNIE trasa `/product/[id]`. Jedna funkcja o dwóch
--      trybach zmuszałaby każdego czytelnika do sprawdzenia, w którym trybie
--      stoi jego wywołanie.
--   3. SYGNATURA ZASTANA ZOSTAJE NIETKNIĘTA — ten sam rachunek, co w 0074
--      przy `app.get_published_site`.
--
-- KOPERTA IDENTYCZNA CO DO KLUCZA z `app.get_published_page`: sklep parsuje
-- obie tym samym `parsePublishedSite`, więc nie powstaje drugi kształt do
-- pilnowania ani drugie miejsce, w którym degradacja sekcji mogłaby się
-- rozjechać. Wygląd i znak jadą tu z wiersza NAJEMCY (ADR-171) dokładnie tak,
-- jak w odczycie po adresie — szablon jest stroną tego samego sklepu.
--
-- Ciało jest KOPIĄ ciała z sekcji 5 z jedną różnicą w warunku: `s.kind =
-- 'product'` zamiast pary `s.kind = 'page' and s.slug_published = p_slug`.
-- Kopia, a nie wywołanie rdzenia, świadomie: rdzeniem jest funkcja, której
-- definicję skanują strażniki strukturalne (packages/db/test) w poszukiwaniu
-- odczytu kolumn szkicu. Zamiana jej w cienką owijkę przeniosłaby zapytanie
-- poza zasięg tych bramek i zostawiła je zielone nad pustką. Ta funkcja
-- dostaje własnego strażnika tej samej klasy (site-product-template.test.ts).
--
-- IZOLACJA STOI NA JAWNYM ZAWĘŻENIU, NIE NA RLS — funkcja jest SECURITY
-- DEFINER, więc polityki w niej nie uczestniczą. Wiersz szablonu wchodzi
-- WYŁĄCZNIE przez `s.tenant_id = p_tenant_id`, a wiersz najemcy wyłącznie
-- przez `t.id = s.tenant_id`. Złożenie tych dwóch warunków jest jedynym
-- powodem, dla którego szablon najemcy A nie ma jak wyjść na sklep najemcy B.

create or replace function app.get_published_product_template(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'template', coalesce(t.template_published, 'classic'),
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
  || case
       when t.style_published = '{}'::jsonb then '{}'::jsonb
       else jsonb_build_object('style', t.style_published)
     end
  || case
       when t.logo_published = '{}'::jsonb then '{}'::jsonb
       else jsonb_build_object('logo', t.logo_published)
     end
  from public.sites s
  join public.tenants t on t.id = s.tenant_id
  where s.tenant_id = p_tenant_id
    and s.kind = 'product'
    and s.published_at is not null
    and app.tenant_commercially_active(t.status);
$$;

comment on function app.get_published_product_template(uuid) is
  'Opublikowany SZABLON STRONY PRODUKTU najemcy (0080, ADR-178) — treść, którą trasa /product/[id] renderuje raz na pozycję katalogu, podając rekord pozycji jako kontekst wiązań `pageProduct` (ADR-163). Czyta WYŁĄCZNIE kolumny *_published (kanon ADR-091) i wyłącznie dla najemcy w oknie handlowym (0065). NULL = najemca nie ma opublikowanego szablonu; sklep oddaje wtedy wbudowaną stronę sprzętu, bo wdrożenie nie ma prawa zabrać działającej funkcji. Koperta identyczna co do klucza z app.get_published_page — storefront parsuje obie tym samym schematem .strict(). SECURITY DEFINER: jedyną bramką izolacji są jawne filtry tenant_id/kind oraz warunek złączenia t.id = s.tenant_id, nie RLS.';

revoke all on function app.get_published_product_template(uuid) from public;
-- anon: to JEST publiczny odczyt sklepu — jedyna droga szablonu do przeglądarki
-- klienta najemcy, ta sama co app.get_published_page (ADR-041/158).
-- authenticated: podgląd panelu chodzi tą samą funkcją co sklep, żeby nie
-- powstała druga ścieżka odczytu.
grant execute on function app.get_published_product_template(uuid) to anon, authenticated;

-- === END PROD MIGRATION 0080 ===
