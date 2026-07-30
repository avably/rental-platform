-- 0043_site_sections_types_and_images.sql
-- Kreator sekcyjny stron sklepu, etap A2 (ADR-082). Dwie osie w jednej migracji
-- (wzorzec 0016/0018 — spójna zmiana modelu strony w jednym kroku):
--
--   1. site_sections.type: sześć nowych typów sekcji (testimonials, gallery,
--      usp, cta, directions, delivery) — lustro SECTION_TYPES z @avably/core/site.
--      Baza pilnuje tylko OSI typu (CHECK); kształt treści (jsonb) definiuje Zod
--      w core (ADR-041), nie CHECK-i pól.
--
--   2. Zdjęcia sekcji: bucket PUBLICZNY `site-images` + prywatny rejestr biletów
--      `site_image_uploads` + wąskie SECURITY DEFINER RPC (issue/claim/finish) —
--      DOKŁADNE LUSTRO uploadu zdjęć produktów (0018 + 0038). Bajty nie
--      przechodzą przez Server Actions; sesja członka dostaje wyłącznie
--      tenant-bound bilet i podpis do JEDNEJ ścieżki. Dodatkowo
--      app.site_image_paths_in_use — prymityw dla crona sierot (referencje
--      zdjęć siedzą w content jsonb sekcji, nie w osobnej tabeli-katalogu).
--
-- Bucket zakładamy TU (insert into storage.buckets, wzorzec 0018) — NIE wymaga
-- kroku w dashboardzie. 0038 tylko aktualizował istniejący bucket 0018; tu
-- bucket jest nowy, więc migracja go tworzy i od razu ustawia twardy kontrakt.

-- === BEGIN PROD MIGRATION 0043 ===

-- ---------------------------------------------------------------------
-- 1. Rozszerzenie CHECK-a typów sekcji (0019 → 0043)
-- ---------------------------------------------------------------------
--
-- 0019 nadał kolumnie `type` inline CHECK bez nazwy — Postgres nazwał go
-- deterministycznie `site_sections_type_check`. Rozszerzenie listy tylko
-- POSZERZA dopuszczalny zbiór, więc żaden istniejący wiersz nie może go
-- naruszyć. Drop + add w jednym kroku (nowa lista jest nadzbiorem starej).

alter table public.site_sections
  drop constraint if exists site_sections_type_check;

alter table public.site_sections
  add constraint site_sections_type_check check (
    type in (
      'hero', 'products', 'pricing', 'faq', 'contact', 'freeform',
      'testimonials', 'gallery', 'usp', 'cta', 'directions', 'delivery'
    )
  );

comment on constraint site_sections_type_check on public.site_sections is
  'Zamknięta lista typów sekcji — lustro SECTION_TYPES z @avably/core/site (ADR-041/ADR-082). Nowy typ = zmiana tego CHECK-a + schemat Zod w core.';

-- ---------------------------------------------------------------------
-- 2. Bucket `site-images` (publiczny odczyt, twardy kontrakt)
-- ---------------------------------------------------------------------
--
-- Wzorzec 0018: bucket zakładany migracją (idempotentnie), publiczny do odczytu
-- (storefront serwuje /object/public/…). Limit 5 MB i allowlista MIME lustrem
-- product-images — te same typy, ta sama górna granica.

insert into storage.buckets (id, name, public)
values ('site-images', 'site-images', true)
on conflict (id) do nothing;

update storage.buckets
set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif'
  ]::text[]
where id = 'site-images';

-- ---------------------------------------------------------------------
-- 3. Prywatny rejestr zamiarów uploadu zdjęć sekcji
-- ---------------------------------------------------------------------
--
-- Lustro public.product_image_uploads (0038), z rodzicem `sites` zamiast
-- `products`: FK ZŁOŻONY (tenant_id, site_id) → sites(tenant_id, id) czyni
-- bilet wskazujący CUDZĄ stronę niereprezentowalnym (23503), tak jak bilet
-- zdjęcia produktu nie może wskazać cudzego produktu. Ścieżka wiązana
-- CHECK-iem: {tenant}/{site}/{upload_id}.{ext}.

create table public.site_image_uploads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  site_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  declared_mime text not null,
  declared_size bigint not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint site_image_uploads_tenant_id_key unique (tenant_id, id),
  constraint site_image_uploads_site_fk
    foreign key (tenant_id, site_id)
    references public.sites (tenant_id, id) on delete cascade,
  constraint site_image_uploads_status_check
    check (status in ('pending', 'processing', 'completed', 'rejected')),
  constraint site_image_uploads_mime_check
    check (declared_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  constraint site_image_uploads_size_check
    check (declared_size between 1 and 5242880),
  constraint site_image_uploads_expiry_check
    check (expires_at > created_at),
  constraint site_image_uploads_path_check
    check (
      storage_path =
        tenant_id::text || '/' || site_id::text || '/' || id::text || '.' ||
        case declared_mime
          when 'image/jpeg' then 'jpg'
          when 'image/png' then 'png'
          when 'image/webp' then 'webp'
          when 'image/avif' then 'avif'
        end
    )
);

