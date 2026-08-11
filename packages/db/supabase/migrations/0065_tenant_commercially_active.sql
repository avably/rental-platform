-- 0065_tenant_commercially_active.sql
-- ADR-134: JEDNO miejsce decyzji komercyjnej — app.tenant_commercially_active(status).
--
-- STAN PRZED (inwentarz U ŹRÓDŁA — żywa baza po 0064: pg_proc/pg_get_functiondef,
-- pg_policies, pg_views, pg_constraint — nie z pamięci i nie tylko z grepa):
-- bramka literalna `status in ('trialing', 'active')` występuje w DOKŁADNIE
-- 12 funkcjach app.* (wszystkie SECURITY DEFINER, po 1 wystąpieniu):
--   resolve_tenant_by_slug (0017), get_published_site (0047),
--   get_public_availability (0020), resolve_tenant_by_domain (0022),
--   get_public_payment_account (0029), get_public_order_payment (0049),
--   get_public_catalog (0058), get_public_custom_fields (0058),
--   get_legal_document_version, get_published_legal_document,
--   get_published_legal_documents, public_checkout (0063)
-- oraz w ZERO politykach RLS, ZERO widokach i ZERO CHECK-ach poza
-- enumeracją DOMENY statusu na tenants (tenants_status_check,
-- tenants_status_before_lock_check — to nie są bramki komercyjne, zostają).
-- Spike J2 mówił „20 bramek w 13 migracjach" — to liczba wystąpień
-- w PLIKACH, razem z definicjami nadpisanymi kolejnymi wersjami tych
-- samych funkcji; na żywej bazie decyzja żyje w 12 miejscach
-- + lustro API v1 (apps/storefront/lib/api/auth.ts).
--
-- STAN PO:
--   1. app.tenant_commercially_active(p_status) — IMMUTABLE, czysta funkcja
--      statusu (zero odczytu tabel). Zbiór komercyjnie aktywny =
--      trialing | active | past_due, zgodnie z zasadą 2 okna dunningowego
--      (decyzja właściciela 2026-08-10): past_due to NORMALNA praca dla
--      klientów najemcy — nacisk na najemcę idzie banerem i mailem w panelu,
--      nie gaszeniem jego sklepu. Dziś NIC nie ustawia past_due (billingu
--      jeszcze nie ma), więc zmiana zbioru jest behawioralnie pusta —
--      ta migracja usuwa minę PRZED podłączeniem Stripe Billing (J2).
--   2. Wszystkie 12 funkcji podmienione `create or replace` — jedyną zmianą
--      każdej definicji jest bramka statusu; STARE pliki migracji nietknięte.
--   3. Jedyności decyzji pilnuje introspekcyjna bramka
--      packages/db/test/commercial-active-predicate.test.ts: zero wystąpień
--      literału w pg_get_functiondef / pg_policies (poza samym predykatem) —
--      przyszła migracja z nową bramką literalną pali build, nie recenzenta.

-- === BEGIN PROD MIGRATION 0065 ===

-- ---------------------------------------------------------------------
-- 1. Predykat komercyjny — jedno miejsce prawdy
-- ---------------------------------------------------------------------

