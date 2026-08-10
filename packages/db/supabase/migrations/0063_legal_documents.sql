-- =====================================================================
-- 0063 — DOKUMENTY PRAWNE SKLEPU NAJEMCY: szkic + NIEZMIENNE WERSJE
--        (B4, ADR-129; zamyka R18)
-- =====================================================================
--
-- Sklep najemcy linkuje dziś do /regulamin i /prywatnosc w czterdziestu
-- miejscach szablonów, a pod tymi adresami nie ma niczego. Równolegle każdy
-- najemca ma od 0026 (ADR-061) gotową treść regulaminu w
-- tenant_settings.contract_document.terms_body — używaną WYŁĄCZNIE do PDF-a
-- umowy. Treść istnieje, brakuje jej publicznego wyjścia i historii.
--
-- Ta migracja dokłada DWA byty i jedną kolumnę:
--
--   public.legal_documents          — SZKIC, dokładnie jeden na (tenant, rodzaj)
--   public.legal_document_versions  — REJESTR, wersje APPEND-ONLY i NIEZMIENNE
--   public.orders.terms_version_id  — zamówienie wskazuje WIERSZ wersji
--
-- DLACZEGO OSOBNE TABELE, A NIE KOLEJNY KLUCZ W tenant_settings ANI SEKCJA
-- KREATORA: jedno i drugie NADPISUJE treść w miejscu. Po edycji przez najemcę
-- nie da się już okazać tekstu, na który przystał klient — a to jest cała
-- wartość dowodowa orders.terms_version. Rejestr wymaga bytu, którego się nie
-- zmienia; tabela wersji jest tym bytem.
--
-- DLACZEGO TO NIE ŁAMIE KANONU ADR-091 (kolumna widoczna publicznie ma mieć
-- bliźniaka *_published): kanon i strażnik app.guard_published_columns są
-- związane z sites/site_sections i rozwiązują tam ten sam problem parą kolumn.
-- Tutaj ten sam niezmiennik — „stan widoczny publicznie zmienia WYŁĄCZNIE
-- publikacja" — daje ROZDZIAŁ TABEL, i daje go mocniej: odczyt publiczny nie
-- widzi tabeli szkiców w ogóle, a wiersze, które widzi, są niezmienne z
-- konstrukcji. Bliźniaki byłyby tu słabszą wersją tej samej gwarancji.
--
-- ZERO RYZYKA DLA ISTNIEJĄCYCH NAJEMCÓW wynika z jednej własności: w chwili
-- tej migracji ŻADEN dokument nie jest opublikowany (backfill idzie do szkicu,
-- patrz sekcja 8), więc gałąź „brak opublikowanego dokumentu" w
-- app.public_checkout odtwarza dzisiejsze zachowanie CO DO ZNAKU. Nowa ścieżka
-- włącza się dopiero, gdy najemca sam kliknie „Opublikuj".

-- === BEGIN PROD MIGRATION 0063 ===

-- ---------------------------------------------------------------------
-- 1. SZKIC dokumentu — jeden na (tenant, rodzaj)
-- ---------------------------------------------------------------------
--
-- `kind` zamiast osobnych tabel na regulamin i politykę prywatności: oba
-- dokumenty mają identyczny cykl życia (pisz → opublikuj → wersjonuj) i
-- identyczny kształt. Trzeci rodzaj dołoży się jedną wartością w CHECK-u.
--
-- `locale` na SZKICU, nie tylko na wersji: język jest cechą dokumentu, którą
-- publikacja utrwala w migawce. Oś tenancka nie ma prefiksu locale w URL-u,
-- więc to jedyne miejsce, z którego strona wie, w jakim języku jest tekst.

create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('terms', 'privacy')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body_draft text not null check (char_length(btrim(body_draft)) between 1 and 50000),
  locale text not null check (locale in ('en', 'pl')),
  -- Wskaźnik na ŻYWĄ wersję. NULL = dokument nigdy nie opublikowany, czyli
  -- publicznie nie istnieje. FK dodany w sekcji 3, po tabeli wersji.
  current_version_id uuid,
  updated_at timestamptz not null default now(),

  constraint legal_documents_tenant_kind_key unique (tenant_id, kind),
  constraint legal_documents_tenant_id_key unique (tenant_id, id)
);

create index legal_documents_tenant_kind_idx
  on public.legal_documents (tenant_id, kind);

comment on table public.legal_documents is
  'B4/ADR-129: SZKIC dokumentu prawnego sklepu (regulamin, polityka prywatności) — jeden na (tenant, rodzaj). Treść widoczna publicznie NIE pochodzi z tej tabeli, tylko z wiersza wskazanego przez current_version_id.';
comment on column public.legal_documents.body_draft is
  'Robocza treść dokumentu. Nie jest odczytywana publicznie ani razu — publiczny odczyt widzi WYŁĄCZNIE opublikowaną wersję (app.get_published_legal_document).';
comment on column public.legal_documents.current_version_id is
  'Wersja ŻYWA (widoczna w sklepie). NULL = dokument nieopublikowany: sklep zachowuje się dokładnie tak, jak przed migracją 0063.';

-- ---------------------------------------------------------------------
-- 2. REJESTR WERSJI — append-only, niezmienne
-- ---------------------------------------------------------------------
--
-- To jest sedno całego zadania. Wiersz tej tabeli powstaje przy publikacji
-- i NIGDY się nie zmienia, więc zdanie „pokaż regulamin, który zaakceptował
-- ten klient" ma odpowiedź po dowolnej liczbie późniejszych edycji.
--
-- `version_label` NADAJE BAZA ('v' || version_no), nigdy wołający. Etykieta
-- jest identyfikatorem publicznym (jedzie do przeglądarki i wraca w checkoucie),
-- więc jej unikalność i format muszą być własnością bazy, a nie umową z
-- formularzem. Limit 1..100 jest LUSTREM CHECK-a orders.terms_version z 0020 —
-- etykieta musi się zmieścić w kolumnie, która ją utrwala.
--
-- `sha256` STEMPLUJE TRIGGER z sekcji 4, z dokładnych bajtów `body`. Hash
-- podany przez wołającego nie jest dowodem niczego; policzony przez bazę jest.
--
-- `published_by` to SNAPSHOT aktora, nie FK — dokument ma przeżyć usunięcie
-- konta operatora, który go opublikował (wzorzec contract_documents.created_by
-- z 0026 i audit_log.actor_user_id).

create table public.legal_document_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null,
  kind text not null check (kind in ('terms', 'privacy')),
  version_no integer not null check (version_no >= 1),
  version_label text not null check (char_length(btrim(version_label)) between 1 and 100),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 50000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  locale text not null check (locale in ('en', 'pl')),
  published_at timestamptz not null default now(),
  published_by uuid not null,

  constraint legal_document_versions_document_fk
    foreign key (tenant_id, document_id)
    references public.legal_documents (tenant_id, id) on delete cascade,
  constraint legal_document_versions_no_key unique (tenant_id, kind, version_no),
  constraint legal_document_versions_label_key unique (tenant_id, kind, version_label),
  constraint legal_document_versions_tenant_id_key unique (tenant_id, id)
);

create index legal_document_versions_tenant_kind_idx
  on public.legal_document_versions (tenant_id, kind, version_no desc);

comment on table public.legal_document_versions is
  'B4/ADR-129: REJESTR wersji dokumentów prawnych — append-only i NIEZMIENNY. Jedyne źródło treści widocznej publicznie i jedyny cel orders.terms_version_id. Brak GRANT-u UPDATE/DELETE dla zwykłej sesji + strażnik app.guard_legal_document_version_write.';
comment on column public.legal_document_versions.version_label is
  'Publiczny identyfikator wersji nadawany przez bazę (v1, v2, ...). Limit 1..100 jest lustrem CHECK-a orders.terms_version (0020) — etykieta musi zmieścić się w kolumnie, która utrwala zgodę.';
comment on column public.legal_document_versions.sha256 is
  'SHA-256 dokładnych bajtów `body`, stemplowany przez bazę (app.stamp_legal_document_version). Wartość podana przez wołającego jest ignorowana.';

