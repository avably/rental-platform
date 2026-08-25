-- 0112_order_returned_at.sql
-- Znacznik FAKTYCZNEJ daty zwrotu zamówienia (ADR-270, Finding 2 audytu cyklu
-- zamówienia, LOW/missing-logic).
--
-- PO CO. Do 0112 przejście order_status → `returned` nie zostawiało ŻADNEGO
-- śladu, KIEDY zwrot faktycznie nastąpił. `updated_at` (0010) jest dotykany
-- KAŻDYM zapisem wiersza, więc nie odpowiada na pytanie „kiedy oddano sprzęt";
-- historia komunikacji zna wysyłkę maila, nie moment tranzycji. Bez własnej
-- kolumny data zwrotu była nie do odzyskania po pierwszym kolejnym UPDATE.
--
-- CO ROBI. (1) Dodaje `orders.returned_at timestamptz null` — kolumna AUDYTU,
-- pusta dla zamówień, które nie doszły do zwrotu; nullable, bo większość
-- wierszy jej nie ma i backfill nie ma z czego liczyć (moment zwrotu
-- historycznych zamówień nie jest zapisany nigdzie). (2) Ustawia ją ATOMOWO
-- w `app.orders_write_gate` — jedynym triggerze BEFORE UPDATE na orders — w
-- TYM SAMYM zapisie, który przenosi status w `returned`. Znacznik nie może
-- być osobnym UPDATE-em z panelu: dwa zapisy to okno, w którym zwrot już jest,
-- a znacznika jeszcze nie (i odwrotnie). Trigger domyka też ścieżki spoza
-- panelu (bulk, surowy PATCH PostgREST) — bramka jest w bazie, tak jak reszta
-- niezmienników zamówienia (ADR-025).
--
-- IDEMPOTENCJA. `returned` jest TERMINALNY (mapa app.order_transition_allowed
-- z 0010: nic z niego nie wychodzi), więc blok przejścia utrwala znacznik
-- DOKŁADNIE raz — powrotu returned→returned nie ma, a UPDATE niezmieniający
-- statusu w ogóle nie wchodzi w gałąź `is distinct`. Ponowny zapis tej samej
-- wartości statusu NIE psuje znacznika: pozostaje z pierwszego przejścia.
--
-- OPŁATA ZA OVERDUE — POZA ZAKRESEM. To decyzja biznesowa właściciela; ta
-- migracja daje wyłącznie znacznik czasu, żadnej arytmetyki kar.
--
-- DYSCYPLINA `create or replace`. Funkcja jest odtworzona z NAJŚWIEŻSZEJ
-- definicji (0049_orders_currency.sql) — nie ze starszej, która po cichu
-- cofnęłaby bramki waluty/płatności/identyfikatora dołożone w 0015/0027/0029/
-- 0030/0049. Jedyna różnica względem 0049 jest oznaczona [0112]: blok znacznika
-- w gałęzi przejścia statusu. Sygnatura, język, search_path i trigger bez
-- zmian. Zgodność semantyki maszyny stanów TS↔SQL nadal przypina
-- packages/db/test/order-gates.test.ts; ślad returned_at — nowy
-- packages/db/test/order-returned-at.test.ts.
--
-- BEZPIECZEŃSTWO / IZOLACJA. Kolumna audytu bez wpływu na RLS — polityki 0007
-- działają na wierszu, nie na tej kolumnie; migracja jest ADDYTYWNA (nowa
-- nullable kolumna, brak zmian grantów tabelarycznych, brak nowej tabeli).
-- Macierz izolacji (rls-isolation.test.ts) i rejestr fabryk bez zmian.

alter table public.orders
  add column if not exists returned_at timestamptz;