create or replace function app.tenant_commercially_active(p_status text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_status in ('trialing', 'active', 'past_due');
$$;

comment on function app.tenant_commercially_active(text) is
  'ADR-134: jedyne miejsce decyzji, czy publiczna powierzchnia najemcy '
  '(storefront, checkout, embed, API v1) przyjmuje ruch. Zbiór komercyjnie '
  'aktywny: trialing | active | past_due (okno dunningowe — zasada 2). '
  'Lustro TS: API_ACTIVE_TENANT_STATUSES w apps/storefront/lib/api/auth.ts.';

-- ---------------------------------------------------------------------
-- 2. Podmiana bramek w 12 funkcjach (pełne, najświeższe definicje;
--    jedyna zmiana każdej = wywołanie predykatu zamiast literału)
-- ---------------------------------------------------------------------

-- resolve_tenant_by_slug (ostatnia definicja: 0017_tenant_resolution.sql) — jedyna zmiana względem 0017:
-- bramka literalna → app.tenant_commercially_active(...).
create or replace function app.resolve_tenant_by_slug(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select t.id
  from public.tenants t
  where t.slug = p_slug
    and app.tenant_commercially_active(t.status)
  limit 1;
$$;

-- get_public_availability (ostatnia definicja: 0020_public_checkout.sql) — jedyna zmiana względem 0020:
-- bramka literalna → app.tenant_commercially_active(...).
create or replace function app.get_public_availability(
  p_tenant_id uuid,
  p_product_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select case
    when p.id is null or p_start_date is null or p_end_date is null or p_end_date < p_start_date
      then null
    else jsonb_build_object(
      'total_units', (
        select count(*) from public.product_units u
        where u.tenant_id = p.tenant_id and u.product_id = p.id
      ),
      'available_units', (
        select count(*) from public.product_units u
        where u.tenant_id = p.tenant_id and u.product_id = p.id
          -- poza oknem serwisowym (surowy termin, lustro isUnitInService)
          and not (
            (u.unavailable_from is not null or u.unavailable_to is not null)
            and (u.unavailable_from is null or p_end_date >= u.unavailable_from)
            and (u.unavailable_to is null or p_start_date <= u.unavailable_to)
          )
          -- bez kolizji z najmem blokującym (termin rozszerzony o bufory)
          and not exists (
            select 1
            from public.order_items oi
            join public.orders o on o.tenant_id = oi.tenant_id and o.id = oi.order_id
            where oi.tenant_id = p.tenant_id
              and oi.unit_id = u.id
              and o.order_status in ('pending', 'reserved', 'ready_for_pickup', 'picked_up')
              and o.start_date <= p_end_date + p.buffer_after_days
              and o.end_date >= p_start_date - p.buffer_before_days
          )
      )
    )
  end
  from (
    select pr.id, pr.tenant_id, pr.buffer_before_days, pr.buffer_after_days
    from public.products pr
    join public.tenants t on t.id = pr.tenant_id
    where pr.tenant_id = p_tenant_id
      and pr.id = p_product_id
      and pr.active
      and app.tenant_commercially_active(t.status)
    union all
    select null::uuid, null::uuid, null::int, null::int
    limit 1
  ) p;
$$;

-- resolve_tenant_by_domain (ostatnia definicja: 0022_store_domains.sql) — jedyna zmiana względem 0022:
-- bramka literalna → app.tenant_commercially_active(...).
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
    and app.tenant_commercially_active(t.status)
  limit 1;
$$;

-- get_public_payment_account (ostatnia definicja: 0029_order_payment_intent.sql) — jedyna zmiana względem 0029:
-- bramka literalna → app.tenant_commercially_active(...).
create or replace function app.get_public_payment_account(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select pa.provider_account_id
  from public.payment_accounts pa
  join public.tenants t on t.id = pa.tenant_id
  where pa.tenant_id = p_tenant_id
    and pa.provider = 'stripe'
    and app.tenant_commercially_active(t.status);
$$;

-- get_published_site (ostatnia definicja: 0047_site_footer_section.sql) — jedyna zmiana względem 0047:
-- bramka literalna → app.tenant_commercially_active(...).
create or replace function app.get_published_site(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'template', s.template_published,
    'published_at', s.published_at,
    'sections', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', sec.id,
            'type', sec.type,
            'position', sec.position_published,
            'content', sec.content_published
          )
          -- Sekcje przypięte (dziś: stopka) schodzą na koniec NIEZALEŻNIE od
          -- zapisanej pozycji. `false < true` w Postgresie, więc wyrażenie
          -- boolowskie sortuje zwykłe sekcje przed przypiętymi bez CASE.
          order by (sec.type = 'footer'), sec.position_published, sec.id
        )
        from public.site_sections sec
        where sec.tenant_id = s.tenant_id
          and sec.site_id = s.id
          and sec.enabled_published
          and sec.content_published is not null
      ),
      '[]'::jsonb
    )
  )
  -- Scalenie zamiast czwartego argumentu jsonb_build_object: pusty styl ma NIE
  -- ZOSTAWIĆ po sobie klucza (nawet z wartością '{}'), bo stary storefront
  -- odrzuca kopertę z nieznanym kluczem niezależnie od jego zawartości.
  || case
       when s.style_published = '{}'::jsonb then '{}'::jsonb
       else jsonb_build_object('style', s.style_published)
     end
  from public.sites s
  join public.tenants t on t.id = s.tenant_id
  where s.tenant_id = p_tenant_id
    and s.published_at is not null
    and app.tenant_commercially_active(t.status);
