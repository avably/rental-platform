-- =====================================================================
-- 0075 — HISTORIA ADRESÓW STRON + PRZEKIEROWANIA 308 (ADR-159)
-- =====================================================================
--
-- Faza 2 kreatora, krok 2.3. Zmiana adresu opublikowanej strony bez 308 to
-- TWARDE 404 pod adresem, który jest w Google i w linkach, które klienci
-- najemcy wkleili na Facebooku. Storefront nie ma dziś mechanizmu przekierowań
-- opartego o dane — jedyne 308 są zaszyte w kodzie.
--
-- ========================= CZTERY ROZSTRZYGNIĘCIA =========================
--
-- 1. HISTORIA MUSI BYĆ TABELĄ — i jest JEDYNĄ nową tabelą w całym planie
--    Fazy 2. Kolumna nie wystarczy, bo strona przenoszona kilka razy zostawia
--    N starych adresów, a każdy z nich ma dalej prowadzić do bieżącego.
--    Wszędzie indziej w tej fazie preferowaliśmy kolumnę (patrz 0073: adres
--    strony głównej jako pusty slug zamiast kolumny `kind`).
--
-- 2. WPIS POWSTAJE W TRIGGERZE, NIE W `publish_site`, I NIKT GO NIE PISZE
--    Z ZEWNĄTRZ. `app.publish_site` jest SECURITY INVOKER, więc zapis historii
--    z jej wnętrza wymagałby GRANT-u INSERT dla `authenticated` — a to jest
--    dokładnie kanał przejęcia adresu: członek wstawiłby wiersz przez surowe
--    PostgREST i przekierował adres, którego nie jest właścicielem. Zamiast
--    tego wpis robi trigger SECURITY DEFINER na `sites`, uzbrojony wyłącznie
--    zmianą `slug_published` — a tę kolumnę pisze WYŁĄCZNIE publikacja
--    (strażnik 0045/0073). `authenticated` dostaje na tej tabeli SAM SELECT.
--
-- 3. STARY ADRES JEST ZABLOKOWANY DO PONOWNEGO UŻYCIA. Bez tego przekierowanie
--    zaczęłoby po cichu prowadzić pod INNĄ stronę: najemca przenosi „Kontakt"
--    z `/kontakt` na `/kontakt-nowy`, po miesiącu zakłada landing pod
--    `/kontakt`, a wszyscy, którzy mieli stary link, lądują nie tam, gdzie
--    wskazywał. Odmowa pada w polu formularza, z uzasadnieniem.
--
-- 4. CHECKBOX „PRZEKIERUJ STARY ADRES" TO KOLUMNA SZKICU, BEZ BLIŹNIAKA.
--    `sites.redirect_old_slug` jest odpowiedzią na pytanie zadane w chwili
--    ZMIANY adresu i konsumowaną w chwili PUBLIKACJI — dokładnie tak, jak
--    `slug` jest konsumowany do `slug_published`. Stanem publicznym jest wiersz
--    historii, a nie ta flaga, więc bliźniak nie miałby czego nieść.
--
-- ODCZYT TYM SAMYM TOREM. Przekierowania wychodzą kluczem `redirects` koperty
-- `app.get_tenant_pages` — tej samej, którą proxy czyta, żeby rozstrzygnąć
-- adres. Klucz istnieje od 0074 (pusty), więc ta migracja nie zmienia KSZTAŁTU
-- koperty czytanej w middleware, tylko ją wypełnia. Druga podróż do bazy „a może
-- to stary adres?" nie powstaje ani razu.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): RLS + komplet polityk
-- z predykatem żywego członkostwa (0060/ADR-126) + jawne granty + indeks od
-- `tenant_id` — wszystko w tym pliku.

-- === BEGIN PROD MIGRATION 0075 ===

