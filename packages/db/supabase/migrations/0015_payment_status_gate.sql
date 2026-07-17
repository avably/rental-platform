-- 0015_payment_status_gate.sql
-- Bramka maszyny stanów payment_status (Faza 1, Zadanie 9). Decyzja: ADR-035.
--
-- DLACZEGO W BAZIE (spójnie z ADR-025 dla order_status): członek tenanta ma
-- przez RLS (0007) pełny UPDATE na orders — dowolne żądanie PostgREST może
-- przestawić payment_status. Dotąd oś była MIĘKKA (ADR-027 zostawił ją do
-- Zadania 9): UPDATE mógł cofnąć deposit_refunded na paid (utrata faktu
-- rozliczenia) albo ustawić deposit_refunded bez pokrycia w rejestrze kaucji
-- (stan sprzeczny z deposit_events). Bramka domyka to U ŹRÓDŁA.
--
-- ZERO NOWYCH TABEL: jedna funkcja mapy + create or replace triggera 0010.
-- Bramka obowiązuje KAŻDĄ rolę, także service_role — import nie ma prawa
-- tworzyć stanów sprzecznych z rejestrem ani cofać rozliczenia.
--
-- DWIE ORTOGONALNE REGUŁY:
--   A. Mapa przejść (app.payment_transition_allowed) — lustro
--      PAYMENT_TRANSITIONS z @avably/core (order-status.ts). Chroni granicę
--      rozliczenia: zbiór OTWARTY {unpaid,pending,paid,manual,completed}
--      przechodzi swobodnie w obrębie siebie i w rozliczenie; deposit_refunded
--      wychodzi tylko w refunded/cancelled (zero regresu do otwartych);
--      refunded/cancelled terminalne. INSERT wyłącznie w stanie otwartym.
--   B. Spójność z rejestrem: wejście w deposit_refunded wymaga saldo=0 przy
--      pobraniach>0 (lustro isDepositSettled / ADR-027), czytane PUNKTOWO.
--
-- ŚWIADOMIE BEZ ADVISORY LOCKA (w kontrze do 0011/ADR-026 — i to jest
-- DECYZJA, nie przeoczenie): jedyne, co podnosi saldo z 0, to zdarzenie
-- 'collected', a deposit_events_gate (0011) dla 'collected' locka NIE bierze
-- ("saldo tylko rośnie"). Lock w tej bramce nie zserializowałby więc jedynego
-- realnego interferenta. Zwrot/potrącenie po saldzie 0 i tak odrzuca 0011
-- (przekroczyłoby pobrania). Nietrwałość deposit_refunded po PÓŹNIEJSZYM
-- pobraniu to jawnie POZA-zakresowe zachowanie ADR-027 (bramka mówi o saldzie
-- W CHWILI ustawienia, nie o wiecznej niezmienności). Lock, który nic nie
-- serializuje, maskowałby zamiast chronić — lekcja z ADR-024.
--
-- KODY BŁĘDÓW: 23514 (check_violation) dla obu reguł — ograniczenie na
-- WARTOŚCIACH, ta sama klasa co maszyna order_status (ADR-025). Wyłącznie
-- klasy mapowane przez PostgREST (23xxx -> 409); P0xxx ginęłoby w gołym 500.

-- ---------------------------------------------------------------------
-- 1. Mapa przejść payment_status
-- ---------------------------------------------------------------------
--
-- Lustro PAYMENT_TRANSITIONS z packages/core/src/rental/order-status.ts.
-- Zgodność wszystkich 64 par przypina order-gates.test.ts.
create or replace function app.payment_transition_allowed(p_from text, p_to text)
returns boolean
language sql immutable as $$
  select case p_from
    when 'unpaid'    then p_to in ('pending','paid','manual','completed','deposit_refunded','refunded','cancelled')
    when 'pending'   then p_to in ('unpaid','paid','manual','completed','deposit_refunded','refunded','cancelled')
    when 'paid'      then p_to in ('unpaid','pending','manual','completed','deposit_refunded','refunded','cancelled')
    when 'manual'    then p_to in ('unpaid','pending','paid','completed','deposit_refunded','refunded','cancelled')
    when 'completed' then p_to in ('unpaid','pending','paid','manual','deposit_refunded','refunded','cancelled')
    when 'deposit_refunded' then p_to in ('refunded','cancelled')
    else false  -- refunded, cancelled: terminalne
  end
$$;

alter function app.payment_transition_allowed(text, text) set search_path = pg_catalog;

comment on function app.payment_transition_allowed(text, text) is
  'Mapa dozwolonych przejść payment_status — lustro canPaymentTransition z @avably/core (ADR-035). Zbiór otwarty przechodzi swobodnie + w rozliczenie; deposit_refunded tylko w refunded/cancelled; refunded/cancelled terminalne. Zgodność 64 par przypina order-gates.test.ts.';

-- Wołana z triggera pod rolą sesji, więc potrzebuje EXECUTE (wzorzec
-- app.order_transition_allowed z 0010). Jawny revoke przed grantem: schema
-- app jest wystawiona przez PostgREST.
revoke all on function app.payment_transition_allowed(text, text) from public, anon;
grant execute on function app.payment_transition_allowed(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Rozszerzenie app.orders_write_gate() o oś płatności
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0010 sekcja 4 + dwa bloki płatności) —
-- bo create or replace nadpisuje też atrybuty; okrojona kopia zdjęłaby cicho
-- istniejącą logikę order_status/dat. Zmiany względem 0010 oznaczone [0015].
create or replace function app.orders_write_gate() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  r record;
  v_collected bigint;  -- [0015]
  v_settled bigint;    -- [0015]
