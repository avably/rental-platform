-- 0023_reserved_slugs.sql
-- Zadanie 1.5.7: app.create_tenant odrzuca slugi ZAREZERWOWANE.
--
-- LUKA. Routing storefrontu broni się przed hostami platformy od 2.1
-- (RESERVED_SUBDOMAINS z @avably/core → `classifyHost` kieruje `app.avably.io`,
-- `www.avably.io` itd. w gałąź MARKETINGOWĄ, ADR-039), ale zakładanie
-- organizacji nie broniło się przed niczym: najemca mógł wziąć slug `app`,
-- `www` czy `admin` i dostać sklep NIEOSIĄGALNY pod własnym adresem — routing
-- nigdy nie skieruje tego hosta do jego tenanta. Od 2.6 jest gorzej: taki
-- tenant dostaje jeszcze wiersz w `public.domains` i próbę rejestracji hosta
-- u dostawcy (0022), czyli rezerwuje globalnie unikalny `app.avably.io`, który
-- nigdy nie zarouteruje, a przy okazji może zająć nasz własny host.
--
-- Obrona ma stać W BAZIE, nie tylko w Zodzie panelu: `app.create_tenant` jest
-- jedyną drogą powstania organizacji (SECURITY DEFINER, RLS nie pozwala na
-- gołego INSERT-a do `tenants`), więc bramka tutaj obowiązuje każdego
-- wołającego, także przyszły onboarding spoza panelu.
--
-- ROZJAZD DWÓCH LIST. Zbiór musi zostać zgodny z RESERVED_SUBDOMAINS
-- (packages/core/src/brand.ts) — inaczej host byłby zarezerwowany po jednej
-- stronie i wolny po drugiej, co odtwarza dokładnie tę lukę. Dlatego lista
-- żyje tu w JEDNEJ funkcji `app.reserved_subdomains()` (a nie rozsiana po
-- warunkach), a zgodności obu zbiorów pilnuje test
-- `packages/db/test/reserved-slugs.test.ts` — dopisanie wpisu tylko po jednej
-- stronie pali CI. To ten sam wzorzec „lustro CHECK↔TS" co w 0010/0014.
--
-- SQLSTATE. 22023 (invalid_parameter_value) — konwencja nagłówka 0010/0011/0020:
-- wyłącznie standardowe klasy, które PostgREST mapuje na sensowny kod HTTP
-- (tu 400). Komunikat po polsku i bezpieczny do pokazania wprost w formularzu
-- zakładania organizacji (panel pokazuje `error.message`, patrz
-- app/[locale]/organizacja/nowa/actions.ts). Istniejące w tej funkcji P0001
-- i P0002 zostają NIETKNIĘTE — to zaszłość z 0003, a przepinanie ich zmieniłoby
-- kontrakt błędów, na którym stoją testy tamtego zadania.

-- ---------------------------------------------------------------------
-- 1. app.reserved_subdomains() — jedno źródło prawdy po stronie bazy
-- ---------------------------------------------------------------------
--
-- IMMUTABLE i bez dostępu do tabel: to stała, nie zapytanie. Osobna funkcja
-- (zamiast literału wklejonego w warunek) po to, by test mógł ODCZYTAĆ zbiór
-- i porównać go z RESERVED_SUBDOMAINS — bramka anty-rozjazdowa potrzebuje
-- czegoś, co da się zapytać.

create or replace function app.reserved_subdomains()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  -- LUSTRO RESERVED_SUBDOMAINS z packages/core/src/brand.ts. Zmiana po jednej
  -- stronie bez drugiej pali packages/db/test/reserved-slugs.test.ts.
  select array[
    'www',
    'app',
    'admin',
    'api',
    'mail',
    'send',    -- host poczty transakcyjnej (SENDING_SUBDOMAIN, ADR-047)
    'status',
    'docs',
    'blog',
    'help',
    'static',
    'assets',
    'cdn'
  ]::text[];
$$;

comment on function app.reserved_subdomains() is
  'Subdomeny platformy, których nie wolno wziąć slugiem tenanta. LUSTRO RESERVED_SUBDOMAINS z @avably/core (packages/core/src/brand.ts) — zgodności obu zbiorów pilnuje packages/db/test/reserved-slugs.test.ts.';