-- ---------------------------------------------------------------------
-- 1. sites.redirect_old_slug — odpowiedź operatora, nie stan publiczny
-- ---------------------------------------------------------------------
--
-- Domyślnie WŁĄCZONE: najemca, który nie zauważy checkboxa, ma dostać
-- zachowanie bezpieczne dla swojego SEO, a nie 404 pod zaindeksowanym adresem.
-- Wyłączenie jest świadomą decyzją („ten adres był pomyłką, niech zniknie").

alter table public.sites
  add column if not exists redirect_old_slug boolean not null default true;

comment on column public.sites.redirect_old_slug is
  'Czy przy NAJBLIŻSZEJ publikacji stary adres tej strony ma zostać przekierowany 308 (0075, ADR-159). Kolumna SZKICU: odpowiedź operatora z chwili zmiany adresu, konsumowana przy publikacji. Stanem publicznym jest wiersz public.site_slug_history, nie ta flaga — dlatego nie ma bliźniaka *_published.';

-- ---------------------------------------------------------------------
-- 2. public.site_slug_history
-- ---------------------------------------------------------------------

create table if not exists public.site_slug_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  site_id uuid not null,
  -- STARY adres. Pusty slug (strona główna) tu NIE WCHODZI: adresu `/` nie da
  -- się zmienić, więc nie ma czego przekierowywać.
  slug text not null,
  created_at timestamptz not null default now(),

  -- FK ZŁOŻONY, jak w site_sections (0019) i product_categories (0072): wiersz
  -- z poprawnym tenant_id nie może wskazać strony CUDZEGO najemcy. Sam site_id
  -- przepuściłby taki wiersz-łącznik dwóch najemców, bo RLS sprawdza tenant_id
  -- WSTAWIANEGO wiersza, a nie rodzica.
  constraint site_slug_history_site_fkey
    foreign key (tenant_id, site_id) references public.sites (tenant_id, id) on delete cascade,

  -- Lustro CHECK-a `sites_slug_shape` bez gałęzi pustego sluga.
  constraint site_slug_history_slug_shape
    check (char_length(slug) between 1 and 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- Adres należy do NAJWYŻEJ JEDNEJ strony najemcy — także jako adres stary.
-- To jest ograniczenie, na którym stoi blokada ponownego użycia (sekcja 4).
create unique index if not exists site_slug_history_slug_unique_idx
  on public.site_slug_history (tenant_id, slug);

create index if not exists site_slug_history_site_idx
  on public.site_slug_history (tenant_id, site_id);

comment on table public.site_slug_history is
  'Stare adresy stron najemcy — źródło przekierowań 308 (0075, ADR-159). Wiersze wstawia WYŁĄCZNIE trigger sites_record_slug_history przy publikacji zmieniającej slug_published; `authenticated` ma tu sam SELECT, żeby historia nie stała się kanałem przejęcia cudzego adresu.';

alter table public.site_slug_history enable row level security;

revoke all on public.site_slug_history from anon, authenticated;
-- SELECT: panel pokazuje operatorowi, które stare adresy dalej prowadzą do jego
-- strony, a bramka sluga (SECURITY INVOKER) czyta tę tabelę rolą piszącą.
-- Zapisu NIE MA ŚWIADOMIE — patrz rozstrzygnięcie 2 nagłówka.
grant select on public.site_slug_history to authenticated;
grant select, insert, update, delete on public.site_slug_history to service_role;

-- Polityki w kształcie 0060/ADR-126: przy każdym członie tenantowym predykat
-- ŻYWEGO członkostwa, superadmin osobnym członem, owijka (select …) obowiązkowa.
drop policy if exists tenant_select on public.site_slug_history;
create policy tenant_select on public.site_slug_history
  for select to authenticated
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );

-- ---------------------------------------------------------------------
-- 3. app.record_slug_history — jedyna droga wpisu
-- ---------------------------------------------------------------------
--
-- SECURITY DEFINER, bo `authenticated` nie ma i nie ma mieć INSERT-u na tej
-- tabeli. Uzbrojenie jest wąskie z konstrukcji: trigger patrzy WYŁĄCZNIE na
-- zmianę `slug_published`, a tę kolumnę pisze wyłącznie `app.publish_site`
-- (strażnik `app.guard_published_columns`, 42501 dla wszystkich innych).
-- Nie ma więc drogi, którą członek wywołałby ten kod bez publikacji WŁASNEJ
-- strony — RLS na `sites` odcina cudze wiersze zanim trigger w ogóle wystartuje.
--
-- KASOWANIE WPISU DLA ADRESU WŁAŚNIE ZAJĘTEGO: strona wracająca pod swój dawny
-- adres musi przestać się na niego przekierowywać, inaczej proxy widziałoby ten
-- sam slug i w `pages`, i w `redirects`. Pierwszeństwo ma strona, ale pętla
-- „adres → sam do siebie" w kopercie byłaby miną dla każdego kolejnego czytnika.

create or replace function app.record_slug_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
begin
  -- Adres, który strona właśnie zajęła, przestaje być przekierowaniem.
  delete from public.site_slug_history
   where tenant_id = new.tenant_id
     and slug = new.slug_published;

  -- Stary adres wchodzi do historii tylko wtedy, gdy: istniał, nie był adresem
  -- strony głównej i operator poprosił o przekierowanie.
  if old.slug_published is not null
     and old.slug_published <> ''
     and new.redirect_old_slug then
    insert into public.site_slug_history (tenant_id, site_id, slug)
    values (new.tenant_id, new.id, old.slug_published)
    on conflict (tenant_id, slug) do update
      set site_id = excluded.site_id,
          created_at = now();
  end if;

  return new;
end;
$$;

comment on function app.record_slug_history() is
  'Zapis starego adresu strony do public.site_slug_history przy publikacji zmieniającej slug_published (0075, ADR-159). SECURITY DEFINER, bo authenticated nie ma INSERT-u na tabeli historii — to jedyna droga wpisu i jest uzbrojona wyłącznie zmianą kolumny, którą pisze sama publikacja.';

revoke all on function app.record_slug_history() from public, anon, authenticated;

drop trigger if exists sites_record_slug_history on public.sites;

create trigger sites_record_slug_history
  after update of slug_published on public.sites
  for each row
  when (new.slug_published is distinct from old.slug_published)
  execute function app.record_slug_history();

-- ---------------------------------------------------------------------
-- 4. BLOKADA PONOWNEGO UŻYCIA STAREGO ADRESU
-- ---------------------------------------------------------------------
--
-- Ciało `app.site_slug_guard` przepisane z 0073 (ostatnia definicja) z jednym
-- dołożonym warunkiem. `create or replace` zastępuje całość, więc przepisanie
-- ze starszej wersji cofnęłoby cicho poprawki — poniżej jest kopia co do
-- warunku, nie parafraza.
--
-- Odmowa mówi operatorowi, CO się dzieje: adres nie jest „zajęty" w sensie
-- kolizji, tylko PROWADZI GDZIE INDZIEJ. To dwie różne sytuacje i dwa różne
-- ruchy naprawcze.

create or replace function app.site_slug_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug then
    return new;
  end if;

  if lower(btrim(new.slug)) = any (app.reserved_page_slugs()) then
    raise exception
      'Adres „%" jest zarezerwowany przez sklep — wybierz inny.', lower(btrim(new.slug))
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.site_slug_history h
     where h.tenant_id = new.tenant_id
       and h.slug = lower(btrim(new.slug))
       and h.site_id <> new.id
  ) then
    raise exception
      'Adres „%" przekierowuje do innej strony. Najpierw zdejmij to przekierowanie.',
      lower(btrim(new.slug))
      using errcode = '22023';
  end if;

  return new;
