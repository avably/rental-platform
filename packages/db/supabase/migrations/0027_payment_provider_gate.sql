-- 0027_payment_provider_gate.sql
-- Z1 / ADR-064: dwa reżimy JEDNEJ osi payment_status.
--
-- DLACZEGO: ADR-035 zostawił oś płatności miękką w obrębie zbioru otwartego
-- {unpaid,pending,paid,manual,completed} — świadomie, bo w fazie 1 oś prowadził
-- CZŁOWIEK, a swoboda korekty była tańsza niż policowanie kolejności stanów,
-- których baza i tak nie widziała (pieniądze były poza systemem). Faza 3 zmienia
-- writera: statusy pisze automat (webhook Stripe) BEZ gwarancji kolejności ani
-- krotności dostaw. W tym obiegu „swoboda" znaczy: spóźniony
-- `checkout.session.expired` cofa opłacone zamówienie w `pending`, a klient
-- dostaje drugie wezwanie do zapłaty za to samo. Dlatego oś dostaje DRUGI reżim
-- — ścisły — a nie nową kolumnę statusu.
--
-- REŻIM WYBIERA KOLUMNA, NIE ROLA: `orders.payment_provider`. Rola wywołująca
-- (service_role dla webhooka) nie przeżywa refaktoru — pierwszy handler
-- przeniesiony na inną rolę albo pierwsza akcja panelu wołana serwisowo cicho
-- zmieniłaby reżim zamówienia. Kolumna jest własnością ZAMÓWIENIA i jedzie
-- z nim wszędzie. Konwencja text+CHECK, nie enum (nagłówek 0007/0013).
--
-- ZERO REGRESU Z `paid` W REŻIMIE STRIPE — to jest cała pointa. Odmowa siedzi
-- w BAZIE, nie w handlerze: handler to jedno miejsce, a UPDATE na orders przez
-- PostgREST ma KAŻDY członek tenanta (RLS 0007). Bramka w handlerze broniłaby
-- wyłącznie handlera.
--
-- MIGRACJA NIE ZAOSTRZA REŻIMU WSTECZ: default 'manual' — wszystkie zamówienia
-- sprzed 0027 zachowują obieg operatorski ADR-035 co do pary przejść.
--
-- KODY BŁĘDÓW: wyłącznie 23514 (check_violation) — ograniczenie na WARTOŚCIACH,
-- ta sama klasa co maszyna order_status (ADR-025) i mapa 0015. Klasa 23xxx jest
-- mapowana przez PostgREST na 409; P0xxx ginęłoby w gołym 500.
--
-- IDEMPOTENCJA: całość przez add column if not exists / drop constraint if
-- exists / create or replace — migracja wgrana dwa razy nie pada.

-- ---------------------------------------------------------------------
-- 1. Kolumna reżimu
-- ---------------------------------------------------------------------

alter table public.orders
  add column if not exists payment_provider text not null default 'manual';

alter table public.orders
  drop constraint if exists orders_payment_provider_check;

alter table public.orders
  add constraint orders_payment_provider_check
  check (payment_provider in ('manual', 'stripe'));

comment on column public.orders.payment_provider is
  'Kto prowadzi płatność zamówienia i JAKI reżim obowiązuje oś payment_status (ADR-064): manual = swoboda operatorska ADR-035, stripe = ścisła kolejność bez regresu z paid. Default manual — zamówienia sprzed 0027 zachowują obieg operatorski. Lustro PaymentProvider z @avably/core.';

-- ---------------------------------------------------------------------
-- 2. Nowy status: payment_failed
-- ---------------------------------------------------------------------
--
-- Próba płatności online odrzucona albo wygasła. Zamówienie ŻYJE, klient może
-- ponowić. Bez tego statusu nieudany BLIK musiałby wylądować jako `unpaid` —
-- „nikt nie próbował", co jest nieprawdą i gubi informację potrzebną
-- operatorowi. Status jest osiągalny WYŁĄCZNIE w reżimie stripe.
-- Lustro PAYMENT_STATUSES z @avably/core; zgodność przypina introspekcja
-- CHECK-u w order-gates.test.ts.