revoke all on function app.reserved_subdomains() from public;
grant execute on function app.reserved_subdomains() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. app.create_tenant — bramka slugów zarezerwowanych
-- ---------------------------------------------------------------------
--
-- Ciało funkcji przepisane w całości z 0022 (create or replace nie umie
-- „dołożyć linii"); JEDYNA zmiana merytoryczna to blok odmowy niżej.
--
-- MIEJSCE BRAMKI: PO sprawdzeniach autoryzacyjnych, PRZED insertem. Kolejność
-- jest celowa — anonim i user z niepotwierdzonym adresem mają dostać swoją
-- odmowę jak dotąd, zanim funkcja w ogóle zacznie oceniać slug.
--
-- `lower(btrim(...))`: CHECK z 0001 i tak dopuszcza wyłącznie małe litery, ale
-- normalizacja PRZED porównaniem sprawia, że bramka nie zależy od tego, czy
-- CHECK kiedyś zelżeje — inaczej rozluźnienie CHECK-u po cichu otworzyłoby
-- furtkę `APP`.

create or replace function app.create_tenant(p_slug text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth, app
as $$
declare
  v_user_id uuid := auth.uid();
  v_email_confirmed boolean;
  v_tenant_count int;
  v_tenant_id uuid;
  v_host text;
begin
  if v_user_id is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;

  select (u.email_confirmed_at is not null)
    into v_email_confirmed
  from auth.users u
  where u.id = v_user_id;

  if coalesce(v_email_confirmed, false) is false then
    raise exception 'Adres e-mail nie został zweryfikowany.' using errcode = 'P0001';
  end if;

  select count(distinct m.tenant_id) into v_tenant_count
  from public.members m
  where m.user_id = v_user_id;

  if v_tenant_count >= 2 then
    raise exception 'Limit 2 organizacji na użytkownika został osiągnięty.' using errcode = 'P0002';
  end if;

  -- BRAMKA SLUGÓW ZAREZERWOWANYCH (0023). Bez niej najemca brał adres, pod
  -- którym routing nigdy nie znajdzie jego sklepu (ADR-039).
  if lower(btrim(p_slug)) = any (app.reserved_subdomains()) then
    raise exception 'Adres „%" jest zarezerwowany — wybierz inny.', lower(btrim(p_slug))
      using errcode = '22023';
  end if;

  insert into public.tenants (slug, name)
  values (p_slug, p_name)
  returning id into v_tenant_id;

  insert into public.members (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner');

  -- Subdomena platformy (Zadanie 2.6). Lustro ROOT_DOMAIN z @avably/core.
  v_host := lower(p_slug) || '.avably.io';
  if v_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
     and length(v_host) <= 253
  then
    -- ON CONFLICT: host mógł już zostać zajęty (np. wcześniejszy tenant o tym
    -- slugu skasowany i odtworzony). UNIQUE na `domain` jest globalny, więc
    -- kolizja nie może wywrócić onboardingu — brak wiersza jest widoczny na
    -- ekranie domen i naprawialny, przerwana rejestracja organizacji nie.
    insert into public.domains (tenant_id, domain, kind, verified, verified_at)
    values (v_tenant_id, v_host, 'subdomain', true, now())
    on conflict (domain) do nothing;
  end if;

  return v_tenant_id;
end;
$$;

comment on function app.create_tenant(text, text) is
  'Zakłada organizację wraz z członkostwem ownera i wierszem subdomeny (0022) w JEDNEJ transakcji. Odrzuca slugi zarezerwowane (0023, app.reserved_subdomains → 22023), niepotwierdzony e-mail (P0001) i przekroczony limit 2 organizacji na użytkownika (P0002).';

-- ---------------------------------------------------------------------
-- 3. Tenanci sprzed tej migracji zostają NIETKNIĘCI
-- ---------------------------------------------------------------------
--
-- Świadomie ZERO backfillu i zero kasowania. Gdyby jakaś organizacja miała już
-- slug zarezerwowany, odebranie go migracją zabrałoby najemcy adres sklepu bez
-- ostrzeżenia (a wiersz w `domains` i tak by po nim został). Bramka dotyczy
-- ZAKŁADANIA — istniejący przypadek jest sprawą operacyjną dla superadmina,
-- nie skutkiem ubocznym deployu.