end;
$$;

comment on function app.site_slug_guard() is
  'Bramka sluga strony (0073/0075, ADR-157/159): odmawia (22023) przejęcia pierwszego segmentu ścieżki zajętego przez trasę sklepu (app.reserved_page_slugs) ORAZ adresu, który historia trzyma jako przekierowanie do INNEJ strony tego najemcy. Patrzy wyłącznie na ZMIANĘ sluga: rozrost listy nie może zablokować edycji zastanego wiersza.';

revoke all on function app.site_slug_guard() from public, anon, authenticated;
-- authenticated: guard jest SECURITY INVOKER i czyta historię rolą PISZĄCĄ
-- wiersz strony — bez SELECT-a (nadanego wyżej) UPDATE sites padałby na
-- braku uprawnień, a nie na regule.

-- ---------------------------------------------------------------------
-- 5. REJESTR ADRESÓW niesie przekierowania
-- ---------------------------------------------------------------------
--
-- Kształt koperty BEZ ZMIAN względem 0074 — klucz `redirects` już tam był,
-- pusty. Zmienia się wyłącznie jego zawartość, więc okno wdrożeniowe nie ma
-- czego zepsuć w middleware.
--
-- Przekierowanie wychodzi TYLKO wtedy, gdy strona docelowa dalej jest żywa:
-- 308 prowadzące pod adres, który sam oddaje 404, jest gorsze niż jego brak.

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
  'Rejestr ŻYWYCH adresów stron najemcy dla proxy sklepu (0074/0075, ADR-158/159): {"pages": [slug...], "redirects": [{"from","to"}...]}. Pusty slug = strona główna. Przekierowanie wychodzi wyłącznie dla strony, która dalej jest żywa. NULL dla najemcy poza oknem handlowym. SECURITY DEFINER: bramką izolacji jest jawny filtr tenant_id, a nie RLS.';

revoke all on function app.get_tenant_pages(uuid) from public;
grant execute on function app.get_tenant_pages(uuid) to anon, authenticated;

-- === END PROD MIGRATION 0075 ===
