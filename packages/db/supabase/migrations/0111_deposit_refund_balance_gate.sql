-- 0111_deposit_refund_balance_gate.sql
-- ADR-269: saldo kaucji jest bramką WYSTAWIENIA żądania zwrotu, nie tylko
-- jego KSIĘGOWANIA. Domknięcie luki money-critical z audytu cyklu zamówienia
-- (Finding 1): zwrot większy niż saldo wychodził do dostawcy, ZANIM którakolwiek
-- bramka zdążyła go odrzucić.
--
-- ---------------------------------------------------------------------
-- LUKA, KTÓRĄ TA MIGRACJA ZAMYKA
-- ---------------------------------------------------------------------
--
-- `requestDepositRefund` (apps/panel/lib/deposit-refund.ts) woła `createRefund`
-- z kwotą Z FORMULARZA operatora. Do tej pory jedynymi ogranicznikami tej kwoty
-- były:
--   1. limit CAŁEGO PaymentIntentu u dostawcy — a ten obejmuje najem + kaucję
--      + dostawę (0029), więc operator nadpisujący edytowalne pole zwrotu mógł
--      oddać z kaucji część NAJMU i mieścić się w limicie intentu,
--   2. bramka salda 0011 (`deposit_events_gate`) — ale ta jest triggerem na
--      `deposit_events`, a wiersz `refunded` powstaje DOPIERO PO potwierdzonym
--      przelewie (deposit-booking.ts). Odmowa 23514 pada więc, GDY PIENIĄDZE
--      JUŻ WYSZŁY: rejestr twierdzi „nie oddano", a klient ma o kaucję za dużo.
--      Dokładnie ten kształt awarii („pieniądze wyszły, rejestr odmówił") ma
--      wykluczać całe Z5.
--
-- Wariant bez błędu operatora: wyścig dwóch sesji. Sesja B księguje potrącenie
-- obniżające saldo, sesja A — od salda sprzed potrącenia — zleca zwrot całości.
-- Kwota A mieści się w limicie intentu, więc dostawca ją wykonuje; 23514 z 0011
-- pada dopiero przy księgowaniu, po przelewie.
--
-- ---------------------------------------------------------------------
-- ROZSTRZYGNIĘCIE: BRAMKA SALDA PRZESUNIĘTA NA WIERSZ ŻĄDANIA
-- ---------------------------------------------------------------------
--
-- `deposit_refunds` (0031) to rejestr ŻĄDAŃ zwrotu, a wiersz `requested`/`pending`
-- powstaje w kroku 4 `requestDepositRefund` — czyli PRZED `createRefund` (krok 5).
-- Bramka na INSERT tego wiersza odrzuca nadmiarowy zwrot ZANIM cokolwiek wyjdzie
-- do dostawcy: żaden `POST /v1/refunds` nie dostaje szansy.
--
-- To DRUGA warstwa obok clampu w kodzie aplikacji (deposit-refund.ts). Dwie
-- warstwy są tu celem, nie nadmiarem (nagłówki 0031/0032): clamp daje operatorowi
-- czytelną odmowę i uwzględnia potrącenie z tego samego modalu (jeszcze
-- niezaksięgowane w chwili INSERT-u żądania), a ta bramka jest ostatnią linią na
-- bazie — trzyma nawet wtedy, gdy kod aplikacji zostanie ominięty albo zmieniony,
-- i zamyka wyścig, którego clamp (odczyt bez locka) sam nie serializuje.
--
-- ADVISORY LOCK TEN SAM, CO W 0011/0034. Bramka bierze
-- `pg_advisory_xact_lock` per (tenant, zamówienie) o TYM SAMYM haszu, co
-- `app.deposit_events_gate`. Dzięki temu INSERT żądania zwrotu serializuje się
-- z księgowaniem `deposit_events`: potrącenie sesji B i żądanie sesji A ustawiają
-- się na jednym locku, a przegrany czyta rejestr NOWYM snapshotem (READ COMMITTED)
-- i widzi już zatwierdzone saldo. Wyścig „B potrąca, A zwraca stare saldo" (B
-- księguje PRZED wstawieniem żądania A) rozstrzyga więc lock, nie kolejność
-- wywołań.
--
-- ZAKRES: WYŚCIG „B PRZED A". Ta bramka (jak clamp w kodzie) czyta saldo
-- z `deposit_events` w chwili INSERT-u żądania. Nie pokrywa odwrotnego wyścigu,
-- w którym potrącenie sesji B księguje się DOPIERO w oknie między wstawieniem
-- żądania A a jego zaksięgowaniem po przelewie (żądanie zwrotu nie wchodzi do
-- salda dopóki nie stanie się wierszem `refunded`) — tam ostatnią linią zostaje
-- niezmiennik 0011 przy księgowaniu. Domknięcie tamtego wymagałoby, by
-- `deposit_events_gate` liczył też zwroty W LOCIE, co jest zmianą rdzenia 0011
-- poza zakresem tej migracji.
--
-- TRIGGER `AFTER INSERT`, NIE `BEFORE`. Bramka ma DODAWAĆ warstwę salda, nie
-- ZASŁANIAĆ pozostałych ograniczeń wiersza. `BEFORE INSERT` odpala PRZED FK,
-- CHECK-ami i RLS, więc na wierszu bez pokrycia salda (np. żądanie
-- międzytenantowe albo ze złym statusem) rzucałby 23514 ZAMIAST właściwej
-- odmowy (23503 z FK, 23514 ze statusu, odmowa RLS) — myląca diagnostyka i
-- zasłonięte niezmienniki. `AFTER INSERT` odpala PO nich: gdy wiersz i tak jest
-- odrzucany głębiej, ta bramka nie dochodzi do głosu; gdy wiersz jest poprawny,
-- wyjątek z bramki wywraca CAŁY INSERT (żaden wiersz nie zostaje, `createRefund`
-- się nie odpala). Bezpieczeństwo pieniędzy jest identyczne jak przy BEFORE:
-- PostgREST oddaje błąd, więc `requestDepositRefund` nie wychodzi do dostawcy.
--
-- ---------------------------------------------------------------------
-- CZEGO TA MIGRACJA NIE RUSZA
-- ---------------------------------------------------------------------
--
-- RLS I GRANTY `deposit_refunds` (0031) — ani jednego znaku. Funkcja jest
-- INVOKER (bez SECURITY DEFINER), więc jej SELECT po `deposit_events` biegnie
-- w zasięgu wołającego: sesja operatora widzi zdarzenia SWOJEGO tenanta
-- (polityka tenant_select z 0011/0031), service_role widzi wszystko, ale filtr
-- `tenant_id = new.tenant_id and order_id = new.order_id` i tak zawęża sumę do
-- jednego zamówienia. Bramka NIE rozluźnia izolacji: nie nadaje uprawnień, nie
-- omija RLS, nie sięga poza (tenant, zamówienie) z wstawianego wiersza.
--
-- BRAMKA 0011 zostaje ostatnią linią przy KSIĘGOWANIU zwrotu (wiersz `refunded`)
-- — dla zwrotów zleconych z panelu dostawcy poza naszym obiegiem albo domykanych
-- webhookiem. Ta migracja dokłada linię WCZEŚNIEJSZĄ: przy WYSTAWIANIU żądania.
--
-- KOD BŁĘDU: 23514 (check_violation) — ta sama klasa i semantyka, co niezmiennik
-- salda z 0011 („rozliczenie przekracza pobraną kwotę”). PostgREST mapuje 23514
-- na HTTP 400 z `error.code = '23514'`, a `requestDepositRefund` klasyfikuje po
-- tym kodzie odmowę INSERT-u żądania (wyścig, w którym saldo spadło między
-- odczytem clampu a wstawieniem) i zwraca `failed` z czytelnym powodem — bez
-- ani jednego wyjścia do dostawcy.
--
-- IDEMPOTENCJA MIGRACJI: `create or replace function` + `drop trigger if exists`
-- + `create trigger`. Baza lokalna bywa współdzielona i dogrywana ręcznie.

