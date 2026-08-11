-- =====================================================================
-- 0070 — REGULAMIN PLATFORMY (SaaS): NIEZMIENNE WERSJE + DOWÓD AKCEPTACJI
--        (ADR-141; platformowe lustro wzorca B4/ADR-129)
-- =====================================================================
--
-- Regulamin świadczenia usługi Avably (umowa platforma↔najemca) nie istniał
-- dotąd w systemie w ogóle: rejestracja i założenie organizacji nie zbierały
-- żadnej zgody, a LP nie miało strony /terms. Ta migracja buduje MECHANIKĘ;
-- TREŚĆ przyjdzie od prawnika OSOBNĄ migracją-seedem (decyzja D7 spike'u:
-- mechanika merguje się od razu, treść czeka na prawnika).
--
-- Dwa byty — platformowe lustro pary z 0063 (legal_document_versions +
-- orders.terms_version_id), bez tenant_id na rejestrze, bo dokument jest
-- JEDEN dla całej platformy:
--
--   public.platform_terms_versions    — REJESTR wersji, append-only, NIEZMIENNE
--   public.platform_terms_acceptances — DOWÓD akceptacji = FK do wiersza wersji
--
-- ROZSTRZYGNIĘCIA SPIKE'U (regulamin-saas-wdrozenie.md), przyjęte przez PM:
--   D1: PARA JĘZYKÓW W JEDNYM WIERSZU wersji (nie wiersz per locale jak w B4).
--       Akceptacja wskazuje WERSJĘ UMOWY, nie język: PL wiążący, EN
--       informacyjny (§15 ust. 3 projektu), a parytet PL↔EN jest własnością
--       wersji i ma być atomowy — stąd CHECK-i na obu treściach i OBA stemple.
--   D2: akceptacja przy ORGANIZACJI (app.create_tenant, ta sama transakcja),
--       nie przy koncie: stroną umowy jest organizacja (§1 ust. 4), personel
--       z zaproszenia nie akceptuje niczego, trial startuje w tym samym RPC.
--   D3: nowa wersja WYŁĄCZNIE migracją (recenzja jak kod) — panel nie dostaje
--       UI edycji, superadmin nie dostaje RPC zapisu.
--   D5: wymuszenie TWARDE w samym RPC (fail-closed): przy istniejącej wersji
--       obowiązującej create_tenant bez wskazania wersji ODMAWIA. Bez tego
--       uwierzytelniony użytkownik wołałby RPC wprost przez PostgREST i miał
--       organizację bez śladu akceptacji — dokładnie uzasadnienie B4
--       („wskazanie wersji bez zgody byłoby dowodem zgody bez zgody").
--   D8: IP/user-agent przy akceptacji ŚWIADOMIE NIE zapisywane (minimalizacja
--       danych; user_id + accepted_at + odcisk wersji wystarczą jako dowód).
--
-- SZKIC (wiersz z effective_from IS NULL). Rejestr przyjmuje wiersz, który
-- NIE obowiązuje i NIE jest widoczny publicznie — to jest platformowy
-- odpowiednik szkicu z 0063 (tam: osobna tabela; tu: osobny STAN, bo treść
-- i tak wchodzi migracją, więc osobna tabela robocza nie ma czego trzymać).
-- Publicznie (RPC niżej) wychodzą WYŁĄCZNIE wersje z effective_from NOT NULL;
-- wiąże (i wymusza akceptację) wyłącznie wersja z effective_from <= now().
--
-- SEED TEJ MIGRACJI: placeholder v0 „[treść po weryfikacji prawnika]" jako
-- SZKIC — NIE-opublikowany. Skutek NA ZNAK zgodny z dniem wczorajszym:
-- get_platform_terms() zwraca NULL, /terms na LP odpowiada 404, checkbox
-- w onboardingu się nie renderuje, create_tenant przyjmuje wywołania bez
-- wersji, przesłona w panelu nie zapala się nikomu. Mechanika czeka
-- w gotowości na migrację-następnik z treścią od prawnika (v1,
-- effective_from = data startu komercyjnego — bramka (f) z ADR-138:
-- pierwsze realne `suspended` nie może wyprzedzić obowiązującego regulaminu).
--
-- NUMERACJA WERSJI: nadaje ją BAZA (trigger: max+1, start od 0), etykietę
-- liczy kolumna generowana ('v' || version_no). v0 = placeholder-szkic;
-- pierwsza wersja wiążąca od prawnika dostanie v1 sama z siebie.

-- === BEGIN PROD MIGRATION 0070 ===

-- ---------------------------------------------------------------------
-- 1. REJESTR WERSJI — append-only, niezmienne, para języków w wierszu
-- ---------------------------------------------------------------------

create table public.platform_terms_versions (
  id uuid primary key default gen_random_uuid(),
  -- Nadaje baza (trigger stempla: max+1). CHECK >= 0, nie >= 1 jak w B4:
  -- v0 to zarezerwowany numer placeholder-szkicu z seedu tej migracji.
  version_no integer not null check (version_no >= 0),
  -- Etykieta publiczna liczona przez bazę — nie da się jej podać z wejścia.
  version_label text generated always as ('v' || version_no::text) stored,
  title_pl text not null check (char_length(btrim(title_pl)) between 1 and 200),
  body_pl text not null check (char_length(btrim(body_pl)) between 1 and 100000),
  -- Tłumaczenie informacyjne — WYMAGANE (parytet PL↔EN jest własnością
  -- wersji, decyzja D1): wersja bez któregokolwiek języka nie istnieje.
  title_en text not null check (char_length(btrim(title_en)) between 1 and 200),
  body_en text not null check (char_length(btrim(body_en)) between 1 and 100000),
  -- Stempluje trigger z dokładnych bajtów body_* — wartości z wejścia są
  -- nadpisywane (wzorzec 0063: „hash od wołającego nie dowodzi niczego").
  sha256_pl text not null check (sha256_pl ~ '^[0-9a-f]{64}$'),
  sha256_en text not null check (sha256_en ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null default now(),
  -- NULL = SZKIC: wiersz nie obowiązuje i nie wychodzi żadną drogą publiczną.
  -- Wartość w przyszłości = wersja OGŁOSZONA (czytelna permalinkiem, jeszcze
  -- nie wiąże — okres uprzedzenia §14). Wartość <= now() = wersja OBOWIĄZUJE.
  effective_from timestamptz,

  constraint platform_terms_versions_no_key unique (version_no),
  constraint platform_terms_versions_effective_after_publish
    check (effective_from is null or effective_from >= published_at)
);

comment on table public.platform_terms_versions is
  'ADR-141: REJESTR wersji regulaminu platformy (umowa Avably↔najemca) — append-only i NIEZMIENNY, platformowe lustro legal_document_versions (B4/ADR-129), bez tenant_id (dokument jeden dla platformy). Para języków w JEDNYM wierszu (D1): PL wiążący, EN informacyjny. Nowa wersja wchodzi WYŁĄCZNIE migracją (D3). Wiersz z effective_from NULL to SZKIC — nie obowiązuje i nie jest widoczny publicznie.';
comment on column public.platform_terms_versions.version_no is
  'Numer nadawany przez bazę (trigger stempla: max+1, start od 0). v0 = placeholder-szkic z seedu 0070; wersje wiążące zaczynają się od v1.';
comment on column public.platform_terms_versions.sha256_pl is
  'SHA-256 dokładnych bajtów body_pl, stemplowany przez bazę (app.stamp_platform_terms_version). Wartość podana przez wołającego jest ignorowana.';
comment on column public.platform_terms_versions.effective_from is
  'Od kiedy wersja wiąże. NULL = szkic (niewidoczny publicznie); przyszłość = ogłoszona (permalink działa, obowiązek akceptacji jeszcze nie); <= now() = obowiązująca. CHECK: nie wcześniej niż published_at.';

-- ---------------------------------------------------------------------
-- 2. DOWÓD AKCEPTACJI — FK do wiersza wersji, append-only
-- ---------------------------------------------------------------------

create table public.platform_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  -- Akceptacja ZAWSZE w kontekście organizacji — stroną umowy jest
  -- organizacja (§1 ust. 4 projektu regulaminu), nie konto e-mail (D2).
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- SNAPSHOT ręki, która kliknęła — celowo BEZ FK do auth.users: dowód ma
  -- przeżyć usunięcie konta (wzorzec published_by z 0063 i audit_log).
  user_id uuid not null,
  -- Dowód wskazuje WIERSZ niezmiennej wersji — nigdy wolny string (B4).
  -- Bez ON DELETE: wersji się nie kasuje (strażnik), a dowód nie może
  -- stracić celu.
  version_id uuid not null references public.platform_terms_versions(id),
  context text not null check (context in ('tenant_creation', 'terms_update')),
  accepted_at timestamptz not null default now(),

  -- Idempotencja per (organizacja, wersja): może być >1 ownera, ale umowa
  -- na daną wersję zawiera się raz. Indeks unikatowy jest zarazem indeksem
  -- odczytu bramki layoutu (lookup po tenant_id, version_id).
  constraint platform_terms_acceptances_tenant_version_key unique (tenant_id, version_id)
);

comment on table public.platform_terms_acceptances is
  'ADR-141: DOWÓD akceptacji regulaminu platformy przez organizację — append-only, FK do niezmiennej wersji (nigdy wolny string, wzorzec B4). Zapis WYŁĄCZNIE przez funkcje DEFINER (app.create_tenant, app.accept_platform_terms) — zero polityk INSERT dla sesji. IP/user-agent świadomie NIE zapisywane (D8 — minimalizacja danych).';
comment on column public.platform_terms_acceptances.context is
  'Skąd akceptacja: tenant_creation (checkbox przy zakładaniu organizacji, ta sama transakcja co tenant) albo terms_update (przesłona/baner dla kont istniejących przy nowej wersji).';

-- ---------------------------------------------------------------------
-- 3. STEMPEL WERSJI — numer, hashe i moment publikacji nadaje BAZA
-- ---------------------------------------------------------------------

create or replace function app.stamp_platform_terms_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  -- Numer nadaje baza: max+1 (start od 0). Wartość z wejścia — nadpisana,
  -- z tego samego powodu co hash: numeracja jest własnością rejestru, nie
  -- umową z wołającym. Wyścig dwóch INSERT-ów kończy się na unikacie
  -- version_no — akceptowalne z konstrukcji: wiersze wstawiają wyłącznie
  -- migracje (D3), a te biegną sekwencyjnie.
  select coalesce(max(version_no), -1) + 1
    into new.version_no
  from public.platform_terms_versions;

  new.sha256_pl := encode(sha256(convert_to(new.body_pl, 'UTF8')), 'hex');
  new.sha256_en := encode(sha256(convert_to(new.body_en, 'UTF8')), 'hex');
  new.published_at := now();
  return new;
end;
$$;

comment on function app.stamp_platform_terms_version() is
  'Stempel wersji regulaminu platformy (ADR-141): version_no (max+1), sha256_pl/en z dokładnych bajtów body_* i published_at z zegara serwera. Wartości z wejścia są nadpisywane — hash i numer od wołającego nie dowodzą niczego (wzorzec 0063).';

revoke all on function app.stamp_platform_terms_version() from public;

create trigger platform_terms_versions_stamp
  before insert on public.platform_terms_versions
  for each row execute function app.stamp_platform_terms_version();

-- ---------------------------------------------------------------------
-- 4. NIEZMIENNOŚĆ — strażnicy UPDATE/DELETE (druga warstwa obok grantów)
-- ---------------------------------------------------------------------
--
-- Warstwa pierwsza to GRANTY (sekcja 5): role API nie dostają zapisu w ogóle.
-- Dublowanie strażnikiem jest celowe, jak w 0063: grant to jedno `alter` od
-- zniknięcia, a wtedy dałoby się PO CICHU podmienić tekst umowy, na którą
-- przystali najemcy. Odmowa 42501 — ten sam SQLSTATE co odmowa RLS.
--
-- service_role PRZEPUSZCZANY: przy wersjach wyłącznie jako droga serwisowa
-- (sprzątanie testowe); przy akceptacjach dodatkowo kaskada offboardingu
-- tenanta (DELETE z public.tenants idzie tą rolą i ciągnie dowody za sobą —
-- akceptacje skasowanej organizacji nie mają już czego dowodzić).

create or replace function app.guard_platform_terms_version_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  if pg_has_role(current_user, 'service_role', 'USAGE') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception
    'Wersji regulaminu platformy nie można zmienić ani usunąć — nowa treść wchodzi nową wersją (migracją).'
    using errcode = '42501';
end;
$$;

comment on function app.guard_platform_terms_version_write() is
  'Strażnik niezmienności rejestru wersji regulaminu platformy (ADR-141): UPDATE i DELETE wykonuje wyłącznie rola serwisowa. Odmowa: 42501 — nieodróżnialna od odmowy RLS (wzorzec 0063).';

revoke all on function app.guard_platform_terms_version_write() from public;

create trigger platform_terms_versions_guard_write
  before update or delete on public.platform_terms_versions
  for each row execute function app.guard_platform_terms_version_write();

create or replace function app.guard_platform_terms_acceptance_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  if pg_has_role(current_user, 'service_role', 'USAGE') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception
    'Dowód akceptacji regulaminu jest niezmienny — wpisów nie można edytować ani usuwać.'
    using errcode = '42501';
end;
$$;

comment on function app.guard_platform_terms_acceptance_write() is
  'Strażnik append-only dowodów akceptacji regulaminu platformy (ADR-141): UPDATE i DELETE wyłącznie rolą serwisową (kaskada offboardingu tenanta). Odmowa: 42501.';

revoke all on function app.guard_platform_terms_acceptance_write() from public;

create trigger platform_terms_acceptances_guard_write
  before update or delete on public.platform_terms_acceptances
  for each row execute function app.guard_platform_terms_acceptance_write();

-- ---------------------------------------------------------------------
-- 5. RLS i GRANTY
-- ---------------------------------------------------------------------
--
-- REJESTR WERSJI: zero grantów dla ról API i zero polityk (RLS włączone,
-- fail-closed). Jedyna droga odczytu to funkcje DEFINER z sekcji 6 — czyli
-- „anon widzi wyłącznie opublikowane" jest własnością definicji funkcji,
-- a nie warunkiem WHERE w zapytaniu klienta, który dałoby się przeoczyć.
-- Szkic (effective_from IS NULL) nie występuje w żadnej z tych dróg.

alter table public.platform_terms_versions enable row level security;
revoke all on public.platform_terms_versions from public, anon, authenticated;
grant select, insert, update, delete on public.platform_terms_versions to service_role;

-- DOWODY AKCEPTACJI: odczyt dla ŻYWEGO członka organizacji (spike mówił
-- „owner widzi", świadomie poszerzone do członka — patrz niżej), zapis
-- WYŁĄCZNIE przez funkcje DEFINER (zero grantu INSERT dla sesji).
--
-- DLACZEGO CZŁONEK, NIE TYLKO OWNER: bramka przesłony w layoucie panelu
-- czyta „czy organizacja ma akceptację bieżącej wersji" sesją użytkownika.
-- Claim roli bywa nieświeży do godziny (ADR-126) — owner zdegradowany do
-- personelu ma jeszcze claim „owner", a polityka zawężona do
-- app.is_tenant_owner() (stan ŻYWY) zwracałaby mu pusto i przesłona
-- zapalałaby się użytkownikowi, który nie może już niczego zaakceptować.
-- FAKT zawarcia umowy nie jest tajemnicą wobec własnego personelu; treścią
-- wpisu jest wyłącznie (wersja, kto, kiedy).

alter table public.platform_terms_acceptances enable row level security;
revoke all on public.platform_terms_acceptances from public, anon, authenticated;
grant select on public.platform_terms_acceptances to authenticated;
grant select, insert, update, delete on public.platform_terms_acceptances to service_role;

create policy tenant_select on public.platform_terms_acceptances for select
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );

-- ---------------------------------------------------------------------
-- 6. ODCZYT PUBLICZNY — żywa wersja + permalink (lustro 0063, sekcja 7)
-- ---------------------------------------------------------------------
--
-- Grant anon+authenticated ŚWIADOMY: LP pokazuje regulamin niezalogowanym
-- PRZED rejestracją (checkbox onboardingu linkuje do /terms), a treść jest
-- z definicji publiczna. Obie funkcje wymagają wpisu w allowliście
-- packages/db/test/function-acls.test.ts — i to jest pożądany moment recenzji.

create or replace function app.get_platform_terms()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'version_id', v.id,
    'version_no', v.version_no,
    'version_label', v.version_label,
    'title_pl', v.title_pl,
    'body_pl', v.body_pl,
    'title_en', v.title_en,
    'body_en', v.body_en,
    'sha256_pl', v.sha256_pl,
    'sha256_en', v.sha256_en,
    'published_at', v.published_at,
    'effective_from', v.effective_from
  )
  from public.platform_terms_versions v
  where v.effective_from is not null
    and v.effective_from <= now()
  order by v.version_no desc
  limit 1;
$$;

comment on function app.get_platform_terms() is
  'ADR-141: ŻYWA (obowiązująca) wersja regulaminu platformy — najwyższy version_no z effective_from <= now(). NULL = żadna wersja nie obowiązuje (stan sprzed treści od prawnika): LP odpowiada 404, checkbox onboardingu się nie renderuje, wymuszenie w create_tenant śpi. Szkic (effective_from NULL) nie wychodzi tą drogą. SECURITY DEFINER; grant anon — LP pokazuje umowę przed rejestracją.';

revoke all on function app.get_platform_terms() from public, anon, authenticated;
grant execute on function app.get_platform_terms() to anon, authenticated;

create or replace function app.get_platform_terms_version(p_version_no integer)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'version_id', v.id,
    'version_no', v.version_no,
    'version_label', v.version_label,
    'title_pl', v.title_pl,
    'body_pl', v.body_pl,
    'title_en', v.title_en,
    'body_en', v.body_en,
    'sha256_pl', v.sha256_pl,
    'sha256_en', v.sha256_en,
    'published_at', v.published_at,
    'effective_from', v.effective_from,
    'current', (
      v.version_no = (
        select max(cur.version_no)
        from public.platform_terms_versions cur
        where cur.effective_from is not null
          and cur.effective_from <= now()
      )
    )
  )
  from public.platform_terms_versions v
  where v.version_no = p_version_no
    -- SZKIC NIE WYCHODZI PERMALINKIEM. Wersja OGŁOSZONA (effective_from w
    -- przyszłości) wychodzi — owner musi móc przeczytać nową treść w okresie
    -- uprzedzenia (§14), zanim zacznie ona wiązać.
    and v.effective_from is not null;
