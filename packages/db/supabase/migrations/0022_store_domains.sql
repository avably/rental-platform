-- 0022_store_domains.sql
-- Domeny sklepów (Zadanie 2.6, ADR-046): wiring tabeli public.domains z 0019
-- do realnego routingu — automatyczna subdomena `<slug>.avably.io` przy
-- zakładaniu tenanta oraz własne domeny najemców (kind='custom').
--
-- Ta migracja robi cztery rzeczy:
--   1. rozszerza public.domains o kolumny stanu rejestracji u dostawcy hostingu
--      (kind, provider_domain_id, verified_at, last_error),
--   2. dodaje app.resolve_tenant_by_domain — LUSTRO app.resolve_tenant_by_slug
--      z 0017 (ADR-039) dla hostów spoza `*.avably.io`,
--   3. wpina wiersz subdomeny w app.create_tenant (ta sama transakcja co
--      tenant + members) — patrz „DLACZEGO W SQL" niżej,
--   4. uzupełnia subdomeny dla tenantów założonych PRZED tą migracją.
--
-- RLS, GRANT-y i klucz kandydujący (tenant_id, id) z 0019 zostają NIETKNIĘTE:
-- dokładamy wyłącznie kolumny. Tabela pozostaje w automatycznej macierzy
-- izolacji (packages/db/test/rls-isolation.test.ts wybiera tabele po kolumnie
-- tenant_id, a ta się nie zmienia).

-- ---------------------------------------------------------------------
-- 1. Rozszerzenie public.domains
-- ---------------------------------------------------------------------

