-- 0033_review_comments.sql
-- ADR-071: warstwa komentarzy przeglądu produktu (narzędzie WEWNĘTRZNE).
--
-- Właściciel przechodzi produkt ekran po ekranie (panel, marketing, sklep
-- klienta) i zostawia uwagi bezpośrednio na żywym interfejsie — pinezka lub
-- obszar, treść, priorytet 1–5, obrazki-inspiracje. PM czyta je w
-- /admin/przeglad-uwagi i nanosi poprawki.
--
-- TABELE SĄ PLATFORMOWE (bez tenant_id) — uwagi dotyczą PRODUKTU, nie danych
-- najemcy, i istnieją wyłącznie na czas przeglądu przed startem. Jedyna oś
-- dostępu: superadmin. Najemca i anon nie mają tu żadnej polityki ani grantu
-- SELECT-a poza rolą authenticated (którą i tak zatrzymuje polityka
-- app.is_superadmin()). Zapis ze storefrontu (gdzie nie ma sesji) idzie
-- service_rolem przez podwójnie bramkowany endpoint (REVIEW_MODE + hasło
-- site'u) — wyjątek odnotowany w scripts/audit-service-role.sh.

-- ---------------------------------------------------------------------
-- 1. Komentarze przeglądu
-- ---------------------------------------------------------------------

create table public.review_comments (
  id uuid primary key default gen_random_uuid(),
  -- Powierzchnia, na której padła uwaga — trzy fronty produktu.
  surface text not null check (surface in ('panel', 'marketing', 'storefront')),
  -- Etykieta z listy 39 ekranów przeglądu (np. „01 Dashboard"). Tekst, nie
  -- enum: lista ekranów żyje w artefakcie trackera i w @avably/review, a
  -- prefiks numeryczny daje kolejność sortowania w widoku PM.
  screen text not null check (length(btrim(screen)) between 1 and 120),
  -- Pathname bez prefiksu locale — pozwala nakładce załadować uwagi trasy.
  route text not null check (length(btrim(route)) between 1 and 500),
  kind text not null check (kind in ('point', 'area')),
  -- Pozycja znormalizowana do DOKUMENTU (0..1) — niezależna od viewportu.
  pos_x numeric not null check (pos_x between 0 and 1),
  pos_y numeric not null check (pos_y between 0 and 1),
  -- Wymiary obszaru tylko dla kind=area.
  area_w numeric check (area_w between 0 and 1),
  area_h numeric check (area_h between 0 and 1),
  scroll_y int not null default 0,
  body text not null check (length(btrim(body)) between 1 and 10000),
  -- 1 = najwyższy priorytet; domyślnie środek skali.
  priority int not null default 3 check (priority between 1 and 5),
  status text not null default 'open' check (status in ('open', 'done')),
  -- Snapshot aktora (panel: auth.uid(); storefront: null — brak sesji za
  -- hasłem site'u). Nie FK — narzędzie znika przed startem, konto może żyć.
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint review_comments_area_shape check (
    (kind = 'area' and area_w is not null and area_h is not null)
    or (kind = 'point' and area_w is null and area_h is null)
  )
);

create index review_comments_route_idx on public.review_comments (surface, route);
create index review_comments_priority_idx on public.review_comments (status, priority, screen, created_at);

comment on table public.review_comments is
  'ADR-071: uwagi przeglądu produktu przed startem (narzędzie wewnętrzne, superadmin-only). Tabela platformowa — bez tenant_id.';
comment on column public.review_comments.screen is
  'Etykieta z listy 39 ekranów przeglądu; prefiks numeryczny daje kolejność ekranu w widoku PM.';
comment on column public.review_comments.priority is
  '1 = najwyższy, 5 = najniższy; domyślnie 3.';

create or replace function app.review_comments_touch() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.review_comments_touch() is
  'Znacznik ostatniej zmiany uwagi przeglądu (0033) — status/priorytet/treść zmieniają się w trakcie nanoszenia poprawek.';

create trigger review_comments_touch
  before update on public.review_comments
  for each row execute function app.review_comments_touch();

-- ---------------------------------------------------------------------
-- 2. Obrazki uwag (wiele na komentarz)
-- ---------------------------------------------------------------------

create table public.review_comment_attachments (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.review_comments (id) on delete cascade,
  -- Ścieżka w prywatnym buckecie review-attachments; podgląd przez signed URL.
  image_path text not null unique check (length(btrim(image_path)) between 1 and 500),
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create index review_comment_attachments_comment_idx
  on public.review_comment_attachments (comment_id, sort);

comment on table public.review_comment_attachments is
  'ADR-071: obrazki dołączone do uwag przeglądu (wklejka/zrzut/inspiracja) w prywatnym buckecie review-attachments.';

-- ---------------------------------------------------------------------
-- 3. RLS: wyłącznie superadmin
-- ---------------------------------------------------------------------
--
-- Grant dla authenticated jest KONIECZNY (PostgREST łączy się tą rolą także
-- dla superadmina), ale całą treść dostępu trzyma polityka
-- app.is_superadmin(). anon: zero grantów — odmowa pada na uprawnieniach
-- (42501), zanim RLS dojdzie do głosu (wzorzec waitlist_signups/0006).

alter table public.review_comments enable row level security;
alter table public.review_comment_attachments enable row level security;

revoke all on public.review_comments from anon, authenticated;
revoke all on public.review_comment_attachments from anon, authenticated;

grant select, insert, update, delete on public.review_comments to authenticated;
grant select, insert, update, delete on public.review_comments to service_role;
grant select, insert, update, delete on public.review_comment_attachments to authenticated;
grant select, insert, update, delete on public.review_comment_attachments to service_role;

create policy superadmin_select on public.review_comments for select
  using (app.is_superadmin());
create policy superadmin_insert on public.review_comments for insert
  with check (app.is_superadmin());
create policy superadmin_update on public.review_comments for update
  using (app.is_superadmin())
  with check (app.is_superadmin());
create policy superadmin_delete on public.review_comments for delete
  using (app.is_superadmin());

create policy superadmin_select on public.review_comment_attachments for select
  using (app.is_superadmin());
create policy superadmin_insert on public.review_comment_attachments for insert
  with check (app.is_superadmin());
create policy superadmin_update on public.review_comment_attachments for update
  using (app.is_superadmin())
  with check (app.is_superadmin());
create policy superadmin_delete on public.review_comment_attachments for delete
  using (app.is_superadmin());

-- ---------------------------------------------------------------------
-- 4. Prywatny Storage na obrazki
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('review-attachments', 'review-attachments', false)
on conflict (id) do update set public = false;

drop policy if exists review_attachments_superadmin_select on storage.objects;
create policy review_attachments_superadmin_select on storage.objects for select to authenticated
  using (bucket_id = 'review-attachments' and app.is_superadmin());

drop policy if exists review_attachments_superadmin_insert on storage.objects;
create policy review_attachments_superadmin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'review-attachments' and app.is_superadmin());

drop policy if exists review_attachments_superadmin_delete on storage.objects;
create policy review_attachments_superadmin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'review-attachments' and app.is_superadmin());
