-- 0019_site_model.sql
-- Model sekcyjny storefrontu (Faza 2, Zadanie 2.3a; ADR-041): strona sklepu
-- tenanta jako lista SEKCJI z rozdzielonym stanem roboczym i opublikowanym.
--
-- Zawartość (cztery sekcje, jedna migracja — wzorzec 0016/0018):
--   1. public.sites          — jedna strona per tenant (szablon, published_at),
--   2. public.site_sections  — sekcje strony (draft/published jsonb, kolejność),
--   3. public.domains        — schemat pod własne domeny (Zadanie 2.6; teraz
--                              sama tabela + RLS, hostem MVP jest tenants.slug),
--   4. funkcje app.publish_site (publikacja, SECURITY INVOKER) oraz
--      app.get_published_site (publiczny odczyt, SECURITY DEFINER — ADR-041).
--
-- MODEL DRAFT/PUBLISHED. Edycja w panelu pisze WYŁĄCZNIE do content_draft;
-- odwiedzający sklep widzi WYŁĄCZNIE content_published. Publikacja kopiuje
-- draft→published dla wszystkich sekcji strony i stawia sites.published_at —
-- atomowo, w RPC (PostgREST nie umie `set kolumna = kolumna`, a publikacja
-- połowiczna zostawiłaby stronę-hybrydę: część sekcji nowa, część stara).
--
-- KSZTAŁT TREŚCI sekcji (jsonb) definiuje wyłącznie @avably/core/site (Zod,
-- walidacja w server actions panelu). Baza pilnuje osi bezpieczeństwa: typu
-- sekcji (CHECK), własności tenanta (RLS + FK złożony) i granicy draft/published
-- (funkcja odczytu). Walidacja pól treści w CHECK-ach jsonb dublowałaby schematy
-- Zod i rozjeżdżała się z nimi przy każdej zmianie — jedno źródło kształtu.

-- ---------------------------------------------------------------------
-- 1. public.sites — strona storefrontu tenanta
-- ---------------------------------------------------------------------

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Dwa szablony MVP (ADR-041). Tekst + CHECK zamiast enuma — wzorzec statusów
  -- z 0001/0007: dodanie szablonu to zmiana CHECK-a, nie typ w katalogu.
  template text not null default 'classic'
    check (template in ('classic', 'bold')),

  -- NULL = strona nigdy nie opublikowana (storefront jej nie serwuje).
  -- Ustawiane WYŁĄCZNIE przez app.publish_site — pojedynczy punkt publikacji.
  published_at timestamptz,

  created_at timestamptz not null default now(),

  -- Jedna strona per tenant (MVP). UNIQUE zamiast PK po tenant_id, żeby id
  -- pozostało stabilnym kluczem wierszowym (i celem FK dzieci). Ten indeks
  -- pełni zarazem rolę indeksu per-tenant (konwencja: indeks od tenant_id).
  constraint sites_tenant_unique unique (tenant_id),

  -- Klucz kandydujący (wzorzec każdej tabeli-rodzica, ADR-019): dzieci
  -- (site_sections) wskazują stronę kluczem złożonym (tenant_id, id).
  constraint sites_tenant_id_key unique (tenant_id, id)
);

comment on table public.sites is
  'Strona storefrontu tenanta (jedna per tenant, MVP). published_at = NULL: nigdy nie opublikowana. Publikacja wyłącznie przez app.publish_site (ADR-041).';
comment on column public.sites.published_at is
  'Moment ostatniej publikacji (app.publish_site). NULL = strona nieopublikowana — publiczny odczyt zwraca NULL.';

-- ---------------------------------------------------------------------
-- 2. public.site_sections — sekcje strony (draft/published)
-- ---------------------------------------------------------------------

