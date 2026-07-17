-- 0013_courier_shipments.sql
-- Dostawy (Faza 1, Zadanie 7): koszt dostawy zamówienia, konfiguracja
-- kurierska tenanta i rejestr przesyłek kurierskich. Decyzje: ADR-030
-- (koszt dostawy: kolumna orders.delivery_grosze + cennik w tenant_settings),
-- ADR-031 (cykl życia przesyłki: status wewnętrzny + provider_status verbatim,
-- sync na żądanie, etykiety on-demand, credentiale w tenant_settings).
--
-- Zawartość:
--   1. orders.delivery_grosze — denormalizowany koszt dostawy,
--   2. walidacja czterech nowych kluczy tenant_settings (CHECK-i wartości
--      wzorcem tenant_settings_order_number_prefix_valid z 0007)
--      + app.delivery_pricing_valid(),
--   3. tabela courier_shipments,
--   4. RLS + revoke przed grantami + polityki (wzorzec 0007).
--
-- KONWENCJE UTRZYMANE (patrz docs/konwencje-migracji.md i nagłówki 0007/0011):
--   * zbiory wartości to text + CHECK, nie enumy — rozszerzenie = zwykła
--     migracja bez ALTER TYPE,
--   * revoke all PRZED grantami na każdej nowej tabeli (0006/0008),
--   * FK ZŁOŻONY (tenant_id, order_id) → orders — wiersz międzytenantowy jest
--     niereprezentowalny niezależnie od polityk RLS (0007, order_items),
--   * indeksy zaczynają się od tenant_id,
--   * wyłącznie standardowe SQLSTATE (23514/23503) — kody P0xxx PostgREST
--     zjada do gołego 500 bez treści (nagłówek 0011).
--
-- NUMERACJA: 0012 jest zarezerwowane dla równoległego Zadania 6 — luka w
-- numeracji jest świadoma i legalna (kolejność stosowania jest leksykalna).

-- ---------------------------------------------------------------------
-- 1. orders.delivery_grosze (ADR-030)
-- ---------------------------------------------------------------------
--
-- Denormalizacja jak total_rental_grosze (0007): koszt dostawy, na który
-- umówiono się z klientem, ma przetrwać późniejszą zmianę cennika tenanta.
-- Źródłem wartości jest silnik (calculateDeliveryCost w @avably/core):
-- koszt stały metody + próg darmowej dostawy z tenant_settings; brak cennika
-- dla metody płatnej to błąd konfiguracji w silniku, nigdy ciche 0 — default
-- kolumny 0 obsługuje wyłącznie odbiór osobisty i zamówienia sprzed 0013.
alter table public.orders
  add column delivery_grosze int not null default 0 check (delivery_grosze >= 0);

comment on column public.orders.delivery_grosze is
  'Koszt dostawy w groszach (ADR-030) — denormalizacja utrwalająca uzgodniony koszt wobec późniejszych zmian cennika (tenant_settings.delivery_pricing). Waluta: plans.currency (0005).';

-- ---------------------------------------------------------------------
-- 2. Walidacja nowych kluczy tenant_settings
-- ---------------------------------------------------------------------
--
-- Wzorzec 0007 (order_number_prefix): walidacja U ŹRÓDŁA, przy zapisie
-- ustawienia, standardowym 23514 — a nie dopiero przy nadaniu przesyłki,
-- błędem, którego PostgREST nie umie pokazać. CHECK-i pilnują KSZTAŁTU
-- (obiekt, wymagane pola, typy); pełną semantykę (np. poprawność adresu)
-- weryfikuje dostawca przy nadaniu.
--
-- Klucze (kontrakt z @avably/core, tenant-config.ts — tam mapowanie na
-- typy silnika i CZYTELNE komunikaty o brakach, zanim żądanie wyjdzie
-- do dostawcy):
--   * globkurier_credentials: {email, password, environment: test|production}
--   * courier_sender: nadawca przesyłek tenanta (snake_case pól),
--   * courier_parcel: domyślne gabaryty paczki,
--   * delivery_pricing: cennik metod płatnych (price_grosze,
--     opcjonalnie free_above_grosze; pickup zawsze 0 i nie występuje).

