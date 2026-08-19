-- =====================================================================
-- 0088 — WŁASNA STRONA WYBRANEGO PRODUKTU: WYJĄTEK OD SZABLONU (ADR-199)
-- =====================================================================
--
-- Faza 6 architektury kreatora (dokument 2026-08-12, §4/§5), FAZA A z dwóch:
-- schemat + rozstrzyganie w sklepie. Do tej migracji najemca miał JEDEN
-- szablon strony sprzętu na cały katalog (0080, ADR-178). Ta migracja daje
-- mu WYJĄTEK: osobny wiersz `sites`, przypisany produktowi PO ID, który —
-- gdy jest opublikowany — wygrywa z szablonem-matką na stronie tego jednego
-- produktu. Kreator forka i panel liczników to FAZA B (osobne zadanie).
--
-- MIGRACJA BEZ ANI JEDNEJ ZMIANY WIDOCZNEJ. Kolumna `product_id` rodzi się
-- NULL-em dla wszystkich wierszy zastanych, każdy dołożony niżej warunek jest
-- dla nich prawdziwy, a nowa sygnatura funkcji odczytu ma drugi argument
-- Z DOMYŚLKĄ — stary kod w oknie wdrożeniowym woła po staremu i dostaje
-- dokładnie to, co dostawał: szablon-matkę (wzorzec 0074/0079/0083).
--
-- ========================= PIĘĆ ROZSTRZYGNIĘĆ =========================
--
-- 1. WYJĄTEK TO OSOBNY WIERSZ `sites`, NIE NADPISANIE NA PRODUKCIE.
--    Wiersz `sites` dziedziczy CAŁY istniejący potok publikacji: draft/publish
--    (`app.publish_site`/`app.unpublish_site`), strażnika kolumn
--    opublikowanych, strażnika kasowania żywej strony, kreator po siteId.
--    Kolumna na `products` musiałaby ten potok zbudować od nowa.
--    Wyjątek ⇔ `kind = 'product' AND product_id IS NOT NULL`; szablon-matka
--    ma `product_id IS NULL`. `product_id` jest TOŻSAMOŚCIĄ wiersza jak
--    `kind`: ustala się przy utworzeniu i nie zmienia, więc nie dostaje
--    bliźniaka `*_published` (dokładnie ten sam rachunek, co przy roli
--    w 0080, rozstrzygnięcie 2). Do koperty publicznego odczytu NIE wchodzi —
--    bierze udział wyłącznie w warunku WHERE.
--
-- 2. FK ZŁOŻONY (tenant_id, product_id) → products (tenant_id, id),
--    ON DELETE CASCADE. Klucz złożony to wzorzec każdej tabeli-dziecka
--    produktu (0007/0018/0083): wyjątek wskazujący produkt INNEGO najemcy
--    jest niereprezentowalny na poziomie constraintu, zanim jakakolwiek
--    polityka zdąży się wypowiedzieć. Kaskada, bo model usuwania produktu
--    ZAOBSERWOWANY w repo ma hard delete: `grant delete on public.products`
--    + polityka `tenant_delete` (0007, zawężona w 0060) — panel dziś usuwa
--    wyłącznie przez `active = false`, ale baza usuwa naprawdę i wszystkie
--    tabele-dzieci produktu kaskadują. Strona produktu, którego nie ma, nie
--    ma racji bytu. NIE `set null` — zrobiłby z wyjątku DRUGĄ matkę
--    (`product_id` null) i złamał unikat z rozstrzygnięcia 4.
--    Złożenie z 0048/0078 ZMIERZONE, nie założone: kaskada z produktu zdejmuje
--    także wyjątek ŻYWY, bo trigger więzów referencyjnych wykonuje DELETE
--    w kontekście WŁAŚCICIELA tabeli (postgres, członek service_role) — czyli
--    dokładnie tym kanałem, który `app.guard_live_site_delete` przepuszcza
--    Z NAZWY od 0048 („kasuje wyłącznie rola serwisowa (kaskada z tenants)").
--    To jest zachowanie właściwe: strona żyje wyłącznie pod adresem produktu,
--    więc z chwilą jego zniknięcia nie ma ani adresu, ani treści do ochrony —
--    a odmowa robiłaby z usunięcia produktu operację dwustopniową bez zysku.
--
-- 3. NIEZMIENNOŚĆ `product_id` EGZEKWUJE TEN SAM STRAŻNIK, CO ROLI.
--    `app.site_kind_guard` dostaje drugą gałąź zamiast bliźniaczego triggera:
--    obie kolumny są tożsamością wiersza, obie chroni ta sama reguła („nie
--    zmienia nikt"), ten sam SQLSTATE 42501 i ta sama przepustka serwisowa.
--    Drugi trigger o identycznym ciele różniłby się wyłącznie nazwą kolumny —
--    czyli byłby kopią czekającą na rozjazd. Pułapka z 0080 obowiązuje obie
--    gałęzie: patch NIEDOTYKAJĄCY kolumny przechodzi (`is distinct from`),
--    inaczej `app.publish_site` umarłby na pierwszym UPDATE.
--
-- 4. DWA UNIKATY CZĘŚCIOWE ZAMIAST JEDNEGO SZERSZEGO (rachunek z 0080 R3):
--      • `sites_live_product_template_idx` ZAWĘŻONY o `product_id is null` —
--        najwyżej jeden żywy szablon-MATKA na najemcę; dla wierszy zastanych
--        (wszystkie mają `product_id` null) zbiór jest ten sam co przed
--        migracją, więc nie ma czego obalić;
--      • nowy `sites_live_product_exception_idx (tenant_id, product_id)` dla
--        żywych wyjątków — najwyżej JEDEN żywy wyjątek na produkt. Bez niego
--        dwa żywe wyjątki tego samego produktu dałyby cichy wybór pierwszego
--        wiersza niesortowanego skanu, dokładnie jak przed 0048.
--
-- 5. LIMIT 5 WYJĄTKÓW NA NAJEMCĘ EGZEKWUJE BAZA (trigger BEFORE INSERT —
--    CHECK nie policzy wierszy). Limit liczy PRODUKTY z własną stroną
--    (count distinct product_id), nie wiersze: drugi szkic dla produktu,
--    który już ma wyjątek, nie zjada limitu — jest przeróbką tego samego
--    wyjątku, nie nowym. Odmowa SQLSTATE **PT409** i to jest wynik POMIARU,
--    nie preferencji: plan zakładał własny kod klasy P (wzorzec P0002 —
--    „limit 2 organizacji"), ale PostgREST mapuje na HTTP wyłącznie P0001,
--    a KAŻDY inny kod P0xxx oddaje jako 500 z ciałem zamaskowanym do
--    „Something went wrong" — zmierzone sondą na wprost na PostgREST
--    lokalnego stacka, z pominięciem Konga. Odmowa limitu wyglądałaby jak
--    awaria serwera i nie niosłaby ani kodu, ani komunikatu. Konwencja
--    PTnnn to udokumentowany kanał PostgREST na własny status HTTP: klient
--    dostaje 409 (ta sama klasa, co unikaty 23505) z kodem `PT409`,
--    komunikatem PO POLSKU i hintem-tokenem `sites_product_exception_limit`
--    dla panelu fazy B (dopasowanie po hincie, nie po treści zdania).
--    SECURITY INVOKER świadomie: zliczenie idzie pod RLS wołającego, więc
--    napastnik wstrzykujący wiersz w cudzego najemcę zliczy zero i NIE
--    zabierze macierzy izolacji jej 42501 (pułapka opisana przy fabrykach
--    macierzy RLS). Wyścig dwóch równoległych INSERT-ów zamyka blokada
--    advisory per najemca (wzorzec numeracji zamówień z 0007). Rola
--    serwisowa przepuszczana — seedy, migracje i sprzątanie testów jadą
--    nią, a limit jest regułą produktu, nie bezpieczeństwa.
--
-- ROZSTRZYGANIE W SKLEPIE: WYJĄTEK > SZABLON-MATKA > STRONA WBUDOWANA.
-- `app.get_published_product_template` dostaje drugi parametr
-- `p_product_id uuid default null`. Zmiana sygnatury wymaga DROP + CREATE
-- (`create or replace` nie podmienia funkcji o innej liście argumentów —
-- precedens 0016/0029/0044), więc granty wracają w tym samym pliku.
-- Ciało przepisane z 0080 (JEDYNA i zarazem ostatnia definicja w historii
-- migracji) z dwiema różnicami: warunek wyboru wiersza i jawne
-- `order by … limit 1` — z chwilą, gdy wyjątek i matka mogą pasować oba,
-- „pierwszy wiersz niesortowanego skanu" przestaje być deterministyczny
-- i priorytet musi być WŁASNOŚCIĄ zapytania. Trzeci szczebel drabiny
-- (strona wbudowana) pozostaje po stronie sklepu: NULL z tej funkcji znaczy
-- „oddaj stronę wbudowaną" — dokładnie jak przed migracją. Stały blok góry
-- strony (ADR-189) stoi PRZED rozgałęzieniem w renderze, więc żaden wynik
-- tej funkcji nie ma jak go zdjąć.
--
-- CZEGO TA MIGRACJA NIE RUSZA: `app.publish_site` / `app.unpublish_site`
-- (wyjątek publikuje się i gaśnie tą samą drogą, co każda strona),
-- `app.guard_published_columns` (tożsamość nie jest stanem publikowanym),
-- `app.get_published_page` i `app.get_tenant_pages` (filtrują `kind='page'`,
-- więc wyjątek — `kind='product'` — jest dla nich niewidzialny tak samo jak
-- matka), CHECK-i pustego sluga z 0080 (wyjątek dziedziczy je po roli:
-- adresem strony wyjątku jest adres PRODUKTU `/produkt/{slug}`, nie własny),
-- `app.get_public_product` / `app.get_public_catalog` (pozycja nieaktywna
-- dalej nie wychodzi do sklepu, więc wyjątek produktu zdezaktywowanego jest
-- nieszkodliwy — trasa nigdy o niego nie zapyta), polityki RLS `sites`
-- (nowa kolumna nie zmienia zasięgu wiersza — chroni go ten sam tenant_id),
-- granty tabel.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): funkcja podmieniana
-- dostaje `revoke all ... from public` + jawne granty w TEJ SAMEJ migracji,
-- z uzasadnieniem per rola.

-- === BEGIN PROD MIGRATION 0088 ===

-- ---------------------------------------------------------------------
-- 1. sites.product_id — PRZYPISANIE wyjątku do produktu (po ID, nie slugu)
-- ---------------------------------------------------------------------
--
-- Po ID, NIGDY po slugu (§4 zab. 2 dokumentu architektury): slug jest
-- adresem, nie kluczem — zmiana adresu produktu nie ma prawa cicho zrzucić
-- jego strony na szablon ogólny.

alter table public.sites
  add column if not exists product_id uuid;

alter table public.sites
  drop constraint if exists sites_product_exception_fk;

alter table public.sites
  add constraint sites_product_exception_fk
  foreign key (tenant_id, product_id)
  references public.products (tenant_id, id)
  on delete cascade;

-- Wyjątek jest reprezentowalny WYŁĄCZNIE w roli `product`. Strona treściowa
-- z przypiętym produktem nie znaczy nic w żadnej ścieżce odczytu — a wiersz,
-- którego nie czyta nikt, jest dokładnie tą klasą cichego stanu, którą CHECK-i
-- 0080 zamykają dla sluga szablonu.

alter table public.sites
  drop constraint if exists sites_product_exception_kind_check;

alter table public.sites
  add constraint sites_product_exception_kind_check
  check (product_id is null or kind = 'product');

comment on column public.sites.product_id is
  'PRZYPISANIE strony do produktu (0088, ADR-199): NULL = wiersz nie jest wyjątkiem (strona treściowa albo szablon-matka strony produktu); NOT NULL (dozwolone tylko przy kind=''product'') = WYJĄTEK — własna strona TEGO produktu, wygrywająca w sklepie z szablonem-matką. Przypisanie idzie po ID, nigdy po slugu (slug jest adresem, nie kluczem). Tożsamość wiersza jak kind: niezmienna po utworzeniu (trigger sites_kind_guard, 42501), bez bliźniaka *_published, do koperty odczytu publicznego nie wchodzi — bierze udział wyłącznie w WHERE. FK złożony (tenant_id, product_id) z ON DELETE CASCADE: wyjątek cudzego produktu jest niereprezentowalny, a twarde usunięcie produktu zabiera jego stronę — TAKŻE żywą, bo kaskada wykonuje się w kontekście właściciela tabeli i przechodzi przepustką serwisową app.guard_live_site_delete (ten sam kanał, co kaskada z tenants — zmierzone, nie założone).';

-- ---------------------------------------------------------------------
-- 2. DWA NIEZMIENNIKI ŻYWYCH WIERSZY ROLI `product`
-- ---------------------------------------------------------------------
--
-- Patrz rozstrzygnięcie 4 nagłówka. Kolejność jest częścią poprawności:
-- najpierw drop starego indeksu matki, potem oba nowe — `create unique index`
-- na zbiorze łamiącym niezmiennik padłby, więc każdy z tych kroków jest
-- także mimowolną asercją o stanie danych produkcji.

drop index if exists public.sites_live_product_template_idx;

create unique index if not exists sites_live_product_template_idx
  on public.sites (tenant_id)
  where published_at is not null and kind = 'product' and product_id is null;

comment on index public.sites_live_product_template_idx is
  'Najwyżej JEDEN żywy szablon-MATKA strony produktu na najemcę (0080 ADR-178, zawężony o product_id is null w 0088 ADR-199). Klucz to sam najemca, bo matka nie ma adresu ani przypisania, po których dałoby się rozróżnić dwie. Predykat jest lustrem gałęzi matki w app.get_published_product_template; żywe WYJĄTKI stoją poza tym indeksem — ich niezmiennik pilnuje sites_live_product_exception_idx.';

create unique index if not exists sites_live_product_exception_idx
  on public.sites (tenant_id, product_id)
  where published_at is not null and kind = 'product' and product_id is not null;

comment on index public.sites_live_product_exception_idx is
  'Najwyżej JEDEN żywy WYJĄTEK strony produktu na produkt (0088, ADR-199). Predykat jest lustrem gałęzi wyjątku w app.get_published_product_template — dwa żywe wyjątki tego samego produktu dałyby cichy, niedeterministyczny wybór wiersza, nie błąd (ta sama klasa, co przed 0048). Wyjątki-szkice tego samego produktu są legalne — niezmiennik jest częściowy świadomie, jak każdy unikat publikacji od 0048.';

-- ---------------------------------------------------------------------
-- 3. app.site_kind_guard — TOŻSAMOŚĆ WIERSZA TO ODTĄD PARA (kind, product_id)
-- ---------------------------------------------------------------------
--
-- Ciało przepisane z 0080 (jedyna i zarazem ostatnia definicja) z dołożoną
-- drugą gałęzią. Patrz rozstrzygnięcie 3 nagłówka. Bez tej gałęzi „wyjątek
-- jest przypięty po ID" byłoby komentarzem: jeden UPDATE przepinałby żywą
-- stronę produktu A pod produkt B — zmiana widoczna publicznie na DWÓCH
-- stronach sklepu naraz, bez ani jednego zdarzenia publikacji. To jest
-- dokładnie luka, którą kanon ADR-091 zamyka dla treści, a 0080 dla roli.
--
-- Obie gałęzie porównują przez IS DISTINCT FROM i odmawiają wyłącznie przy
-- RZECZYWISTEJ zmianie — patch niedotykający tożsamości (publikacja, zmiana
-- nazwy, macierz RLS z patchem na `template`) przechodzi bez oporu.

create or replace function app.site_kind_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  c_denied_kind constant text :=
    'Roli strony nie można zmienić — załóż nową stronę we właściwej roli.';
  c_denied_product constant text :=
    'Przypisania strony do produktu nie można zmienić — przywróć produktowi szablon wspólny i załóż nową stronę.';
begin
  if pg_has_role(current_user, 'service_role', 'USAGE') then
    return new;
  end if;

  if new.kind is distinct from old.kind then
    raise exception '%', c_denied_kind using errcode = '42501';
  end if;

  if new.product_id is distinct from old.product_id then
    raise exception '%', c_denied_product using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function app.site_kind_guard() is
  'Strażnik TOŻSAMOŚCI wiersza strony (0080 ADR-178 dla sites.kind, rozszerzony w 0088 ADR-199 o sites.product_id): obie kolumny ustalają się przy utworzeniu i nie zmieniają. Bez gałęzi roli żywa strona główna dałaby się przełączyć w szablon; bez gałęzi przypisania żywy wyjątek dałby się przepiąć pod inny produkt — w obu razach zmiana widoczna publicznie bez zdarzenia publikacji, czyli luka klasy ADR-091. Żadna z kolumn nie ma bliźniaka *_published właśnie dlatego, że jest niezmienna; ta funkcja jest drugą połową tamtej decyzji. Odmowa: 42501 — ten sam SQLSTATE co odmowa RLS. Patch niedotykający tożsamości przechodzi (IS DISTINCT FROM).';

revoke all on function app.site_kind_guard() from public, anon, authenticated;

-- Trigger z 0080 stoi i wskazuje tę funkcję — podmiana ciała wystarcza.

-- ---------------------------------------------------------------------
-- 4. LIMIT 5 WYJĄTKÓW NA NAJEMCĘ — trigger, bo CHECK nie policzy wierszy
-- ---------------------------------------------------------------------
--
-- Patrz rozstrzygnięcie 5 nagłówka. Licznik „X z 5" w panelu to faza B;
-- ta bramka jest jego jedyną PRAWDĄ — UI bez bazy byłby prośbą, nie regułą.

create or replace function app.site_product_exception_limit_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  c_limit constant int := 5;
  c_denied constant text :=
    'Limit 5 produktów z własną stroną został osiągnięty — przywróć któremuś produktowi szablon wspólny.';
  -- Token maszynowy dla panelu fazy B: dopasowanie po hincie, nie po treści
  -- polskiego zdania, które ma prawo się zmieniać.
  c_hint constant text := 'sites_product_exception_limit';
  v_products_with_exception int;
begin
  if pg_has_role(current_user, 'service_role', 'USAGE') then
    return new;
  end if;

  if new.kind <> 'product' or new.product_id is null then
    return new;
  end if;

  -- Dwa równoległe INSERT-y zliczyłyby ten sam stan „4" i oba by przeszły —
  -- blokada advisory per najemca serializuje bramkę (wzorzec numeracji
  -- zamówień z 0007). Zasięg transakcyjny: zwalnia się sama.
  perform pg_advisory_xact_lock(
    hashtextextended('sites_product_exception:' || new.tenant_id::text, 0)
  );

  -- COUNT DISTINCT produktów, nie wierszy, i z wyłączeniem produktu
  -- wstawianego wiersza: drugi szkic dla produktu, który już ma wyjątek,
  -- nie jest nowym wyjątkiem. SECURITY INVOKER — zliczenie idzie pod RLS
  -- wołającego (patrz rozstrzygnięcie 5: napastnik zliczy zero i macierz
  -- izolacji zachowa swoje 42501).
  select count(distinct s.product_id)
    into v_products_with_exception
    from public.sites s
   where s.tenant_id = new.tenant_id
     and s.kind = 'product'
     and s.product_id is not null
     and s.product_id <> new.product_id;

  if v_products_with_exception >= c_limit then
    raise exception '%', c_denied using errcode = 'PT409', hint = c_hint;
  end if;

  return new;
end;
$$;

comment on function app.site_product_exception_limit_guard() is
  'Limit 5 produktów z własną stroną na najemcę (0088, ADR-199; §4 dokumentu architektury: „wyjątek, którego nie da się policzyć, przestaje być wyjątkiem"). BEFORE INSERT na wierszu wyjątku (kind=product, product_id not null): zlicza DISTINCT produkty z wyjątkiem — drugi szkic dla już policzonego produktu limitu nie zjada. Odmowa: PT409 z hintem sites_product_exception_limit — konwencja PTnnn PostgREST-a, bo ZMIERZONE (sondą na wprost na PostgREST): każdy kod P0xxx poza P0001 wychodzi jako zamaskowane 500 „Something went wrong", bez kodu i bez komunikatu; PT409 oddaje 409 z kodem, polskim zdaniem i hintem-tokenem dla panelu fazy B. SECURITY INVOKER świadomie: zliczenie pod RLS wołającego, więc INSERT w cudzego najemcę zliczy zero i dostanie swoje 42501 od RLS, nie odmowę limitu od tej bramki. Wyścig zamyka pg_advisory_xact_lock per najemca. Rola serwisowa przepuszczana (seedy, sprzątanie) — limit jest regułą produktu, nie bezpieczeństwa.';

revoke all on function app.site_product_exception_limit_guard() from public, anon, authenticated;

drop trigger if exists sites_product_exception_limit on public.sites;

create trigger sites_product_exception_limit
  before insert on public.sites
  for each row execute function app.site_product_exception_limit_guard();

-- ---------------------------------------------------------------------
-- 5. app.get_published_product_template — WYJĄTEK > MATKA > NULL
-- ---------------------------------------------------------------------
--
-- Patrz blok „ROZSTRZYGANIE W SKLEPIE" nagłówka. Ciało przepisane z 0080
-- (JEDYNA definicja w historii — sprawdzone grepem po wszystkich migracjach);
-- koperta co do klucza NIETKNIĘTA, więc parsuje ją ten sam `parsePublishedSite`
-- i ten sam strażnik strukturalny pilnuje, że czyta wyłącznie stan
-- opublikowany. DROP konieczny: zmiana listy argumentów, `create or replace`
-- zostawiłby DWIE funkcje i PostgREST odmówiłby wyboru między nimi.

drop function if exists app.get_published_product_template(uuid);

create or replace function app.get_published_product_template(
  p_tenant_id uuid,
  p_product_id uuid default null
)
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
    and app.tenant_commercially_active(t.status)
    -- DRABINA: żywy WYJĄTEK wskazanego produktu albo żywa MATKA. Bez wskazania
    -- produktu (okno wdrożeniowe, stary kod) pasuje wyłącznie matka — czyli
    -- dokładnie zbiór sprzed 0088.
    and (
      (p_product_id is not null and s.product_id = p_product_id)
      or s.product_id is null
    )
  -- PRIORYTET JEST WŁASNOŚCIĄ ZAPYTANIA, nie przypadkiem skanu: z chwilą, gdy
  -- pasować mogą DWA wiersze, funkcja `language sql` bez sortowania oddawałaby
  -- pierwszy z niesortowanego skanu (ta sama klasa, co przed 0048).
  order by (s.product_id is not null) desc
  limit 1;
$$;

comment on function app.get_published_product_template(uuid, uuid) is
  'Opublikowana strona sprzętu najemcy dla trasy /produkt (0080 ADR-178; rozstrzyganie wyjątku w 0088 ADR-199): żywy WYJĄTEK wskazanego produktu (kind=product, product_id=p_product_id) wygrywa z żywym szablonem-MATKĄ (product_id null); NULL = sklep oddaje stronę wbudowaną — trzeci szczebel drabiny stoi w kodzie sklepu, nie tutaj. `p_product_id default null` to okno wdrożeniowe: stary kod woła po staremu i dostaje matkę, czyli zbiór sprzed 0088. Czyta WYŁĄCZNIE kolumny *_published (kanon ADR-091) i wyłącznie dla najemcy w oknie handlowym (0065). Koperta identyczna co do klucza z app.get_published_page — storefront parsuje obie tym samym schematem .strict(); product_id do koperty NIE wchodzi. SECURITY DEFINER: jedyną bramką izolacji są jawne filtry s.tenant_id = p_tenant_id / kind oraz warunek złączenia t.id = s.tenant_id, nie RLS; wyjątek cudzego najemcy nie przejdzie też przez FK złożony (tenant_id, product_id).';

revoke all on function app.get_published_product_template(uuid, uuid) from public;
-- anon: to JEST publiczny odczyt sklepu — jedyna droga treści strony sprzętu
-- do przeglądarki klienta najemcy, ta sama co app.get_published_page
-- (ADR-041/158, granty identyczne z 0080 — DROP je zdjął, więc wracają tutaj).
-- authenticated: podgląd panelu chodzi tą samą funkcją co sklep, żeby nie
-- powstała druga ścieżka odczytu.
grant execute on function app.get_published_product_template(uuid, uuid) to anon, authenticated;

-- === END PROD MIGRATION 0088 ===
