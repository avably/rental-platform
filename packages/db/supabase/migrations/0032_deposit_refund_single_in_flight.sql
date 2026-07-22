-- 0032_deposit_refund_single_in_flight.sql
-- Z11 / ADR-070: JEDEN zwrot kaucji „w locie" na zamówienie — domknięcie
-- wyścigu dwukliku, który 0031 zostawił na SELECT-cie zamiast na bazie.
--
-- ---------------------------------------------------------------------
-- LUKA, KTÓRĄ TA MIGRACJA ZAMYKA (znalezisko przeglądu adwersaryjnego Z11)
-- ---------------------------------------------------------------------
--
-- 0031 broni przed „kaucją oddaną dwa razy" DWIEMA rzeczami i OBIE mają
-- szczelinę przy współbieżności:
--
--   1. `requestDepositRefund` (apps/panel/lib/deposit-refund.ts, krok 2)
--      czyta `deposit_refunds` po wierszach in-flight i odmawia, jeśli
--      któryś jest. To jest SELECT-potem-INSERT: dwa równoległe żądania
--      (dwuklik, druga karta, powtórzony POST akcji serwerowej) przechodzą
--      oba SELECT-y, ZANIM którekolwiek zdąży wstawić swój wiersz — dokładnie
--      ten kształt wyścigu, który ADR-024 rozstrzyga OGRANICZENIEM BAZY, a nie
--      warunkiem w kodzie (patrz webhook_events / unikat event_id z 0030).
--
--   2. Klucz idempotencji dostawcy to `deposit_refunds.id` — ŚWIEŻY UUID
--      per żądanie (0031 celowo, żeby druga LEGALNA rata tej samej kwoty nie
--      została zjedzona jako duplikat). Dwa wiersze = dwa klucze = DWA realne
--      refundy u dostawcy. Klucz idempotencji NIE ratuje przed dwuklikiem,
--      bo każdy klik dostaje własny klucz.
--
-- Skutek na żywym Stripe: dwa równoległe `POST /v1/refunds` z różnymi kluczami
-- WYKONUJĄ SIĘ oba. Bramka salda 0011 (`deposit_events_gate`) łapie tylko to,
-- co przekroczy pobranie, i to DOPIERO przy księgowaniu — czyli PO tym, jak
-- pieniądze już wyszły. Zwrot częściowy mieszczący się w pobranej kaucji
-- (dwa razy „zwróć 5 zł" z kaucji 10 zł) przechodzi OBIE warstwy DB po cichu,
-- a najemca wypłaca 10 zł zamiast 5. Zwrot pełny dwa razy wychodzi u dostawcy
-- (druga rata zjada najem/dostawę z tego samego intentu), a 0011 odrzuca
-- dopiero DRUGI zapis — rejestr zostaje spójny, saldo najemcy u dostawcy NIE.
--
-- ---------------------------------------------------------------------
-- ROZSTRZYGNIĘCIE
-- ---------------------------------------------------------------------
--
-- Częściowy unikat: co najwyżej JEDEN wiersz `deposit_refunds` w stanie
-- NIEDOMKNIĘTYM (`requested` | `pending`) na (tenant, zamówienie). Drugi
-- równoległy INSERT rozbija się o unikat kodem 23505 — wyścig zserializowany
-- na wpisie do indeksu (drugi wstawiający czeka na commit pierwszego, potem
-- dostaje odmowę), a nie na SELECT-cie, który obu żądaniom pokazał pustkę.
--
-- ZAKRES STANÓW = DOKŁADNIE „w locie". `succeeded` i `failed` WYCHODZĄ z
-- indeksu, więc kolejna, SEKWENCYJNA rata zwrotu tej samej kaucji jest legalna
-- — czyli zdolność do wielu zwrotów częściowych w czasie (cała pointa
-- świeżego klucza idempotencji z 0031) zostaje NIETKNIĘTA. Blokujemy wyłącznie
-- DRUGIE żądanie, gdy pierwsze jest jeszcze w drodze — a to jest właśnie stan,
-- w którym drugi refund oznaczałby wypłatę tej samej kaucji dwa razy.
--
-- CO SIĘ NIE ZMIENIA. `deposit_events` (rejestr FAKTÓW) i bramka 0011 stoją
-- nietknięte — to nadal one bronią przed zwrotem większym niż pobranie, gdy
-- pieniądze już wyszły. Ta migracja dokłada warstwę, która nie dopuszcza do
-- WYJŚCIA drugiego żądania; 0011 zostaje ostatnią linią, gdy jednak wyjdzie
-- (zwrot zlecony z panelu dostawcy, poza naszym obiegiem). Dwie warstwy są tu
-- celem, nie nadmiarem — pierwsza łapie błąd NASZ, druga cudzy (nagłówek 0031).
--
-- KOD BŁĘDU: 23505 (unique_violation) — mapowany przez PostgREST na 409.
-- `requestDepositRefund` klasyfikuje go tam po `error.code` i zwraca ten sam
-- wynik `pending` („zwrot już w toku"), co bramka SELECT — druga, przegrana
-- ścieżka dwukliku nie jest porażką do ponowienia.
--
-- IDEMPOTENCJA MIGRACJI: `drop index if exists` + `create unique index`.
-- Poza `create table` (i tak jesteśmy na istniejącej tabeli z 0031): unikat,
-- na którym stoi pojedynczość zwrotu w locie, musi być ODTWARZANY przy każdym
-- przebiegu — zdjęty ręcznie nie wróciłby po `create table if not exists`, a
-- objaw byłby NIEMY, dokładnie jak przy unikacie event_id z 0030.

-- ---------------------------------------------------------------------
-- Częściowy unikat: jeden zwrot w locie na zamówienie
-- ---------------------------------------------------------------------

drop index if exists public.deposit_refunds_one_in_flight_per_order;

create unique index deposit_refunds_one_in_flight_per_order
  on public.deposit_refunds (tenant_id, order_id)
  where status in ('requested', 'pending');

comment on index public.deposit_refunds_one_in_flight_per_order is
  'Co najwyżej jeden zwrot kaucji NIEDOMKNIĘTY (requested|pending) na (tenant, zamówienie) — ADR-070. Domyka wyścig dwukliku, którego bramka SELECT w requestDepositRefund (0031) nie serializowała: dwa równoległe żądania mijały SELECT i wysyłały DWA refundy z różnymi kluczami idempotencji. Drugi INSERT rozbija się teraz o ten unikat (23505). succeeded/failed wychodzą z indeksu, więc kolejne zwroty częściowe w czasie zostają legalne.';