begin
  if tg_op = 'INSERT' then
    -- Zamówienie rodzi się wyłącznie jako pending — INSERT z dowolnym innym
    -- statusem omijałby całą maszynę stanów jednym żądaniem.
    if new.order_status <> 'pending' then
      raise exception
        'Zamówienie może powstać wyłącznie w statusie pending (otrzymano %).',
        new.order_status
        using errcode = '23514';
    end if;
    -- [0015] Zamówienie rodzi się w OTWARTYM statusie płatności. Stan
    -- rozliczeniowy (deposit_refunded/refunded/cancelled) przy narodzinach
    -- zakłada historię, której nie ma — a deposit_refunded dodatkowo pokrycie
    -- w rejestrze, którego świeże zamówienie mieć nie może. Default kolumny to
    -- 'unpaid', więc app.create_order przechodzi bez zmian. Blok spójności
    -- rejestru (niżej) żyje w gałęzi UPDATE, więc INSERT musi mieć własny
    -- strażnik — inaczej deposit_refunded przy INSERT prześlizgnąłby się.
    if new.payment_status not in ('unpaid', 'pending', 'paid', 'manual', 'completed') then
      raise exception
        'Zamówienie może powstać wyłącznie w otwartym statusie płatności (otrzymano %).',
        new.payment_status
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.order_status is distinct from old.order_status then
    if not app.order_transition_allowed(old.order_status, new.order_status) then
      raise exception
        'Niedozwolone przejście statusu zamówienia: % → %.',
        old.order_status, new.order_status
        using errcode = '23514';
    end if;

    -- Anulowanie przy pobranych (lub pobieranych) środkach: najpierw zwrot,
    -- potem anulowanie. Stan sprawdzamy PO zapisie (NEW), więc zwrot
    -- i anulowanie w jednym UPDATE są legalne. Lista = lustro
    -- BLOCKING_PAYMENT_STATUSES z @avably/core (zgodność przypięta testem).
    if new.order_status = 'cancelled'
       and new.payment_status in ('pending', 'paid', 'manual', 'completed', 'deposit_refunded')
    then
      raise exception
        'Nie można anulować zamówienia z nierozliczoną płatnością (payment_status=%).',
        new.payment_status
        using errcode = '23001';
    end if;
  end if;

  -- [0015] Bramka osi płatności — reguła A (mapa przejść). Przejście
  -- tożsamościowe nie wchodzi tu w ogóle (is distinct from), tak jak maszyna
  -- order_status wyżej.
  if new.payment_status is distinct from old.payment_status then
    if not app.payment_transition_allowed(old.payment_status, new.payment_status) then
      raise exception
        'Niedozwolone przejście statusu płatności: % → %.',
        old.payment_status, new.payment_status
        using errcode = '23514';
    end if;

    -- [0015] Reguła B — spójność z rejestrem kaucji przy wejściu w
    -- deposit_refunded: saldo 0 przy pobraniach > 0 (lustro isDepositSettled
    -- / ADR-027). Odczyt PUNKTOWY, bez advisory locka — uzasadnienie w
    -- nagłówku migracji (jedyny interferent 'collected' i tak locka nie bierze
    -- w 0011, a nietrwałość po późniejszym pobraniu jest poza-zakresowa wg
    -- ADR-027). Trigger jest SECURITY INVOKER: odczyt przez RLS wołającego
    -- widzi komplet zdarzeń własnego tenanta, a FK złożony (tenant_id,
    -- order_id) nie dopuszcza zdarzeń międzytenantowych — jedyny zbiór, w
    -- którym suma ma sens (jak 0011).
    if new.payment_status = 'deposit_refunded' then
      select
        coalesce(sum(amount_grosze) filter (where kind = 'collected'), 0),
        coalesce(sum(amount_grosze) filter (where kind in ('refunded','deducted')), 0)
        into v_collected, v_settled
      from public.deposit_events
      where tenant_id = new.tenant_id and order_id = new.id;

      if not (v_collected > 0 and v_settled = v_collected) then
        raise exception
          'Nie można oznaczyć kaucji jako rozliczonej: rejestr nie pokrywa (pobrano % gr, rozliczono % gr).',
          v_collected, v_settled
          using errcode = '23514';
      end if;
    end if;
  end if;

  -- Zmiana TERMINU przechodzi przez tę samą bramkę dostępności, co
  -- przypisanie egzemplarza — inaczej PATCH dat byłby dziurą obok bramki.
  -- Pozycje w stałym porządku unit_id: dwie transakcje biorą blokady advisory
  -- w tej samej kolejności (app.create_order wstawia tak samo), więc nie mogą
  -- się zakleszczyć.
  if (new.start_date is distinct from old.start_date
      or new.end_date is distinct from old.end_date)
     and new.order_status in ('pending', 'reserved', 'ready_for_pickup', 'picked_up')
  then
    for r in
      select oi.id, oi.unit_id
      from public.order_items oi
      where oi.tenant_id = new.tenant_id
        and oi.order_id = new.id
        and oi.unit_id is not null
      order by oi.unit_id
    loop
      perform app.assert_unit_available(new.tenant_id, r.unit_id, r.id, new.start_date, new.end_date);
    end loop;
  end if;

  -- 0007 zostawił updated_at bez mechanizmu odświeżania — domykamy tutaj,
  -- w jedynym triggerze BEFORE UPDATE na orders.
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.orders_write_gate() is
  'Bramka zapisu orders (0010 + 0015): INSERT tylko pending i w otwartym payment_status; mapa przejść order_status (ADR-025) i payment_status (ADR-035); anulowanie blokowane przy pobranej płatności (23001); wejście w deposit_refunded wymaga pokrycia w rejestrze kaucji (23514); re-walidacja terminu (23P01); updated_at.';