create table public.site_sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  site_id uuid not null,

  -- Zamknięta lista typów sekcji (ADR-041) — lustro SECTION_TYPES z
  -- @avably/core/site. Nowy typ = zmiana CHECK-a + schemat Zod w core.
  type text not null
    check (type in ('hero', 'products', 'pricing', 'faq', 'contact', 'freeform')),

  -- Kolejność prezentacji. Int bez unikalności (wzorzec sort_order z 0018):
  -- zmiana kolejności to seria UPDATE-ów, przejściowe duplikaty są legalne;
  -- remis rozstrzyga deterministycznie (position, id) w funkcji odczytu.
  position int not null default 0,

  -- Wyłączona sekcja zostaje w edytorze (draft przetrwa), ale publiczny odczyt
  -- ją pomija — także gdy ma content_published z wcześniejszej publikacji.
  enabled boolean not null default true,

  -- Stan roboczy edytora. NOT NULL default '{}': sekcja świeżo dodana ma pustą
  -- treść, nie NULL — edytor zawsze dostaje obiekt.
  content_draft jsonb not null default '{}'::jsonb,

  -- Stan opublikowany. NULL = sekcja nigdy nie opublikowana (dodana po
  -- ostatniej publikacji) — publiczny odczyt ją pomija. Kopiowane z
  -- content_draft wyłącznie przez app.publish_site.
  content_published jsonb,

  updated_at timestamptz not null default now(),

  -- Klucz kandydujący (ADR-019) — na wypadek przyszłych dzieci sekcji.
  constraint site_sections_tenant_id_key unique (tenant_id, id),

  -- FK ZŁOŻONY (ADR-019) — sedno izolacji tabeli. Bez niego sekcja z własnym,
  -- poprawnym tenant_id mogłaby wskazać site_id CUDZEGO tenanta: RLS by to
  -- przepuściło (sprawdza tylko tenant_id wstawianego wiersza). Klucz
  -- (tenant_id, site_id) → sites(tenant_id, id) czyni wiersz łączący dwa
  -- tenanty NIEREPREZENTOWALNYM (odrzuca baza: 23503). CASCADE: sekcja żyje
  -- i umiera ze stroną.
  constraint site_sections_site_fk
    foreign key (tenant_id, site_id)
    references public.sites (tenant_id, id) on delete cascade
);

-- Odczyt sekcji strony (edytor i publikacja) filtruje po (tenant_id, site_id)
-- i sortuje po (position, id) — indeks pokrywa oba.
create index site_sections_tenant_site_idx
  on public.site_sections (tenant_id, site_id, "position", id);

comment on table public.site_sections is
  'Sekcja strony storefrontu. content_draft = stan edytora; content_published = stan publiczny (kopiowany przez app.publish_site). Kształt treści definiuje @avably/core/site (ADR-041).';
comment on column public.site_sections.content_draft is
  'Stan roboczy (panel). NIGDY nie serwowany publicznie — granicy pilnuje app.get_published_site.';
comment on column public.site_sections.content_published is
  'Stan opublikowany. NULL = sekcja nigdy nie opublikowana — publiczny odczyt ją pomija.';

-- ---------------------------------------------------------------------
-- 3. public.domains — własne domeny tenantów (schemat pod Zadanie 2.6)
-- ---------------------------------------------------------------------
--
-- Sama tabela + RLS: wiring Vercel/DNS to Zadanie 2.6, hostem MVP pozostaje
-- subdomena z tenants.slug (ADR-039). Tabela istnieje już teraz, żeby model
-- danych storefrontu był kompletny i żeby 2.6 nie zaczynało od migracji.

create table public.domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Domena globalnie unikalna (jeden host wskazuje jeden sklep). CHECK lustrem
  -- realnego hostname: małe litery/cyfry/kreski, co najmniej jedna kropka
  -- (goła etykieta typu 'localhost' nie jest domeną klienta), limit RFC 253.
  domain text not null unique check (
    length(domain) <= 253
    and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  ),

  -- Weryfikacja własności (DNS) — ustawiana przez wiring 2.6; do tego czasu
  -- false. Nieweryfikowana domena nie może routować (bramka przyszłego 2.6).
  verified boolean not null default false,

  created_at timestamptz not null default now(),

  -- Klucz kandydujący (ADR-019) — konwencja każdej tabeli per-tenant.
  constraint domains_tenant_id_key unique (tenant_id, id)
);