-- ---------------------------------------------------------------------
-- 3. Wskaźnik żywej wersji — FK złożony, ODROCZONY
-- ---------------------------------------------------------------------
--
-- Złożony (tenant_id, current_version_id), więc dokument NIE MA JAK wskazać
-- wersji innego najemcy — to granica tenanta wyrażona schematem, nie kodem.
--
-- DEFERRABLE INITIALLY DEFERRED jest KONIECZNE, nie ozdobne: usunięcie tenanta
-- kasuje kaskadą OBIE tabele, a kolejność wyzwalaczy referencyjnych między nimi
-- nie jest określona. Przy sprawdzeniu natychmiastowym skasowanie wersji przed
-- dokumentem wywracałoby offboarding najemcy błędem FK. Odroczenie przesuwa
-- sprawdzenie na koniec transakcji, gdy nie ma już ani jednej, ani drugiej.

alter table public.legal_documents
  add constraint legal_documents_current_version_fk
  foreign key (tenant_id, current_version_id)
  references public.legal_document_versions (tenant_id, id)
  deferrable initially deferred;

-- ---------------------------------------------------------------------
-- 4. NIEZMIENNOŚĆ WERSJI — dwie warstwy
-- ---------------------------------------------------------------------
--
-- Warstwa pierwsza to GRANTY (sekcja 5): `authenticated` dostaje select+insert
-- i nic więcej, dokładnie jak przy contract_documents (0026). Warstwa druga to
-- ten strażnik. Dublowanie jest celowe: grant to jedno `alter` od zniknięcia,
-- a wtedy właściciel mógłby PO CICHU podmienić tekst, na który przystał klient.
-- Odmowa 42501 — ten sam SQLSTATE co odmowa RLS i co strażnik z 0048, więc
-- warstwa aplikacji nie musi ich rozróżniać.
--
-- service_role PRZEPUSZCZANY: kaskada z public.tenants (offboarding, sprzątanie
-- testów) idzie tą rolą, a wersje dokumentu kasowanego razem z najemcą nie mają
-- już czego dowodzić. Ta sama przepustka i to samo uzasadnienie, co w 0045/0048.

create or replace function app.guard_legal_document_version_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text :=
    'Opublikowanej wersji dokumentu nie można zmienić ani usunąć — opublikuj nową.';
begin
  if pg_has_role(current_user, 'service_role', 'USAGE') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception '%', c_denied using errcode = '42501';
end;
$$;

comment on function app.guard_legal_document_version_write() is
  'Strażnik niezmienności rejestru wersji (ADR-129): UPDATE i DELETE na legal_document_versions wykonuje wyłącznie rola serwisowa (kaskada z tenants). Odmowa: 42501 — nieodróżnialna od odmowy RLS.';

create trigger legal_document_versions_guard_write
  before update or delete on public.legal_document_versions
  for each row execute function app.guard_legal_document_version_write();

-- Hash liczy BAZA z bajtów, które faktycznie zapisuje. Gdyby przyszedł
-- z wejścia, „dowód bajtów" dowodziłby wyłącznie tego, że wołający potrafi
-- wpisać 64 znaki heksadecymalne. Ten sam trigger utrwala moment publikacji:
-- czas serwera, nie czas przeglądarki.
create or replace function app.stamp_legal_document_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  new.sha256 := encode(sha256(convert_to(new.body, 'UTF8')), 'hex');
  new.published_at := now();
  return new;
end;
$$;

comment on function app.stamp_legal_document_version() is
  'Stempel wersji dokumentu prawnego (ADR-129): sha256 z dokładnych bajtów body i published_at z zegara serwera. Wartości z wejścia są nadpisywane — hash od wołającego nie dowodzi niczego.';

create trigger legal_document_versions_stamp
  before insert on public.legal_document_versions
  for each row execute function app.stamp_legal_document_version();

-- ---------------------------------------------------------------------
-- 5. RLS: zapis wyłącznie właściciel, odczyt żywy członek
-- ---------------------------------------------------------------------
--
-- Kształt polityk jest LUSTREM tenant_settings po poprawce 0060 (ADR-126):
-- każdy człon `tenant_id = app.tenant_id()` niesie obok `(select
-- app.is_current_tenant_member())`, bo sam claim z JWT nie jest dowodem dostępu
-- (token po cofnięciu członkostwa żyje jeszcze do godziny). Owijka `(select …)`
-- jest obowiązkowa — robi z bramki InitPlan zamiast wywołania per wiersz.
--
-- DOKUMENT PRAWNY PISZE WŁAŚCICIEL, NIE OBSŁUGA. To jest ta sama granica, co
-- przy ustawieniach umowy (0024/0060): treść, którą podpisuje klient, jest
-- oświadczeniem firmy, a nie operacją na zamówieniu. Personel czyta.
--
-- DELETE NIE MA GRANTU dla nikogo poza rolą serwisową — ani dla szkicu, ani dla
-- wersji. Skasowanie dokumentu zabrałoby cel FK zamówieniom, które go niosą.

alter table public.legal_documents enable row level security;
revoke all on public.legal_documents from anon, authenticated;
grant select, insert, update on public.legal_documents to authenticated;
grant select, insert, update, delete on public.legal_documents to service_role;

create policy tenant_select on public.legal_documents for select
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );

create policy owner_insert on public.legal_documents for insert
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );

create policy owner_update on public.legal_documents for update
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );

alter table public.legal_document_versions enable row level security;
revoke all on public.legal_document_versions from anon, authenticated;
grant select, insert on public.legal_document_versions to authenticated;
grant select, insert, update, delete on public.legal_document_versions to service_role;

create policy tenant_select on public.legal_document_versions for select
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );

-- `published_by = auth.uid()` to lustro contract_documents (0026): wpis do
-- rejestru nie może wskazać cudzej ręki. Publikacja idzie funkcją
-- SECURITY INVOKER, więc ta polityka jest jej faktyczną bramką.
create policy owner_insert on public.legal_document_versions for insert
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
    and published_by = auth.uid()
  );

-- ---------------------------------------------------------------------
-- 6. PUBLIKACJA — jedyna droga powstania wersji
-- ---------------------------------------------------------------------
--
-- SECURITY INVOKER, dokładnie jak app.publish_site (0048): bramką jest RLS
-- wołającego, więc funkcja nie musi powtarzać sprawdzenia roli, a definer nie
-- otwiera drogi obok polityk.
--
-- PUBLIKACJA BEZ ZMIANY TREŚCI NIE TWORZY WERSJI. Rejestr, w którym połowa
-- wpisów to ta sama treść pod innym numerem, przestaje być użyteczny jako
-- dowód; a najemca klikający „Opublikuj" drugi raz nie wyraża woli, żeby
-- klienci akceptowali „nową" wersję identycznego tekstu. Porównanie idzie po
-- HASHU BAJTÓW, tytule i języku — czyli po wszystkim, co niesie migawka.

