-- 0039_order_notes.sql
-- Notatki zamówienia jako LISTA WPISÓW (uwaga właściciela, runda 2026-07-28:
-- „notatki po zapisaniu powinny być listą — treść, data — każda kolejna
-- zapisana notatka trafia do listy, nie do uzupełnianego inputa"). Decyzja
-- projektowa: ADR-079.
--
-- Do tej pory notatka zamówienia była JEDNYM polem `orders.notes` (text,
-- od 0007), nadpisywanym przy każdym zapisie — druga uwaga kasowała pierwszą.
-- Ta migracja wprowadza tabelę `order_notes` (jeden wiersz = jeden wpis)
-- i PRZENOSI istniejącą treść `orders.notes` jako pierwszy wpis listy.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md, nagłówki 0007/0013):
--   * zbiory wartości to text + CHECK, nie enumy,
--   * revoke all PRZED grantami na każdej nowej tabeli (0006/0008),
--   * FK ZŁOŻONY (tenant_id, order_id) → orders — wiersz międzytenantowy jest
--     niereprezentowalny niezależnie od polityk RLS (0007, order_items),
--   * indeks zaczyna się od tenant_id,
--   * wyłącznie standardowe SQLSTATE (23514/23503) — kody P0xxx PostgREST
--     zjada do gołego 500 bez treści (nagłówek 0011).
--
-- CZEGO TA MIGRACJA NIE ROBI: nie usuwa kolumny `orders.notes`. Kolumna
-- zostaje jako świadek danych źródłowych do czasu okrzepnięcia listy —
-- osobna migracja czyszcząca zdejmie ją później (dług odnotowany w ADR-079).

-- ---------------------------------------------------------------------
-- 1. Tabela order_notes
-- ---------------------------------------------------------------------
--
-- Jeden wiersz = jeden wpis notatki. Treść to `body` (niepusty, jak w
-- review_comments/0033), autorem jest członek zespołu w `created_by`.
--
-- created_by BEZ FK (wzorzec deposit_events.created_by/0007,
-- courier_shipments.created_by/0013): wpis notatki musi przetrwać usunięcie
-- konta pracownika — autorstwo uwagi z odbioru sprzętu nie może zniknąć
-- razem z jego kontem. NULL jest dopuszczalny i oznacza wpis HISTORYCZNY
-- (przeniesiony z orders.notes, gdzie autora nigdy nie zapisywano) — UI
-- pokazuje wtedy „—". Rozwiązanie uuid → e-mail robi na żywo funkcja
-- app.tenant_member_emails() (sekcja 4); autor, który odszedł z zespołu,
-- też pokazuje się jako „—" (świadomy kompromis — ADR-079).
create table public.order_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,

  -- Treść wpisu. Górny limit hojny (jak review_comments) — notatka bywa
  -- akapitem ustaleń z klientem, nie hasłem; dolny (btrim >= 1) odrzuca
  -- puste/„same spacje" u źródła, żeby lista nie zbierała pustych wierszy.
  body text not null check (length(btrim(body)) between 1 and 10000),

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint order_notes_tenant_id_key unique (tenant_id, id),

  -- FK ZŁOŻONY — bramka spójności tenanta, której RLS nie zapewnia
  -- (uzasadnienie: 0007, order_items_order_fk). Kaskada z zamówienia:
  -- usunięcie zamówienia (ścieżka naprawy pomyłki ownera) zabiera też
  -- jego notatki.
  constraint order_notes_order_fk
    foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete cascade
);

-- Zapytanie panelu: „wpisy tego zamówienia, najnowsze na górze". Indeks
-- zaczyna się od tenant_id (konwencja); sortowanie malejące realizuje skan
-- wsteczny po tym samym indeksie.
create index order_notes_tenant_order_idx
  on public.order_notes (tenant_id, order_id, created_at);

comment on table public.order_notes is
  'Notatki zamówienia jako lista wpisów (ADR-079). Jeden wiersz = jeden wpis (treść, autor, data). Zastępuje nadpisywane pole orders.notes, które zostaje do czasu okrzepnięcia (dług ADR-079).';
comment on column public.order_notes.created_by is
  'Autor wpisu (członek zespołu, auth.uid() przy zapisie). Bez FK — autorstwo przeżywa usunięcie konta. NULL = wpis historyczny przeniesiony z orders.notes. Rozwiązanie na e-mail: app.tenant_member_emails().';
comment on column public.order_notes.body is
  'Treść wpisu (niepusta, do 10000 znaków). Notatka bywa akapitem ustaleń, nie hasłem.';