comment on column public.orders.returned_at is
  'Znacznik FAKTYCZNEJ daty zwrotu — ustawiany atomowo przez app.orders_write_gate przy przejściu order_status → returned (ADR-270). NULL, dopóki zamówienie nie zostało zwrócone. Opłata za overdue jest POZA zakresem (decyzja właściciela).';

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
    -- Zbiór dopuszczalny przy narodzinach BEZ ZMIAN względem 0015/0027/0029:
    -- payment_failed przy INSERT zakłada nieudaną próbę, której nie było,
    -- a stan rozliczeniowy zakłada historię, której nie ma.
    if new.payment_status not in ('unpaid', 'pending', 'paid', 'manual', 'completed') then
      raise exception
        'Zamówienie może powstać wyłącznie w otwartym statusie płatności (otrzymano %).',
        new.payment_status
        using errcode = '23514';
    end if;

    -- [0030] Narodziny w obiegu stripe od razu w `paid` byłyby obejściem
    -- bramki writera w JEDNYM kroku: zamówienie nie „przechodzi" wtedy
    -- w paid, tylko się w nim rodzi, więc blok przejść niżej nigdy go nie
    -- ogląda. `app.public_checkout` zakłada zamówienia w `unpaid`, więc
    -- ta reguła nie odbiera niczego żadnej istniejącej ścieżce.
    if new.payment_provider = 'stripe'
       and new.payment_status = 'paid'
       and not app.is_settlement_writer()
    then
      raise exception
        'Zamówienie w obiegu stripe nie może powstać jako opłacone — status paid ustawia wyłącznie handler webhooka (service_role), rola % nie ma tego prawa.',
        current_user
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

  -- [0029] Identyfikator płatności jest NIEZMIENNY po ustawieniu — w obie
  -- strony: nie wolno go ani podmienić, ani wyczyścić (wyczyszczenie byłoby
  -- podmianą w dwóch krokach). Warunek patrzy na STARĄ wartość: dopóki
  -- kolumna jest pusta, wpisanie identyfikatora jest legalne i tak właśnie
  -- działa app.attach_payment_intent.
  --
  -- Bez WARTOŚCI identyfikatorów w komunikacie: komunikat trafia do warstwy,
  -- która pokazuje go człowiekowi (wzorzec 0028).
  if new.provider_payment_intent_id is distinct from old.provider_payment_intent_id
     and old.provider_payment_intent_id is not null
  then
    raise exception
      'Identyfikatora płatności nie można zmienić ani usunąć po jego przypisaniu.'
      using errcode = '23514';
  end if;

  -- [0049] Waluta zamówienia jest NIEZMIENNA od narodzin (ADR-103) — bez
  -- wyjątku dla service_role: kolumny _grosze wyrażają kwoty w TEJ walucie,
  -- więc podmiana waluty przepisywałaby znaczenie wszystkich kwot wiersza
  -- bez zmiany choćby jednej liczby. Kolumna NOT NULL, więc — inaczej niż
  -- przy identyfikatorze płatności — nie ma legalnego przejścia z pustki;
  -- każda różnica jest odmową.
  if new.currency is distinct from old.currency then
    raise exception
      'Waluty zamówienia nie można zmienić po jego utworzeniu.'
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

    -- [0112] Znacznik FAKTYCZNEJ daty zwrotu (ADR-270). Stoi TU, w gałęzi
    -- zmiany statusu, więc utrwala się w TYM SAMYM UPDATE, co przejście —
    -- nie osobnym zapisem, który mógłby nie dojść. `returned` jest terminalny
    -- (order_transition_allowed nie wypuszcza z niego niczego), więc gałąź
    -- `is distinct` ogląda to przejście DOKŁADNIE raz: znacznik zapisuje się
    -- jeden raz, a ponowny UPDATE tej samej wartości statusu tu nie wchodzi.
    -- now() to czas startu transakcji — ten sam, którym niżej stemplowany jest
    -- updated_at, więc oba znaczniki zwrotu są spójne co do chwili.
    -- Przypisanie jest BEZWARUNKOWE względem starej wartości returned_at:
    -- świadome nadpisanie ewentualnego śladu sprzed przejścia znaczy, że
    -- returned_at zawsze niesie moment REALNEJ tranzycji w returned, a nie
    -- wartość wstrzykniętą obok bramki. Opłata za overdue: POZA zakresem.
    if new.order_status = 'returned' then
      new.returned_at := now();
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

    -- [0030] KTO wykonuje przejście — pytanie ROZŁĄCZNE z mapą wyżej.
    --
    -- `paid` i `payment_failed` to jedyne dwa stany osi, o których nie da
    -- się orzec bez pytania dostawcy o pieniądze; oba są w obiegu online
    -- wynikiem ODCZYTU (ADR-049), a odczyt robi handler webhooka. Reszta
    -- osi zostaje otwarta dla członka także w obiegu stripe: `pending`
    -- ustawia anonowa ścieżka checkoutu (0029), `cancelled` i rozliczenie
    -- kaucji to decyzje operatora, a nie twierdzenia o wpłacie.
    --
    -- Reżim `manual` nie jest tu wymieniony i to jest cała jego ochrona:
    -- swoboda operatorska ADR-035 zostaje nietknięta.
    if new.payment_provider = 'stripe'
       and new.payment_status in ('paid', 'payment_failed')
       and not app.is_settlement_writer()
    then
      raise exception
        'Status płatności % w obiegu stripe ustawia wyłącznie handler webhooka (service_role) po odczycie u dostawcy — rola % nie ma tego prawa.',
        new.payment_status, current_user
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