create or replace function app.publish_legal_document(p_kind text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_doc record;
  v_current record;
  v_draft_sha text;
  v_no integer;
  v_label text;
  v_id uuid;
  v_published_at timestamptz;
begin
  if p_kind is null or p_kind not in ('terms', 'privacy') then
    raise exception 'legal_document_kind_invalid' using errcode = '22023';
  end if;

  -- JAWNA BRAMKA WŁAŚCICIELA, mimo że zapisów broni RLS. Powód jest konkretny
  -- i wyszedł z testu: gałąź „treść bez zmian" NIE WYKONUJE ŻADNEGO ZAPISU,
  -- więc żadna polityka się nie odzywa — personel dostawał w odpowiedzi
  -- sukces publikacji, której nie miał prawa wywołać. Odpowiedź, która kłamie
  -- o uprawnieniu, jest gorsza niż odmowa, nawet gdy nic nie zmieniła.
  -- (select …) — owijka InitPlan, wymóg ADR-126.
  if not (select app.is_tenant_owner()) then
    raise exception 'legal_document_forbidden' using errcode = '42501';
  end if;

  -- RLS zawęża zasięg do dokumentów wołającego, więc zdanie nie ma jak
  -- dosięgnąć cudzego. Brak wiersza i cudzy wiersz są celowo nieodróżnialne.
  select id, tenant_id, title, body_draft, locale, current_version_id
    into v_doc
  from public.legal_documents
  where kind = p_kind;

  if not found then
    raise exception 'legal_document_not_found' using errcode = '22023';
  end if;

  v_draft_sha := encode(sha256(convert_to(v_doc.body_draft, 'UTF8')), 'hex');

  if v_doc.current_version_id is not null then
    select id, version_no, version_label, sha256, title, locale, published_at
      into v_current
    from public.legal_document_versions
    where tenant_id = v_doc.tenant_id and id = v_doc.current_version_id;

    if found
       and v_current.sha256 = v_draft_sha
       and v_current.title = v_doc.title
       and v_current.locale = v_doc.locale then
      return jsonb_build_object(
        'version_id', v_current.id,
        'version_no', v_current.version_no,
        'version_label', v_current.version_label,
        'published_at', v_current.published_at,
        'created', false
      );
    end if;
  end if;

  select coalesce(max(version_no), 0) + 1 into v_no
  from public.legal_document_versions
  where tenant_id = v_doc.tenant_id and kind = p_kind;

  v_label := 'v' || v_no::text;

  insert into public.legal_document_versions (
    tenant_id, document_id, kind, version_no, version_label,
    title, body, sha256, locale, published_by
  )
  values (
    v_doc.tenant_id, v_doc.id, p_kind, v_no, v_label,
    v_doc.title, v_doc.body_draft, v_draft_sha, v_doc.locale, auth.uid()
  )
  returning id, published_at into v_id, v_published_at;

  update public.legal_documents
     set current_version_id = v_id,
         updated_at = v_published_at
   where id = v_doc.id;

  return jsonb_build_object(
    'version_id', v_id,
    'version_no', v_no,
    'version_label', v_label,
    'published_at', v_published_at,
    'created', true
  );
end;
$$;

comment on function app.publish_legal_document(text) is
  'Publikacja dokumentu prawnego (ADR-129): migawka szkicu do NIEZMIENNEGO wiersza legal_document_versions + przełączenie current_version_id. SECURITY INVOKER — bramką jest RLS wołającego (zapis tylko właściciel). Publikacja treści identycznej z żywą wersją NIE tworzy nowego wpisu (created=false). Odmowa (brak dokumentu / cudzy dokument): 22023.';

revoke all on function app.publish_legal_document(text) from public, anon;
grant execute on function app.publish_legal_document(text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. ODCZYT PUBLICZNY — lustro app.get_published_site
-- ---------------------------------------------------------------------
--
-- Trzy funkcje, bo trzy różne pytania i trzy różne koszty:
--
--   get_published_legal_documents  — „co jest opublikowane?" BEZ treści.
--       Woła je KAŻDA strona checkoutu, żeby wiedzieć, czy pokazać link i jaką
--       etykietę wysłać. Ciągnięcie 50 000 znaków po to, żeby przeczytać
--       etykietę, byłoby podatkiem od każdego zamówienia.
--   get_published_legal_document   — ŻYWA wersja z treścią (strona /regulamin).
--   get_legal_document_version     — KONKRETNA wersja z treścią (permalink
--       /regulamin/w/<n>), czyli okazanie tego, na co przystał klient.
--
-- Bramka `t.status in ('trialing','active')` jest przepisana z 0047: bez niej
-- sklep zawieszonego najemcy dalej pokazywałby jego dokumenty.
--
-- SZKIC NIE MA JAK WYJŚĆ ŻADNĄ Z TYCH DRÓG — body_draft nie występuje w ani
-- jednym zapytaniu. Wersje są wszystkie z definicji opublikowane, więc „anon
-- widzi tylko opublikowane" jest własnością schematu, nie warunkiem WHERE,
-- który da się przeoczyć.
--
-- ŚWIADOMIE AKCEPTOWANA EKSPOZYCJA: funkcje mają grant dla anona i przyjmują
-- dowolny uuid, więc kto zna identyfikator najemcy, odczyta jego OPUBLIKOWANE
-- dokumenty. To ta sama, już przyjęta własność co app.get_published_site
-- (0047) i dotyczy wyłącznie treści z definicji publicznej.

create or replace function app.get_published_legal_documents(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', v.kind,
        'title', v.title,
        'version_label', v.version_label,
        'version_no', v.version_no,
        'published_at', v.published_at,
        'locale', v.locale
      )
      order by v.kind
    ),
    '[]'::jsonb
  )
  from public.legal_documents d
  join public.legal_document_versions v
    on v.tenant_id = d.tenant_id and v.id = d.current_version_id
  join public.tenants t on t.id = d.tenant_id
  where d.tenant_id = p_tenant_id
    and t.status in ('trialing', 'active');
$$;

comment on function app.get_published_legal_documents(uuid) is
  'Publiczny SPIS opublikowanych dokumentów prawnych najemcy — BEZ treści (kind, tytuł, etykieta wersji, data, język). Źródło etykiety wysyłanej przez checkout i bramka „czy pokazać link". SECURITY DEFINER; szkice i treść nie wychodzą tą drogą.';

revoke all on function app.get_published_legal_documents(uuid) from public, anon, authenticated;
grant execute on function app.get_published_legal_documents(uuid) to anon, authenticated;

create or replace function app.get_published_legal_document(p_tenant_id uuid, p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'kind', v.kind,
    'title', v.title,
    'body', v.body,
    'version_label', v.version_label,
    'version_no', v.version_no,
    'sha256', v.sha256,
    'published_at', v.published_at,
    'locale', v.locale
  )
  from public.legal_documents d
  join public.legal_document_versions v
    on v.tenant_id = d.tenant_id and v.id = d.current_version_id
  join public.tenants t on t.id = d.tenant_id
  where d.tenant_id = p_tenant_id
    and d.kind = p_kind
    and t.status in ('trialing', 'active');
$$;

comment on function app.get_published_legal_document(uuid, text) is
  'Publiczny odczyt ŻYWEJ wersji dokumentu prawnego najemcy (treść + etykieta + sha256) — tylko dla aktywnego najemcy i opublikowanego dokumentu, inaczej NULL. SECURITY DEFINER — jedyna droga anonowa. Czyta wyłącznie legal_document_versions, więc edycja szkicu nie zmienia jej wyniku przed publikacją (ADR-129).';

revoke all on function app.get_published_legal_document(uuid, text) from public, anon, authenticated;
grant execute on function app.get_published_legal_document(uuid, text) to anon, authenticated;

-- Permalink do KONKRETNEJ wersji (decyzja właściciela: klient musi móc okazać
-- to, na co przystał, bez naszego udziału). Bezpieczny z konstrukcji — wersje
-- są niezmienne, a wszystkie są opublikowane. Numer wersji, nie uuid: adres ma
-- być do przepisania z potwierdzenia zamówienia.
create or replace function app.get_legal_document_version(
  p_tenant_id uuid,
  p_kind text,
  p_version_no integer
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'kind', v.kind,
    'title', v.title,
    'body', v.body,
    'version_label', v.version_label,
    'version_no', v.version_no,
    'sha256', v.sha256,
    'published_at', v.published_at,
    'locale', v.locale,
    'current', (v.id = d.current_version_id)
  )
  from public.legal_document_versions v
  join public.legal_documents d
    on d.tenant_id = v.tenant_id and d.id = v.document_id
  join public.tenants t on t.id = v.tenant_id
  where v.tenant_id = p_tenant_id
    and v.kind = p_kind
    and v.version_no = p_version_no
    and t.status in ('trialing', 'active');
$$;

comment on function app.get_legal_document_version(uuid, text, integer) is
  'Publiczny permalink do KONKRETNEJ wersji dokumentu prawnego (ADR-129) — okazanie tekstu, na który przystał klient, także po późniejszych edycjach najemcy. Klucz `current` mówi, czy to wersja żywa. SECURITY DEFINER.';

