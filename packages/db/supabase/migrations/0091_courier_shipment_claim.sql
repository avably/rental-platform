-- 0091_courier_shipment_claim.sql
-- L5 (ADR-223): idempotencja nadania kuriera — „opłać co najwyżej raz".
--
-- PROBLEM: apps/panel/.../delivery-actions.ts createShipmentAction szło prosto
-- do PŁATNEGO GlobKurier.createOrderBestPrice bez żadnej bramki wyścigu —
-- podwójny submit / dwa równoległe żądania tworzyły DWIE OPŁACONE paczki. Tabela
-- courier_shipments z 0013 nie miała unikatu na zamówienie, a wiersz powstawał
-- dopiero PO zapłacie, więc NIC nie serializowało decyzji o zapłacie.
--
-- ROZWIĄZANIE (claim-first, ADR-223): akcja wstawia wiersz-zaklepanie w stanie
-- 'pending' (jeszcze bez provider_order_number) PRZED płatnym wywołaniem. Unikat
-- CZĘŚCIOWY po (tenant_id, order_id, shipment_type) dla przesyłek NIE-anulowanych
-- sprawia, że druga próba odbija się o 23505, zanim cokolwiek zapłaci. Po udanym
-- nadaniu wiersz jest PROMOWANY (UPDATE: numer + status dostawcy), a przy
-- porażce ZWALNIANY (UPDATE status='cancelled' — DELETE jest owner-only od 0060,
-- a nadanie robi też pracownik lady).
--
-- DLACZEGO shipment_type W KLUCZU (a nie samo order_id): zwrot to osobny wiersz
-- shipment_type='return' (0013) — outbound i return TEGO SAMEGO zamówienia
-- współistnieją jako aktywne. Unikat po samym order_id zabijałby przesyłkę
-- zwrotną, gdy istnieje wysyłkowa. Klucz zawiera więc typ; tenant_id na czele
-- trzyma konwencję „indeksy zaczynają się od tenant_id" (order_id i tak jest
-- globalnie unikalne, więc tenant_id nie zmienia semantyki unikatu).
--
-- Ta migracja rozszerza 0013:
--   1. status: nowa dozwolona wartość 'pending' (przejściowe zaklepanie),
--   2. provider_order_number: DROP NOT NULL (zaklepanie nie ma jeszcze numeru)
--      + CHECK obecności numeru dla KAŻDEGO stanu poza 'pending'/'cancelled'
--      (żywa przesyłka bez numeru jest niereprezentowalna — niezmiennik 0013
--      utrzymany dla wierszy, które przeżywają żądanie),
--   3. unikat CZĘŚCIOWY courier_shipments_one_active_per_order_type.
--
-- KONWENCJE (0013/0027): zbiory wartości to text+CHECK (bez enumów), rozszerzenie
-- to drop constraint if exists + add; wyłącznie standardowe SQLSTATE
-- (23514 check_violation / 23505 unique_violation) — kody P0xxx PostgREST zjada
-- do gołego 500. IDEMPOTENCJA: if exists / if not exists / drop-add — migracja
-- wgrana dwa razy nie pada.
--
-- BEZPIECZEŃSTWO DANYCH PRZED UNIKATEM: preflight sprawdza, czy prod NIE MA już
-- aktywnych duplikatów (≥2 nie-anulowane wiersze na (tenant, zamówienie, typ)).
-- Gdyby były, CREATE UNIQUE INDEX padłby na deployu kryptycznym błędem budowy
-- indeksu — zamiast tego podnosimy JAWNY wyjątek z listą kolizji (obsługa, nie
-- ciche wywalenie). Diagnostyka prod przed wdrożeniem: patrz dziennik budowy /
-- blok „Wdrożenie PROD migracji" w ADR-223.

-- ---------------------------------------------------------------------
-- 0. Preflight: brak aktywnych duplikatów przed unikatem
-- ---------------------------------------------------------------------
do $$
declare
  v_dups text;
begin
  select string_agg(
           format('(tenant=%s, order=%s, type=%s)×%s', tenant_id, order_id, shipment_type, cnt),
           '; '
         )
    into v_dups
  from (
    select tenant_id, order_id, shipment_type, count(*) as cnt
      from public.courier_shipments
     where status <> 'cancelled'
     group by tenant_id, order_id, shipment_type
    having count(*) > 1
  ) d;

  if v_dups is not null then
    raise exception
      using errcode = '23505',
            message = 'courier_shipments: istnieją aktywne duplikaty (tenant, zamówienie, typ) — unikat 0091 nie może wejść',
            detail  = v_dups,
            hint    = 'Rozstrzygnij nadmiarowe przesyłki (ustaw status=cancelled na zbędnych) przed wdrożeniem 0091.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. status: dołóż wartość 'pending'
-- ---------------------------------------------------------------------
alter table public.courier_shipments
  drop constraint if exists courier_shipments_status_check;

alter table public.courier_shipments
  add constraint courier_shipments_status_check
  check (status in (
    'pending','created','in_progress','in_transit','delivered','cancelled','returned_to_sender'
  ));

comment on column public.courier_shipments.status is
  'Wewnętrzny cykl życia przesyłki (ADR-031). ''pending'' (ADR-223) to PRZEJŚCIOWE zaklepanie przed płatnym nadaniem — wiersz bez provider_order_number, ukryty w UI (listy filtrują po numerze); po nadaniu PROMOWANY na status dostawcy, przy porażce ZWALNIANY na ''cancelled''.';

-- ---------------------------------------------------------------------
-- 2. provider_order_number: nullable + CHECK obecności
-- ---------------------------------------------------------------------
alter table public.courier_shipments
  alter column provider_order_number drop not null;

alter table public.courier_shipments
  drop constraint if exists courier_shipments_number_presence;

-- Numer wolno pominąć TYLKO w stanach nietrwałych/zwolnionych: 'pending'
-- (zaklepanie w toku) i 'cancelled' (zwolnione zaklepanie bez zapłaty). Każdy
-- inny status to żywa przesyłka u dostawcy i MUSI mieć numer — niezmiennik 0013
-- „wiersz odzwierciedla zamówienie istniejące u dostawcy" dla wszystkiego, co
-- przeżywa żądanie. Istniejące wiersze miały numer NOT NULL, więc dodanie
-- CHECK-u waliduje się czysto.
alter table public.courier_shipments
  add constraint courier_shipments_number_presence
  check (status in ('pending','cancelled') or provider_order_number is not null);

-- ---------------------------------------------------------------------
-- 3. Unikat CZĘŚCIOWY: co najwyżej JEDNA aktywna przesyłka na (zamówienie, typ)
-- ---------------------------------------------------------------------
-- WHERE status <> 'cancelled': anulowana/zwolniona przesyłka wypada spod unikatu,
-- więc po anulowaniu można nadać nową (kolejny outbound po nieudanym; outbound
-- i return współistnieją, bo różni je shipment_type). To jest bramka, o którą
-- odbija się DRUGIE płatne nadanie — 23505 PRZED zapłatą.
create unique index if not exists courier_shipments_one_active_per_order_type
  on public.courier_shipments (tenant_id, order_id, shipment_type)
  where status <> 'cancelled';

comment on index public.courier_shipments_one_active_per_order_type is
  'ADR-223: co najwyżej jedna NIE-anulowana przesyłka na (tenant_id, order_id, shipment_type). Bramka idempotencji nadania (claim-first) — druga równoległa/ponowna próba dostaje 23505 przed płatnym createOrderBestPrice.';