-- Znacznik ostatniej zmiany — wpis wolno edytować inline (ADR-079).
create or replace function app.order_notes_touch() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.order_notes_touch() is
  'Znacznik ostatniej zmiany wpisu notatki (0039) — treść zmienia się przy edycji inline.';

create trigger order_notes_touch
  before update on public.order_notes
  for each row execute function app.order_notes_touch();

-- ---------------------------------------------------------------------
-- 2. RLS + GRANT-y
-- ---------------------------------------------------------------------

alter table public.order_notes enable row level security;

-- REVOKE PRZED GRANT-em (wzorzec 0006/0008): nowa tabela rodzi się z
-- kompletem uprawnień default privileges, w tym TRUNCATE spoza zasięgu RLS.
revoke all on public.order_notes from anon, authenticated;

-- anon: NIC (tabela czysto panelowa).
grant select, insert, update, delete on public.order_notes
  to authenticated, service_role;

create policy tenant_select on public.order_notes for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.order_notes for insert
  with check (tenant_id = app.tenant_id());
-- UPDATE i DELETE dla KAŻDEGO członka tenanta (nie tylko ownera — inaczej niż
-- courier_shipments/0007). Zespół jest mały, a notatka nie jest rekordem
-- finansowym: edycja i twarde usunięcie cudzego wpisu są dozwolone świadomie
-- (ADR-079). Bramką pozostaje tenant_id = app.tenant_id() — cudzy tenant nie
-- dosięga wiersza niezależnie od tej decyzji.
create policy tenant_update on public.order_notes for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
create policy tenant_delete on public.order_notes for delete
  using (tenant_id = app.tenant_id());

-- ---------------------------------------------------------------------
-- 3. Przeniesienie danych: orders.notes → pierwszy wpis listy
-- ---------------------------------------------------------------------
--
-- Istniejąca treść staje się PIERWSZYM wpisem listy danego zamówienia.
-- created_by = NULL (autora starych notatek nigdy nie zapisywano — wpis
-- historyczny, UI pokaże „—"); created_at = orders.created_at, żeby wpis
-- sortował się jako najstarszy i miał sensowną datę zamiast „teraz".
-- Filtr length(btrim(notes)) >= 1 pomija puste i „same spacje" — takie
-- i tak nie przeszłyby CHECK-a body.
insert into public.order_notes (tenant_id, order_id, body, created_by, created_at, updated_at)
select o.tenant_id, o.id, btrim(o.notes), null, o.created_at, o.created_at
from public.orders o
where o.notes is not null
  and length(btrim(o.notes)) >= 1;

-- ---------------------------------------------------------------------
-- 4. Rozwiązanie autora: e-mail członka zespołu (SECURITY DEFINER)
-- ---------------------------------------------------------------------
--
-- created_by trzyma uuid, a UI pokazuje CZŁOWIEKA — a jedyna czytelna
-- tożsamość członka to e-mail w auth.users (members nie ma nazwy). auth.users
-- jest poza RLS aplikacji, więc odczyt idzie funkcją SECURITY DEFINER z jawnie
-- WĘŻSZĄ walidacją w ciele (wzorzec app.create_tenant/app.accept_invitation
-- z 0003): funkcja zwraca WYŁĄCZNIE e-maile członków tenanta WOŁAJĄCEGO
-- (app.tenant_id() czyta claim z JWT żądania, nie z definera), więc nie
-- ujawnia adresów spoza organizacji. Członkowie i tak widzą user_id swoich
-- kolegów przez politykę members.tenant_select (0001) — e-mail jest naturalnym
-- rozszerzeniem dla narzędzia zespołowego (ADR-079).
--
-- STABLE, bo czyta tabele; search_path przypięty (wzorzec 0002/0003), żeby
-- SECURITY DEFINER nie dał się nabrać na podstawiony obiekt z search_path
-- wołającego.
create or replace function app.tenant_member_emails()
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = pg_catalog, public, auth, app
as $$
  select m.user_id, u.email::text
  from public.members m
  join auth.users u on u.id = m.user_id
  where m.tenant_id = app.tenant_id()
$$;

comment on function app.tenant_member_emails() is
  'Mapa uuid→e-mail członków tenanta WOŁAJĄCEGO (app.tenant_id() z JWT żądania). SECURITY DEFINER — czyta auth.users, ale zwraca wyłącznie adresy własnego tenanta. Używana do pokazania autora wpisu notatki (ADR-079).';

-- Tylko authenticated (członek panelu). anon nie ma tu czego szukać; zabranie
-- public/anon domyka powierzchnię PostgREST pod schematem app.
revoke all on function app.tenant_member_emails() from public, anon;
grant execute on function app.tenant_member_emails() to authenticated;