revoke all on function app.get_legal_document_version(uuid, text, integer) from public, anon, authenticated;
grant execute on function app.get_legal_document_version(uuid, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. BACKFILL — do SZKICU, nigdy do publikacji
-- ---------------------------------------------------------------------
--
-- Najemcy mają regulamin od 0026; sklep go nie pokazywał. Przenosimy treść
-- tam, skąd może wyjść publicznie — ale NIE PUBLIKUJEMY. Opublikowanie cudzego
-- dokumentu prawnego w jego imieniu uczyniłoby nas jego autorem, a zgody na to
-- nie da się domniemać. Najemca widzi gotowy szkic i publikuje kliknięciem.
--
-- current_version_id zostaje NULL, więc po tej migracji ani jeden sklep nie
-- zmienia zachowania.

insert into public.legal_documents (tenant_id, kind, title, body_draft, locale)
select
  s.tenant_id,
  'terms',
  case when t.locale = 'en' then 'Terms and conditions' else 'Regulamin' end,
  btrim(s.value ->> 'terms_body'),
  case when t.locale = 'en' then 'en' else 'pl' end
from public.tenant_settings s
join public.tenants t on t.id = s.tenant_id
where s.key = 'contract_document'
  and jsonb_typeof(s.value -> 'terms_body') = 'string'
  and char_length(btrim(s.value ->> 'terms_body')) between 1 and 50000
on conflict (tenant_id, kind) do nothing;

-- ---------------------------------------------------------------------
-- 9. ZAMÓWIENIE WSKAZUJE WIERSZ WERSJI, NIE NAPIS (R18)
-- ---------------------------------------------------------------------
--
-- Dziś orders.terms_version jest WOLNYM STRINGIEM z payloadu przeglądarki,
-- walidowanym wyłącznie na długość (0020:51-52, 0059:477-480). Dowód zgody
-- podaje więc nazwę wersji, której nikt nigdy nie ustalił, i której nie da się
-- rozwinąć do treści.
--
-- Kolumna jest NULLABLE i tak zostanie: zamówienia sprzed tej migracji oraz
-- najemcy bez opublikowanego dokumentu nie mają czego wskazywać, a udawanie,
-- że mają, byłoby dokładnie tym samym kłamstwem w drugą stronę.
--
-- FK ZŁOŻONY (tenant_id, terms_version_id) — zamówienie NIE MA JAK wskazać
-- wersji cudzego najemcy. To jest ta granica wyrażona schematem: nawet gdyby
-- warstwa aplikacji kiedykolwiek dała się nakłonić do podania obcego uuid,
-- baza odmówi.
--
-- CHECK orders_terms_complete z 0020 ZOSTAJE NIETKNIĘTY. Nowy CHECK dokłada
-- tylko to, czego tamten nie mówi: wskazanie wersji bez momentu akceptacji
-- byłoby dowodem zgody bez zgody.

alter table public.orders
  add column terms_version_id uuid;

alter table public.orders
  add constraint orders_terms_version_fk
    foreign key (tenant_id, terms_version_id)
    references public.legal_document_versions (tenant_id, id);

alter table public.orders
  add constraint orders_terms_version_pinned check (
    terms_version_id is null or terms_accepted_at is not null
  );

comment on column public.orders.terms_version_id is
  'B4/ADR-129 (R18): WIERSZ niezmiennej wersji regulaminu, na którą przystał klient — rozstrzygany przez bazę w app.public_checkout, nigdy z payloadu. NULL = najemca bez opublikowanego regulaminu albo wołający spoza powierzchni, które renderujemy (API v1, wtyczka) — wtedy zostaje sama etykieta tekstowa, czyli zachowanie sprzed 0063.';

create index orders_tenant_terms_version_idx
  on public.orders (tenant_id, terms_version_id)
  where terms_version_id is not null;

-- ---------------------------------------------------------------------
-- 10. app.public_checkout — redefinicja: serwer rozstrzyga wersję regulaminu
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0059, wzorzec 0021/0029/0040/0049/0058/0059).
-- Różnice merytoryczne wobec 0059 oznaczone [0063] i są DOKŁADNIE TRZY:
-- cztery nowe zmienne, blok rozstrzygnięcia wersji tuż po walidacji akceptacji
-- oraz dwie wartości więcej w INSERT-cie zamówienia. Reszta jest przepisana bez
-- zmian — łącznie z komentarzami, żeby diff wobec 0059 dało się przeczytać
-- wzrokiem.
--
-- SYGNATURA SIĘ NIE ZMIENIA, więc nie ma `drop function` i nie ma okna, w którym
-- istniałaby druga ścieżka zapisu. Sklep, embed, API v1 i wtyczka wołają dalej
-- tak samo; zmienia się WYŁĄCZNIE to, co baza robi z `p_terms_version`.
--
-- ==================== CZYM JEST TERAZ p_terms_version ====================
--
-- Przestaje być wartością ZAPISYWANĄ, a staje się DEKLARACJĄ WOŁAJĄCEGO, którą
-- baza konfrontuje z własnym rejestrem. Trzy gałęzie, każda z innym powodem:
--
--   (a) najemca NIE MA opublikowanego regulaminu → zachowanie sprzed 0063 co do
--       znaku: zapisujemy przycięty napis, terms_version_id zostaje NULL.
--       To jest gałąź, która broni wszystkich dzisiejszych najemców.
--
--   (b) deklaracja zgadza się z etykietą ŻYWEJ wersji → przypinamy WIERSZ.
--       Dowód zgody da się od tej chwili rozwinąć do bajtów i do sha256.
--
--   (c) deklaracja to etykieta INNEJ wersji tego samego najemcy → odmowa 22023.
--       Klient przystał na tekst, którego już nie ma; jedyna uczciwa odpowiedź
--       to kazać mu przeczytać nowy. Ta gałąź może zapalić się WYŁĄCZNIE dla
--       wołającego, który wcześniej dostał etykietę od nas, więc nie ma jak
--       wywrócić integracji, która o naszych etykietach nie wie.
--
--   (d) deklaracja to napis, który nigdy nie był naszą etykietą (API v1,
--       wtyczka WordPress ze swoją stałą) → zapisujemy napis, terms_version_id
--       NULL. ŚWIADOMA GRANICA, nie przeoczenie: te powierzchnie renderują
--       własną zgodę, więc nie mamy dowodu, jaki tekst zobaczył klient, a
--       zmyślenie go byłoby tym samym kłamstwem, które ta migracja usuwa.
--       Domknięcie należy do API v2 (wersja jako pole kontraktu) — zapisane
--       w ADR-129 jako dług nazwany.
--
-- CZEGO WOŁAJĄCY NIE MOŻE ZROBIĆ W ŻADNEJ GAŁĘZI: podać uuid wersji, przypiąć
-- wersję innego najemcy ani wersję nieistniejącą. Identyfikator wybiera
-- WYŁĄCZNIE zapytanie niżej, po p_tenant_id, a FK złożony z sekcji 9 jest
-- drugą warstwą tej samej gwarancji.