-- CHECK nie może zawierać podzapytania, a walidacja cennika iteruje po
-- wpisach jsonb — stąd funkcja pomocnicza. IMMUTABLE jest uprawnione:
-- funkcja czyta wyłącznie argument (jsonb_each nad wartością), zero
-- dostępu do tabel. search_path przypięty (wzorzec 0002).
create or replace function app.delivery_pricing_valid(value jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(value) = 'object'
    and not exists (
      select 1 from jsonb_each(value) as e(method, entry)
      where e.method not in ('courier','parcel_locker','own_delivery')
         or jsonb_typeof(e.entry) <> 'object'
         -- `is distinct from`, nie `<>`: przy BRAKU klucza jsonb_typeof
         -- zwraca SQL NULL, a `NULL <> 'number'` to NULL — wiersz nie
         -- zostałby oznaczony jako naruszenie i wpis bez ceny przeszedłby
         -- bramkę (trójwartościowa logika SQL; ta sama pułapka co strażnik
         -- `reason_code is not null` w 0011, złapana testem).
         or jsonb_typeof(e.entry->'price_grosze') is distinct from 'number'
         or (e.entry->>'price_grosze')::numeric < 0
         -- Grosze są całkowite: 25.5 grosza to pomyłka jednostki (złote
         -- zamiast groszy), odrzucana u źródła, nie zaokrąglana po cichu.
         or floor((e.entry->>'price_grosze')::numeric) <> (e.entry->>'price_grosze')::numeric
         or (e.entry ? 'free_above_grosze' and (
              jsonb_typeof(e.entry->'free_above_grosze') <> 'number'
              or (e.entry->>'free_above_grosze')::numeric < 0
              or floor((e.entry->>'free_above_grosze')::numeric) <> (e.entry->>'free_above_grosze')::numeric))
    )
$$;

alter function app.delivery_pricing_valid(jsonb) set search_path = pg_catalog;

comment on function app.delivery_pricing_valid(jsonb) is
  'Kształt tenant_settings.delivery_pricing: obiekt {courier|parcel_locker|own_delivery → {price_grosze int>=0, free_above_grosze? int>=0}}. Używana w CHECK-u tenant_settings_delivery_pricing_valid.';

-- KAŻDA koniunkcja walidacyjna owinięta w coalesce(..., false): przy BRAKU
-- klucza w obiekcie `value->'pole'` to SQL NULL, jsonb_typeof(NULL) to NULL,
-- NULL propaguje się przez koniunkcję — a CHECK z wynikiem NULL PRZECHODZI
-- (trójwartościowa logika SQL, pułapka opisana w 0011). Bez coalesce
-- credentiale BEZ hasła przechodziłyby bramkę, mimo że hasło z błędnym
-- typem już nie — złapane testem courier-shipments.
alter table public.tenant_settings
  add constraint tenant_settings_globkurier_credentials_valid check (
    key <> 'globkurier_credentials' or coalesce((
      jsonb_typeof(value) = 'object'
      and jsonb_typeof(value->'email') = 'string'
      and length(value->>'email') between 3 and 320
      and jsonb_typeof(value->'password') = 'string'
      and length(value->>'password') > 0
      and (value->>'environment') in ('test','production')
    ), false)
  );

alter table public.tenant_settings
  add constraint tenant_settings_courier_sender_valid check (
    key <> 'courier_sender' or coalesce((
      jsonb_typeof(value) = 'object'
      and jsonb_typeof(value->'name') = 'string' and length(btrim(value->>'name')) > 0
      and jsonb_typeof(value->'street') = 'string' and length(btrim(value->>'street')) > 0
      and jsonb_typeof(value->'house_number') = 'string' and length(btrim(value->>'house_number')) > 0
      and jsonb_typeof(value->'post_code') = 'string' and length(btrim(value->>'post_code')) > 0
      and jsonb_typeof(value->'city') = 'string' and length(btrim(value->>'city')) > 0
      and jsonb_typeof(value->'phone') = 'string' and length(btrim(value->>'phone')) > 0
      and jsonb_typeof(value->'email') = 'string' and length(value->>'email') between 3 and 320
    ), false)
  );

alter table public.tenant_settings
  add constraint tenant_settings_courier_parcel_valid check (
    key <> 'courier_parcel' or coalesce((
      jsonb_typeof(value) = 'object'
      and jsonb_typeof(value->'length_cm') = 'number' and (value->>'length_cm')::numeric > 0
      and jsonb_typeof(value->'width_cm') = 'number' and (value->>'width_cm')::numeric > 0
      and jsonb_typeof(value->'height_cm') = 'number' and (value->>'height_cm')::numeric > 0
      and jsonb_typeof(value->'weight_kg') = 'number' and (value->>'weight_kg')::numeric > 0
    ), false)
  );

alter table public.tenant_settings
  add constraint tenant_settings_delivery_pricing_valid check (
    key <> 'delivery_pricing' or app.delivery_pricing_valid(value)
  );

comment on column public.tenant_settings.key is
  'Identyfikator ustawienia (snake_case). Znane klucze: order_number_prefix (0007), globkurier_credentials, courier_sender, courier_parcel, delivery_pricing (0013 — kształty pilnowane CHECK-ami).';

-- ---------------------------------------------------------------------
-- 3. courier_shipments
-- ---------------------------------------------------------------------
--
-- Rejestr przesyłek kurierskich zamówienia. Wiersz powstaje PO udanym
-- nadaniu u dostawcy (provider_order_number not null) — tabela odzwierciedla
-- zamówienia istniejące w systemie dostawcy, nie robocze próby.
--
-- Zwrot to osobny wiersz shipment_type='return' (przesyłka lustrzana:
-- kurier odbiera od klienta i wiezie do nadawcy tenanta — ADR-031).
--
-- Dwa pola statusu (ADR-031):
--   * status — WEWNĘTRZNY cykl życia, text + CHECK (konwencja 0001);
--     wartości mapuje silnik (@avably/core, mapProviderStatus),
--   * provider_status — status dostawcy VERBATIM, BEZ CHECK-a: to dana
--     zewnętrzna; CHECK na cudzych wartościach zamieniałby dryf API
--     dostawcy w twardą awarię zapisu synchronizacji. Nieznany status
--     dostawcy zostawia wewnętrzny bez zmian, surowy zapisuje się tutaj.
create table public.courier_shipments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,

  shipment_type text not null check (shipment_type in ('outbound','return')),

  status text not null default 'created'
    check (status in ('created','in_progress','in_transit','delivered','cancelled','returned_to_sender')),

  -- Jedyny dostawca fazy 1; kolumna od pierwszego dnia, żeby drugi dostawca
  -- był rozszerzeniem CHECK-a, a nie przebudową tabeli.
  provider text not null default 'globkurier' check (provider in ('globkurier')),

  provider_order_number text not null
    check (length(btrim(provider_order_number)) between 1 and 100),

  -- Hash do pobrania etykiety. Etykiety NIE przechowujemy (ADR-031):
  -- PDF pobierany on-demand z API po hashu; hash nie wychodzi do klienta
  -- przeglądarkowego (panel czyta go wyłącznie server-side).
  provider_order_hash text,
  provider_status text,

  tracking_number text,
  tracking_url text,

  -- Koszt nadania wg dostawcy (NULL = dostawca nie zwrócił wyceny).
  price_grosze int check (price_grosze is null or price_grosze >= 0),

  -- Gabaryty faktycznie nadanej paczki — migawka, nie odesłanie do
  -- courier_parcel: domyślne gabaryty tenanta zmieniają się w czasie,
  -- a spór z przewoźnikiem dotyczy tej konkretnej paczki.
  length_cm numeric not null check (length_cm > 0),
  width_cm numeric not null check (width_cm > 0),
  height_cm numeric not null check (height_cm > 0),
  weight_kg numeric not null check (weight_kg > 0),

  content text,

  -- Bez FK: wiersz rejestru musi przetrwać usunięcie konta pracownika
  -- (wzorzec deposit_events.created_by z 0007).
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint courier_shipments_tenant_id_key unique (tenant_id, id),

  -- FK ZŁOŻONY — bramka spójności tenanta, której RLS nie zapewnia
  -- (uzasadnienie: 0007, order_items_order_fk). Kaskada z zamówienia:
  -- usunięcie zamówienia (ścieżka naprawy pomyłki ownera) zabiera też
  -- jego przesyłki.
  constraint courier_shipments_order_fk
    foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete cascade
);

