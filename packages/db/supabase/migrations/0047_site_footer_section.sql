-- =====================================================================
-- 0047 — SEKCJA STOPKI: trzynasty typ, jedyność i przypięcie do końca
--        (K6, ADR-092; na kanonie ADR-082 i ADR-091)
-- =====================================================================
--
-- Kreator 2.0 przeszedł przegląd na produkcji i wrócił z czterema brakami.
-- Pierwszym z nich jest STOPKA: strona zbudowana z sekcji kończy się dziś tym,
-- co operator postawił ostatnie, i nie ma gdzie umieścić danych kontaktowych,
-- godzin, linków do regulaminu ani noty o prawach. Sekcja `contact` tego nie
-- zastępuje — stoi w środku strony, jest jedną z wielu i nie niesie noty
-- o prawach.
--
-- Ta migracja robi DWIE rzeczy i obie są własnością BAZY, nie edytora:
--
--   1. dopuszcza typ `footer` (rozszerzenie CHECK-a, wzorzec 0043);
--   2. czyni DRUGĄ STOPKĘ NIEREPREZENTOWALNĄ (unikat częściowy).
--
-- Trzecia reguła — „stopka jest ostatnia" — jest opisana niżej, w sekcji 3,
-- razem z uzasadnieniem, dlaczego jej miejscem jest odczyt publiczny, a nie
-- CHECK na wierszu.
--
-- ---------------------------------------------------------------------
-- CZEGO TA MIGRACJA NIE ROBI: ŻADNEJ NOWEJ KOLUMNY PUBLICZNEJ
-- ---------------------------------------------------------------------
--
-- Kanon ADR-091 brzmi: „nowa kolumna widoczna publicznie MUSI dostać bliźniaka
-- *_published w tej samej migracji ORAZ wejść na listę app.guard_published_
-- columns". 0047 tego kroku nie wykonuje, bo nie dokłada ANI JEDNEJ kolumny:
-- stopka jest zwykłym wierszem `site_sections` i cały jej stan (treść,
-- pozycja, włączenie) jedzie kolumnami, które bliźniaki już mają — od 0019
-- (content) i 0045 (position, enabled). Strażnik zostaje więc NIETKNIĘTY,
-- a to jest wynik pożądany: rozszerzanie listy strażnika bez potrzeby to
-- ryzyko literówki w regule, która broni żywej strony.
--
-- ---------------------------------------------------------------------
-- DLACZEGO UNIKAT JEST CZĘŚCIOWY (i którą częścią)
-- ---------------------------------------------------------------------
--
-- Model nagrobków (ADR-091): usunięcie sekcji, która stoi na OPUBLIKOWANEJ
-- stronie, nie kasuje wiersza — stawia `deleted_in_draft = true`, a wiersz
-- znika dopiero przy publikacji. Gdyby unikat obejmował wszystkie wiersze,
-- operator, który skasował stopkę i chce postawić nową PRZED publikacją,
-- dostałby 23505 na zdarzeniu, które jest całkowicie legalne — i nie miałby
-- jak z tego wyjść inaczej niż publikując stronę w stanie bez stopki.
--
-- Predykat `not deleted_in_draft` wycina nagrobki ze zbioru pilnowanego, więc
-- niezmiennik brzmi dokładnie tak, jak powinien: JEDNA ŻYWA STOPKA W SZKICU.
-- Nagrobków może być kilka i to jest w porządku — żaden z nich nie jest już
-- częścią strony, którą operator składa.

-- === BEGIN PROD MIGRATION 0047 ===

-- ---------------------------------------------------------------------
-- 1. Rozszerzenie CHECK-a typów sekcji (0019 → 0043 → 0047)
-- ---------------------------------------------------------------------
--
-- Wzorzec bez zmian względem 0043: Postgres nie zna „dopisz wartość do
-- CHECK-a", więc lista jedzie od nowa, a drop + add stoją w jednym kroku.
-- Nowa lista jest NADZBIOREM starej, więc żaden istniejący wiersz nie może
-- naruszyć nowego ograniczenia — walidacja przy `add constraint` przejdzie
-- po całej tabeli i nie ma prawa niczego znaleźć.

alter table public.site_sections
  drop constraint if exists site_sections_type_check;

alter table public.site_sections
  add constraint site_sections_type_check check (
    type in (
      'hero', 'products', 'pricing', 'faq', 'contact', 'freeform',
      'testimonials', 'gallery', 'usp', 'cta', 'directions', 'delivery',
      'footer'
    )
  );