create or replace function app.public_checkout(
  p_tenant_id uuid,
  p_email text,
  p_full_name text,
  p_phone text,
  p_start_date date,
  p_end_date date,
  p_delivery_method text,
  p_pickup_location_id uuid,
  p_items jsonb,
  p_terms_version text,
  p_locale text default null,
  p_company_name text default null,
  p_nip text default null,
  p_address_street text default null,
  p_address_zip text default null,
  p_address_city text default null,
  p_notes text default null,
  -- [0029] Wybór metody płatności przez klienta. Default 'transfer', bo
  -- wołający, który o płatności nie wie NIC, ma dostać obieg offline —
  -- najbezpieczniejszy z możliwych: zamówienie czeka na rozliczenie
  -- z człowiekiem. Domyślka 'online' cicho wprowadzałaby zamówienia
  -- w reżim ścisły bez płatności, która ma je z niego wyprowadzić.
  p_payment_method text default 'transfer',
  -- [0058] POLA WŁASNE Z ZAMAWIANIA (C6-A3, ADR-121). Dwie mapy, nie jedna:
  -- kolumna `custom_fields` mieszka OSOBNO na zamówieniu i na kliencie, więc
  -- rozdział musi nastąpić PRZED wejściem tutaj. Encję wybiera DEFINICJA
  -- (rdzeń `splitCustomFieldValuesByEntity`), nigdy wołający — inaczej
  -- wystarczyłoby przenieść wartość do drugiej mapy, żeby ominąć filtr encji
  -- w triggerze 0057.
  --
  -- DEFAULT '{}' czyni wołającego sprzed C6-A3 poprawnym: checkout bez pól
  -- własnych zachowuje się dokładnie tak, jak przed tą migracją.
  p_order_custom_fields jsonb default '{}'::jsonb,
  p_customer_custom_fields jsonb default '{}'::jsonb,
  -- [0059] BILET ZAUFANEJ GRANICY (R13/H-02, ADR-125). Trzy pola jednego
  -- zaświadczenia, rozbite na osobne parametry, bo PostgREST i tak przekazuje
  -- je z nazwy — a rozbicie oszczędza parsowania stringa po stronie SQL.
  -- Bije je serwer storefrontu (lib/checkout/ticket.ts) PO zaliczonych
  -- bramkach; przeglądarka ich nie widzi i nie ma jak wyprodukować.
  p_ticket_exp bigint default null,
  p_ticket_nonce text default null,
  p_ticket_sig text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_tenant record;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_full_name text := btrim(coalesce(p_full_name, ''));
  -- [R6b] Telefon wejścia w normalizacji app.normalize_phone (same cyfry),
  -- do dopasowania przeciw ban-liście (ADR-080).
  v_phone_normalized text;
  v_locale text;
  v_days int;
  v_customer_id uuid;
  v_pickup uuid;
  v_currency text;
  v_item jsonb;
  v_product record;
  v_product_id uuid;
  v_quantity int;
  v_matched_mult numeric;
  v_highest_days int;
  v_extra_days int;
  v_rental_per_unit int;
  v_units uuid[];
  v_unit uuid;
  v_seen_products uuid[] := array[]::uuid[];
  v_item_rows jsonb := '[]'::jsonb;
  v_summary jsonb := '[]'::jsonb;
  v_total_rental int := 0;
  v_total_deposit int := 0;
  v_delivery int := 0;
  v_pricing jsonb;
  v_entry jsonb;
  v_free_above int;
  v_log_token uuid := gen_random_uuid();
  -- [0029] Metoda z wejścia po normalizacji i wywiedziony z niej REŻIM osi
  -- płatności (ADR-064). Reżim NIE jest osobnym parametrem: wywiedzenie go
  -- z metody czyni stan „online w obiegu manual" (i odwrotnie)
  -- niereprezentowalnym, zamiast pilnować zgodności dwóch pól wejścia.
  v_payment_method text;
  v_payment_provider text;
  v_order_id uuid;
  v_order_number text;
  v_reply_to text;
  v_sender jsonb;
  v_limits jsonb;
  v_limit_customer int;
  v_limit_tenant int;
  v_tenant_recent int;
  v_customer_recent int;
  -- [0058] Mapy po normalizacji NULL→'{}' — anon potrafi przysłać JSON-owy null.
  v_order_cf jsonb;
  v_customer_cf jsonb;
  -- [0063] REJESTR WERSJI REGULAMINU (R18, ADR-129). `v_terms_label` to
  -- wartość, która TRAFI do kolumny — w gałęzi (b) pochodzi z rejestru, nie
  -- z wejścia. `v_terms_version_id` startuje z NULL i pozostaje nim wszędzie
  -- poza gałęzią (b): brak dowodu zapisujemy jako brak dowodu.
  v_terms_input text;
  v_terms_current record;
  v_terms_label text;
  v_terms_version_id uuid := null;
begin
  -- --- [0059] BRAMKA BILETU (R13/H-02, ADR-125) — PIERWSZA INSTRUKCJA ---
  --
  -- Przed wszystkim innym: przed odczytem tenanta, przed walidacją, przed
  -- throttlem, przed klientem, wyceną i zapisem. Powód jest dwojaki.
  --
  -- BEZPIECZEŃSTWO: każda instrukcja wykonana przed bramką to praca zrobiona
  -- dla wołającego, który nie udowodnił, że przeszedł zaufaną granicę —
  -- a część tych instrukcji (odczyt tenanta, throttle, ban-lista) odpowiada
  -- RÓŻNYMI komunikatami, więc byłaby wyrocznią dostępną bez biletu.
  --
  -- KOSZT: odmowa kosztuje wtedy jeden odczyt klucza i jedno HMAC, a nie
  -- przebieg przez wycenę i dobór egzemplarzy. Zalew żądań ma się odbijać
  -- tanio.
  --
  -- Pozostałe bramki (throttle w bazie, ban-lista, wycena serwerowa, bramka
  -- widoczności pól własnych) zostają NIETKNIĘTE jako obrona w głąb — bilet
  -- ich nie zastępuje, tylko dokłada brakującą warstwę: dowód, że wołający
  -- jest naszym serwerem po zaliczonych bramkach, a nie kimkolwiek z anon key.
  perform app.assert_checkout_ticket(p_tenant_id, p_ticket_exp, p_ticket_nonce, p_ticket_sig);

  -- --- Tenant aktywny (izolacja: nieaktywny nieodróżnialny od nieistniejącego) ---
  select id, name, locale into v_tenant
  from public.tenants
  where id = p_tenant_id and status in ('trialing', 'active');
  if not found then
    raise exception 'Sklep jest niedostępny.' using errcode = '22023';
  end if;

  -- --- Walidacja wejścia (jawna i pełna — definer omija RLS) ---
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Nieprawidłowy adres e-mail.' using errcode = '22023';
  end if;
  if v_full_name = '' or length(v_full_name) > 200 then
    raise exception 'Imię i nazwisko jest wymagane.' using errcode = '22023';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Nieprawidłowy zakres dat najmu.' using errcode = '22023';
  end if;
  if p_delivery_method is null
     or p_delivery_method not in ('pickup', 'courier', 'parcel_locker', 'own_delivery') then
    raise exception 'Nieprawidłowa metoda dostawy.' using errcode = '22023';
  end if;
  if p_terms_version is null or length(btrim(p_terms_version)) = 0
     or length(btrim(p_terms_version)) > 100 then
    raise exception 'Akceptacja regulaminu jest wymagana.' using errcode = '22023';
  end if;

  -- --- [0063] ROZSTRZYGNIĘCIE WERSJI REGULAMINU (R18, ADR-129) ---
  --
  -- Zapytanie wiąże się WYŁĄCZNIE po p_tenant_id — wołający nie ma jak wskazać
  -- wiersza, więc nie ma jak wskazać cudzego ani nieistniejącego. Definer omija
  -- RLS, dlatego granica najemcy musi stać w tym WHERE, nie w polityce.
  v_terms_input := btrim(p_terms_version);
  v_terms_label := v_terms_input;

  select v.id, v.version_label
    into v_terms_current
  from public.legal_documents d
  join public.legal_document_versions v
    on v.tenant_id = d.tenant_id and v.id = d.current_version_id
  where d.tenant_id = p_tenant_id
    and d.kind = 'terms';

  if found then
    if v_terms_input = v_terms_current.version_label then
      -- (b) Zgodne z żywą wersją: przypinamy WIERSZ, a etykietę bierzemy
      -- z rejestru. Napis z wejścia nie dociera już do kolumny nawet tutaj.
      v_terms_version_id := v_terms_current.id;
      v_terms_label := v_terms_current.version_label;
    elsif exists (
      select 1
      from public.legal_document_versions v
      where v.tenant_id = p_tenant_id
        and v.kind = 'terms'
        and v.version_label = v_terms_input
    ) then
      -- (c) Nasza etykieta, ale nie ta żywa: klient zaakceptował tekst, który
      -- najemca zdążył zmienić. Osobny, rozróżnialny komunikat — warstwa
      -- sklepu mapuje go na „odśwież i zaakceptuj ponownie", a nie na ogólne
      -- „zamówienie odrzucone".
      raise exception 'Regulamin zmienił się w trakcie składania zamówienia — zapoznaj się z nim i zaakceptuj ponownie.'
        using errcode = '22023';
    end if;
    -- (d) Napis, który nigdy nie był naszą etykietą — zostaje jak przyszedł,
    -- bez przypięcia. Patrz nagłówek sekcji 10.
  end if;
  -- (a) Brak opublikowanego regulaminu: v_terms_label = wejście, id = NULL.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Zamówienie wymaga co najmniej jednej pozycji.' using errcode = '22023';
  end if;

  -- --- [0058] BRAMKA WIDOCZNOŚCI PÓL WŁASNYCH (C6-A3, ADR-121) ---
  --
  -- Trigger 0057 pilnuje ZGODNOŚCI wartości z definicją (typ, opcje, encja,
  -- najemca) — i to jest wszystko, czego pilnować powinien: reguły
  -- reprezentowalności wiersza obowiązują tak samo pracę lady. NIE pilnuje
  -- natomiast POWIERZCHNI, bo panel wypełnia pola oznaczone „panel", a to
  -- jest ta sama kolumna.
  --
  -- Tu jest jedyne miejsce, w którym powierzchnia ma znaczenie po stronie
  -- bazy: `app.public_checkout` to WEJŚCIE ANONIMOWE. Bez tej bramki klient
  -- końcowy, który raz zobaczył identyfikator definicji (choćby z formularza
  -- innego najemcy albo z DOM-u panelu), mógłby wpisać wartość pod polem
  -- oznaczonym wyłącznie „panel" — czyli pod danymi wewnętrznymi
  -- wypożyczalni. Widoczność jest kontraktem, więc broni jej BAZA, a nie
  -- formularz, który da się ominąć surowym żądaniem.
  v_order_cf := coalesce(nullif(p_order_custom_fields, 'null'::jsonb), '{}'::jsonb);
  v_customer_cf := coalesce(nullif(p_customer_custom_fields, 'null'::jsonb), '{}'::jsonb);
  perform app.assert_checkout_custom_fields(p_tenant_id, 'order', v_order_cf);
  perform app.assert_checkout_custom_fields(p_tenant_id, 'customer', v_customer_cf);

  -- --- [R6b] Ban-lista klientów (ADR-080) ---
  --
  -- Zbanowany klient nie składa zamówienia. Dopasowanie po ZNORMALIZOWANYM
  -- mailu ORAZ telefonie tego tenanta — te same normalizacje, którymi
  -- wypełniono klucze banu (lower+btrim maila, app.normalize_phone telefonu),
  -- więc porównanie jest symetryczne. Ban łapie też NOWY checkout z tym samym
  -- mailem/telefonem, który dedupuje do INNEGO (albo żadnego jeszcze) wiersza
  -- customers — dlatego sprawdzamy klucze banu, nie stan wiersza klienta.
  --
  -- ODMOWA NIEROZRÓŻNIALNA: 22023 (jak inne odmowy walidacyjne) — storefront
  -- mapuje ją na ogólny status „rejected", więc klient końcowy nie dowiaduje
  -- się, że jest na liście. Zawężenie tenant_id jest sednem izolacji: ban
  -- tenanta A nie może blokować checkoutu tenanta B.
  --
  -- Guard `v_phone_normalized is not null`: pusty telefon wejścia nie dopasowuje
  -- się do banów bez telefonu (i tak phone_normalized bywa NULL).
  v_phone_normalized := app.normalize_phone(p_phone);
  if exists (
    select 1
    from public.customer_bans b
    where b.tenant_id = p_tenant_id
      and (
        b.email_normalized = v_email
        or (v_phone_normalized is not null and b.phone_normalized = v_phone_normalized)
      )
  ) then
    raise exception 'Nie można złożyć zamówienia.' using errcode = '22023';
  end if;

  -- --- [0029] Metoda płatności i wywiedziony z niej reżim (ADR-066) ---
  v_payment_method := coalesce(nullif(btrim(p_payment_method), ''), 'transfer');
  if v_payment_method not in ('online', 'transfer', 'cod') then
    raise exception 'Nieprawidłowa metoda płatności.' using errcode = '22023';
  end if;
  v_payment_provider := case when v_payment_method = 'online' then 'stripe' else 'manual' end;

  -- Płatność online wymaga, żeby najemca MIAŁ konto u dostawcy — inaczej
  -- zamówienie rodziłoby się w reżimie ścisłym bez adresata środków i bez
  -- żadnej drogi wyjścia z `pending`.
  --
  -- To NIE JEST bramka gotowości konta. Gotowość (`charges_enabled`) wolno
  -- stwierdzić WYŁĄCZNIE odczytem u dostawcy (ADR-049) i robi to serwer
  -- storefrontu przed utworzeniem płatności; kolumny w `payment_accounts` są
  -- kopią prezentacyjną i celowo NIE SĄ tu czytane. Tu sprawdzamy istnienie
  -- adresata — fakt z NASZEJ bazy, o którym nasza baza wie wszystko.
  if v_payment_method = 'online' then
    perform 1 from public.payment_accounts where tenant_id = p_tenant_id;
    if not found then
      raise exception 'Płatność online jest niedostępna w tym sklepie.' using errcode = '22023';
    end if;
  end if;

  v_locale := case when p_locale in ('en', 'pl') then p_locale else null end;
  v_days := (p_end_date - p_start_date) + 1;

  -- Odbiór osobisty wymaga AKTYWNEGO punktu tego tenanta; przy dostawie punktu
  -- nie zapisujemy (informacja nadmiarowa — logistyka to faza 3).
  if p_delivery_method = 'pickup' then
    if p_pickup_location_id is null then
      raise exception 'Odbiór osobisty wymaga wskazania punktu.' using errcode = '22023';
    end if;
    perform 1 from public.pickup_locations
      where tenant_id = p_tenant_id and id = p_pickup_location_id and active;
    if not found then
      raise exception 'Wskazany punkt odbioru jest niedostępny.' using errcode = '22023';
    end if;
    v_pickup := p_pickup_location_id;
  else
    v_pickup := null;
  end if;

  -- --- THROTTLE W BAZIE (ADR-042, znalezisko recenzji) ---
  --
  -- Bezpośrednie wywołanie RPC anon keyem omija bramki warstwy storefrontu
  -- (honeypot / rate-limit per IP / Turnstile), a zamówienia pending blokują
  -- egzemplarze w dostępności — bez limitu W FUNKCJI spam zdejmowałby cały
  -- inwentarz tenanta z oferty. [0059] Bilet zamyka tę drogę u źródła, ale
  -- throttle ZOSTAJE nietknięty: jest obroną w głąb na wypadek wycieku sekretu
  -- podpisu i jedyną warstwą, która ogranicza zalew z NASZEJ ścieżki.
  -- Limity liczone WYŁĄCZNIE po zamówieniach
  -- source='storefront' w stanie pending+unpaid (praca lady i zamówienia już
  -- obsłużone nie zjadają budżetu klienta). Count-check bez własnego locka —
  -- świadomie: INSERT i tak serializuje się na advisory locku numeracji per
  -- (tenant, rok), a celem jest throttling, nie dokładna bariera; drobne
  -- przekroczenie przy wyścigu dwóch transakcji jest dla tego celu
  -- nieszkodliwe, a lock, który niczego nie musi gwarantować, maskowałby
  -- zamiast chronić (lekcja ADR-024/ADR-035).
  --
  -- LIMITY KONFIGUROWALNE PER TENANT (uwaga właściciela): defaulty 3/24h per
  -- klient i 30/1h per tenant są bezpieczne na start, ale za ciasne dla dużej
  -- wypożyczalni w sezonie (30/h = zamówienie co 2 minuty). Operator podnosi
  -- WŁASNE limity kluczem tenant_settings 'checkout_limits'
  -- ({"per_customer_24h": int, "per_tenant_1h": int}) — throttle chroni
  -- TENANTA, więc podniesienie własnego limitu jest legalne i nie wymaga
  -- nowej bramki uprawnień (RLS tenant_settings ogranicza zapis do członków).
  --
  -- COALESCE-GUARD przy ODCZYCIE (w kontrze do CHECK-u u źródła z 0013/0014 —
  -- świadomie): wartość liczy się wyłącznie, gdy jest JSON-ową liczbą
  -- CAŁKOWITĄ w przedziale 1..10000; śmieć (ujemna, ułamek, string, brak
  -- klucza, brak wpisu) spada na DEFAULT zamiast wywracać checkout. Zepsuta
  -- konfiguracja limitu nie ma prawa zablokować sklepu — bezpiecznym stanem
  -- jest default, nie odmowa. Cap 10000: wartość powyżej to pomyłka
  -- konfiguracji, nie intencja (żadna wypożyczalnia nie przyjmuje 10k
  -- publicznych pending na godzinę).
  select value into v_limits
  from public.tenant_settings
  where tenant_id = p_tenant_id and key = 'checkout_limits'
    and jsonb_typeof(value) = 'object';

  v_limit_customer := case
    when jsonb_typeof(v_limits -> 'per_customer_24h') = 'number'
         and (v_limits ->> 'per_customer_24h') ~ '^[0-9]{1,5}$'
         and (v_limits ->> 'per_customer_24h')::int between 1 and 10000
      then (v_limits ->> 'per_customer_24h')::int
    else 3  -- default per klient / 24 h
  end;
  v_limit_tenant := case
    when jsonb_typeof(v_limits -> 'per_tenant_1h') = 'number'
         and (v_limits ->> 'per_tenant_1h') ~ '^[0-9]{1,5}$'
         and (v_limits ->> 'per_tenant_1h')::int between 1 and 10000
      then (v_limits ->> 'per_tenant_1h')::int
    else 30  -- default per tenant / 1 h
  end;

  -- Per tenant PRZED utworzeniem klienta (najtańsza odmowa — bez dotykania
  -- customers); komunikat NEUTRALNY, wspólny dla obu limitów (nie zdradza,
  -- który limit zadziałał ani jakie są progi).
  select count(*) into v_tenant_recent
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.source = 'storefront'
    and o.order_status = 'pending'
    and o.payment_status = 'unpaid'
    and o.created_at > now() - interval '1 hour';
  if v_tenant_recent >= v_limit_tenant then
    raise exception 'Zbyt wiele prób — spróbuj później lub skontaktuj się z wypożyczalnią.'
      using errcode = '22023';
  end if;

  -- --- Klient: znajdź-lub-utwórz per (tenant, lower(email)), atomowo ---
  -- Bez wcześniejszego SELECT-a jako jedynej bramki (wyścig): przy dwóch
  -- równoległych checkoutach nowego klienta on conflict do nothing rozstrzyga
  -- kolizję na customers_tenant_email_key, a ponowny SELECT odzyskuje wiersz
  -- konkurenta. Istniejącego klienta NIE nadpisujemy (może być stały klient
  -- panelu) — bierzemy jego id.
  select id into v_customer_id
  from public.customers
  where tenant_id = p_tenant_id and lower(email) = v_email;

  if v_customer_id is null then
    insert into public.customers (
      tenant_id, email, full_name, phone, company_name, nip,
      address_street, address_zip, address_city, locale,
      custom_fields
    )
    values (
      p_tenant_id, v_email, v_full_name,
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_company_name, '')), ''),
      nullif(btrim(coalesce(p_nip, '')), ''),
      nullif(btrim(coalesce(p_address_street, '')), ''),
      nullif(btrim(coalesce(p_address_zip, '')), ''),
      nullif(btrim(coalesce(p_address_city, '')), ''),
      v_locale,
      v_customer_cf
    )
    on conflict (tenant_id, lower(email)) do nothing
    returning id into v_customer_id;

    if v_customer_id is null then
      select id into v_customer_id
      from public.customers
      where tenant_id = p_tenant_id and lower(email) = v_email;
    end if;
  end if;

  -- --- [0058] POLA WŁASNE KLIENTA: SCALENIE, NIE NADPISANIE (C6-A3) ---
  --
  -- Klient bywa STAŁYM klientem panelu, a jego wiersz niesie wtedy wartości
  -- pod polami oznaczonymi „panel" — których sklep nie pokazuje i o których
  -- nic nie wie. Zapis CAŁĄ MAPĄ skasowałby je przy pierwszym zamówieniu ze
  -- sklepu; dokładnie ta klasa błędu, którą po stronie aplikacji zamyka
  -- wymagalność `existing` (ADR-121).
  --
  -- `existing` nie ma tu jednak jak powstać: anon nie czyta `customers`, więc
  -- serwer storefrontu nie zna zapisanych wartości i NIE MA PRAWA ich znać
  -- (byłaby to wyrocznia o kliencie po samym adresie e-mail). Scalenie musi
  -- więc zrobić baza, atomowo, w tej samej transakcji — operatorem `||`,
  -- gdzie prawa strona (wpis klienta) wygrywa wyłącznie na SWOICH kluczach.
  --
  -- Warunek na niepustej mapie jest istotny: bez niego każdy checkout
  -- wykonywałby bezcelowy UPDATE na wierszu klienta (i budził trigger 0057
  -- na danych, których nikt nie dotknął).
  if v_customer_cf <> '{}'::jsonb then
    update public.customers
       set custom_fields = coalesce(custom_fields, '{}'::jsonb) || v_customer_cf
     where id = v_customer_id and tenant_id = p_tenant_id;
  end if;

  -- Per klient (druga oś throttle'u — patrz komentarz przy limicie per tenant).
  -- Świeżo utworzony klient ma count 0 i przechodzi; odmowa wycofuje całą
  -- transakcję, więc nie zostawia klienta-sieroty utworzonego wyżej.
  select count(*) into v_customer_recent
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.customer_id = v_customer_id
    and o.source = 'storefront'
    and o.order_status = 'pending'
    and o.payment_status = 'unpaid'
    and o.created_at > now() - interval '24 hours';
  if v_customer_recent >= v_limit_customer then
    raise exception 'Zbyt wiele prób — spróbuj później lub skontaktuj się z wypożyczalnią.'
      using errcode = '22023';
  end if;

  -- --- Pozycje: wycena SERWEROWA + przypisanie wolnych egzemplarzy ---
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    v_quantity := coalesce((v_item ->> 'quantity')::int, 0);

    if v_product_id is null then
      raise exception 'Pozycja bez produktu.' using errcode = '22023';
    end if;
    if v_quantity < 1 or v_quantity > 100 then
      raise exception 'Nieprawidłowa ilość pozycji.' using errcode = '22023';
    end if;
    -- Jedna linia per produkt: druga linia tego samego produktu nie wiedziałaby
    -- o egzemplarzach zajętych przez pierwszą (pozycje nie są jeszcze wstawione)
    -- i mogłaby przypisać tę samą sztukę dwa razy. Kontrakt 2.4b: agregacja
    -- ilości po produkcie następuje po stronie klienta.
    if v_product_id = any(v_seen_products) then
      raise exception 'Produkt powtórzony w zamówieniu.' using errcode = '22023';
    end if;
    v_seen_products := v_seen_products || v_product_id;

    select id, base_price_day_grosze, deposit_grosze, auto_increment_multiplier,
           buffer_before_days, buffer_after_days
      into v_product
    from public.products
    where tenant_id = p_tenant_id and id = v_product_id and active;
    if not found then
      raise exception 'Produkt jest niedostępny.' using errcode = '22023';
    end if;

    -- Wycena — lustro calculatePrice (@avably/core): najwyższy próg <= dni;
    -- doby ponad najwyższy próg dolicza auto_increment; bez progu = cena bazowa.
    select pt.multiplier into v_matched_mult
    from public.pricing_tiers pt
    where pt.tenant_id = p_tenant_id and pt.product_id = v_product_id
      and pt.tier_days <= v_days
    order by pt.tier_days desc
    limit 1;

    select max(pt.tier_days) into v_highest_days
    from public.pricing_tiers pt
    where pt.tenant_id = p_tenant_id and pt.product_id = v_product_id;

    if v_matched_mult is null then
      v_rental_per_unit := v_product.base_price_day_grosze * v_days;
    else
      v_extra_days := case when v_days > v_highest_days then v_days - v_highest_days else 0 end;
      v_rental_per_unit :=
        round(v_product.base_price_day_grosze * v_matched_mult)::int
        + case when v_extra_days > 0
            then round(v_product.base_price_day_grosze * v_product.auto_increment_multiplier * v_extra_days)::int
            else 0 end;
    end if;

    -- Wybór wolnych egzemplarzy (lustro checkAvailability). To dobór KANDYDATÓW,
    -- nie bramka wyścigu — właściwą bramką jest advisory lock + re-check w
    -- assert_unit_available przy wstawianiu pozycji (trigger 0010): jeśli
    -- konkurent zdążył zająć sztukę między tym SELECT-em a INSERT-em, trigger
    -- rzuci 23P01 i wycofa transakcję (dokładnie jeden checkout wygrywa).
    select array_agg(u.id order by u.id) into v_units
    from (
      select u.id
      from public.product_units u
      where u.tenant_id = p_tenant_id and u.product_id = v_product_id
        and not (
          (u.unavailable_from is not null or u.unavailable_to is not null)
          and (u.unavailable_from is null or p_end_date >= u.unavailable_from)
          and (u.unavailable_to is null or p_start_date <= u.unavailable_to)
        )
        and not exists (
          select 1
          from public.order_items oi
          join public.orders o on o.tenant_id = oi.tenant_id and o.id = oi.order_id
          where oi.tenant_id = p_tenant_id
            and oi.unit_id = u.id
            and o.order_status in ('pending', 'reserved', 'ready_for_pickup', 'picked_up')
            and o.start_date <= p_end_date + v_product.buffer_after_days
            and o.end_date >= p_start_date - v_product.buffer_before_days
        )
      order by u.id
      limit v_quantity
    ) u;

    if v_units is null or array_length(v_units, 1) < v_quantity then
      raise exception 'Brak wolnych egzemplarzy w wybranym terminie.' using errcode = '23P01';
    end if;

    foreach v_unit in array v_units
    loop
      v_item_rows := v_item_rows || jsonb_build_object(
        'product_id', v_product_id,
        'unit_id', v_unit,
        'rental_grosze', v_rental_per_unit,
        'deposit_grosze', v_product.deposit_grosze
      );
      v_total_rental := v_total_rental + v_rental_per_unit;
      v_total_deposit := v_total_deposit + v_product.deposit_grosze;
    end loop;

    v_summary := v_summary || jsonb_build_object(
      'product_id', v_product_id,
      'quantity', v_quantity,
      'unit_rental_grosze', v_rental_per_unit,
      'unit_deposit_grosze', v_product.deposit_grosze
    );
  end loop;

  -- --- Koszt dostawy — lustro calculateDeliveryCost (po zsumowaniu najmu) ---
  if p_delivery_method = 'pickup' then
    v_delivery := 0;
  else
    select value into v_pricing
    from public.tenant_settings
    where tenant_id = p_tenant_id and key = 'delivery_pricing'
      and jsonb_typeof(value) = 'object';

    v_entry := v_pricing -> p_delivery_method;
    if v_entry is null or jsonb_typeof(v_entry) <> 'object'
       or (v_entry ->> 'price_grosze') is null then
      raise exception 'Metoda dostawy nie jest skonfigurowana.' using errcode = '22023';
    end if;

    v_free_above := (v_entry ->> 'free_above_grosze')::int;
    if v_free_above is not null and v_total_rental >= v_free_above then
      v_delivery := 0;
    else
      v_delivery := (v_entry ->> 'price_grosze')::int;
    end if;
  end if;

  -- --- Wstawienie zamówienia (bramki 0010/0015: pending + unpaid, numeracja) ---
  -- tenant_id z parametru, NIE app.tenant_id() (anon nie ma claimu). Kwoty i
  -- egzemplarze wyłącznie policzone wyżej; nic z klienta.
  insert into public.orders (
    tenant_id, customer_id, start_date, end_date, delivery_method,
    pickup_location_id, total_rental_grosze, total_deposit_grosze,
    -- [0063] terms_version_id obok terms_version: kolumna tekstowa ZOSTAJE
    -- (zgodność wstecz i CHECK orders_terms_complete z 0020), a nowa niesie
    -- dowód rozwijalny do bajtów.
    delivery_grosze, terms_accepted_at, terms_version, terms_version_id, source, checkout_log_token,
    -- [0058] Zamówienie POWSTAJE tutaj, więc mapa idzie w całości — nie ma
    -- czego scalać. Trigger 0057 sprawdzi ją tak samo jak zapis z panelu.
    custom_fields,
    -- [0029] Metoda to DANE ZAMÓWIENIA, nie stan sesji (ADR-066), a reżim
    -- jedzie z nią od narodzin. `payment_status` zostaje domyślne `unpaid`:
    -- zamówienie rodzi się nieopłacone także wtedy, gdy klient za chwilę
    -- zapłaci kartą — `paid` w tej migracji nie występuje ani razu.
    payment_method, payment_provider
  )
  values (
    p_tenant_id, v_customer_id, p_start_date, p_end_date, p_delivery_method,
    v_pickup,
    v_total_rental, v_total_deposit, v_delivery, now(), v_terms_label, v_terms_version_id,
    'storefront', v_log_token, v_order_cf, v_payment_method, v_payment_provider
  )
  -- [0049] RETURNING niesie też walutę UTRWALONĄ na wierszu przez trigger
  -- orders_persist_currency — payload checkoutu (potwierdzenie + maile) mówi
  -- odtąd walutą ZAMÓWIENIA, nie osobnym odczytem ustawień (ADR-103).
  returning id, order_number, currency into v_order_id, v_order_number, v_currency;

  -- [0041] Notatka klienta ze storefrontu → wpis w order_notes (nie usuwana
  -- niżej kolumna orders.notes). created_by = NULL: checkout jest anonimowy,
  -- nie ma członka zespołu jako autora — UI pokaże „—" (jak wpisy historyczne
  -- z 0039). SECURITY DEFINER omija RLS, więc wstawienie z p_tenant_id
  -- przechodzi tak samo jak wstawienie zamówienia wyżej.
  if nullif(btrim(coalesce(p_notes, '')), '') is not null then
    insert into public.order_notes (tenant_id, order_id, body, created_by)
    values (p_tenant_id, v_order_id, btrim(p_notes), null);
  end if;

  -- Pozycje w stałym porządku unit_id (jak create_order): dwie transakcje biorą
  -- advisory locki w tej samej kolejności — bez zakleszczenia.
  insert into public.order_items (tenant_id, order_id, product_id, unit_id, rental_grosze, deposit_grosze)
  select
    p_tenant_id, v_order_id,
    (row ->> 'product_id')::uuid,
    (row ->> 'unit_id')::uuid,
    (row ->> 'rental_grosze')::int,
    (row ->> 'deposit_grosze')::int
  from jsonb_array_elements(v_item_rows) as row
  order by row ->> 'unit_id';

  -- --- Kontekst wysyłki e-maili (konsumowany po stronie serwera) ---
  select value into v_sender
  from public.tenant_settings
  where tenant_id = p_tenant_id and key = 'email_sender'
    and jsonb_typeof(value) = 'object';

  -- Adres powiadomień najemcy: WYŁĄCZNIE email_sender.reply_to — adres
  -- biznesowy z jawnej intencji operatora. ŚWIADOMIE bez fallbacku na e-mail
  -- ownera z auth.users (znalezisko recenzji 2.4a): odpowiedź RPC czyta każdy
  -- bezpośredni wołający z anon keyem, więc fallback zwracałby prywatny adres
  -- konta jednym żądaniem (wyciek PII). Brak reply_to → null; warstwa e-maili
  -- raportuje uczciwie „powiadomienie niewysłane — skonfiguruj nadawcę".
  v_reply_to := case
    when v_sender is not null and jsonb_typeof(v_sender -> 'reply_to') = 'string'
      then nullif(btrim(v_sender ->> 'reply_to'), '')
    else null
  end;

  return jsonb_build_object(
    'order_number', v_order_number,
    -- [0029] Identyfikator zamówienia — SERVER-ONLY, jak log_token. Jest
    -- kluczem idempotencji płatności (jeden intent na zamówienie), więc musi
    -- wyjść z tej funkcji; kontrakt CheckoutResult go nie niesie.
    'order_id', v_order_id,
    'order_status', 'pending',
    'payment_status', 'unpaid',
    -- [0029] Metoda i reżim WPROST z zapisanego wiersza — strona
    -- potwierdzenia nie ma zgadywać, czy czeka ją krok płatności.
    'payment_method', v_payment_method,
    'payment_provider', v_payment_provider,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'delivery_method', p_delivery_method,
    'total_rental_grosze', v_total_rental,
    'total_deposit_grosze', v_total_deposit,
    'delivery_grosze', v_delivery,
    'currency', v_currency,
    'items', v_summary,
    'customer', jsonb_build_object('email', v_email, 'full_name', v_full_name, 'locale', v_locale),
    'tenant', jsonb_build_object('name', v_tenant.name, 'locale', v_tenant.locale),
    'email_sender', case
      when v_sender is not null and jsonb_typeof(v_sender -> 'name') = 'string'
        then jsonb_build_object('name', v_sender ->> 'name', 'reply_to', v_reply_to)
      else null
    end,
    'notify_email', v_reply_to,
    -- Token jednorazowy wiążący PÓŹNIEJSZY zapis dziennika z TYM checkoutem
    -- (ADR-045). Dane SERWEROWE — jak notify_email nie trafiają do przeglądarki.
    'log_token', v_log_token
  );
