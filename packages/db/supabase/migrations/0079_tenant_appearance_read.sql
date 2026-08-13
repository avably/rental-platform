-- =====================================================================
-- 0079 — POWŁOKA SKLEPU CZYTA SIĘ TOREM NAJEMCY, NIE KOPERTĄ STRONY (ADR-171)
-- =====================================================================
--
-- Ta migracja dokłada JEDNĄ funkcję odczytu i nie rusza ani jednej istniejącej.
--
-- ============== CO SIĘ ZEPSUŁO I DLACZEGO NIE WIDAĆ TEGO W 0077 ==============
--
-- 0076 i 0077 przeniosły znak firmy i wygląd na wiersz NAJEMCY i wystawiły je
-- w kopercie `app.get_published_page` — przy KAŻDEJ opublikowanej stronie.
-- Dane od tamtej pory leżą we właściwym miejscu. Sklep sięga po nie złą drogą:
-- powłokę (znak, motyw, akcent, kroje) bierze z koperty STRONY GŁÓWNEJ
-- (`app.get_published_site` = `get_published_page(tenant, '')`), bo tam stoi
-- też stopka, która naprawdę jest własnością strony głównej (ADR-154).
--
-- Skutek jest widoczny w stanie DOMYŚLNYM nowego najemcy: dopóki strona główna
-- nie jest opublikowana, koperta jest pusta, a klient nie widzi ani znaku, ani
-- wybranego motywu — także na opublikowanej PODSTRONIE i na trasach, które
-- w ogóle nie mają wiersza `sites` (katalog, koszyk, kasa, dokumenty prawne).
-- Panel po drugiej stronie liczy stan z kolumn najemcy i melduje „Ten znak
-- widzą klienci". Zdanie jest prawdziwe o CZYNNOŚCI (kopia szkic → bliźniak)
-- i fałszywe o STANIE SKLEPU.
--
-- ============== DLACZEGO OSOBNA FUNKCJA, A NIE DRUGI ARGUMENT ==============
--
-- Rozważone i odrzucone:
--
--   (a) DOŁOŻENIE WYGLĄDU DO `app.get_public_catalog`. Katalog czyta KAŻDA
--       trasa sklepu, więc wygląd jechałby bez ani jednej dodatkowej podróży.
--       Ale koperta katalogu jest po stronie sklepu parsowana schematem, który
--       nie zna klucza `appearance`, a migracje wchodzą na produkcję PRZED
--       kodem — nowy klucz kładłby sklep KAŻDEGO najemcy na czas okna.
--       Ta sama krawędź, przed którą broniło się 0077.
--   (b) TRZECI ARGUMENT `app.get_published_page`. Zmiana sygnatury funkcji,
--       którą w oknie wdrożeniowym woła stary sklep — dokładnie ta klasa
--       ryzyka, przed którą broniło się 0074.
--   (c) ODCZYT `public.tenants` WPROST PRZEZ POSTGREST. Anon nie ma na tej
--       tabeli grantu i mieć go nie powinien: wiersz najemcy niesie e-mail
--       rozliczeniowy, status subskrypcji i identyfikator konta płatności.
--       Grant „tylko na cztery kolumny" jest granicą, której RLS nie widzi.
--
-- Zostaje własna funkcja o własnej sygnaturze. Nowa funkcja nie ma jak niczego
-- zepsuć w oknie wdrożeniowym, bo w oknie NIKT jej nie woła.
--
-- ============== IZOLACJA ==============
--
-- SECURITY DEFINER, więc RLS w tym odczycie NIE UCZESTNICZY — jedyną bramką
-- jest jawne zawężenie `t.id = p_tenant_id` w ciele. `p_tenant_id` przychodzi
-- do sklepu WYŁĄCZNIE z nagłówka wstrzykniętego przez proxy po rozwiązaniu
-- hosta (lib/tenant/headers.ts zdejmuje przychodzące nagłówki bezwarunkowo),
-- więc odwiedzający nie ma czym go podmienić. Bramka stoi w CIELE, a nie
-- w polityce, dokładnie po to, żeby dała się udowodnić mutacją (wzorzec
-- ADR-170 D3) — asercja nazwana wprost o izolację jest w
-- packages/db/test/tenant-appearance-read.test.ts.
--
-- Okno handlowe (`app.tenant_commercially_active`) jest tym samym warunkiem,
-- co w `app.get_published_page` i `app.get_public_catalog`: najemca po
-- zamknięciu konta ma zniknąć CAŁY, a nie zostawić w sklepie własny znak.
--
-- ============== CZEGO TA MIGRACJA NIE ROBI ==============
--
-- NIE RUSZA `app.get_published_page` ani `app.get_published_site`. Stopka
-- dalej jest własnością strony głównej i dalej jedzie kopertą — powłoka to od
-- ADR-154 dwie różne rzeczy o dwóch różnych właścicielach, a ta migracja
-- rozdziela wyłącznie tę, której właścicielem jest NAJEMCA.

