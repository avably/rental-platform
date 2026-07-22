-- 0030_webhook_events.sql
-- Z4 / ADR-067: rejestr zdarzeń dostawcy płatności + domknięcie pytania
-- „KTO wolno, żeby napisał `paid`".
--
-- DWIE RZECZY W JEDNEJ MIGRACJI, BO SĄ JEDNĄ DECYZJĄ. Rejestr zdarzeń mówi
-- „to zdarzenie już przejęliśmy" (idempotencja). Bramka writera mówi „stan
-- rozliczeniowy w obiegu online pisze wyłącznie ta jedna ścieżka". Rozdzielone
-- byłyby dwoma połowami tej samej reguły: rejestr bez bramki chroni handler
-- przed samym sobą, a nie zamówienie przed resztą systemu.
--
-- ---------------------------------------------------------------------
-- LUKA, KTÓRĄ TA MIGRACJA ZAMYKA (znalezisko recenzji Z3)
-- ---------------------------------------------------------------------
--
-- 0027 dało osi płatności reżim ścisły: w obiegu `stripe` nie ma regresu
-- z `paid`, a `pending → paid` jest przejściem LEGALNYM — bo to dokładnie
-- to przejście wykonuje webhook. Ale mapa przejść odpowiada wyłącznie na
-- pytanie „czy z tego stanu wolno przejść w tamten". NIE PYTA, KTO PISZE.
--
-- Skutek na main przed tą migracją: każdy członek tenanta, mając zwykły
-- UPDATE na `orders` przez PostgREST (RLS 0007 daje mu go z definicji —
-- to jego dane), mógł JEDNYM żądaniem ustawić `payment_status='paid'` na
-- zamówieniu w obiegu Stripe, którego klient nigdy nie zapłacił. Baza
-- przyjęłaby to jako poprawne przejście, panel pokazałby „opłacone",
-- a pieniędzy nigdy nie było. Cały aparat ADR-049 — odczyt zamiast
-- deklaracji, podpis, idempotencja — broniłby wtedy JEDNYCH drzwi przy
-- drugich otwartych na oścież.
--
-- ROZSTRZYGNIĘCIE: w obiegu `stripe` przejścia DO `paid` i DO
-- `payment_failed` wolno wykonać WYŁĄCZNIE roli `service_role`. Każdy inny
-- writer dostaje 23514 z czytelnym powodem. Obieg `manual` zostaje BEZ
-- ZMIAN — tam pieniądze prowadzi człowiek i swoboda operatorska ADR-035
-- jest cechą, nie długiem.
--
-- DLACZEGO TO NIE JEST SPRZECZNE Z ADR-064 („reżim wybiera KOLUMNA, NIE
-- ROLA"). Tamta reguła mówi, KTÓRA MAPA przejść obowiązuje zamówienie —
-- i nadal wybiera ją kolumna `payment_provider`, bo mapa musi jechać
-- z zamówieniem, a nie zależeć od tego, kto akurat je otwiera. Tutaj
-- pytanie jest inne: mając już mapę, kto ma prawo wykonać KONKRETNE
-- przejście przenoszące pieniądze. Te dwa pytania mają dwie różne
-- odpowiedzi i mieszkają w dwóch różnych miejscach: mapa w
-- `app.payment_transition_allowed` (funkcja CZYSTA, lustro TS —
-- wpuszczenie do niej roli zerwałoby zgodność 2 × 81 par pilnowaną przez
-- order-gates.test.ts), bramka writera w `app.orders_write_gate`.
--
-- DLACZEGO `current_user = 'service_role'`, A NIE `pg_has_role(...)`.
-- `pg_has_role(current_user,'service_role','member')` jest prawdziwe także
-- dla `postgres` i `supabase_admin` — czyli dla właściciela KAŻDEJ funkcji
-- SECURITY DEFINER w tym schemacie. A takich funkcji na anonowej ścieżce
-- checkoutu mamy kilka (`app.public_checkout`, `app.attach_payment_intent`).
-- Przy `pg_has_role` pierwsza definer-funkcja, która dotknęłaby
-- `payment_status`, wyprałaby tożsamość wołającego: anon wchodziłby przez
-- nią jako `postgres` i bramka przepuściłaby go bez słowa. Dosłowne
-- porównanie roli BIEŻĄCEJ jest fail-closed: ścieżka, która nie jest
-- połączeniem service-role, dostaje odmowę — także wtedy, gdy to my sami
-- kiedyś ją zbudujemy. Głośna odmowa jest tu tańsza niż cicha furtka.
--
-- KOD BŁĘDU: 23514 (check_violation) — ta sama klasa co reszta bramek osi
-- płatności (0015/0027/0029). Klasa 23xxx jedzie przez PostgREST jako 409
-- z komunikatem; 42501 sugerowałoby brak GRANT-u, a GRANT jest w porządku
-- — to reguła DOMENY, nie uprawnień tabelarycznych.
--
-- IDEMPOTENCJA: całość przez create table if not exists / drop ... if
-- exists / create or replace — migracja wgrana dwa razy nie pada (baza
-- lokalna bywa współdzielona i dogrywana ręcznie).

-- ---------------------------------------------------------------------
-- 1. public.webhook_events — rejestr PLATFORMOWY
-- ---------------------------------------------------------------------
--
-- BEZ `tenant_id` I TO JEST DECYZJA, NIE PRZEOCZENIE. Idempotencja musi
-- działać ZANIM rozpoznamy tenanta: pierwszą rzeczą, jaką handler robi ze
-- zdarzeniem, jest „przejmuję je albo nie" — a tenanta zna dopiero po
-- odczycie płatności u dostawcy i odnalezieniu zamówienia. Gdyby wiersz
-- wymagał `tenant_id`, dwie równoległe dostawy tego samego zdarzenia
-- musiałyby najpierw ZGODNIE rozpoznać tenanta, żeby móc się na siebie
-- natknąć — czyli wyścig przeniósłby się piętro wyżej, tam gdzie nie ma
-- ograniczenia bazy, które go rozstrzyga.
--
-- Konsekwencja dla macierzy izolacji: tabela wchodzi do DRUGIEJ osi
-- (`listPlatformTablesWithoutRls`). Bez RLS zapaliłaby harness — i ma
-- zapalać, bo rejestr zdarzeń płatniczych nie jest widokiem najemcy.

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),

  -- Konwencja text+CHECK, nie enum (nagłówek 0007/0013): drugi dostawca
  -- w fazie 4 to zwykła migracja, bez ALTER TYPE i blokad.
  provider text not null default 'stripe' check (provider in ('stripe')),

  -- Identyfikator zdarzenia U DOSTAWCY (`evt_...`). To po nim, i wyłącznie
  -- po nim, rozstrzygamy „już to widzieliśmy".
  event_id text not null check (length(event_id) between 1 and 255),

  -- Typ zdarzenia prosto od dostawcy (`payment_intent.succeeded`). BEZ
  -- CHECK-a na wartościach: to słownik DOSTAWCY, a włączenie nam nowego
  -- typu w jego panelu nie ma prawa być awarią NASZEGO zapisu. Filtrowanie
  -- typów, które obsługujemy, należy do handlera — tu rejestrujemy także
  -- te, których nie obsłużyliśmy, bo „przyszło i zignorowaliśmy" jest
  -- informacją, a cisza nie jest.
  event_type text not null check (length(event_type) between 1 and 255),

  received_at timestamptz not null default now(),

  -- NULL, dopóki handler nie skończył. Nie służy do decyzji „czy
  -- przetwarzać" (od tego jest UNIQUE niżej) — służy do diagnozy, ile
  -- zdarzenie u nas siedziało.
  processed_at timestamptz,

  -- 'received'  — wiersz przejęty, przetwarzanie trwa albo padło twardo,
  -- 'processed' — stan zamówienia zapisany i POTWIERDZONY ODCZYTEM,
  -- 'failed'    — nie zapisaliśmy tego, co zamierzaliśmy: odmowa bramki
  --               statusów, rozjazd odczytu po zapisie, awaria dostawcy.
  --
  -- 'failed' obejmuje ODMOWĘ, mimo że dostawca dostaje 2xx. To nie jest
  -- niespójność: 2xx mówi „nie ponawiaj", a wiersz mówi, co się REALNIE
  -- stało. Zwinięcie obu w jedno („odpowiedzieliśmy 200, czyli sukces")
  -- zamieniłoby rejestr w echo naszych własnych odpowiedzi.
  status text not null default 'received'
    check (status in ('received', 'processed', 'failed')),

  -- Powód przy 'failed' — wzorzec `domains.last_error` / ADR-046: porażka
  -- jest WARTOŚCIĄ do przeczytania, nie ciszą.
  error text,

  -- UNIKAT = CAŁA IDEMPOTENCJA. Nie `select`-potem-`insert` w handlerze:
  -- dwie równoległe dostawy tego samego zdarzenia przeszłyby oba SELECT-y
  -- zanim którakolwiek zdążyłaby wstawić wiersz (ADR-024 — dokładnie ten
  -- kształt wyścigu co przy przypisaniu egzemplarza). Handler robi
  -- `insert ... on conflict do nothing` i czyta LICZBĘ WSTAWIONYCH wierszy:
  -- 1 = „ja to zdarzenie przejmuję", 0 = „ktoś inny je już ma".
  --
  -- Para (provider, event_id), nie samo `event_id`: kolumna `provider`
  -- istnieje właśnie dlatego, że drugi dostawca jest przewidziany, a jego
  -- przestrzeń identyfikatorów jest jego. Unikat globalny po samym
  -- `event_id` kazałby nam MILCZĄCO pominąć zdarzenie PayU, które trafiło
  -- w ten sam ciąg znaków co zdarzenie Stripe'a — czyli zgubić płatność
  -- w imię ostrożności. Zakres unikatu jest ten sam, co zakres kolumny.
  constraint webhook_events_provider_event_unique unique (provider, event_id)
);