end;
$$;

revoke all on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb, bigint, text, text) from public;
grant execute on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb, bigint, text, text) to anon, authenticated;

comment on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb, bigint, text, text) is
  'Jedyna publiczna ścieżka powstania zamówienia (ADR-042): wycena SERWEROWA, przypisanie wolnych egzemplarzy, throttle w bazie, ban-lista (ADR-080), wybór metody płatności (0029) i waluta z wiersza zamówienia (0049). [0058] Przyjmuje wartości pól własnych w DWÓCH mapach (zamówienie, klient) — encję wybiera definicja, nie wołający. [0059] WYMAGA BILETU zaufanej granicy (R13/H-02, ADR-125): app.assert_checkout_ticket jest PIERWSZĄ instrukcją ciała, więc wywołanie rolą anon bez ważnego, niezużytego biletu nie tworzy ani klienta, ani zamówienia, ani pozycji. Grant dla anona ZOSTAJE bez zmian — bramką jest bilet, nie uprawnienie. [0063] WERSJĘ REGULAMINU ROZSTRZYGA BAZA (R18, ADR-129): p_terms_version jest deklaracją wołającego konfrontowaną z rejestrem, a orders.terms_version_id wskazuje WIERSZ niezmiennej wersji wybrany po p_tenant_id — nigdy z payloadu. Deklaracja niezgodna z żywą etykietą, ale znana rejestrowi, odrzuca zamówienie (22023): klient przystał na tekst, którego już nie ma. SECURITY DEFINER.';

-- === END PROD MIGRATION 0063 ===