$$;

-- get_public_order_payment (ostatnia definicja: 0049_orders_currency.sql) — jedyna zmiana względem 0049:
-- bramka literalna → app.tenant_commercially_active(...).
create or replace function app.get_public_order_payment(
  p_tenant_id uuid,
  p_order_id uuid,
  p_checkout_token uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_order record;
begin
  -- [0049] currency prosto z wiersza — waluta, w której zamówienie POWSTAŁO.
  select o.order_number, o.order_status, o.payment_status, o.payment_method,
         o.payment_provider, o.provider_payment_intent_id,
         o.total_rental_grosze, o.total_deposit_grosze, o.delivery_grosze,
         o.currency
    into v_order
  from public.orders o
  join public.tenants t on t.id = o.tenant_id
  where o.tenant_id = p_tenant_id
    and o.id = p_order_id
    and o.checkout_log_token is not null
    and o.checkout_log_token = p_checkout_token
    -- Sklep nieaktywny nieodróżnialny od nieistniejącego (spójnie z 0017/0019/0020).
    and app.tenant_commercially_active(t.status);

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'order_number', v_order.order_number,
    'order_status', v_order.order_status,
    'payment_status', v_order.payment_status,
    'payment_method', v_order.payment_method,
    'payment_provider', v_order.payment_provider,
    'provider_payment_intent_id', v_order.provider_payment_intent_id,
    -- SUMA POLICZONA PRZEZ SERWER, w groszach — to jest liczba, z którą
    -- wolno porównywać `amount_received` z odczytu u dostawcy. Kwota
    -- z przeglądarki nie występuje w tym obiegu ani razu.
    'amount_grosze',
      v_order.total_rental_grosze + v_order.total_deposit_grosze + v_order.delivery_grosze,
    'currency', v_order.currency
  );
end;
$$;

-- get_public_catalog (ostatnia definicja: 0058_custom_fields_checkout.sql) — jedyna zmiana względem 0058:
-- bramka literalna → app.tenant_commercially_active(...).
create or replace function app.get_public_catalog(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  with t as (
    select ten.id, ten.name, ten.locale
    from public.tenants ten
    where ten.id = p_tenant_id
      and app.tenant_commercially_active(ten.status)
  ),
  cur as (
    select coalesce(
      (select s.value #>> '{}'
       from public.tenant_settings s
       where s.tenant_id = p_tenant_id and s.key = 'currency'
         and jsonb_typeof(s.value) = 'string'
         and (s.value #>> '{}') in ('PLN', 'EUR', 'USD')),
      'PLN'
    ) as currency
  ),
  pricing as (
    select s.value as v
    from public.tenant_settings s
    where s.tenant_id = p_tenant_id and s.key = 'delivery_pricing'
      and jsonb_typeof(s.value) = 'object'
  )
  select case when t.id is null then null else jsonb_build_object(
    'tenant', jsonb_build_object('name', t.name, 'locale', t.locale, 'currency', cur.currency),
    -- [0058] Definicje pól własnych zamawiania — JEDNO źródło prawdy o tym,
    -- co jest publiczne (app.get_public_custom_fields), zamiast drugiej
    -- kopii listy kolumn, która rozjechałaby się przy pierwszej poprawce.
    'custom_fields', app.get_public_custom_fields(t.id),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'description', p.description,
          'base_price_day_grosze', p.base_price_day_grosze,
          'deposit_grosze', p.deposit_grosze,
          'auto_increment_multiplier', p.auto_increment_multiplier,
          'buffer_before_days', p.buffer_before_days,
          'buffer_after_days', p.buffer_after_days,
          -- [0058] Wartości pól własnych PRODUKTU — wyłącznie pod definicjami
          -- oznaczonymi „zamawianie". Pole opisujące sprzęt na użytek lady
          -- (koszt zakupu, numer w ewidencji) nie ma tędy drogi na zewnątrz.
          'custom_fields', coalesce((
            select jsonb_object_agg(d.id::text, p.custom_fields -> d.id::text)
            from public.custom_field_definitions d
            where d.tenant_id = p.tenant_id
              and d.entity = 'product'
              and d.archived_at is null
              and d.show_in_checkout
              and p.custom_fields ? d.id::text
          ), '{}'::jsonb),
          'pricing_tiers', coalesce((
            select jsonb_agg(
              jsonb_build_object('tier_days', pt.tier_days, 'multiplier', pt.multiplier, 'label', pt.label)
              order by pt.tier_days
            )
            from public.pricing_tiers pt
            where pt.tenant_id = p.tenant_id and pt.product_id = p.id
          ), '[]'::jsonb),
          'images', coalesce((
            select jsonb_agg(
              jsonb_build_object('storage_path', pi.storage_path, 'alt_text', pi.alt_text, 'sort_order', pi.sort_order)
              order by pi.sort_order, pi.created_at
            )
            from public.product_images pi
            where pi.tenant_id = p.tenant_id and pi.product_id = p.id
          ), '[]'::jsonb)
        )
        order by p.name, p.id
      )
      from public.products p
      where p.tenant_id = t.id and p.active
    ), '[]'::jsonb),
    'pickup_locations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pl.id, 'name', pl.name,
          'address_street', pl.address_street,
          'address_zip', pl.address_zip,
          'address_city', pl.address_city
        )
        order by pl.name, pl.id
      )
      from public.pickup_locations pl
      where pl.tenant_id = t.id and pl.active
    ), '[]'::jsonb),
    'delivery_methods', (
      jsonb_build_array(jsonb_build_object('method', 'pickup', 'price_grosze', 0))
      || coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'method', m.method,
            'price_grosze', (pricing.v -> m.method ->> 'price_grosze')::int,
            'free_above_grosze', (pricing.v -> m.method ->> 'free_above_grosze')::int
          )
          order by m.method
        )
        from pricing, unnest(array['courier', 'parcel_locker', 'own_delivery']) as m(method)
        where pricing.v ? m.method
          and jsonb_typeof(pricing.v -> m.method) = 'object'
      ), '[]'::jsonb)
    )
  ) end
  from cur left join t on true;
