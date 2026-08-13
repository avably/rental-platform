-- =====================================================================
-- 0077 — WYGLĄD SKLEPU JEST WŁASNOŚCIĄ NAJEMCY, NIE PODSTRONY (ADR-161)
-- =====================================================================
--
-- Ta migracja przenosi SZABLON i STYL z wiersza strony na wiersz najemcy —
-- dokładnie tą samą drogą, którą 0076 przeniosło znak firmy.
--
-- ============== CO SIĘ ZEPSUŁO I KIEDY ==============
--
-- `sites.template`, `sites.template_published`, `sites.style_draft`
-- i `sites.style_published` (0019, 0046) były POPRAWNE dopóki wiersz `sites`
-- znaczył WERSJĘ jednej strony sklepu (0048 opisuje `name` wprost jako „nazwa
-- wersji widoczna wyłącznie w panelu"). Wersje wykluczały się nawzajem, więc
-- „styl wersji" i „styl sklepu" były tym samym zdaniem.
--
-- FAZA 2 (0073–0075, ADR-157/158/159) zamieniła wersje w osobne STRONY:
-- kontakt, „o nas", landingi miast — współistniejące, każda pod własnym
-- adresem. W tej samej chwili, bez ani jednej linijki o wyglądzie, szablon
-- i styl stały się ustawieniem PER PODSTRONA. Najemca dostał nagłówek, który
-- zmienia krój i kolor przy przejściu z „O nas" na „Kontakt", i N źródeł prawdy
-- o tym, jak wygląda jego sklep. To jest niezamierzony skutek uboczny fazy 2,
-- nie decyzja projektowa — i to samo rozpoznanie, które ADR-160 zrobiło dla
-- logo, tydzień wcześniej i o jedną kolumnę za wąsko.
--
-- ============== DLACZEGO TENANT, A NIE STRONA ==============
--
-- Szablon i styl to TOŻSAMOŚĆ SKLEPU, nie właściwość podstrony. Klient wchodzi
-- na jeden sklep, a nie na sześć niezależnych stron, które przypadkiem stoją
-- pod jednym adresem. Para kolumn na `public.tenants` w kanonie ADR-091
-- (bliźniak opublikowany + wpis u strażnika kolumn opublikowanych + test,
-- wszystko w TEJ SAMEJ migracji) jest tu tym samym rozwiązaniem, co dla znaku
-- firmy — łącznie z uzasadnieniem, dla którego to KOLUMNA, a nie tabela
-- ustawień: strażnik `app.guard_published_columns` porównuje `new.<kolumna>`
-- z `old.<kolumna>`, a na tabeli klucz→jsonb nie ma czego porównać.
--
-- ============== CO SIĘ DZIEJE Z WARTOŚCIAMI ZASTANYMI ==============
--
-- Sekcja 2. Wartość ze STRONY GŁÓWNEJ (slug pusty) jest tą, która przeżywa —
-- bo to ona odpowiada za pierwsze wrażenie sklepu i to ona jest tą stroną,
-- którą najemca stylował świadomie. Najemca z dwiema stronami o różnym stylu
-- traci styl strony niegłównej: po tej migracji jego „Kontakt" wygląda tak, jak
-- jego strona główna. To jest CEL, a nie koszt uboczny — dwa różne wyglądy
-- w jednym sklepie są dokładnie tą awarią, którą ta migracja zamyka.
--
-- ============== OKNO WDROŻENIOWE: DWIE OSTRE KRAWĘDZIE ==============
--
-- Koperta odczytu publicznego jest po stronie sklepu parsowana schematem
-- `.strict()` (packages/core/src/site/index.ts), a migracje wchodzą na produkcję
-- PRZED kodem. Stary sklep musi przeżyć tę migrację bez jednej zmiany bajtu.
--
-- KRAWĘDŹ 1 — klucz `style` dokłada się WARUNKOWO, przez porównanie z pustym
-- obiektem. Takie porównanie WYMAGA kolumny `not null default '{}'`: kolumna
-- dopuszczająca NULL oddaje w nim NULL zamiast prawdy, `case` wpada w gałąź
-- przeciwną i koperta `.strict()` wywraca KAŻDĄ stronę KAŻDEGO sklepu na czas
-- okna. Obie kolumny stylu niżej są więc `not null default '{}'::jsonb`.
--
-- KRAWĘDŹ 2 — klucz `template` jest w kopercie BEZWARUNKOWY i parsowany
-- `z.enum`, więc `null` pod tym kluczem kładzie stronę tak samo skutecznie, jak
-- klucz nieznany. `template_published` jest NULLOWALNY (lustro `sites`: NULL
-- znaczy „nigdy nieopublikowany"), więc odczyt bierze go przez
-- `coalesce(…, 'classic')` — a `classic` to nie liczba z sufitu, tylko wartość
-- `DEFAULT_THEME` z rdzenia i default kolumny na `sites` od 0019. Najemca,
-- który nigdy niczego nie zapisał, dostaje więc kopertę CO DO BAJTU taką, jaką
-- dostawał przed tą migracją.
--
-- ============== CZEGO TA MIGRACJA NIE ROBI ==============
--
-- NIE KASUJE kolumn na `sites` i NIE RUSZA `app.publish_site`. W oknie
-- wdrożeniowym stary panel dalej pisze `sites.style_draft` i dalej woła
-- `app.publish_site` — skasowanie kolumn albo zmiana tej funkcji wywróciłaby mu
-- zapis i publikację, czyli zamieniła okno „sklep wygląda jak wyglądał" w okno
-- „operator nie może pracować". Kolumny zostają martwe (komentarz w sekcji 7)
-- i schodzą osobną migracją, gdy kod będzie już wdrożony.

-- === BEGIN PROD MIGRATION 0077 ===

-- ---------------------------------------------------------------------
-- 1. Cztery kolumny na public.tenants
-- ---------------------------------------------------------------------
--
-- Nazwy są LUSTREM kolumn na `sites` i to jest decyzja, nie zbieg okoliczności:
-- strażniki strukturalne w testach (skan `pg_get_functiondef` po nazwie kolumny
-- szkicu) chodzą po nazwach, więc ta sama nazwa po obu stronach znaczy, że
-- bramka „odczyt publiczny nie czyta szkicu" broni obu tabel naraz, bez ani
-- jednej nowej reguły.

alter table public.tenants
  add column if not exists template text not null default 'classic';

alter table public.tenants
  add column if not exists template_published text;

alter table public.tenants
  drop constraint if exists tenants_template_check;
alter table public.tenants
  add constraint tenants_template_check check (template in ('classic', 'bold'));

alter table public.tenants
  drop constraint if exists tenants_template_published_check;
alter table public.tenants
  add constraint tenants_template_published_check
    check (template_published is null or template_published in ('classic', 'bold'));

alter table public.tenants
  add column if not exists style_draft jsonb not null default '{}'::jsonb;

alter table public.tenants
  add column if not exists style_published jsonb not null default '{}'::jsonb;

alter table public.tenants
  drop constraint if exists tenants_style_shape_check;
alter table public.tenants
  add constraint tenants_style_shape_check check (
    jsonb_typeof(style_draft) = 'object'
    and jsonb_typeof(style_published) = 'object'
    -- Granica rozmiaru jak przy znaku firmy (0076): styl to trzy krótkie pola
    -- z zamkniętych zbiorów, a jsonb bez limitu w kolumnie czytanej przy KAŻDYM
    -- renderze sklepu jest zaproszeniem do składowania czegokolwiek.
    and length(style_draft::text) <= 4096
    and length(style_published::text) <= 4096
  );

comment on column public.tenants.template is
  'ZASTANY szablon graficzny sklepu (ADR-161, przeniesiony z sites.template z 0019). Kolumna szkicu w rozumieniu ADR-091; panel do niej NIE pisze — nowy wybór idzie w style_draft->>''theme''. Zostaje jako fallback motywu dla najemcy bez zapisanego stylu.';
comment on column public.tenants.template_published is
  'Bliźniak opublikowany szablonu zastanego (ADR-161). NULL = najemca nigdy nie publikował wyglądu; odczyt publiczny bierze wtedy ''classic''. Pisze WYŁĄCZNIE app.publish_tenant_appearance (strażnik app.guard_published_columns, kanon ADR-091).';
comment on column public.tenants.style_draft is
  'STYL SKLEPU — stan roboczy najemcy (ADR-161, przeniesiony z sites.style_draft z 0046). Pusty obiekt = najemca nigdy nie zapisał stylu. Kształt wnętrza (theme/accent/fontPair) pilnuje @avably/core/site; baza trzyma TYP i GRANICĘ. Zapis WYŁĄCZNIE przez app.set_tenant_style: członek nie ma UPDATE na tenants (RLS: superadmin_update).';
comment on column public.tenants.style_published is
  'STYL SKLEPU w wersji publicznej — jedyne, co czyta app.get_published_page. Pisane WYŁĄCZNIE przez app.publish_tenant_appearance (strażnik app.guard_published_columns, kanon ADR-091).';

-- ---------------------------------------------------------------------
-- 2. Przeniesienie wartości zastanych — STRONA GŁÓWNA WYGRYWA
-- ---------------------------------------------------------------------
--
-- Para SZKICU i para OPUBLIKOWANA biorą się z DWÓCH RÓŻNYCH źródeł i to jest
-- sedno tej sekcji, a nie komplikacja:
--
--   • SZKIC idzie ze strony GŁÓWNEJ (pusty adres w kolumnie szkicu) — to ona
--     jest stroną, którą najemca stylował świadomie, i to jej wygląd ma zostać
--     wyglądem sklepu. Gdy stron głównych jest kilka (unikat z 0073 obejmuje
--     wyłącznie strony ŻYWE), wygrywa żywa, potem najstarsza;
--
--   • BLIŹNIAK OPUBLIKOWANY idzie z ŻYWEJ strony — i to nie jest ta sama
--     preferencja przez pomyłkę. Najemca, którego strona główna jest dopiero
--     szkicem, a w sklepie stoi opublikowana „oferta", dostałby ze strony
--     głównej PUSTY stan opublikowany — czyli jego żywy sklep zmieniłby wygląd
--     w chwili migracji, w oknie, w którym z definicji nie zmienia się NIC.
--     Wśród stron żywych wygrywa główna, potem najwcześniej opublikowana.
--
-- Najemca bez strony zostaje przy wartościach domyślnych kolumn — `coalesce`
-- niżej pilnuje, żeby brak źródła nie nadpisał niczego NULL-em.
--
-- SANITYZACJA W ŹRÓDLE: `sites.style_draft`/`style_published` nie mają CHECK-a
-- kształtu ani rozmiaru (0046), a kolumny docelowe mają. Wartość spoza
-- kontraktu (nie-obiekt, wielkie jsonb) wywróciłaby CAŁĄ migrację na jednym
-- wierszu — degraduje się więc do pustego obiektu, czyli do stanu „najemca
-- nigdy nie zapisał stylu", zamiast blokować wdrożenie wszystkim.
--
-- Zapis do kolumn opublikowanych przechodzi przez strażnika ścieżką serwisową
-- (migracja biegnie rolą będącą członkiem service_role).

with home_draft as (
  select distinct on (s.tenant_id)
    s.tenant_id,
    s.template,
    case
      when jsonb_typeof(s.style_draft) = 'object' and length(s.style_draft::text) <= 4096
        then s.style_draft
      else '{}'::jsonb
    end as style_draft
  from public.sites s
  order by
    s.tenant_id,
    (s.slug = '') desc,
    (s.published_at is not null) desc,
    s.created_at asc,
    s.id asc
),
live_look as (
  select distinct on (s.tenant_id)
    s.tenant_id,
    s.template_published,
    case
      when jsonb_typeof(s.style_published) = 'object' and length(s.style_published::text) <= 4096
        then s.style_published
      else '{}'::jsonb
    end as style_published
  from public.sites s
  where s.published_at is not null
  order by
    s.tenant_id,
    (s.slug_published = '') desc,
    s.published_at asc,
    s.id asc
)
update public.tenants t
   set template = coalesce(
         (select hd.template from home_draft hd where hd.tenant_id = t.id),
         t.template
       ),
       style_draft = coalesce(
         (select hd.style_draft from home_draft hd where hd.tenant_id = t.id),
         t.style_draft
       ),
       -- Bez `coalesce`: brak ŻYWEJ strony ma znaczyć „najemca nigdy nie
       -- opublikował wyglądu", a to jest dokładnie NULL w tej kolumnie.
       template_published =
         (select ll.template_published from live_look ll where ll.tenant_id = t.id),
       style_published = coalesce(
         (select ll.style_published from live_look ll where ll.tenant_id = t.id),
         t.style_published
       );

-- ---------------------------------------------------------------------
-- 3. Strażnik kolumn opublikowanych — gałąź `tenants` rośnie o wygląd
-- ---------------------------------------------------------------------
--
-- Pełne ciało przepisane z 0076 — OSTATNIEJ definicji tej funkcji w historii,
-- odczytanej z ŻYWEJ bazy przez pg_get_functiondef. `create or replace`
-- zastępuje całość, więc przepisanie ze starszej wersji cofnęłoby cicho gałąź
-- `tenants` z 0076 (znak firmy), czego w diffie migracji NIE WIDAĆ. Ta pułapka
-- zadziałała w tym repo dwa razy.
--
-- Zmiana jest jedna: gałąź `tenants` sprawdza teraz trzy kolumny zamiast
-- jednej. Broni tego samego, co przy znaku firmy — SUPERADMINA, jedynej roli
-- interaktywnej z polityką UPDATE na tej tabeli (0001). Członek UPDATE-u na
-- `tenants` nie ma w ogóle, więc jego bramką jest sprawdzenie uprawnienia
-- wewnątrz RPC z sekcji 4 i 5, a nie ten trigger. Dwie różne role, dwie różne
-- bramki.

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
    --
    -- Wygląd tej gałęzi NIE OPUSZCZA po ADR-161: kolumny wyglądu na `sites`
    -- zostają do osobnej migracji kasującej, a dopóki istnieją, zdejmowanie
    -- im ochrony byłoby otwarciem zapisu do kolumn, których nikt nie pilnuje.
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
    -- ADR-160 (znak firmy) + ADR-161 (wygląd sklepu). Najemca RODZI SIĘ bez
    -- stanu publicznego: tenant zakładany interaktywnie nie ma prawa przyjść na
    -- świat z gotowym wyglądem, tak samo jak strona (wyżej).
    if tg_op = 'INSERT' then
      if new.logo_published <> '{}'::jsonb
         or new.style_published <> '{}'::jsonb
         or new.template_published is not null then
        raise exception '%', c_denied using errcode = '42501';
      end if;
    elsif new.logo_published is distinct from old.logo_published
       or new.style_published is distinct from old.style_published
       or new.template_published is distinct from old.template_published then
      raise exception '%', c_denied using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.guard_published_columns() is
  'Strażnik kolumn stanu opublikowanego (ADR-091, rozszerzony o style_published w ADR-090, slug_published w ADR-157, logo_published w ADR-160 oraz wygląd najemcy w ADR-161): zapis do *_published / published_at wyłącznie z wnętrza czasownika publikacji (flaga transakcyjna app.publishing) albo rolą serwisową. Odmowa: 42501 — ten sam SQLSTATE co odmowa RLS/grantu, żeby trigger BEFORE nie przykrywał oczekiwań macierzy izolacji.';

revoke all on function app.guard_published_columns() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. app.set_tenant_style — zapis SZKICU wyglądu
-- ---------------------------------------------------------------------
--
-- DLACZEGO SECURITY DEFINER, SKORO `sites` PISZE SIĘ INVOKEREM. Ten sam powód,
-- co przy znaku firmy (ADR-160): `authenticated` ma GRANT UPDATE na
-- `public.tenants`, ale RLS przepuszcza tam wyłącznie superadmina (0001:
-- `superadmin_update`). Zapis invokerem skończyłby się CICHYM „zero wierszy"
-- — operator klikałby akcent i nie dostawał ani błędu, ani koloru. Otwarcie
-- polityki UPDATE dla członka oznaczałoby z kolei otwarcie CAŁEGO wiersza
-- tenanta, ze `status` i `slug` włącznie.
--
-- ZAWĘŻENIE JEST W CIELE, NIE W RLS: tenant bierze się z `app.tenant_id()`,
-- a nie z argumentu, więc „zapisz styl cudzemu najemcy" nie jest odmawiane —
-- jest NIEWYRAŻALNE. Wołający nie ma jak wskazać wiersza.
--
-- PRÓG UPRAWNIENIA jest DOKŁADNIE TEN, którego wymaga publikacja: ŻYWE
-- członkostwo (`app.is_current_tenant_member`, kanon ADR-126), a nie sam claim
-- z tokenu. Do ADR-161 zapis stylu szedł przez RLS tabeli `sites`, której
-- polityki od 0060 stoją na tym samym predykacie — przeniesienie kolumn nie ma
-- prawa obniżyć progu przy okazji.

create or replace function app.set_tenant_style(p_style jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text := 'Nie można zapisać wyglądu sklepu.';
  v_tenant_id uuid;
begin
  v_tenant_id := app.tenant_id();

  if auth.uid() is null or v_tenant_id is null then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  if not (select app.is_current_tenant_member()) then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  -- Baza pilnuje TYPU i GRANICY; zamknięte zbiory motywów, akcentów i par
  -- krojów zna wyłącznie @avably/core/site i tam są sprawdzane. Powielanie tej
  -- listy w SQL dałoby drugie źródło prawdy, które rozjeżdża się przy pierwszym
  -- nowym motywie.
  if p_style is null
     or jsonb_typeof(p_style) <> 'object'
     or length(p_style::text) > 4096 then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  update public.tenants
     set style_draft = p_style
   where id = v_tenant_id;

  if not found then
    raise exception '%', c_denied using errcode = '22023';
  end if;
end;
$$;

comment on function app.set_tenant_style(jsonb) is
  'Zapis SZKICU wyglądu sklepu (ADR-161). Pusty obiekt = najemca wraca do motywu zastanego. Tenant bierze się z app.tenant_id(), więc zapis cudzemu najemcy jest NIEWYRAŻALNY, a nie odmawiany. Wymaga ŻYWEGO członkostwa (ADR-126) — tego samego progu, co publikacja. Kształtu wnętrza pilnuje @avably/core/site. Odmowa: 22023.';

revoke all on function app.set_tenant_style(jsonb)
  from public, anon, authenticated;
grant execute on function app.set_tenant_style(jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. app.publish_tenant_appearance — wygląd wchodzi na żywo
-- ---------------------------------------------------------------------
--
-- WŁASNY CZASOWNIK, a nie zdanie dołożone do `app.publish_site`, i to jest
-- rozstrzygnięcie WDROŻENIOWE, nie stylistyczne. `app.publish_site` jest
-- funkcją, którą w oknie wdrożeniowym woła STARY panel; dołożenie jej zdania
-- o tabeli `tenants` byłoby zmianą kontraktu pod działającym kodem — dokładnie
-- tą klasą ryzyka, przed którą broniło się 0074 (sygnatura odczytu) i 0076
-- (sygnatura biletu). Ta migracja zostawia `app.publish_site` NIETKNIĘTĄ, więc
-- w oknie nie ma jak nic zepsuć.
--
-- Cena tej decyzji jest jawna: panel publikuje stronę i wygląd DWOMA
-- wywołaniami, więc nie ma jednej transakcji na oba. Skutek nieudanego drugiego
-- wywołania jest WIDOCZNY i odwracalny — strona wchodzi ze starym wyglądem,
-- operator dostaje komunikat i klika publikację jeszcze raz (operacja jest
-- idempotentna). Alternatywa — SECURITY DEFINER dla publikacji strony — kazałaby
-- przepisać na jawne zawężenie izolację, która dziś stoi na RLS.
--
-- Publikacja obejmuje OBIE pary naraz: motyw zastany (`template`) jest
-- fallbackiem dla najemcy bez zapisanego stylu, więc bliźniak bez niego niósłby
-- połowę wyglądu.

create or replace function app.publish_tenant_appearance()
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text := 'Nie można opublikować wyglądu sklepu.';
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

  -- Flaga transakcyjna jak w app.publish_site. Dziś ta funkcja przeszłaby
  -- przez strażnika także bez niej — właściciel definera jest członkiem
  -- service_role, a strażnik przepuszcza ścieżkę serwisową pierwszym warunkiem.
  -- Flaga jest tu po to, żeby przejście NIE ZALEŻAŁO od tego zbiegu ról.
  perform set_config('app.publishing', '1', true);

  update public.tenants
     set style_published = style_draft,
         template_published = template
   where id = v_tenant_id;

  if not found then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  perform set_config('app.publishing', '0', true);
  return v_published_at;
end;
$$;

comment on function app.publish_tenant_appearance() is
  'Publikacja wyglądu sklepu (ADR-161): kopia obu par szkic → bliźniak opublikowany pod flagą app.publishing. Osobny czasownik od app.publish_site, żeby migracja nie zmieniała funkcji wołanej w oknie wdrożeniowym przez stary kod. Wymaga ŻYWEGO członkostwa. Odmowa: 22023.';

revoke all on function app.publish_tenant_appearance()
  from public, anon, authenticated;
grant execute on function app.publish_tenant_appearance()
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. app.get_published_page — wygląd czytany z NAJEMCY
-- ---------------------------------------------------------------------
--
-- Ciało przepisane z 0076 (ostatnia definicja, odczytana z ŻYWEJ bazy) z dwiema
-- zmianami i ani jedną więcej: klucz `template` i klucz `style` biorą wartość
-- z wiersza NAJEMCY zamiast z wiersza strony.
--
-- IZOLACJA TEJ FUNKCJI STOI NA JAWNYM ZAWĘŻENIU, NIE NA RLS — jest SECURITY
-- DEFINER, więc polityki w niej nie uczestniczą. Wiersz najemcy wchodzi
-- WYŁĄCZNIE przez `t.id = s.tenant_id`, a strona wyłącznie przez
-- `s.tenant_id = p_tenant_id`. Złożenie tych dwóch warunków jest jedynym
-- powodem, dla którego wygląd najemcy A nie ma jak wyjść na sklep najemcy B;
-- pilnuje tego asercja nazwana wprost o izolację w packages/db/test.
--
-- `app.get_published_site(uuid)` dziedziczy zmianę bez dotykania: od 0074 jest
-- wywołaniem tej funkcji dla pustego adresu.

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
    and s.slug_published = p_slug
    and s.published_at is not null
    and app.tenant_commercially_active(t.status);
$$;

comment on function app.get_published_page(uuid, text) is
  'Opublikowana strona najemcy POD WSKAZANYM ADRESEM (0074, ADR-158; znak firmy w ADR-160, wygląd sklepu w ADR-161): pusty slug = strona główna. Czyta WYŁĄCZNIE kolumny *_published (kanon ADR-091) i wyłącznie dla najemcy w oknie handlowym (0065). SECURITY DEFINER — jedyną bramką izolacji są jawne filtry tenant_id/slug_published oraz warunek złączenia t.id = s.tenant_id, nie RLS. Koperta jest po stronie sklepu parsowana schematem .strict(), więc klucze `style` i `logo` dokładają się WARUNKOWO, a `template` przechodzi przez coalesce — pusta wartość nie zostawia po sobie klucza, a NULL nie ma jak trafić pod klucz bezwarunkowy.';

revoke all on function app.get_published_page(uuid, text) from public;
grant execute on function app.get_published_page(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Kolumny wyglądu na `sites` są odtąd MARTWE
-- ---------------------------------------------------------------------
--
-- Zostają wyłącznie na czas okna wdrożeniowego i na wypadek wycofania kodu.
-- Nic ich nie czyta: odczyt publiczny bierze wygląd z najemcy (sekcja 6),
-- a panel po ADR-161 pisze przez app.set_tenant_style. `app.publish_site`
-- dalej je przepisuje i to jest ŚWIADOME — zmiana tej funkcji byłaby zmianą
-- kontraktu pod starym kodem w oknie wdrożeniowym.

comment on column public.sites.template is
  'MARTWA po ADR-161 — szablon graficzny jest własnością NAJEMCY (tenants.template). Kolumna zostaje na czas okna wdrożeniowego i schodzi osobną migracją. Nic jej nie czyta.';
comment on column public.sites.template_published is
  'MARTWA po ADR-161 — bliźniak opublikowany szablonu żyje na tenants.template_published. Dalej przepisywana przez app.publish_site (kontrakt starego kodu), ale przez nikogo nieczytana.';
comment on column public.sites.style_draft is
  'MARTWA po ADR-161 — styl jest własnością NAJEMCY (tenants.style_draft). Kolumna zostaje na czas okna wdrożeniowego i schodzi osobną migracją. Nic jej nie czyta.';
comment on column public.sites.style_published is
  'MARTWA po ADR-161 — bliźniak opublikowany stylu żyje na tenants.style_published. Dalej przepisywana przez app.publish_site (kontrakt starego kodu), ale przez nikogo nieczytana.';

-- === END PROD MIGRATION 0077 ===