alter table public.orders
  drop constraint if exists orders_payment_status_check;

alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in (
    'unpaid', 'pending', 'payment_failed', 'paid', 'manual', 'completed',
    'deposit_refunded', 'refunded', 'cancelled'
  ));

-- ---------------------------------------------------------------------
-- 3. Mapa przejść z parametrem reżimu
-- ---------------------------------------------------------------------
--
-- Lustro PAYMENT_TRANSITIONS (manual) i PAYMENT_TRANSITIONS_STRIPE ze
-- packages/core/src/rental/order-status.ts. Zgodność WSZYSTKICH par w OBU
-- reżimach przypina order-gates.test.ts.
--
-- Gałąź 'manual' jest DOSŁOWNĄ kopią mapy z 0015 (zbiór otwarty przechodzi
-- swobodnie w obrębie siebie i w rozliczenie; deposit_refunded tylko w
-- refunded/cancelled; refunded/cancelled terminalne) POSZERZONĄ o jedno:
-- payment_failed jest w niej nieosiągalny w obie strony.

create or replace function app.payment_transition_allowed(
  p_from text, p_to text, p_provider text
)
returns boolean
language sql immutable as $$
  select case p_provider
    when 'stripe' then case p_from
      -- Ścisła kolejność cyklu online. paid wychodzi WYŁĄCZNIE w rozliczenie
      -- — zero regresu (powtórzony/spóźniony webhook nie cofa opłaty).
      when 'unpaid'         then p_to in ('pending','cancelled')
      when 'pending'        then p_to in ('paid','payment_failed','cancelled')
      when 'payment_failed' then p_to in ('pending','cancelled')
      when 'paid'           then p_to in ('deposit_refunded','refunded')
      when 'deposit_refunded' then p_to in ('refunded')
      -- manual/completed to ręczne oznaczenia operatora — poza obiegiem
      -- online; refunded/cancelled terminalne.
      else false
    end
    else case p_from
      when 'unpaid'    then p_to in ('pending','paid','manual','completed','deposit_refunded','refunded','cancelled')
      when 'pending'   then p_to in ('unpaid','paid','manual','completed','deposit_refunded','refunded','cancelled')
      when 'paid'      then p_to in ('unpaid','pending','manual','completed','deposit_refunded','refunded','cancelled')
      when 'manual'    then p_to in ('unpaid','pending','paid','completed','deposit_refunded','refunded','cancelled')
      when 'completed' then p_to in ('unpaid','pending','paid','manual','deposit_refunded','refunded','cancelled')
      when 'deposit_refunded' then p_to in ('refunded','cancelled')
      else false  -- refunded, cancelled: terminalne; payment_failed: nieosiągalny offline
    end
  end
$$;

alter function app.payment_transition_allowed(text, text, text) set search_path = pg_catalog;

comment on function app.payment_transition_allowed(text, text, text) is
  'Mapa dozwolonych przejść payment_status per REŻIM (ADR-064) — lustro canPaymentTransition z @avably/core. stripe: ścisła kolejność cyklu online, zero regresu z paid. manual: swoboda operatorska ADR-035 bez zmian. Zgodność wszystkich par w obu reżimach przypina order-gates.test.ts.';

revoke all on function app.payment_transition_allowed(text, text, text) from public, anon;
grant execute on function app.payment_transition_allowed(text, text, text) to authenticated, service_role;

-- Wariant dwuargumentowy z 0015 ZNIKA. Zostawiony byłby drugą, nieaktualną
-- mapą tej samej osi — pierwsze wywołanie bez reżimu cicho przywracałoby
-- swobodę operatorską zamówieniu Stripe. Drop idzie PO create or replace
-- nowego wariantu i przed podmianą triggera; plpgsql wiąże funkcje późno,
-- więc kolejność nie zrywa istniejącej bramki w tej samej transakcji.
drop function if exists app.payment_transition_allowed(text, text);