-- Zapytanie panelu: „przesyłki tego zamówienia, chronologicznie".
create index courier_shipments_tenant_order_idx
  on public.courier_shipments (tenant_id, order_id, created_at);

comment on table public.courier_shipments is
  'Przesyłka kurierska zamówienia (outbound = do klienta, return = lustrzany zwrot do nadawcy tenanta). Wiersz powstaje po udanym nadaniu u dostawcy. Status wewnętrzny + provider_status verbatim — ADR-031.';
comment on column public.courier_shipments.provider_status is
  'Status dostawcy VERBATIM, bez CHECK-a (dana zewnętrzna — ADR-031). Wewnętrzny cykl życia trzyma kolumna status.';
comment on column public.courier_shipments.provider_order_hash is
  'Hash zamówienia u dostawcy — klucz do pobrania etykiety PDF on-demand. Nie wychodzi poza server-side panelu.';
comment on column public.courier_shipments.price_grosze is
  'Koszt nadania wg dostawcy w groszach (NULL = brak wyceny w odpowiedzi). To koszt tenanta u dostawcy, nie koszt dostawy klienta (ten: orders.delivery_grosze).';

-- ---------------------------------------------------------------------
-- 4. RLS + GRANT-y
-- ---------------------------------------------------------------------

alter table public.courier_shipments enable row level security;

-- REVOKE PRZED GRANT-em (wzorzec 0006/0008): nowa tabela rodzi się z
-- kompletem uprawnień default privileges, w tym TRUNCATE spoza zasięgu RLS.
revoke all on public.courier_shipments from anon, authenticated;

-- anon: NIC (tabela czysto panelowa). UPDATE dla członków — odświeżenie
-- statusu/trackingu z API to praca lady, jak edycja zamówienia (0007).
grant select, insert, update, delete on public.courier_shipments
  to authenticated, service_role;

create policy tenant_select on public.courier_shipments for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.courier_shipments for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.courier_shipments for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
-- Kasowanie tylko owner (wzorzec orders z 0007): wiersz odzwierciedla
-- zamówienie istniejące u dostawcy — anulowanie to zmiana statusu, a
-- usunięcie wiersza wyłącznie ścieżką naprawy pomyłki.
create policy tenant_delete on public.courier_shipments for delete
  using (tenant_id = app.tenant_id() and app.is_tenant_owner());