-- Rodzaj hosta. Text + CHECK zamiast enuma (konwencja statusów z 0001/0007).
-- Rozróżnienie jest ISTOTNE, nie kosmetyczne:
--   * 'subdomain' — host pod naszą kontrolą (`<slug>.avably.io`); własność jest
--     nasza z definicji, więc verified=true stawiamy sami, bez dowodu DNS,
--   * 'custom'    — domena NAJEMCY; własności dowodzi dostawca hostingu przez
--     rekord DNS, my wyłącznie odzwierciedlamy jego werdykt (nigdy nie
--     ustawiamy verified=true „z góry" — to byłoby przejęcie cudzego hosta).
-- Default 'subdomain' jest bezpieczny dla wierszy sprzed migracji: 0019 nie
-- dopuszczało innego znaczenia niż „host tenanta", a verified było tam false.
alter table public.domains
  add column kind text not null default 'subdomain'
    check (kind in ('subdomain', 'custom'));

-- Identyfikator hosta u dostawcy (Vercel Domains API). Nullable, bo wiersz
-- powstaje ZAWSZE, a rejestracja u dostawcy może się nie udać (awaria API nie
-- może wywrócić zakładania organizacji — ADR-033/036, ADR-046). NULL znaczy
-- „nie zarejestrowano u dostawcy", nie „błąd".
alter table public.domains add column provider_domain_id text;

-- Chwila potwierdzenia własności. NULL dla hostów niezweryfikowanych.
-- Świadomie osobna kolumna, nie wyliczana z verified: operator ma widzieć KIEDY
-- domena zaczęła routować, a verified bywa zdejmowane i stawiane ponownie.
alter table public.domains add column verified_at timestamptz;

-- Ostatni powód niepowodzenia rejestracji/weryfikacji, do POKAZANIA operatorowi.
-- Bez tej kolumny nieudana rejestracja u dostawcy byłaby ciszą: wiersz istnieje,
-- sklep nie odpowiada, a najemca nie ma jak się dowiedzieć dlaczego (ten sam
-- powód, dla którego ADR-033 zabrania cichego sukcesu wysyłki). NULL = brak
-- zaległego błędu; udana operacja MUSI ją czyścić, inaczej pokazywałaby
-- nieaktualny powód przy działającej domenie.
alter table public.domains add column last_error text;

comment on column public.domains.kind is
  'subdomain = `<slug>.avably.io` (host platformy, verified=true bez dowodu DNS); custom = domena najemcy (verified wyłącznie z werdyktu dostawcy).';
comment on column public.domains.provider_domain_id is
  'Identyfikator hosta u dostawcy hostingu. NULL = nie zarejestrowano (np. awaria API przy zakładaniu) — wiersz i tak istnieje.';
comment on column public.domains.last_error is
  'Ostatni powód niepowodzenia rejestracji/weryfikacji, pokazywany operatorowi. Czyszczony przy sukcesie. NIGDY nie zawiera credentiali dostawcy.';

comment on table public.domains is
  'Hosty storefrontu tenanta (Zadanie 2.6, ADR-046): automatyczna subdomena platformy + własne domeny najemców. Routuje WYŁĄCZNIE wiersz verified=true (bramka app.resolve_tenant_by_domain).';

-- Rozwiązywanie hosta po każdym żądaniu na obcą domenę idzie po kolumnie
-- `domain` — pokrywa je UNIQUE z 0019. Dokładamy indeks częściowy pod bramkę
-- routingu (tylko wiersze, które w ogóle mogą routować).
create index domains_verified_idx on public.domains (domain) where verified;

-- ---------------------------------------------------------------------
-- 2. app.resolve_tenant_by_domain — publiczne rozwiązanie hosta → tenant
-- ---------------------------------------------------------------------
--
-- LUSTRO app.resolve_tenant_by_slug (0017, ADR-039) dla drugiej osi hostów.
-- Wszystkie decyzje tamtej funkcji obowiązują tu bez zmian i z tych samych
-- powodów:
--   * SECURITY DEFINER, bo odwiedzający sklep jest ANONIMEM bez sesji, a
--     public.domains i public.tenants mają RLS (anon nie widzi żadnego wiersza,
--     0019 nie daje mu nawet GRANT-u na tabelę),
--   * zwraca WYŁĄCZNIE uuid — żadnej nazwy, statusu, slugu ani listy domen;
--     powierzchnia jednej wartości zamiast enumerowalnej tabeli,
--   * STABLE (czytająca, deterministyczna w transakcji),
--   * search_path przypięty (konwencja 0002/0003/0006),
--   * nie rzuca wyjątków — brak trafienia to NULL, więc nie dotyczy jej problem
--     „PostgREST zjada P0xxx do 500".
--
-- DWIE BRAMKI, obie zwracają NULL nieodróżnialny od nieistnienia:
--   (a) verified = true. Domena NIEZWERYFIKOWANA NIE ROUTUJE. Bez tego warunku
--       ktokolwiek mógłby wpisać w panelu CUDZĄ domenę (albo nasz własny
--       kanon `www.avably.io`) i zacząć serwować pod nią swój sklep — wiersz
--       w domains nie jest żadnym dowodem własności, dowodem jest rekord DNS
--       potwierdzony przez dostawcę. To jest bramka izolacji tego zadania.
--   (b) status tenanta in ('trialing','active') — identycznie jak 0017: sklep
--       zawieszony/anulowany jest dla publiczności nieodróżnialny od
--       nieistniejącego (NULL → middleware daje neutralne 404).
--
-- Host normalizujemy do lower-case i bez końcowej kropki: nagłówek `Host`
-- niesie klient, a `ACME.EXAMPLE.COM.` to ten sam host co `acme.example.com`.
-- CHECK z 0019 dopuszcza w kolumnie wyłącznie postać małymi literami bez
-- kropki końcowej, więc bez normalizacji te warianty dawałyby fałszywe 404.

create or replace function app.resolve_tenant_by_domain(p_host text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select t.id
  from public.domains d
  join public.tenants t on t.id = d.tenant_id
  where d.domain = rtrim(lower(p_host), '.')
    and d.verified
    and t.status in ('trialing', 'active')
  limit 1;
$$;

comment on function app.resolve_tenant_by_domain(text) is
  'Routing storefrontu po WŁASNEJ domenie najemcy: host → id tenanta, wyłącznie dla domeny verified=true i tenanta trialing|active (inaczej NULL). SECURITY DEFINER, bo odwiedzający sklep jest anonimem, a domains/tenants mają RLS. Zwraca sam uuid — żadnych innych danych. Lustro app.resolve_tenant_by_slug (0017).';

-- Domyślny EXECUTE dla PUBLIC zabrany, grant jawnie tylko wołającym rolom —
-- dokładnie jak w 0017.
revoke all on function app.resolve_tenant_by_domain(text) from public;
grant execute on function app.resolve_tenant_by_domain(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. app.create_tenant — wiersz subdomeny w TEJ SAMEJ transakcji
-- ---------------------------------------------------------------------
--
-- DLACZEGO W SQL, A NIE W AKCJI PANELU (ADR-046). Wiersz subdomeny mógłby
-- powstawać drugim wywołaniem PostgREST po create_tenant, ale:
--   (a) świeżo utworzony owner NIE MA jeszcze claimu tenant_id w JWT (hook
--       custom_access_token wstrzykuje go dopiero przy WYSTAWIENIU tokenu —
--       stąd refreshSession w akcji), więc insert do domains poleciałby na
--       politykę `tenant_id = app.tenant_id()` i został odrzucony 42501.
--       Kolejność „refresh, potem insert" działałaby, ale opierałaby
--       niezmiennik na wyścigu odświeżenia sesji,
--   (b) osobne wywołanie może paść MIĘDZY tenantem a domeną i zostawić
--         organizację bez własnego hosta — stan, którego nikt nie naprawia.
-- Tu niezmiennik „tenant istnieje ⇒ ma wiersz subdomeny" pilnuje transakcja.
-- U DOSTAWCY host rejestruje dopiero panel (@avably/core/vercel) i to
-- wywołanie jest best-effort: jego awaria zapisuje last_error, nie wywraca
-- zakładania organizacji.
--
-- ROOT DOMAIN HARDCODOWANY, ŚWIADOMIE. Kusi parametr p_root_domain, żeby
-- jedynym źródłem prawdy został ROOT_DOMAIN z @avably/core. Byłaby to DZIURA:
-- funkcja stawia verified=true bez dowodu własności (bo host jest nasz), więc
-- wołający podający własny root zarejestrowałby sobie DOWOLNĄ domenę od razu
-- jako routującą. Stała w SQL kosztuje jedną linię przy ewentualnej zmianie
-- domeny platformy; parametr kosztowałby przejęcie cudzego hosta.
--
-- GUARD REGEXEM. tenants.slug (CHECK 0001) dopuszcza slug z KOŃCOWYM myślnikiem
-- (`acme-`), a `acme-.avably.io` nie przechodzi CHECK-u hostname z 0019 —
-- naruszenie 23514 wewnątrz tej funkcji wywróciłoby CAŁE zakładanie organizacji.
-- Dlatego insert jest warunkowy: host niepasujący do CHECK-u po prostu nie
-- dostaje wiersza (tenant powstaje; operator zobaczy brak subdomeny), zamiast
-- zamieniać dziwny slug w twardą awarię onboardingu.

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

-- ---------------------------------------------------------------------
-- 4. Uzupełnienie subdomen dla tenantów sprzed tej migracji
-- ---------------------------------------------------------------------
--
-- Bez tego istniejące organizacje (w tym konta demo) miałyby pusty ekran domen
-- i nie routowałyby po żadnym wierszu — subdomena działa u nich przez
-- app.resolve_tenant_by_slug (0017), ale ekran ustawień nie miałby co pokazać,
-- a stan „host tenanta" byłby w bazie niekompletny. Ten sam guard regexem.

insert into public.domains (tenant_id, domain, kind, verified, verified_at)
select t.id, lower(t.slug) || '.avably.io', 'subdomain', true, now()
from public.tenants t
where (lower(t.slug) || '.avably.io') ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  and length(lower(t.slug) || '.avably.io') <= 253
on conflict (domain) do nothing;