-- ---------------------------------------------------------------------
-- 4. Bramka zapisu orders — reżim per zamówienie
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0015 + bloki reżimu) — bo create or
-- replace nadpisuje też atrybuty; okrojona kopia zdjęłaby cicho logikę
-- order_status/dat/rejestru kaucji. Zmiany względem 0015 oznaczone [0027].
create or replace function app.orders_write_gate() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  r record;
  v_collected bigint;
  v_settled bigint;
begin
  if tg_op = 'INSERT' then
    if new.order_status <> 'pending' then
      raise exception
        'Zamówienie może powstać wyłącznie w statusie pending (otrzymano %).',
        new.order_status
        using errcode = '23514';
    end if;
    -- Zbiór dopuszczalny przy narodzinach BEZ ZMIAN względem 0015:
    -- payment_failed przy INSERT zakłada nieudaną próbę, której nie było,
    -- a stan rozliczeniowy zakłada historię, której nie ma.
    if new.payment_status not in ('unpaid', 'pending', 'paid', 'manual', 'completed') then
      raise exception
        'Zamówienie może powstać wyłącznie w otwartym statusie płatności (otrzymano %).',
        new.payment_status
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- [0027] Reżim nie cofa się ze `stripe` na `manual`. Bez tej reguły ścisła
  -- bramka miałaby jednolinijkowe obejście: UPDATE payment_provider='manual',
  -- potem paid → pending. Kierunek manual → stripe zostaje otwarty — tak
  -- zamówienie wchodzi w płatność online (Z3).
  if new.payment_provider is distinct from old.payment_provider
     and old.payment_provider = 'stripe'
  then
    raise exception
      'Nie można zmienić obiegu płatności ze stripe na % — reżim zamówienia jest jednokierunkowy.',
      new.payment_provider
      using errcode = '23514';
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
    -- [0027] payment_failed NIE blokuje: nieudana próba nie pobrała środków.
    if new.order_status = 'cancelled'
       and new.payment_status in ('pending', 'paid', 'manual', 'completed', 'deposit_refunded')
    then
      raise exception
        'Nie można anulować zamówienia z nierozliczoną płatnością (payment_status=%).',
        new.payment_status
        using errcode = '23001';
    end if;
  end if;

  if new.payment_status is distinct from old.payment_status then
    -- [0027] Reżim czytany z NEW — ten sam wzorzec co blokada anulowania
    -- wyżej: liczy się stan PO zapisie. UPDATE wchodzący w Stripe i zmieniający
    -- status jednym żądaniem jest więc oceniany reżimem ścisłym (ostrzejszym),
    -- a nie tym, z którego wychodzi.
    if not app.payment_transition_allowed(
         old.payment_status, new.payment_status, new.payment_provider
       ) then
      raise exception
        'Niedozwolone przejście statusu płatności: % → % (obieg %).',
        old.payment_status, new.payment_status, new.payment_provider
        using errcode = '23514';
    end if;

    -- Reguła B — spójność z rejestrem kaucji przy wejściu w deposit_refunded:
    -- saldo 0 przy pobraniach > 0 (lustro isDepositSettled / ADR-027).
    -- Obowiązuje OBA reżimy: rejestr kaucji nie zna Stripe'a.
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

  new.updated_at := now();
  return new;
end;
$$;

comment on function app.orders_write_gate() is
  'Bramka zapisu orders (0010 + 0015 + 0027): INSERT tylko pending i w otwartym payment_status; mapa przejść order_status (ADR-025) i payment_status per reżim payment_provider (ADR-064, 23514); reżim nie cofa się ze stripe na manual (23514); anulowanie blokowane przy pobranej płatności (23001); wejście w deposit_refunded wymaga pokrycia w rejestrze kaucji (23514); re-walidacja terminu (23P01); updated_at.';
