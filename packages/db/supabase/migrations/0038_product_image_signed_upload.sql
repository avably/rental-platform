-- 0038_product_image_signed_upload.sql
-- Bezpośredni, jednorazowy upload zdjęć produktów do publicznego bucketa
-- product-images. Bajty nie przechodzą przez Server Actions; sesja członka
-- dostaje wyłącznie tenant-bound bilet i podpis do jednej ścieżki.

-- === BEGIN PROD MIGRATION 0038 ===

-- ---------------------------------------------------------------------
-- 1. Preflight istniejących metadanych zdjęć
-- ---------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from public.product_images pi
    where split_part(pi.storage_path, '/', 1) <> pi.tenant_id::text
       or split_part(pi.storage_path, '/', 2) <> pi.product_id::text
       or pi.storage_path !~ (
         '^' || pi.tenant_id::text || '/' || pi.product_id::text ||
         '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' ||
         '\.(jpg|png|webp|avif)$'
       )
  ) then
    raise exception
      'Istniejące product_images.storage_path nie spełniają kontraktu migracji 0038.';
  end if;

  if exists (
    select pi.storage_path
    from public.product_images pi
    group by pi.storage_path
    having count(*) > 1
  ) then
    raise exception
      'Istniejące product_images.storage_path zawierają duplikaty; migracja 0038 przerwana.';
  end if;
end;
$$;

alter table public.product_images
  add constraint product_images_storage_path_key unique (storage_path);

alter table public.product_images
  add constraint product_images_storage_path_shape check (
    split_part(storage_path, '/', 1) = tenant_id::text
    and split_part(storage_path, '/', 2) = product_id::text
    and storage_path ~ (
      '^' || tenant_id::text || '/' || product_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' ||
      '\.(jpg|png|webp|avif)$'
    )
  );

-- ---------------------------------------------------------------------
-- 2. Prywatny rejestr zamiarów uploadu
-- ---------------------------------------------------------------------

create table public.product_image_uploads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  declared_mime text not null,
  declared_size bigint not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint product_image_uploads_tenant_id_key unique (tenant_id, id),
  constraint product_image_uploads_product_fk
    foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete cascade,
  constraint product_image_uploads_status_check
    check (status in ('pending', 'processing', 'completed', 'rejected')),
  constraint product_image_uploads_mime_check
    check (declared_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  constraint product_image_uploads_size_check
    check (declared_size between 1 and 5242880),
  constraint product_image_uploads_expiry_check
    check (expires_at > created_at),
  constraint product_image_uploads_path_check
    check (
      storage_path =
        tenant_id::text || '/' || product_id::text || '/' || id::text || '.' ||
        case declared_mime
          when 'image/jpeg' then 'jpg'
          when 'image/png' then 'png'
          when 'image/webp' then 'webp'
          when 'image/avif' then 'avif'
        end
    )
);

create index product_image_uploads_tenant_created_idx
  on public.product_image_uploads (tenant_id, created_at);
create index product_image_uploads_cleanup_idx
  on public.product_image_uploads (status, created_at);

alter table public.product_image_uploads enable row level security;

revoke all on public.product_image_uploads from anon, authenticated;
grant select, insert, update, delete on public.product_image_uploads to service_role;

comment on table public.product_image_uploads is
  'Prywatny rejestr jednorazowych zamiarów uploadu zdjęć. Brak bezpośredniego API dla anon/authenticated; ścieżka użytkownika korzysta wyłącznie z app.issue/claim/finish_product_image_upload.';

-- ---------------------------------------------------------------------
-- 3. Wąskie SECURITY DEFINER RPC
-- ---------------------------------------------------------------------

create or replace function app.issue_product_image_upload(
  p_product_id uuid,
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

  if not exists (
    select 1
    from public.products p
    where p.tenant_id = v_tenant_id
      and p.id = p_product_id
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
    v_tenant_id::text || '/' || p_product_id::text || '/' ||
    v_upload_id::text || '.' || v_extension;

  insert into public.product_image_uploads (
    id,
    tenant_id,
    product_id,
    requested_by,
    storage_path,
    declared_mime,
    declared_size,
    expires_at
  )
  values (
    v_upload_id,
    v_tenant_id,
    p_product_id,
    v_user_id,
    v_storage_path,
    p_declared_mime,
    p_declared_size,
    clock_timestamp() + interval '15 minutes'
  );

  return query select v_upload_id, v_storage_path;
end;
$$;

create or replace function app.claim_product_image_upload(
  p_upload_id uuid
)
returns table(
  upload_id uuid,
  tenant_id uuid,
  product_id uuid,
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
  update public.product_image_uploads u
  set status = 'processing'
  where u.id = p_upload_id
    and u.tenant_id = app.tenant_id()
    and u.requested_by = auth.uid()
    and u.status = 'pending'
    and u.expires_at > clock_timestamp()
  returning
    u.id,
    u.tenant_id,
    u.product_id,
    u.storage_path,
    u.declared_mime,
    u.declared_size;

  if not found then
    raise exception '%', c_denied using errcode = '22023';
  end if;
end;
$$;

create or replace function app.finish_product_image_upload(
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

  update public.product_image_uploads u
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

revoke all on function app.issue_product_image_upload(uuid, text, bigint)
  from public, anon, authenticated;
revoke all on function app.claim_product_image_upload(uuid)
  from public, anon, authenticated;
revoke all on function app.finish_product_image_upload(uuid, text)
  from public, anon, authenticated;

grant execute on function app.issue_product_image_upload(uuid, text, bigint)
  to authenticated, service_role;
grant execute on function app.claim_product_image_upload(uuid)
  to authenticated, service_role;
grant execute on function app.finish_product_image_upload(uuid, text)
  to authenticated, service_role;

create or replace function app.can_upload_product_image(
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
    from public.product_image_uploads u
    join public.products p
      on p.tenant_id = u.tenant_id
     and p.id = u.product_id
    where u.storage_path = p_storage_path
      and u.tenant_id = app.tenant_id()
      and u.requested_by = auth.uid()
      and u.status = 'pending'
      and u.expires_at > clock_timestamp()
  );
$$;

revoke all on function app.can_upload_product_image(text)
  from public, anon, authenticated;
grant execute on function app.can_upload_product_image(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Twardy kontrakt bucketa i polityk Storage
-- ---------------------------------------------------------------------

do $$
begin
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
  where id = 'product-images';

  if not found then
    raise exception 'Brak wymaganego bucketu product-images.';
  end if;
end;
$$;

drop policy if exists product_images_tenant_insert on storage.objects;
create policy product_images_tenant_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'product-images'
  and app.can_upload_product_image(storage.objects.name)
);

drop policy if exists product_images_tenant_update on storage.objects;

drop policy if exists product_images_tenant_delete on storage.objects;
create policy product_images_tenant_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = app.tenant_id()::text
);

drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects
for select
using (bucket_id = 'product-images');

-- === END PROD MIGRATION 0038 ===