comment on table public.webhook_events is
  'Rejestr zdarzeń dostawcy płatności (Z4, ADR-067). PLATFORMOWA — bez tenant_id, bo idempotencja musi rozstrzygać się ZANIM rozpoznamy tenanta. Unikat (provider, event_id) jest jedynym mechanizmem idempotencji: handler robi insert ... on conflict do nothing i czyta liczbę wstawionych wierszy. RLS włączone, ZERO polityk dla anon/authenticated — dostęp wyłącznie service_role.';
comment on column public.webhook_events.event_id is
  'Identyfikator zdarzenia u dostawcy (evt_...). Podstawa idempotencji — nie sygnatura ciała ani znacznik czasu, bo dostawca ponawia TO SAMO zdarzenie z tym samym id.';
comment on column public.webhook_events.event_type is
  'Typ zdarzenia prosto od dostawcy, BEZ CHECK-a na wartościach: to jego słownik, a jego zmiana nie ma być naszą awarią zapisu. Zdarzenia nieobsługiwane też mają tu wiersz — „przyszło i zignorowaliśmy" jest informacją.';
comment on column public.webhook_events.status is
  'received = przejęte; processed = stan zamówienia zapisany i POTWIERDZONY ODCZYTEM; failed = nie zapisaliśmy zamierzonego (odmowa bramki, rozjazd odczytu po zapisie, awaria dostawcy). failed występuje także tam, gdzie dostawca dostał 2xx — 2xx znaczy „nie ponawiaj", a nie „udało się".';