create index site_image_uploads_tenant_created_idx
  on public.site_image_uploads (tenant_id, created_at);
create index site_image_uploads_cleanup_idx
  on public.site_image_uploads (status, created_at);

alter table public.site_image_uploads enable row level security;

-- Brak polityk dla anon/authenticated — jak w 0038: JEDYNA ścieżka użytkownika
-- to SECURITY DEFINER RPC niżej; bezpośredni dostęp API-owy jest zamknięty
-- brakiem grantu (42501). service_role omija RLS (cron sierot).
revoke all on public.site_image_uploads from anon, authenticated;
grant select, insert, update, delete on public.site_image_uploads to service_role;

comment on table public.site_image_uploads is
  'Prywatny rejestr jednorazowych zamiarów uploadu zdjęć sekcji strony. Brak bezpośredniego API dla anon/authenticated; ścieżka użytkownika korzysta wyłącznie z app.issue/claim/finish_site_image_upload. Lustro product_image_uploads (0038).';

-- ---------------------------------------------------------------------
-- 4. Wąskie SECURITY DEFINER RPC (issue / claim / finish / can_upload)
-- ---------------------------------------------------------------------

create or replace function app.issue_site_image_upload(
  p_site_id uuid,
  p_declared_mime text,
  p_declared_size bigint
)
returns table(upload_id uuid, storage_path text)
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text := 'Nie można wykonać tego uploadu zdjęcia.';
  v_user_id uuid;
  v_tenant_id uuid;
  v_upload_id uuid := gen_random_uuid();
  v_extension text;
  v_storage_path text;
begin
  v_user_id := auth.uid();
  v_tenant_id := app.tenant_id();

  if v_user_id is null or v_tenant_id is null then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  if p_declared_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
     or p_declared_size not between 1 and 5242880 then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  -- Strona MUSI należeć do tenanta wołającego — bilet dla cudzej strony jest
  -- odmawiany tu (a FK złożony zamknąłby go i tak: 23503).
  if not exists (
    select 1
    from public.sites s
    where s.tenant_id = v_tenant_id
      and s.id = p_site_id
  ) then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  v_extension := case p_declared_mime
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/avif' then 'avif'
  end;
  v_storage_path :=
    v_tenant_id::text || '/' || p_site_id::text || '/' ||
    v_upload_id::text || '.' || v_extension;

  insert into public.site_image_uploads (
    id,
    tenant_id,
    site_id,
    requested_by,
    storage_path,
    declared_mime,
    declared_size,
    expires_at
  )
  values (
    v_upload_id,
    v_tenant_id,
    p_site_id,
    v_user_id,
    v_storage_path,
    p_declared_mime,
    p_declared_size,
    clock_timestamp() + interval '15 minutes'
  );

  return query select v_upload_id, v_storage_path;
end;
$$;