$$;

-- get_public_custom_fields (ostatnia definicja: 0058_custom_fields_checkout.sql) — jedyna zmiana względem 0058:
-- bramka literalna → app.tenant_commercially_active(...).
create or replace function app.get_public_custom_fields(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'entity', d.entity,
        'field_type', d.field_type,
        'label', d.label,
        'help_text', d.help_text,
        'required', d.required,
        'options', d.options
      )
      order by d.position, d.created_at, d.id
    )
    from public.custom_field_definitions d
    join public.tenants t on t.id = d.tenant_id
    where d.tenant_id = p_tenant_id
      and app.tenant_commercially_active(t.status)
      and d.archived_at is null
      and d.show_in_checkout
  ), '[]'::jsonb);
$$;

-- get_legal_document_version (ostatnia definicja: 0063_legal_documents.sql) — jedyna zmiana względem 0063:
-- bramka literalna → app.tenant_commercially_active(...).
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
    and app.tenant_commercially_active(t.status);
$$;

-- get_published_legal_document (ostatnia definicja: 0063_legal_documents.sql) — jedyna zmiana względem 0063:
-- bramka literalna → app.tenant_commercially_active(...).
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
    and app.tenant_commercially_active(t.status);
$$;

-- get_published_legal_documents (ostatnia definicja: 0063_legal_documents.sql) — jedyna zmiana względem 0063:
-- bramka literalna → app.tenant_commercially_active(...).
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
    and app.tenant_commercially_active(t.status);
$$;

-- public_checkout (ostatnia definicja: 0063_legal_documents.sql) — jedyna zmiana względem 0063:
-- bramka literalna → app.tenant_commercially_active(...).
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
  where id = p_tenant_id and app.tenant_commercially_active(status);
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
      --
      -- DETAIL niesie znacznik MASZYNOWY, a nie ozdobę: warstwa sklepu mapuje
      -- dziś 22023 na jedno „nie przyjęliśmy zamówienia" (świadomie — patrz
      -- lib/checkout/core.ts), a jego rada „sprawdź dane i spróbuj ponownie"
      -- jest tu akurat lekarstwem, bo odświeżona strona pobiera już nową
      -- etykietę. Znacznik stoi po to, żeby osobny status dało się kiedyś
      -- dołożyć BEZ ruszania migracji i bez dopasowywania komunikatu regexem.
      raise exception 'Regulamin zmienił się w trakcie składania zamówienia — zapoznaj się z nim i zaakceptuj ponownie.'
        using errcode = '22023', detail = 'terms_outdated';
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