comment on column public.webhook_events.error is
  'Powód przy status=failed (wzorzec domains.last_error, ADR-046). Bez sekretów i bez ciała zdarzenia — powód, nie zrzut.';

-- Odczyt diagnostyczny idzie po czasie („co przyszło ostatnio"), a wyszukanie
-- po id obsługuje unikat wyżej. Indeks malejący, bo tak się to czyta.
create index if not exists webhook_events_received_at_idx
  on public.webhook_events (received_at desc);

-- ---------------------------------------------------------------------
-- 2. RLS i uprawnienia — tabela poza zasięgiem najemcy
-- ---------------------------------------------------------------------
--
-- REVOKE PRZED GRANT-em (wzorzec 0006/0007/0024/0028): bez tego `alter
-- default privileges` Supabase zostawia anon i authenticated komplet
-- uprawnień, w tym TRUNCATE — które NIE PODLEGA RLS w ogóle. Sama polityka
-- (a raczej jej brak) nie obroniłaby rejestru przed wyczyszczeniem.

alter table public.webhook_events enable row level security;

revoke all on public.webhook_events from anon, authenticated;
grant select, insert, update, delete on public.webhook_events to service_role;

-- ŻADNEJ POLITYKI DLA anon/authenticated I TO JEST CAŁA TREŚĆ TEGO KROKU.
-- RLS bez polityki = brak dostępu; `service_role` polityk nie potrzebuje,
-- bo je omija. Gdyby kiedyś najemca miał zobaczyć historię swoich płatności,
-- powstanie do tego OSOBNY, per-tenant widok tego, co go dotyczy — a nie
-- polityka na rejestrze platformowym, w którym leżą też zdarzenia cudze
-- i zdarzenia nierozpoznane.
drop policy if exists tenant_select on public.webhook_events;
drop policy if exists superadmin_select on public.webhook_events;

-- ---------------------------------------------------------------------
-- 3. Kto pisze rozliczenie w obiegu online
-- ---------------------------------------------------------------------
--
-- Osobna funkcja, a nie warunek wpisany w trigger, z dwóch powodów:
-- (1) test może ją przypiąć wprost (`select app.is_settlement_writer()`
-- z sesji członka i z sesji service-role) zamiast wnioskować o niej
-- z zachowania UPDATE-a, (2) definicja stoi w JEDNYM miejscu, więc
-- przyszłe rozszerzenie zbioru writerów jest jedną zmianą, a nie
-- polowaniem po ciałach triggerów.
--
-- STABLE, nie IMMUTABLE: wynik zależy od kontekstu sesji. IMMUTABLE
-- pozwoliłoby planerowi policzyć to raz i zapamiętać.

create or replace function app.is_settlement_writer() returns boolean
language sql stable
set search_path = pg_catalog
as $$
  select current_user = 'service_role'
$$;

comment on function app.is_settlement_writer() is
  'Czy BIEŻĄCA rola ma prawo zapisać stan rozliczeniowy zamówienia w obiegu stripe (ADR-067). Dosłowne current_user = service_role, świadomie NIE pg_has_role: to drugie jest prawdziwe dla postgres/supabase_admin, czyli dla właściciela każdej funkcji SECURITY DEFINER — anonowa ścieżka checkoutu weszłaby przez taką funkcję z wypraną tożsamością.';

revoke all on function app.is_settlement_writer() from public;
grant execute on function app.is_settlement_writer() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. app.orders_write_gate — redefinicja z 0029
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0029 + jeden blok) — bo `create or
-- replace` nadpisuje także atrybuty funkcji; okrojona kopia zdjęłaby po
-- cichu logikę order_status, niezmienności identyfikatora płatności, dat
-- i rejestru kaucji. Zmiany względem 0029 oznaczone [0030]; reszta ciała
-- jest dosłowna.

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

comment on function app.orders_write_gate() is
  'Bramka zapisu orders (0010 + 0015 + 0027 + 0029 + 0030): INSERT tylko pending i w otwartym payment_status; mapa przejść order_status (ADR-025) i payment_status per reżim payment_provider (ADR-064, 23514); reżim nie cofa się ze stripe na manual; identyfikator płatności niezmienny po ustawieniu (ADR-066); [0030] w obiegu stripe przejście DO paid/payment_failed wolno wykonać wyłącznie roli service_role (ADR-067, 23514) — mapa mówi CZY, ta bramka mówi KTO; anulowanie blokowane przy pobranej płatności (23001); wejście w deposit_refunded wymaga pokrycia w rejestrze kaucji (23514); re-walidacja terminu (23P01); updated_at.';