-- ---------------------------------------------------------------------
-- Bramka salda na wystawieniu żądania zwrotu
-- ---------------------------------------------------------------------

create or replace function app.deposit_refund_balance_gate() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_collected bigint;
  v_settled bigint;
begin
  -- Serializacja per (tenant, zamówienie) TYM SAMYM haszem, co bramka
  -- deposit_events_gate (0011/0034) — wystawienie żądania zwrotu ustawia się na
  -- tym samym locku, co księgowanie potrącenia z drugiej sesji. Lock zwalnia
  -- koniec transakcji; kolizja hasza kosztuje wyłącznie chwilę oczekiwania.
  perform pg_advisory_xact_lock(
    hashtextextended(new.tenant_id::text || ':deposit:' || new.order_id::text, 0)
  );

  select
    coalesce(sum(amount_grosze) filter (where kind = 'collected'), 0),
    coalesce(sum(amount_grosze) filter (where kind in ('refunded','deducted')), 0)
    into v_collected, v_settled
  from public.deposit_events
  where tenant_id = new.tenant_id and order_id = new.order_id;

  -- Żądanie zwrotu większe niż saldo kaucji nie ma prawa dojść do dostawcy.
  -- Wyjątek wywraca CAŁY INSERT (trigger AFTER), więc wiersz `deposit_refunds`
  -- nie zostaje, PostgREST oddaje błąd, a `requestDepositRefund` nie woła
  -- `createRefund` — żaden przelew tędy nie wychodzi.
  if new.amount_grosze > v_collected - v_settled then
    raise exception
      'Zwrot kaucji przekracza dostępne saldo (saldo % gr, żądanie zwrotu % gr).',
      v_collected - v_settled, new.amount_grosze
      using errcode = '23514';
  end if;

  return null; -- AFTER INSERT: wartość zwrotu jest ignorowana.