-- === BEGIN PROD MIGRATION 0079 ===

-- ---------------------------------------------------------------------
-- 1. app.get_tenant_appearance — znak i wygląd BEZ pośrednictwa strony
-- ---------------------------------------------------------------------
--
-- Kształt koperty jest PODZBIOREM koperty strony i to jest decyzja, nie zbieg
-- okoliczności: sklep parsuje oba wejścia tymi samymi schematami rdzenia
-- (`siteStyleSchema`, `parseSiteLogo`), więc drugi kształt znaczyłby drugie
-- miejsce, w którym trzeba pamiętać o zmianie allowlisty motywów.
--
--   • `template` — klucz BEZWARUNKOWY przez `coalesce(…, 'classic')`. Najemca,
--     który nigdy nie publikował wyglądu, ma dostać motyw zastany, a nie NULL
--     pod kluczem, który po drugiej stronie parsuje `z.enum`.
--   • `style` i `logo` — klucze WARUNKOWE, tą samą regułą pustego obiektu, co
--     w 0076/0077. Brak znaku jest stanem NORMALNYM, nie awarią.
--
-- Nazw kolumn szkicu NIE MA w ciele ani w komentarzach: strażnik strukturalny
-- w packages/db/test skanuje `pg_get_functiondef`, a ten oddaje ciało RAZEM
-- z komentarzami — wzmianka paliłaby bramkę, która ma pilnować ZAPYTANIA.

create or replace function app.get_tenant_appearance(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object('template', coalesce(t.template_published, 'classic'))
    || case
         when t.style_published = '{}'::jsonb then '{}'::jsonb
         else jsonb_build_object('style', t.style_published)
       end
    || case
         when t.logo_published = '{}'::jsonb then '{}'::jsonb
         else jsonb_build_object('logo', t.logo_published)
       end
  from public.tenants t
  where t.id = p_tenant_id
    and app.tenant_commercially_active(t.status);
$$;

comment on function app.get_tenant_appearance(uuid) is
  'POWŁOKA SKLEPU NAJEMCY — znak firmy i wygląd (ADR-171): jedyny odczyt, który nie wymaga ani jednej opublikowanej strony. Czyta WYŁĄCZNIE kolumny *_published na public.tenants (kanon ADR-091) i wyłącznie dla najemcy w oknie handlowym (0065). Zwraca NULL dla najemcy nieistniejącego albo poza oknem — nieodróżnialnie. SECURITY DEFINER: jedyną bramką izolacji jest jawne zawężenie t.id = p_tenant_id w ciele, nie RLS. Kształt jest PODZBIOREM koperty app.get_published_page (klucz template bezwarunkowo przez coalesce, klucze style i logo warunkowo), więc sklep parsuje oba wejścia tymi samymi schematami rdzenia.';

revoke all on function app.get_tenant_appearance(uuid) from public;
grant execute on function app.get_tenant_appearance(uuid) to anon, authenticated;

-- === END PROD MIGRATION 0079 ===