comment on constraint site_sections_type_check on public.site_sections is
  'Zamknięta lista typów sekcji — lustro SECTION_TYPES z @avably/core/site (ADR-041/ADR-082/ADR-092). Nowy typ = zmiana tego CHECK-a + schemat Zod w core.';

-- ---------------------------------------------------------------------
-- 2. JEDNA ŻYWA STOPKA NA STRONĘ
-- ---------------------------------------------------------------------
--
-- Unikat, nie CHECK: „ile jest wierszy tego typu na tej stronie" to pytanie
-- o ZBIÓR, a CHECK widzi wyłącznie wiersz, który właśnie powstaje. CHECK
-- z podzapytaniem byłby przy tym niepoprawny nie tylko formalnie (Postgres
-- go nie waliduje przy zmianach w INNYCH wierszach) — dopuszczałby dwie
-- równoległe wstawki, z których każda nie widzi jeszcze drugiej.
--
-- Indeks jest po (site_id), a nie (tenant_id, site_id): `sites` ma unikat
-- (tenant_id, id) od 0019, więc identyfikator strony już rozstrzyga tenanta.
-- Dołożenie tenant_id nie zwiększyłoby siły reguły, a rozmyłoby jej treść.

create unique index if not exists site_sections_one_live_footer_idx
  on public.site_sections (site_id)
  where type = 'footer' and not deleted_in_draft;

comment on index public.site_sections_one_live_footer_idx is
  'JEDNA ŻYWA STOPKA na stronę (ADR-092). Częściowy: nagrobki (deleted_in_draft) są poza zbiorem, żeby „skasuj stopkę i postaw nową przed publikacją" pozostało legalne. Druga stopka: 23505.';

-- ---------------------------------------------------------------------
-- 3. STOPKA JEST OSTATNIA — na granicy ODCZYTU PUBLICZNEGO
-- ---------------------------------------------------------------------
--
-- Przypięcie nie da się zapisać jako CHECK: „position jest największa na tej
-- stronie" to znowu własność ZBIORU, a dodatkowo reorder w panelu przechodzi
-- przez stan, w którym pozycje chwilowo się dublują (świadome, 0019) — więc
-- trigger pilnujący maksimum przewracałby legalną serię UPDATE-ów.
--
-- Reguła siedzi więc w DWÓCH miejscach, i to jest podział zamierzony:
--
--   * KOLEJNOŚĆ ZAPISYWANA — normalizuje ją akcja serwerowa panelu
--     (`normalizeSectionOrder` z @avably/core/site). To jest miejsce, w którym
--     operator widzi wynik: przeciągnięcie sekcji pod stopkę kończy się
--     sekcją NAD stopką, a nie cichym odrzuceniem zapisu.
--
--   * KOLEJNOŚĆ CZYTANA PUBLICZNIE — wymusza ją TA funkcja, poniżej. To jest
--     bezpiecznik: gdyby stan w bazie kiedykolwiek rozjechał się z regułą
--     (starsza wersja panelu, ręczna poprawka, zapis z pominięciem akcji),
--     strona sklepu i tak nie pokaże stopki w środku.
--
-- Jedyna zmiana względem 0046 to WYRAŻENIE SORTUJĄCE. Kształt koperty zostaje
-- co do bajtu: te same klucze, ten sam warunkowy `style`, te same bramki
-- widoczności. Funkcja dalej czyta wyłącznie kolumny *_published.

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
    and s.published_at is not null
    and t.status in ('trialing', 'active');
$$;

comment on function app.get_published_site(uuid) is
  'Publiczny odczyt storefrontu: opublikowane, włączone sekcje (sekcje przypięte na końcu, dalej position_published, id) + opublikowany szablon + styl strony (klucz `style` tylko dla niepustego stylu) — TYLKO dla aktywnego tenanta i opublikowanej strony, inaczej NULL. SECURITY DEFINER — jedyna ścieżka anonowa. Czyta WYŁĄCZNIE kolumny *_published, więc żadna operacja kreatora nie zmienia jej wyniku przed publikacją (ADR-041/ADR-090/ADR-091/ADR-092).';

revoke all on function app.get_published_site(uuid) from public;
grant execute on function app.get_published_site(uuid) to anon, authenticated;

-- === END PROD MIGRATION 0047 ===