end;
$$;

comment on function app.deposit_refund_balance_gate() is
  'Bramka salda na WYSTAWIENIU żądania zwrotu kaucji (ADR-269): trigger AFTER INSERT na deposit_refunds z advisory lockiem per (tenant, zamówienie) — ten sam hasz, co deposit_events_gate — i odmową 23514, gdy żądana kwota zwrotu przekracza saldo kaucji (pobrania minus zwroty i potrącenia). Wyjątek wywraca INSERT, więc nadmiarowy zwrot nie ma jak dojść do createRefund; druga warstwa obok clampu w requestDepositRefund. AFTER (nie BEFORE), by nie zasłaniać FK/CHECK/RLS wiersza. Funkcja INVOKER — nie rozluźnia RLS ani izolacji tenanta.';

-- REVOKE PUBLIC (konwencja 0064, docs/konwencje-migracji.md). Schemat `app` jest
-- wystawiony przez PostgREST, więc świeża funkcja z DOMYŚLNYM ACL (proacl NULL =
-- PUBLIC ma EXECUTE) byłaby wołalna publicznym kluczem anon z przeglądarki. To
-- funkcja WYZWALACZA — odpala ją mechanizm triggera, nie RPC, więc nie potrzebuje
-- EXECUTE dla żadnej roli API (uwaga praktyczna z konwencji): odbieramy PUBLIC,
-- bez nadawania grantów. Bramka function-acls.test.ts pilnuje tego automatycznie.
revoke all on function app.deposit_refund_balance_gate() from public;

drop trigger if exists deposit_refund_balance_gate on public.deposit_refunds;

create trigger deposit_refund_balance_gate
  after insert on public.deposit_refunds
  for each row execute function app.deposit_refund_balance_gate();
