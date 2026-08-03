-- 0044_order_delivery_destination.sql
-- Runda przeglądu 3, ekran „Nowe zamówienie" (ADR-089): DOKĄD i JAK jedzie
-- zamówienie przestaje być domysłem operatora, a zaczyna być daną zamówienia.
-- Trzy osie w jednej migracji (wzorzec 0016/0043 — spójna zmiana modelu
-- zamówienia w jednym kroku):
--   1. Punkt odbioru u przewoźnika jako STRUKTURA (dostawca + identyfikator
--      punktu + adres opisowy), a nie luźny string w notatce — pinezka
--      „numer paczkomatu", decyzja właściciela „przygotujmy pod integrację".
--   2. Adres dostarczenia zamówienia: WSKAŹNIK na kartotekę klienta albo
--      MIGAWKA innego adresu — pinezka „wez z danych klienta lub inny adres".
--   3. Źródło ceny dostawy (cennik / ręcznie) — pinezka „ceny z cenników
--      + możliwość edycji ręcznej"; sama kwota siedzi w orders.delivery_grosze
--      od 0013, brakowało odpowiedzi na pytanie „skąd ta liczba".
-- Do tego app.create_order przyjmuje komplet powyższego ORAZ formę płatności
-- (orders.payment_method istnieje od 0029, ale kreator panelu jej nie zapisywał
-- — zamówienia z panelu rodziły się z NULL-em, choć checkout sklepu wypełnia
-- to pole od zawsze).
--
-- STAN PRZED (0043):
--   * orders zna WYŁĄCZNIE `delivery_method` (0007) i `pickup_location_id`
--     (własny punkt odbioru najemcy). Dla `parcel_locker` nie ma gdzie zapisać
--     numeru paczkomatu, a dla `courier`/`own_delivery` nie ma adresu — adres
--     odbiorcy wpisuje się dopiero RĘCZNIE w modalu nadania przesyłki
--     (apps/panel/.../zamowienia/[id]/shipment-modal.tsx) i nigdzie nie jest
--     utrwalany. Przy dostawie własnej nie ma nawet takiego modalu.
--   * `delivery_grosze` (0013) jest zapisywane, ale zawsze jako wynik cennika
--     (ADR-030) — operator nie miał jak ustalić innej ceny, choć dostawa bywa
--     negocjowana per zamówienie.
--   * `payment_method` (0029) jest wypełniane tylko przez app.public_checkout.
--
-- DLACZEGO STRUKTURA, A NIE JEDNO POLE TEKSTOWE (oś 1):
-- Pierwowzór trzyma numer paczkomatu jednym stringiem. Taki zapis jest ślepy
-- na dostawcę (kod „POZ08M" nie mówi, CZYJ to punkt) i nie daje się podać do
-- API przewoźnika bez zgadywania. Rozbicie na dostawcę + identyfikator + adres
-- opisowy sprawia, że dzisiejsze RĘCZNE wpisanie i przyszły PICKER punktów
-- (dług ADR-031) zapisują TO SAMO — integracja dołoży wtedy sposób WYBORU,
-- a nie nowy kształt danych i migrację danych historycznych.
--
-- DLACZEGO WSKAŹNIK ALBO MIGAWKA, A NIE ZAWSZE KOPIA (oś 2):
-- Adres „z danych klienta" NIE jest kopiowany do zamówienia: kopia rozjeżdża
-- się po każdej poprawce kartoteki i rodzi pytanie „który adres jest prawdziwy".
-- `delivery_address_source='customer'` znaczy „patrz w kartotekę" i CHECK
-- pilnuje, żeby pola adresu były wtedy PUSTE. `'custom'` znaczy „ten adres,
-- jednorazowo" i wymaga kompletu ulica+kod+miasto. Trzeciej możliwości nie ma.
--
-- DLACZEGO CHECK-i SĄ SPÓJNOŚCIOWE, A NIE WYMAGAJĄCE:
-- Bramki mówią „jeśli wypełnione, to metoda musi pasować", a NIE „metoda X
-- wymaga wypełnienia". Powód jest konkretny: app.public_checkout (0040/0041)
-- tworzy zamówienia `courier` i `parcel_locker` BEZ tych pól i musi działać
-- dalej bez zmiany. Wymóg kompletu dla nowego zamówienia z panelu egzekwuje
-- schemat Zod kreatora (apps/panel/lib/order-validation.ts) — warstwa, która
-- wie, że mówi do operatora przy ladzie, a nie do anonimowego koszyka.
--
-- Bez nowych tabel, więc bez nowych polityk RLS: orders jest w macierzy
-- izolacji od 0007, a nowe kolumny dziedziczą polityki i klucz złożony tabeli.
-- Wszystkie są NULLABLE bez defaultu poza `delivery_price_source` (NOT NULL
-- DEFAULT 'pricing' — wiersze historyczne POWSTAŁY z cennika, więc default
-- opisuje prawdę o nich, a nie wygodną fikcję).

-- === BEGIN PROD MIGRATION 0044 ===

-- ---------------------------------------------------------------------
-- 1. Punkt odbioru u przewoźnika (paczkomat i — docelowo — punkt kurierski)
-- ---------------------------------------------------------------------
--
-- Nazwa `delivery_point_*`, a NIE `pickup_point_*`: w tym schemacie „pickup"
-- jest już zajęte przez `pickup_locations` / `pickup_location_id`, czyli WŁASNE
-- punkty najemcy przy odbiorze osobistym. To co innego — tu chodzi o punkt
-- OBCEGO przewoźnika, do którego jedzie przesyłka.
alter table public.orders
  add column if not exists delivery_point_provider text,
  add column if not exists delivery_point_code text,
  add column if not exists delivery_point_address text;

-- Lista dostawców rośnie razem z integracjami; dziś jeden, wpisany jawnie,
-- żeby literówka w kodzie aplikacji nie utrwaliła się jako dana.
alter table public.orders
  drop constraint if exists orders_delivery_point_provider_check;
alter table public.orders
  add constraint orders_delivery_point_provider_check
  check (delivery_point_provider is null or delivery_point_provider in ('inpost'));

-- Identyfikator punktu: krótki kod dostawcy (np. „POZ08M"). Górna granica
-- z zapasem — API przewoźników używają kodów do kilkunastu znaków.
alter table public.orders
  drop constraint if exists orders_delivery_point_code_check;
alter table public.orders
  add constraint orders_delivery_point_code_check
  check (
    delivery_point_code is null
    or (length(btrim(delivery_point_code)) between 2 and 32)
  );

alter table public.orders
  drop constraint if exists orders_delivery_point_address_check;
alter table public.orders
  add constraint orders_delivery_point_address_check
  check (
    delivery_point_address is null
    or (length(btrim(delivery_point_address)) between 1 and 300)
  );

-- Punkt jest KOMPLETNY albo go nie ma: sam adres opisowy bez identyfikatora
-- jest nieadresowalny przez API, a sam identyfikator bez dostawcy nie mówi,
-- czyj to punkt. Adres opisowy pozostaje opcjonalny (jest dla człowieka).
alter table public.orders
  drop constraint if exists orders_delivery_point_complete;
alter table public.orders
  add constraint orders_delivery_point_complete
  check (
    (delivery_point_provider is null and delivery_point_code is null
     and delivery_point_address is null)
    or (delivery_point_provider is not null and delivery_point_code is not null)
  );

-- Punkt przewoźnika ma sens WYŁĄCZNIE przy dostawie do punktu. Bramka
-- spójnościowa (patrz nagłówek): nie wymaga punktu przy `parcel_locker`,
-- ale zabrania go przy każdej innej metodzie.
alter table public.orders
  drop constraint if exists orders_delivery_point_method;
alter table public.orders
  add constraint orders_delivery_point_method
  check (delivery_point_provider is null or delivery_method = 'parcel_locker');

comment on column public.orders.delivery_point_provider is
  'Dostawca punktu odbioru przesyłki (ADR-089). NULL = zamówienie nie jedzie do punktu. Dziś wyłącznie ''inpost''; lista rośnie z integracjami.';
comment on column public.orders.delivery_point_code is
  'Identyfikator punktu u dostawcy, np. ''POZ08M'' (ADR-089). Wpisywany dziś ręcznie przez operatora; picker punktów dołoży sposób WYBORU, nie nowy kształt danych (dług ADR-031).';
comment on column public.orders.delivery_point_address is
  'Adres opisowy punktu — dla człowieka (umowa, e-mail, lista kompletacji). Opcjonalny: API przewoźnika adresuje po delivery_point_code.';

-- ---------------------------------------------------------------------
-- 2. Adres dostarczenia zamówienia (kurier / dostawa własna)
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists delivery_address_source text,
  add column if not exists delivery_address_name text,
  add column if not exists delivery_address_street text,
  add column if not exists delivery_address_zip text,
  add column if not exists delivery_address_city text,
  add column if not exists delivery_address_phone text;

alter table public.orders
  drop constraint if exists orders_delivery_address_source_check;
alter table public.orders
  add constraint orders_delivery_address_source_check
  check (delivery_address_source is null or delivery_address_source in ('customer', 'custom'));

-- Adres dostarczenia ma sens przy dostawie POD ADRES. Przy odbiorze osobistym
-- adresem jest punkt najemcy, przy paczkomacie — punkt przewoźnika.
alter table public.orders
  drop constraint if exists orders_delivery_address_method;
alter table public.orders
  add constraint orders_delivery_address_method
  check (
    delivery_address_source is null
    or delivery_method in ('courier', 'own_delivery')
  );

-- Sedno decyzji (patrz nagłówek): wskaźnik albo migawka, nigdy jedno i drugie.
--   'customer' → pola adresu MUSZĄ być puste (źródłem jest kartoteka),
--   'custom'   → ulica, kod i miasto MUSZĄ być wypełnione,
--   NULL       → pola adresu muszą być puste (nie ma adresu do wypełnienia).
-- Bez tej bramki „adres klienta" z częściowo wypełnionymi polami byłby trzecim,
-- niezdefiniowanym stanem — i dokładnie tam rodzi się pytanie „który adres
-- pojechał na etykietę".
alter table public.orders
  drop constraint if exists orders_delivery_address_shape;
alter table public.orders
  add constraint orders_delivery_address_shape
  check (
    case
      when delivery_address_source = 'custom' then
        delivery_address_street is not null
        and delivery_address_zip is not null
        and delivery_address_city is not null
      else
        delivery_address_name is null
        and delivery_address_street is null
        and delivery_address_zip is null
        and delivery_address_city is null
        and delivery_address_phone is null
    end
  );

alter table public.orders
  drop constraint if exists orders_delivery_address_lengths;
alter table public.orders
  add constraint orders_delivery_address_lengths
  check (
    (delivery_address_name is null or length(btrim(delivery_address_name)) between 1 and 200)
    and (delivery_address_street is null or length(btrim(delivery_address_street)) between 1 and 200)
    and (delivery_address_zip is null or length(btrim(delivery_address_zip)) between 1 and 20)
    and (delivery_address_city is null or length(btrim(delivery_address_city)) between 1 and 100)
    and (delivery_address_phone is null or length(btrim(delivery_address_phone)) between 1 and 32)
  );

comment on column public.orders.delivery_address_source is
  'Skąd bierze się adres dostarczenia (ADR-089): ''customer'' = z kartoteki klienta (pola adresu MUSZĄ być puste — wskaźnik, nie kopia), ''custom'' = jednorazowy adres tego zamówienia (migawka, wymagane ulica+kod+miasto). NULL = metoda dostawy nie jedzie pod adres.';
comment on column public.orders.delivery_address_street is
  'Ulica z numerem — wyłącznie dla delivery_address_source=''custom''. Jedno pole, spójnie z customers.address_street (numer domu/lokalu rozbija dopiero formularz nadania przesyłki).';

-- ---------------------------------------------------------------------
-- 3. Źródło ceny dostawy
-- ---------------------------------------------------------------------
--
-- orders.delivery_grosze (0013) niesie KWOTĘ, ale do dziś nie było jak
-- odróżnić kwoty policzonej z cennika tenanta od kwoty ustalonej ręcznie.
-- Bez tego rozróżnienia ekran szczegółu nie ma jak pokazać prawdy: przelicza
-- koszt z BIEŻĄCEGO cennika, więc każda ręczna ustalona cena znikałaby z oczu
-- (a po zmianie cennika — także każda historyczna).
alter table public.orders
  add column if not exists delivery_price_source text not null default 'pricing';

alter table public.orders
  drop constraint if exists orders_delivery_price_source_check;
alter table public.orders
  add constraint orders_delivery_price_source_check
  check (delivery_price_source in ('pricing', 'manual'));

comment on column public.orders.delivery_price_source is
  'Skąd wzięła się orders.delivery_grosze (ADR-089): ''pricing'' = policzone z tenant_settings.delivery_pricing (ADR-030), ''manual'' = ustalone ręcznie przy tworzeniu zamówienia. Default ''pricing'' opisuje wiersze sprzed 0044 zgodnie z prawdą — inaczej powstawały wyłącznie z cennika.';

-- ---------------------------------------------------------------------
-- 4. app.create_order — komplet danych dostarczenia i forma płatności
-- ---------------------------------------------------------------------
--
-- METODA (konwencje-migracji.md + wzorzec 0016): sygnatura się ZMIENIA, więc
-- najpierw DROP starej (10 argumentów), potem CREATE nowej — dwa warianty
-- naraz dawałyby dwuznaczność wołania. Nowe parametry mają DEFAULT-y i stoją
-- NA KOŃCU, więc wołający sprzed 0044 nadal działa (zamówienie bez punktu,
-- bez adresu, z ceną z cennika i bez formy płatności — dokładnie stan 0041).
-- Granty re-wydajemy, bo DROP zabrał je razem z funkcją.
--
-- Ciało odtworzone Z 0041 W CAŁOŚCI, nie okrojone (uzasadnienie okrojenia:
-- nagłówek 0016) — różnice merytoryczne są dokładnie trzy:
--   * INSERT niesie kolumny dostarczenia, źródło ceny i formę płatności,
--   * payment_provider wywodzi się z formy płatności TAK SAMO jak w
--     app.public_checkout (0029/ADR-066): 'online' → 'stripe', reszta →
--     'manual'; jedna reguła dla obu ścieżek zapisu, nie dwie,
--   * płatność online wymaga ISTNIEJĄCEGO payment_accounts tenanta — ta sama
--     bramka co w checkoucie i z tego samego powodu: zamówienie w reżimie
--     ścisłym bez adresata środków nie ma drogi wyjścia z „pending". To NIE
--     jest bramka gotowości konta (ADR-049) — sprawdzamy istnienie adresata.
drop function if exists app.create_order(uuid, date, date, text, uuid, text, int, int, jsonb, int);

create function app.create_order(
  p_customer_id uuid,
  p_start_date date,
  p_end_date date,
  p_delivery_method text,
  p_pickup_location_id uuid,
  p_notes text,
  p_total_rental_grosze int,
  p_total_deposit_grosze int,
  p_items jsonb,
  p_delivery_grosze int default 0,
  p_delivery_price_source text default 'pricing',
  p_payment_method text default null,
  p_delivery_point_provider text default null,
  p_delivery_point_code text default null,
  p_delivery_point_address text default null,
  p_delivery_address_source text default null,
  p_delivery_address_name text default null,
  p_delivery_address_street text default null,
  p_delivery_address_zip text default null,
  p_delivery_address_city text default null,
  p_delivery_address_phone text default null
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_order_id uuid;
  v_payment_method text;
  v_payment_provider text;
  v_price_source text;
  r record;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Zamówienie wymaga co najmniej jednej pozycji.'
      using errcode = '22023';
  end if;

  -- Forma płatności: NULL zostaje NULL-em (zamówienie bez deklaracji, jak do
  -- 0044), pusty string też — „nie wybrano" nie może udawać wyboru.
  v_payment_method := nullif(btrim(coalesce(p_payment_method, '')), '');
  if v_payment_method is not null and v_payment_method not in ('online', 'transfer', 'cod') then
    raise exception 'Nieprawidłowa metoda płatności.' using errcode = '22023';
  end if;
  v_payment_provider := case when v_payment_method = 'online' then 'stripe' else 'manual' end;

  if v_payment_method = 'online' then
    perform 1 from public.payment_accounts where tenant_id = app.tenant_id();
    if not found then
      raise exception 'Płatność online wymaga podłączonego konta rozliczeniowego.'
        using errcode = '22023';
    end if;
  end if;

  v_price_source := coalesce(nullif(btrim(coalesce(p_delivery_price_source, '')), ''), 'pricing');
  if v_price_source not in ('pricing', 'manual') then
    raise exception 'Nieprawidłowe źródło ceny dostawy.' using errcode = '22023';
  end if;

  insert into public.orders (
    tenant_id, customer_id, start_date, end_date, delivery_method,
    pickup_location_id, total_rental_grosze, total_deposit_grosze,
    delivery_grosze, delivery_price_source, payment_method, payment_provider,
    delivery_point_provider, delivery_point_code, delivery_point_address,
    delivery_address_source, delivery_address_name, delivery_address_street,
    delivery_address_zip, delivery_address_city, delivery_address_phone
  ) values (
    app.tenant_id(), p_customer_id, p_start_date, p_end_date, p_delivery_method,
    p_pickup_location_id,
    coalesce(p_total_rental_grosze, 0), coalesce(p_total_deposit_grosze, 0),
    coalesce(p_delivery_grosze, 0), v_price_source, v_payment_method, v_payment_provider,
    nullif(btrim(coalesce(p_delivery_point_provider, '')), ''),
    nullif(btrim(coalesce(p_delivery_point_code, '')), ''),
    nullif(btrim(coalesce(p_delivery_point_address, '')), ''),
    nullif(btrim(coalesce(p_delivery_address_source, '')), ''),
    nullif(btrim(coalesce(p_delivery_address_name, '')), ''),
    nullif(btrim(coalesce(p_delivery_address_street, '')), ''),
    nullif(btrim(coalesce(p_delivery_address_zip, '')), ''),
    nullif(btrim(coalesce(p_delivery_address_city, '')), ''),
    nullif(btrim(coalesce(p_delivery_address_phone, '')), '')
  )
  returning id into v_order_id;

  -- [0041] Notatka kreatora zakłada WPIS w order_notes (ADR-081), nie wpis do
  -- usuniętej kolumny orders.notes. Autor = twórca zamówienia; funkcja jest
  -- SECURITY INVOKER, więc auth.uid() to zalogowany członek.
  if nullif(btrim(coalesce(p_notes, '')), '') is not null then
    insert into public.order_notes (tenant_id, order_id, body, created_by)
    values (app.tenant_id(), v_order_id, btrim(p_notes), auth.uid());
  end if;

  -- Stały porządek wstawiania pozycji (advisory locki bramki 0010): po unit_id,
  -- NULL-e na koniec.
  for r in
    select
      (item->>'product_id')::uuid as product_id,
      nullif(item->>'unit_id', '')::uuid as unit_id,
      coalesce((item->>'rental_grosze')::int, 0) as rental_grosze,
      coalesce((item->>'deposit_grosze')::int, 0) as deposit_grosze
    from jsonb_array_elements(p_items) as item
    order by item->>'unit_id' nulls last
  loop
    insert into public.order_items (
      tenant_id, order_id, product_id, unit_id, rental_grosze, deposit_grosze
    ) values (
      app.tenant_id(), v_order_id, r.product_id, r.unit_id, r.rental_grosze, r.deposit_grosze
    );
  end loop;

  return v_order_id;
end;
$$;

revoke all on function app.create_order(
  uuid, date, date, text, uuid, text, int, int, jsonb, int,
  text, text, text, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function app.create_order(
  uuid, date, date, text, uuid, text, int, int, jsonb, int,
  text, text, text, text, text, text, text, text, text, text, text
) to authenticated;

comment on function app.create_order(
  uuid, date, date, text, uuid, text, int, int, jsonb, int,
  text, text, text, text, text, text, text, text, text, text, text
) is
  'Atomowe utworzenie zamówienia z pozycjami, kosztem dostawy i celem dostarczenia (ADR-024/ADR-030/ADR-089). SECURITY INVOKER: RLS i bramki 0010 obowiązują wewnątrz. [0041] p_notes zakłada wpis w order_notes, nie wpis do usuniętej kolumny orders.notes (ADR-081). [0044] przyjmuje punkt odbioru przewoźnika, adres dostarczenia (wskaźnik ''customer'' albo migawka ''custom''), źródło ceny dostawy oraz formę płatności; payment_provider wywodzi się z formy TAK SAMO jak w app.public_checkout (ADR-066), a ''online'' wymaga istniejącego payment_accounts tenanta (ADR-049 — istnienie adresata, nie gotowość konta). Odmowy: 22023.';

-- === END PROD MIGRATION 0044 ===
