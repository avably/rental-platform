-- 0026_contract_documents.sql
-- Z7 / ADR-061: prywatne, niezmienne umowy najmu per tenant.
--
-- Dokument to DOKŁADNE bajty PDF w prywatnym Storage + append-only metadane.
-- Hash liczymy z bajtów, nie z propsów. Zwykła sesja nie może zmienić ani
-- usunąć zarejestrowanego dokumentu. Wysyłki reużywają email_logs i wiążą
-- próbę z dokumentem oraz kluczem idempotencji.

-- ---------------------------------------------------------------------
-- 1. Kontrakt ustawień dokumentu w tenant_settings
-- ---------------------------------------------------------------------

alter table public.tenant_settings
  add constraint tenant_settings_contract_document_valid check (
    key <> 'contract_document'
    or case
      when jsonb_typeof(value) = 'object' then
        value ?& array['address', 'nip', 'email', 'terms_version', 'terms_body']
        and (
          value - array['address', 'nip', 'email', 'terms_version', 'terms_body']::text[]
        ) = '{}'::jsonb
        and jsonb_typeof(value -> 'address') = 'string'
        and length(btrim(value ->> 'address')) between 1 and 500
        and (
          jsonb_typeof(value -> 'nip') = 'null'
          or (
            jsonb_typeof(value -> 'nip') = 'string'
            and length(btrim(value ->> 'nip')) between 1 and 30
          )
        )
        and jsonb_typeof(value -> 'email') = 'string'
        and length(btrim(value ->> 'email')) between 3 and 320
        and jsonb_typeof(value -> 'terms_version') = 'string'
        and length(btrim(value ->> 'terms_version')) between 1 and 100
        and jsonb_typeof(value -> 'terms_body') = 'string'
        and length(btrim(value ->> 'terms_body')) between 1 and 50000
      else false
    end
  );

comment on constraint tenant_settings_contract_document_valid on public.tenant_settings is
  'Z7/ADR-061: contract_document ma dokładnie address, nip, email, terms_version, terms_body z limitami lustrzanymi wobec walidacji panelu.';

-- ---------------------------------------------------------------------
-- 2. Append-only metadane dokumentów
-- ---------------------------------------------------------------------

create table public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  locale text not null check (locale in ('en','pl')),
  terms_version text not null check (length(btrim(terms_version)) between 1 and 100),
  recipient text not null check (length(btrim(recipient)) between 3 and 320),
  -- Snapshot aktora, nie FK: dokument ma przeżyć późniejsze usunięcie konta
  -- operatora (ten sam wzorzec co audit_log.actor_user_id).
  created_by uuid not null,
  created_at timestamptz not null default now(),

  constraint contract_documents_tenant_id_key unique (tenant_id, id),
  constraint contract_documents_order_fk
    foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id),
  constraint contract_documents_storage_path_shape check (
    storage_path = tenant_id::text || '/' || order_id::text || '/' || id::text || '.pdf'
  ),
  constraint contract_documents_order_hash_key unique (tenant_id, order_id, sha256)
);

create index contract_documents_tenant_order_created_idx
  on public.contract_documents (tenant_id, order_id, created_at desc);

comment on table public.contract_documents is
  'Z7/ADR-061: append-only metadane dokładnych bajtów umowy w prywatnym buckecie rental-contracts. Brak UPDATE/DELETE dla zwykłej sesji.';
comment on column public.contract_documents.sha256 is
  'SHA-256 dokładnych bajtów PDF; sprawdzany ponownie przy pobraniu i wysyłce.';

alter table public.contract_documents enable row level security;
revoke all on public.contract_documents from anon, authenticated;
grant select, insert on public.contract_documents to authenticated;
grant select, insert, update, delete on public.contract_documents to service_role;

create policy tenant_select on public.contract_documents for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());

create policy tenant_insert on public.contract_documents for insert
  with check (
    tenant_id = app.tenant_id()
    and created_by = auth.uid()
  );

-- ---------------------------------------------------------------------
-- 3. Prywatny Storage
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('rental-contracts', 'rental-contracts', false)
on conflict (id) do update set public = false;

drop policy if exists rental_contracts_tenant_select on storage.objects;
create policy rental_contracts_tenant_select on storage.objects for select to authenticated
  using (
    bucket_id = 'rental-contracts'
    and (storage.foldername(name))[1]::uuid = app.tenant_id()
  );

drop policy if exists rental_contracts_tenant_insert on storage.objects;
create policy rental_contracts_tenant_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'rental-contracts'
    and (storage.foldername(name))[1]::uuid = app.tenant_id()
  );

-- Storage zabrania bezpośredniego DELETE z SQL (protect_delete), więc
-- sprzątanie idzie Storage API. Polityka dopuszcza wyłącznie WŁASNY upload
-- bieżącego użytkownika, w jego tenancie, dopóki nie ma metadanych. Inny
-- operator tego samego tenanta nie może wygrać wyścigu z INSERT-em dokumentu.
drop policy if exists rental_contracts_own_orphan_delete on storage.objects;
create policy rental_contracts_own_orphan_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'rental-contracts'
    and (storage.foldername(name))[1]::uuid = app.tenant_id()
    and owner = auth.uid()
    and not exists (
      select 1 from public.contract_documents d
      where d.tenant_id = app.tenant_id() and d.storage_path = storage.objects.name
    )
  );

-- ---------------------------------------------------------------------
-- 4. Powiązanie prób wysyłki z dokumentem + idempotencja
-- ---------------------------------------------------------------------

alter table public.email_logs
  drop constraint if exists email_logs_kind_check;

alter table public.email_logs
  add constraint email_logs_kind_check check (kind in (
    'rental_confirmed',
    'rental_ready_for_pickup',
    'rental_picked_up',
    'rental_returned',
    'rental_cancelled',
    'invitation',
    'return_label',
    'pickup_return_reminder',
    'checkout_confirmation',
    'new_order_notification',
    'rental_contract'
  ));

alter table public.email_logs
  add column contract_document_id uuid,
  add column idempotency_key text;

alter table public.email_logs
  add constraint email_logs_contract_document_fk
    foreign key (tenant_id, contract_document_id)
    references public.contract_documents (tenant_id, id),
  add constraint email_logs_contract_shape check (
    (
      kind = 'rental_contract'
      and contract_document_id is not null
      and length(btrim(coalesce(idempotency_key, ''))) between 1 and 256
    )
    or (
      kind <> 'rental_contract'
      and contract_document_id is null
      and idempotency_key is null
    )
  );

create unique index email_logs_tenant_idempotency_key
  on public.email_logs (tenant_id, idempotency_key);

comment on column public.email_logs.contract_document_id is
  'Z7/ADR-061: dokładny dokument dołączony do próby rental_contract; FK złożony chroni granicę tenanta.';
comment on column public.email_logs.idempotency_key is
  'Z7/ADR-061: klucz próby wysyłki, unikalny per tenant także po 24-godzinnym oknie dostawcy.';