-- Listing domen tenanta w panelu (konwencja: indeks od tenant_id).
create index domains_tenant_idx on public.domains (tenant_id, created_at);

comment on table public.domains is
  'Własna domena storefrontu tenanta (schemat pod Zadanie 2.6 — wiring DNS/Vercel później). verified=false: domena nie routuje. Host MVP to subdomena z tenants.slug (ADR-039).';

-- ---------------------------------------------------------------------
-- 4. RLS + GRANT-y (wzorzec 0007/0018) — wszystkie trzy tabele
-- ---------------------------------------------------------------------

alter table public.sites enable row level security;
alter table public.site_sections enable row level security;
alter table public.domains enable row level security;

-- REVOKE PRZED GRANT-em (wzorzec 0006/0007, ADR-016): default privileges
-- Supabase zostawiają rolom publicznym komplet uprawnień, w tym TRUNCATE,
-- które nie podlega RLS. Kolejność istotna: grant przed revoke zostałby zdjęty.
revoke all on public.sites from anon, authenticated;
revoke all on public.site_sections from anon, authenticated;
revoke all on public.domains from anon, authenticated;

-- anon nie dostaje NIC na tych tabelach. Publiczny odczyt opublikowanej strony
-- idzie WYŁĄCZNIE przez app.get_published_site (sekcja 6) — wąską ścieżką
-- o jawnie wybranych kolumnach, nie grantem na tabelę. Polityka SELECT dla
-- anona wystawiłaby przez PostgREST także content_draft (RLS tnie wiersze,
-- nie kolumny) i pozwoliła enumerować sekcje wszystkich tenantów (ADR-041).
grant select, insert, update, delete on public.sites to authenticated, service_role;
grant select, insert, update, delete on public.site_sections to authenticated, service_role;
grant select, insert, update, delete on public.domains to authenticated, service_role;

-- Wzorzec polityk z 0007: odczyt dla członków tenanta + superadmina; zapis
-- (insert/update/delete) dla KAŻDEGO członka tenanta. Budowa strony jest pracą
-- lady (jak pricing_tiers i product_images) — dodanie/usunięcie sekcji czy
-- strony jest odwracalne (draft można odtworzyć), stąd DELETE dla członka.

create policy tenant_select on public.sites for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.sites for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.sites for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
create policy tenant_delete on public.sites for delete
  using (tenant_id = app.tenant_id());

create policy tenant_select on public.site_sections for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.site_sections for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.site_sections for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
create policy tenant_delete on public.site_sections for delete
  using (tenant_id = app.tenant_id());

create policy tenant_select on public.domains for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.domains for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.domains for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
create policy tenant_delete on public.domains for delete
  using (tenant_id = app.tenant_id());

-- ---------------------------------------------------------------------
-- 5. app.publish_site — publikacja strony (SECURITY INVOKER)
-- ---------------------------------------------------------------------
--
-- Atomowo: kopia content_draft → content_published dla WSZYSTKICH sekcji
-- strony + sites.published_at. RPC zamiast dwóch wywołań PostgREST, bo
--   a) PostgREST nie umie `set kolumna = kolumna` (kopia wymaga SQL),
--   b) publikacja połowiczna (sekcje tak, published_at nie — albo odwrotnie)
--      zostawiłaby stronę-hybrydę; transakcja funkcji zamyka oba zapisy.
--
-- SECURITY INVOKER (wzorzec create_order, 0010): funkcja działa z uprawnieniami
-- WOŁAJĄCEGO, więc RLS site'ów i sekcji obowiązuje w całości — członek tenanta
-- opublikuje wyłącznie własną stronę; cudza jest przez RLS niewidoczna i
-- kończy się odmową 22023 (nieodróżnialną od nieistniejącej — bez wycieku
-- istnienia). Kopiowane są też sekcje WYŁĄCZONE (enabled=false): publikacja
-- utrwala całą migawkę draftu, a granicą widoczności jest odczyt (sekcja 6).
--
-- 22023 (invalid_parameter_value) — standardowy SQLSTATE, wzorzec join_waitlist
-- od 0011: kody P0xxx PostgREST zjadałby do gołego 500.