-- ---------------------------------------------------------------------
-- 3. ACL (konwencja revoke-from-public — ADR-132, docs/konwencje-migracji.md)
-- ---------------------------------------------------------------------

-- Predykat: zdjęcie domyślnego EXECUTE dla PUBLIC (create function nadaje
-- go zawsze).
revoke all on function app.tenant_commercially_active(text) from public;

-- Granty MINIMALNE, zweryfikowane u źródła: żadna polityka RLS dziś
-- predykatu NIE woła (inwentarz w nagłówku — literał żył wyłącznie
-- w 12 funkcjach SECURITY DEFINER; ich wewnętrzne wywołanie predykatu
-- wykonuje się uprawnieniami właściciela funkcji, więc nie wymaga
-- EXECUTE dla ról API). anon i authenticated celowo BEZ grantu —
-- dostaną go dopiero polityki/ścieżki, które predykatu użyją, własną
-- migracją z uzasadnieniem (konwencja). Dzięki temu predykat nie wchodzi
-- na allowlistę anon w function-acls.test.ts.
--
-- service_role dostaje EXECUTE: to rola przyszłych ścieżek billingu
-- (webhook J2 klasyfikuje status tą samą funkcją, nie własną kopią listy)
-- oraz testu parytetu lustra TS (apps/storefront/test/ woła predykat
-- przez PostgREST service-rolem i porównuje z API_ACTIVE_TENANT_STATUSES —
-- rozjazd SQL↔TS pali build).
grant execute on function app.tenant_commercially_active(text) to service_role;

-- Podmieniane funkcje: `create or replace` ZACHOWUJE istniejące proacl
-- (Postgres nie resetuje ACL przy replace), ale konwencja wymaga jawności
-- w tym samym pliku. Stan docelowy = stan po 0064, bez zmian: bez PUBLIC,
-- EXECUTE dla anon (publiczne RPC storefrontu — każda z tych funkcji jest
-- na allowliście anon w function-acls.test.ts z własnym uzasadnieniem
-- z migracji źródłowej) i dla authenticated (te same RPC wołane z panelu
-- np. w podglądzie sklepu; granty źródłowe: 0017/0019-0022/0028-0029/
-- 0040-0049/0058-0059/0063).
revoke all on function app.resolve_tenant_by_slug(text) from public;
grant execute on function app.resolve_tenant_by_slug(text) to anon, authenticated;

revoke all on function app.get_public_availability(uuid, uuid, date, date) from public;
grant execute on function app.get_public_availability(uuid, uuid, date, date) to anon, authenticated;

revoke all on function app.resolve_tenant_by_domain(text) from public;
grant execute on function app.resolve_tenant_by_domain(text) to anon, authenticated;

revoke all on function app.get_public_payment_account(uuid) from public;
grant execute on function app.get_public_payment_account(uuid) to anon, authenticated;

revoke all on function app.get_published_site(uuid) from public;
grant execute on function app.get_published_site(uuid) to anon, authenticated;

revoke all on function app.get_public_order_payment(uuid, uuid, uuid) from public;
grant execute on function app.get_public_order_payment(uuid, uuid, uuid) to anon, authenticated;

revoke all on function app.get_public_catalog(uuid) from public;
grant execute on function app.get_public_catalog(uuid) to anon, authenticated;

revoke all on function app.get_public_custom_fields(uuid) from public;
grant execute on function app.get_public_custom_fields(uuid) to anon, authenticated;

revoke all on function app.get_legal_document_version(uuid, text, integer) from public;
grant execute on function app.get_legal_document_version(uuid, text, integer) to anon, authenticated;

revoke all on function app.get_published_legal_document(uuid, text) from public;
grant execute on function app.get_published_legal_document(uuid, text) to anon, authenticated;

revoke all on function app.get_published_legal_documents(uuid) from public;
grant execute on function app.get_published_legal_documents(uuid) to anon, authenticated;

revoke all on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb, bigint, text, text) from public;
grant execute on function app.public_checkout(uuid, text, text, text, date, date, text, uuid, jsonb, text, text, text, text, text, text, text, text, text, jsonb, jsonb, bigint, text, text) to anon, authenticated;

-- === END PROD MIGRATION 0065 ===