create or replace function app.claim_site_image_upload(
  p_upload_id uuid
)
returns table(
  upload_id uuid,
  tenant_id uuid,
  site_id uuid,
  storage_path text,
  declared_mime text,
  declared_size bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text := 'Nie można wykonać tego uploadu zdjęcia.';
begin
  return query
  update public.site_image_uploads u
  set status = 'processing'
  where u.id = p_upload_id
    and u.tenant_id = app.tenant_id()
    and u.requested_by = auth.uid()
    and u.status = 'pending'
    and u.expires_at > clock_timestamp()
  returning
    u.id,
    u.tenant_id,
    u.site_id,
    u.storage_path,
    u.declared_mime,
    u.declared_size;

  if not found then
    raise exception '%', c_denied using errcode = '22023';
  end if;
end;
$$;

create or replace function app.finish_site_image_upload(
  p_upload_id uuid,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text := 'Nie można wykonać tego uploadu zdjęcia.';
begin
  if p_outcome not in ('completed', 'rejected') then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  update public.site_image_uploads u
  set
    status = p_outcome,
    finished_at = clock_timestamp()
  where u.id = p_upload_id
    and u.tenant_id = app.tenant_id()
    and u.requested_by = auth.uid()
    and u.status = 'processing';

  if not found then
    raise exception '%', c_denied using errcode = '22023';
  end if;
end;
$$;

revoke all on function app.issue_site_image_upload(uuid, text, bigint)
  from public, anon, authenticated;
revoke all on function app.claim_site_image_upload(uuid)
  from public, anon, authenticated;
revoke all on function app.finish_site_image_upload(uuid, text)
  from public, anon, authenticated;

grant execute on function app.issue_site_image_upload(uuid, text, bigint)
  to authenticated, service_role;
grant execute on function app.claim_site_image_upload(uuid)
  to authenticated, service_role;
grant execute on function app.finish_site_image_upload(uuid, text)
  to authenticated, service_role;

-- Predykat polityki Storage INSERT (lustro can_upload_product_image): obiekt
-- można wgrać wyłącznie na ścieżkę OTWARTEGO biletu wołającego (pending,
-- nieprzeterminowanego) — join na sites potwierdza spójność (tenant_id, site_id).
create or replace function app.can_upload_site_image(
  p_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select exists (
    select 1
    from public.site_image_uploads u
    join public.sites s
      on s.tenant_id = u.tenant_id
     and s.id = u.site_id
    where u.storage_path = p_storage_path
      and u.tenant_id = app.tenant_id()
      and u.requested_by = auth.uid()
      and u.status = 'pending'
      and u.expires_at > clock_timestamp()
  );
$$;

revoke all on function app.can_upload_site_image(text)
  from public, anon, authenticated;
grant execute on function app.can_upload_site_image(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. app.site_image_paths_in_use — prymityw crona sierot
-- ---------------------------------------------------------------------
--
-- Referencje zdjęć sekcji NIE mają osobnej tabeli-katalogu (jak product_images)
-- — siedzą w content jsonb sekcji: `hero.imagePath` (skalar) oraz
-- `gallery.items[].imagePath` (tablica). Cron sierot (bliźniaczy do
-- cleanup-product-image-uploads) pyta tą funkcją, które z kandydujących ścieżek
-- są JESZCZE w użyciu (draft LUB published), i kasuje wyłącznie resztę.
--
-- Globalny odczyt wszystkich sekcji (cron nie ma tenanta) — stąd SECURITY
-- DEFINER i grant WYŁĄCZNIE dla service_role. jsonb_typeof strzeże
-- jsonb_array_elements przed nie-tablicą (rzuciłoby błędem).
create or replace function app.site_image_paths_in_use(
  p_paths text[]
)
returns setof text
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select cand.path
  from unnest(p_paths) as cand(path)
  where exists (
    select 1
    from public.site_sections s
    where cand.path in (
           s.content_draft ->> 'imagePath',
           s.content_published ->> 'imagePath'
         )
       or exists (
         select 1
         from jsonb_array_elements(
           case when jsonb_typeof(s.content_draft -> 'items') = 'array'
                then s.content_draft -> 'items' else '[]'::jsonb end
         ) as e
         where e ->> 'imagePath' = cand.path
       )
       or exists (
         select 1
         from jsonb_array_elements(
           case when jsonb_typeof(s.content_published -> 'items') = 'array'
                then s.content_published -> 'items' else '[]'::jsonb end
         ) as e
         where e ->> 'imagePath' = cand.path
       )
  );
$$;

revoke all on function app.site_image_paths_in_use(text[])
  from public, anon, authenticated;
grant execute on function app.site_image_paths_in_use(text[])
  to service_role;

-- ---------------------------------------------------------------------
-- 6. Twardy kontrakt polityk Storage dla `site-images`
-- ---------------------------------------------------------------------
--
-- storage.objects to tabela WSPÓŁDZIELONA (nie tworzona tu) — stąd
-- `drop policy if exists` przed każdym `create` (wzorzec 0018/0038).
--
-- ZAPIS (insert): dozwolony wyłącznie gdy app.can_upload_site_image potwierdzi
-- otwarty bilet wołającego na tę dokładnie ścieżkę — jak w product-images.
-- UST/DELETE po pierwszym segmencie ścieżki = tenant (tenant-bound). BEZ
-- polityki UPDATE: obiekt jest jednorazowy (upsert=false), nadpisanie nie ma
-- prawa się zdarzyć.

drop policy if exists site_images_tenant_insert on storage.objects;
create policy site_images_tenant_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'site-images'
  and app.can_upload_site_image(storage.objects.name)
);

drop policy if exists site_images_tenant_update on storage.objects;

drop policy if exists site_images_tenant_delete on storage.objects;
create policy site_images_tenant_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'site-images'
  and (storage.foldername(name))[1] = app.tenant_id()::text
);

drop policy if exists site_images_public_read on storage.objects;
create policy site_images_public_read on storage.objects
for select
using (bucket_id = 'site-images');

-- === END PROD MIGRATION 0043 ===