create or replace function app.publish_site(p_site_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_published_at timestamptz := now();
begin
  update public.sites
     set published_at = v_published_at
   where id = p_site_id;

  if not found then
    -- Strona nie istnieje ALBO należy do innego tenanta (RLS tnie wiersz) —
    -- celowo ta sama odmowa, żeby nie zdradzać istnienia cudzej strony.
    raise exception 'site_not_found' using errcode = '22023';
  end if;

  update public.site_sections
     set content_published = content_draft,
         updated_at = v_published_at
   where site_id = p_site_id;

  return v_published_at;
end;
$$;

comment on function app.publish_site(uuid) is
  'Publikacja strony storefrontu: atomowa kopia content_draft→content_published wszystkich sekcji + sites.published_at. SECURITY INVOKER — bramką jest RLS wołającego. Odmowa (brak strony / cudza strona): 22023 (ADR-041).';

revoke all on function app.publish_site(uuid) from public;
-- Tylko authenticated: publikacja to operacja zalogowanego membera panelu.
-- anon nie ma tu nic do roboty; service_role omija RLS z definicji.
grant execute on function app.publish_site(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. app.get_published_site — publiczny odczyt (SECURITY DEFINER, ADR-041)
-- ---------------------------------------------------------------------
--
-- JEDYNA publiczna ścieżka odczytu strony. Anonimowy odwiedzający sklep nie ma
-- sesji, a sites/site_sections nie dają anonowi żadnych grantów — jak przy
-- app.resolve_tenant_by_slug (0017, ADR-039) wąska funkcja SECURITY DEFINER
-- zamiast polityki SELECT, bo polityka wystawiłaby przez PostgREST CAŁE wiersze
-- (w tym content_draft — RLS nie tnie kolumn) i pozwoliła enumerować sekcje
-- wszystkich tenantów. Funkcja zwraca JAWNIE wybrane kolumny opublikowanego
-- stanu i nic poza tym.
--
-- Bramki (koniunkcja — wszystkie muszą przejść, inaczej NULL):
--   * tenant aktywny (trialing|active) — nieaktywny sklep jest dla publiczności
--     nieodróżnialny od nieistniejącego (spójnie z 0017),
--   * sites.published_at IS NOT NULL — strona kiedykolwiek opublikowana,
--   * per sekcja: enabled AND content_published IS NOT NULL — sekcja wyłączona
--     lub nigdy nieopublikowana nie istnieje dla publiczności.
--
-- Zwraca jsonb (jedna wartość, jak uuid w 0017): template, published_at i
-- posortowaną listę sekcji {id, type, position, content}. `content` to
-- WYŁĄCZNIE content_published — content_draft nie występuje w zapytaniu
-- poza tym, że nie występuje wcale.
--
-- STABLE + przypięty search_path: konwencja 0017 (czytająca, deterministyczna
-- w transakcji, nie rzuca wyjątków — brak trafienia to NULL, nie błąd).

create or replace function app.get_published_site(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'template', s.template,
    'published_at', s.published_at,
    'sections', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', sec.id,
            'type', sec.type,
            'position', sec."position",
            'content', sec.content_published
          )
          order by sec."position", sec.id
        )
        from public.site_sections sec
        where sec.tenant_id = s.tenant_id
          and sec.site_id = s.id
          and sec.enabled
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
  'Publiczny odczyt storefrontu: opublikowane, włączone sekcje (position, id) + szablon — TYLKO dla aktywnego tenanta i opublikowanej strony, inaczej NULL. SECURITY DEFINER — jedyna ścieżka anonowa; content_draft nigdy nie opuszcza tej granicy (ADR-041).';

revoke all on function app.get_published_site(uuid) from public;
grant execute on function app.get_published_site(uuid) to anon, authenticated;