$$;

comment on function app.get_platform_terms_version(integer) is
  'ADR-141: permalink KONKRETNEJ wersji regulaminu platformy (numer, nie uuid — adres ma dać się przepisać). Zwraca wersje opublikowane (effective_from NOT NULL), także ogłoszone-jeszcze-nie-wiążące (okres uprzedzenia §14); SZKIC (effective_from NULL) nie wychodzi NIGDY. Klucz `current` mówi, czy to wersja obowiązująca. SECURITY DEFINER.';

revoke all on function app.get_platform_terms_version(integer) from public, anon, authenticated;
grant execute on function app.get_platform_terms_version(integer) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. AKCEPTACJA DLA KONT ISTNIEJĄCYCH — app.accept_platform_terms
-- ---------------------------------------------------------------------
--
-- Droga dla organizacji, które istniały PRZED wejściem wersji w życie
-- (przesłona w layoucie panelu, context='terms_update'). Dla nowych
-- organizacji dowód powstaje w app.create_tenant (sekcja 8).

create or replace function app.accept_platform_terms(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, app
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid := app.tenant_id();
  v_target record;
  v_current_no integer;
begin
  if v_user_id is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;

  if v_tenant_id is null then
    raise exception 'Akceptacja regulaminu wymaga kontekstu organizacji.' using errcode = '28000';
  end if;

  -- BRAMKA ŻYWEGO OWNERA — wprost po members, nie po claimie: umowę w imieniu
  -- organizacji zawiera właściciel (D2/D4); personel jest przepuszczany przez
  -- przesłonę bez pytania, więc nie ma czego tu wołać. DEFINER omija RLS,
  -- stąd zapytanie jawne zamiast app.is_tenant_owner() (INVOKER).
  if not exists (
    select 1
    from public.members m
    where m.tenant_id = v_tenant_id
      and m.user_id = v_user_id
      and m.role = 'owner'
  ) then
    raise exception 'Regulamin w imieniu organizacji akceptuje właściciel.' using errcode = '42501';
  end if;

  -- Cel musi być wersją OPUBLIKOWANĄ (szkic nie jest umową)…
  select v.id, v.version_no
    into v_target
  from public.platform_terms_versions v
  where v.id = p_version_id
    and v.effective_from is not null;

  if not found then
    raise exception 'Wskazana wersja regulaminu nie istnieje albo nie została opublikowana.'
      using errcode = '22023';
  end if;

  -- …i nie może być STARSZA niż wersja obowiązująca: akceptacja wstecz nie
  -- zdejmuje obowiązku wobec bieżącej umowy. Wersję OGŁOSZONĄ (nowszą,
  -- jeszcze nie wiążącą) wolno przyjąć wcześniej — okres uprzedzenia §14.
  select max(v.version_no)
    into v_current_no
  from public.platform_terms_versions v
  where v.effective_from is not null
    and v.effective_from <= now();

  if v_current_no is not null and v_target.version_no < v_current_no then
    raise exception 'Wskazana wersja regulaminu została zastąpiona nowszą — zaakceptuj wersję obowiązującą.'
      using errcode = '22023';
  end if;

  -- Idempotentnie: drugi owner (albo drugi klik) nie tworzy drugiej umowy.
  insert into public.platform_terms_acceptances (tenant_id, user_id, version_id, context)
  values (v_tenant_id, v_user_id, p_version_id, 'terms_update')
  on conflict (tenant_id, version_id) do nothing;
end;
$$;

comment on function app.accept_platform_terms(uuid) is
  'ADR-141: akceptacja regulaminu platformy przez ŻYWEGO ownera organizacji (konta istniejące — przesłona w layoucie panelu, context=terms_update). Cel: wersja opublikowana, nie starsza niż obowiązująca (ogłoszoną wolno przyjąć wcześniej — §14). Idempotentna per (tenant, wersja). SECURITY DEFINER — jedyna droga zapisu poza create_tenant.';

revoke all on function app.accept_platform_terms(uuid) from public, anon;
grant execute on function app.accept_platform_terms(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. app.create_tenant — akceptacja w TEJ SAMEJ transakcji co organizacja
-- ---------------------------------------------------------------------
--
-- ZMIANA SYGNATURY (2 → 3 argumenty z defaultem), więc `drop` + pełna
-- najświeższa definicja (baza: 0066; wzorzec 0065/0066 — stare pliki
-- migracji nietknięte). PostgREST woła z named args, więc dotychczasowe
-- dwuargumentowe wywołania rozwiązują się na wariant z defaultem NULL.
--
-- Różnice merytoryczne wobec 0066 oznaczone [0070] i są DOKŁADNIE TRZY:
-- nowy parametr, blok walidacji wersji po bramce limitu organizacji oraz
-- INSERT dowodu akceptacji po INSERT-cie członkostwa. Reszta przepisana
-- co do znaku.

drop function app.create_tenant(text, text);

create function app.create_tenant(
  p_slug text,
  p_name text,
  p_terms_version_id uuid default null
)
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
  -- [0070] Wersja OBOWIĄZUJĄCA rozstrzygana przez bazę, nigdy z payloadu.
  v_terms_id uuid;
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

  -- [0070] WYMUSZENIE TWARDE (ADR-141, D5, fail-closed). Gdy jakakolwiek
  -- wersja regulaminu OBOWIĄZUJE, organizacja nie powstaje bez wskazania
  -- DOKŁADNIE tej wersji: bez tego uwierzytelniony użytkownik wołałby RPC
  -- wprost przez PostgREST i miał organizację bez śladu akceptacji.
  -- Gdy nic nie obowiązuje (stan przed treścią od prawnika), NULL przechodzi
  -- — zachowanie sprzed 0070 co do znaku; wskazanie czegokolwiek w tym
  -- stanie to błąd wołającego (dowód na nieobowiązującą wersję byłby
  -- kłamstwem w drugą stronę).
  select v.id into v_terms_id
  from public.platform_terms_versions v
  where v.effective_from is not null
    and v.effective_from <= now()
  order by v.version_no desc
  limit 1;

  if v_terms_id is not null then
    if p_terms_version_id is null then
      raise exception 'Do założenia organizacji wymagana jest akceptacja regulaminu.'
        using errcode = 'P0003';
    end if;
    if p_terms_version_id <> v_terms_id then
      raise exception 'Wskazana wersja regulaminu nie jest wersją obowiązującą — odśwież formularz i zaakceptuj aktualną.'
        using errcode = '22023';
    end if;
  elsif p_terms_version_id is not null then
    raise exception 'Wskazana wersja regulaminu nie obowiązuje.' using errcode = '22023';
  end if;

  -- BRAMKA SLUGÓW ZAREZERWOWANYCH (0023). Bez niej najemca brał adres, pod
  -- którym routing nigdy nie znajdzie jego sklepu (ADR-039).
  if lower(btrim(p_slug)) = any (app.reserved_subdomains()) then
    raise exception 'Adres „%" jest zarezerwowany — wybierz inny.', lower(btrim(p_slug))
      using errcode = '22023';
  end if;

  -- ZEGAR TRIALA (0066, ADR-135): now() + 14 dni w TEJ SAMEJ transakcji co
  -- created_at (default now()), więc trial_ends_at - created_at = dokładnie
  -- 14 dni. Wartość wyłącznie informacyjna w fazie 1 — patrz komentarz kolumny.
  insert into public.tenants (slug, name, trial_ends_at)
  values (p_slug, p_name, now() + interval '14 days')
  returning id into v_tenant_id;

  insert into public.members (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner');

  -- [0070] DOWÓD AKCEPTACJI w tej samej transakcji co tenant + członkostwo
  -- (D2: umowa i trial zaczynają się w tym samym punkcie; wzorzec B4 —
  -- dowód zgody powstaje razem z bytem, którego dotyczy). Wiersz wskazuje
  -- wersję zweryfikowaną WYŻEJ przeciw rejestrowi, nie surowy payload.
  if v_terms_id is not null then
    insert into public.platform_terms_acceptances (tenant_id, user_id, version_id, context)
    values (v_tenant_id, v_user_id, p_terms_version_id, 'tenant_creation');
  end if;

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

comment on function app.create_tenant(text, text, uuid) is
  'Onboarding organizacji: tenant + członkostwo ownera + DOWÓD AKCEPTACJI REGULAMINU (0070, ADR-141) + subdomena w JEDNEJ transakcji. Slugi zarezerwowane odrzuca 22023 (0023); trial_ends_at = now() + 14 dni (0066, ADR-135). Wymuszenie twarde (D5): przy obowiązującej wersji regulaminu brak p_terms_version_id → P0003, wersja inna niż obowiązująca → 22023; bez obowiązującej wersji NULL przechodzi (zachowanie sprzed 0070).';

-- ACL restated (konwencja ADR-132 / docs/konwencje-migracji.md): migracja
-- podmieniająca funkcję app.* jawnie potwierdza uprawnienia w tym samym
-- pliku. Po `drop function` ACL i tak powstaje od zera — stan ma być
-- czytelny z tej migracji. authenticated: onboarding woła zalogowany
-- użytkownik z panelu (bramki w ciele: potwierdzony e-mail, limit 2 org,
-- akceptacja regulaminu). anon celowo BEZ grantu.
revoke all on function app.create_tenant(text, text, uuid) from public;
grant execute on function app.create_tenant(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9. SEED: placeholder v0 jako SZKIC — mechanika bez żywej wersji
-- ---------------------------------------------------------------------
--
-- effective_from NULL ⇒ wiersz jest niewidoczny publicznie i NICZEGO nie
-- wymusza (patrz nagłówek migracji). Treść od prawnika wejdzie migracją-
-- następnikiem jako v1 (numer nada trigger) z effective_from = data startu
-- komercyjnego. sha256/published_at/version_no stempluje trigger.

insert into public.platform_terms_versions (title_pl, body_pl, title_en, body_en, effective_from)
values (
  'Regulamin świadczenia usługi Avably',
  '[treść po weryfikacji prawnika]',
  'Avably Terms of Service',
  '[content pending legal review]',
  null
);

-- === END PROD MIGRATION 0070 ===
