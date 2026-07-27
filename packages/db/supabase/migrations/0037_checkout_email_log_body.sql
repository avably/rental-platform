-- 0037_checkout_email_log_body.sql
-- ADR-077: storefront zapisuje dokładną treść HTML e-maili checkoutu.
--
-- Migracja 0035 dodała nullable public.email_logs.body, a sendAndLog od tego
-- czasu przekazuje rejestratorowi dokładnie input.email.html. Panel zapisywał
-- tę wartość od razu, lecz wąskie RPC storefrontu z 0021 nie miało parametru
-- na treść. Ta migracja domyka wyłącznie ten kontrakt.
--
-- p_body jest OSTATNIM parametrem z DEFAULT NULL. Dzięki temu migracja może
-- wejść przed aplikacją: stary caller nadal działa i zapisuje NULL. Odwrotna
-- kolejność nie jest wspierana — aplikacja wysyłająca p_body do starej
-- sygnatury dostaje PGRST202.
--
-- Stara sygnatura jest usuwana jawnie. CREATE OR REPLACE nie potrafi zmienić
-- listy argumentów i zostawiłoby overload; PostgREST mógłby wtedy wybrać
-- nie tę funkcję, a audyt grantów miałby dwie publiczne powierzchnie.

-- PROD BLOCK START: app.log_public_checkout_email
drop function if exists app.log_public_checkout_email(
  uuid, text, uuid, text, text, text, text, text, text
);

create function app.log_public_checkout_email(
  p_tenant_id uuid,
  p_order_number text,
  p_log_token uuid,
  p_kind text,
  p_recipient text,
  p_subject text,
  p_status text,
  p_provider_message_id text default null,
  p_error text default null,
  p_body text default null
) returns void
language plpgsql
security definer
as $$
declare
  v_order_id uuid;
  v_count int;
  c_denied constant text := 'Nie można zapisać wpisu dziennika dla tego zamówienia.';
begin
  if p_kind not in ('checkout_confirmation','new_order_notification') then
    raise exception 'Nieobsługiwany rodzaj wiadomości checkoutu: %', p_kind
      using errcode = '22023';
  end if;

  -- Jedno zapytanie po parze (tenant, numer, token). Zwykłe `=` jest celowe:
  -- NULL nie może dopasować zamówienia panelowego z checkout_log_token NULL.
  select o.id into v_order_id
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.order_number = p_order_number
    and o.checkout_log_token = p_log_token;

  if v_order_id is null then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  select count(*) into v_count
  from public.email_logs el
  where el.tenant_id = p_tenant_id and el.order_id = v_order_id;

  if v_count >= 10 then
    raise exception 'Przekroczono limit wpisów dziennika dla tego zamówienia.'
      using errcode = '22023';
  end if;

  insert into public.email_logs (
    tenant_id,
    order_id,
    kind,
    recipient,
    subject,
    status,
    provider_message_id,
    error,
    body
  ) values (
    p_tenant_id,
    v_order_id,
    p_kind,
    p_recipient,
    p_subject,
    p_status,
    p_provider_message_id,
    p_error,
    p_body
  );
end;
$$;

alter function app.log_public_checkout_email(
  uuid, text, uuid, text, text, text, text, text, text, text
) set search_path = pg_catalog, public;

revoke all on function app.log_public_checkout_email(
  uuid, text, uuid, text, text, text, text, text, text, text
) from public;

grant execute on function app.log_public_checkout_email(
  uuid, text, uuid, text, text, text, text, text, text, text
) to anon, service_role;

comment on function app.log_public_checkout_email(
  uuid, text, uuid, text, text, text, text, text, text, text
) is
  'Zapis wpisu historii wysyłki z checkoutu storefrontu (ADR-045, ADR-077): jedyna anonowa ścieżka do public.email_logs — anon NIE ma grantu na tabelę. Zapis wymaga log_tokenu wydanego przez app.public_checkout dla TEGO zamówienia. Odmowa „nie ma takiego zamówienia" i „zły token" są NIEROZRÓŻNIALNE. Rodzaj ograniczony do checkout_confirmation|new_order_notification; limit 10 wpisów na zamówienie. p_body jest nullable i przechowuje dokładne OutgoingEmail.html; DEFAULT NULL zachowuje kompatybilność podczas wdrożenia migration-before-code. Odmowy: 22023. SECURITY DEFINER.';
-- PROD BLOCK END: app.log_public_checkout_email
