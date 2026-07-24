-- 0034_deposit_settlement_serialization.sql
-- ADR-072: serializacja rozliczenia kaucji, które NIE niesie zwrotu.
-- Domknięcie luki, którą 0032 zostawiła po stronie rejestru zdarzeń.
--
-- ---------------------------------------------------------------------
-- LUKA, KTÓRĄ TA MIGRACJA ZAMYKA
-- ---------------------------------------------------------------------
--
-- 0032 daje gwarancję „jeden zwrot w locie na zamówienie" i stoi ona na
-- częściowym unikacie tabeli `deposit_refunds`. Ta tabela z definicji (0031)
-- przyjmuje wyłącznie kwoty > 0 i wyłącznie obieg dostawcy, więc rozliczenie
-- SAMYM POTRĄCENIEM (kwota zwrotu = 0, potrącenie > 0) oraz całe rozliczenie
-- w obiegu RĘCZNYM jej nie dotykają: `settleDepositAction` idzie wtedy wprost
-- do `deposit_events`.
--
-- Na tej ścieżce jedyną bramką jest 0011 — advisory lock i re-check sumy.
-- Lock ORDERUJE, ale nie ODRZUCA: dwa równoległe potrącenia po 300 zł
-- z kaucji 1000 zł są dla niego OBA legalne (600 <= 1000), bo niezmiennik
-- salda nie jest naruszony. Dwuklik operatora zatrzymuje więc klientowi 600 zł
-- tam, gdzie decyzją było 300 zł — i nie zostawia w rejestrze ani jednego
-- śladu, że drugi wiersz jest pomyłką. Zatrzymanie CAŁEJ kaucji dwa razy
-- odbija 0011; częściowe przechodzi po cichu.
--
-- Kontrola negatywna na żywej bazie sprzed tej migracji (dwie sesje członków,
-- dwa równoległe INSERT-y `deducted` po 300 zł z kaucji 1000 zł):
--   błąd A=brak, błąd B=brak, wierszy deducted=2, saldo=400 zamiast 700.
--
-- To NIE jest regresja #118. #118 przeniosło potrącenie zlecane RAZEM ze
-- zwrotem ZA unikat 0032 (i tam jest bezpieczne); rozliczenie bez zwrotu
-- zostało nienazwane od 0011.
--
-- ---------------------------------------------------------------------
-- ROZSTRZYGNIĘCIE: DEKLARACJA SALDA, A NIE CLAIM „W LOCIE"
-- ---------------------------------------------------------------------
--
-- ODRZUCONE 1: rozszerzenie mechanizmu 0032 na rozliczenia bez zwrotu
-- (wiersz-claim w `deposit_refunds` zakładany na czas każdego rozliczenia).
-- Kosztuje trzy rzeczy i żadna nie jest do odrobienia później:
--
--   a) `deposit_refunds` przestaje znaczyć to, co mówi jej komentarz z 0031
--      („POPROSILIŚMY, żeby pieniądze się poruszyły"). Rozliczenie samym
--      potrąceniem nie prosi NIKOGO o NIC. Trzeba by poluzować CHECK
--      `amount_grosze > 0` i CHECK `provider in ('stripe')`, a wtedy KAŻDY
--      przyszły czytelnik tej tabeli — odnajdywanie zamówienia przez webhook
--      po `re_...`, znacznik „zwrot w toku" na ekranie zamówienia, przyszłe
--      uzgodnienie z wyciągiem dostawcy — musi pamiętać o filtrze „…ale tylko
--      te wiersze, które NAPRAWDĘ są zwrotem". Pominięty filtr nie wybucha,
--      tylko odpowiada źle,
--   b) status `requested` znaczy w 0031 „wysłaliśmy żądanie i NIE ZNAMY
--      odpowiedzi; wymaga uzgodnienia z dostawcą". Wiersz-claim rozliczenia
--      bez zwrotu w tym stanie jest zdaniem fałszywym,
--   c) awaria procesu między założeniem a domknięciem claimu zostawia wiersz
--      `requested` NA ZAWSZE. Dla zwrotu to jest cecha (jest z kim uzgadniać —
--      pieniądze mogły wyjść). Dla potrącenia to jest awaria: nie ma z kim
--      uzgadniać, a rozliczenie kaucji tego zamówienia jest zablokowane
--      dopóki ktoś ręcznie nie ruszy wiersza w bazie.
--
-- ODRZUCONE 2: unikat na `deposit_events`. Klucz naturalny potrącenia
-- (tenant, zamówienie, kind, kwota, kod powodu) NIE JEST unikatowy z zamiaru:
-- dwa potrącenia po 100 zł za uszkodzenie, zarejestrowane w odstępie doby, są
-- legalne dokładnie tak samo jak dwie raty zwrotu częściowego, których
-- 0031/0032 bronią wprost. Unikat zjadałby to DRUGIE, prawdziwe zdarzenie —
-- ta sama pomyłka, którą 0031 nazwała, odrzucając (zamówienie, kwota) jako
-- klucz idempotencji dostawcy. Unikat ograniczony czasowo jest w Postgresie
-- niewyrażalny: predykat indeksu musi być IMMUTABLE, a `now()` nie jest.
--
-- ODRZUCONE 3: sam `pg_try_advisory_xact_lock` (nieblokujący) w bramce.
-- Odrzuca wyłącznie żądania, które nachodzą na siebie w oknie TRANSAKCJI —
-- a rozliczenie bez zwrotu to jeden INSERT, czyli kilka milisekund. Realny
-- dwuklik (150-300 ms) minąłby się z tym oknem i zaksięgował dwa razy, mimo
-- że test równoległości świeciłby na zielono. Bramka zielona w teście
-- i nieobecna w produkcji jest gorsza niż jej brak.
--
-- WYBRANE: KONTROLA OPTYMISTYCZNA STANU, którą egzekwuje bramka 0011.
--
-- Rozliczenie jest decyzją podjętą WOBEC KONKRETNEGO SALDA — operator widzi
-- „saldo 1000 zł", zatrzymuje 300 i oddaje 700. Ta liczba jest przesłanką
-- decyzji, więc wiersz rejestru ją NIESIE (`expected_balance_grosze`), a
-- bramka odmawia, gdy przesłanka przestała być prawdziwa. Drugie żądanie
-- dwukliku deklaruje saldo 1000, zastaje 700 i odpada.
--
-- Dlaczego to jest SERIALIZACJA, a nie warunek w kodzie: sprawdzenie stoi
-- wewnątrz istniejącego advisory locka 0011. Dwie równoległe transakcje
-- ustawiają się na locku; przegrana czyta rejestr NOWYM snapshotem (READ
-- COMMITTED: nowe zapytanie = nowy snapshot) i widzi już ZATWIERDZONE
-- zdarzenie wygranej. Ten sam mechanizm, na którym stoi niezmiennik salda
-- od 0011 i który dowodzi test wyścigu w deposit-gates.
--
-- CO TO DAJE PONAD „JEDEN W LOCIE" Z 0032. Gwarancja 0032 wygasa w chwili
-- domknięcia żądania, więc przeciwko dwukliknięciu SEKWENCYJNEMU (drugi klik
-- po odpowiedzi na pierwszy, ze starej karty, z powrotu przeglądarki) nie
-- broni w ogóle. Deklaracja salda broni tam też: stara karta niesie stare
-- saldo. Legalne kolejne rozliczenie zostaje legalne, bo świeży ekran niesie
-- świeże saldo — dokładnie tak, jak 0032 celowo zostawia legalną kolejną ratę
-- zwrotu.
--
-- CZEGO TA MIGRACJA NIE RUSZA. Unikat `deposit_refunds_one_in_flight_per_order`
-- (0032) i cała tabela `deposit_refunds` — ani jednego znaku. Zwrot u dostawcy
-- ma nadal SWÓJ serializator, wcześniejszy niż ten: pierwszy nie dopuszcza do
-- WYJŚCIA drugiego przelewu, drugi nie dopuszcza do ZAKSIĘGOWANIA drugiego
-- rozliczenia. Dwie warstwy są tu celem, nie nadmiarem (nagłówki 0031/0032).
--
-- ---------------------------------------------------------------------
-- GRANICA: DEKLARUJE SIĘ TO, CO JESZCZE SIĘ NIE STAŁO
-- ---------------------------------------------------------------------
--
-- Kolumna jest NIEOBOWIĄZKOWA i to jest decyzja, nie ustępstwo. Wiersz
-- `refunded` księgowany PO potwierdzonym przelewie (nasz odczyt albo webhook
-- `charge.refund.updated`) deklaracji NIE NIESIE i nieść nie może: pieniądze
-- już wyszły, a bramka, która odmawia zapisu faktu dokonanego, produkuje
-- dokładnie ten stan, któremu całe Z5 ma zapobiegać („pieniądze u klienta,
-- rejestr mówi że nie"). Odmawiać wolno tylko temu, co jeszcze nie nastąpiło:
-- potrąceniu i rozliczeniu w obiegu ręcznym, zapisywanym PRZED jakimkolwiek
-- ruchem pieniędzy.
--
-- Skutkiem ubocznym jest to, że wołający, który deklaracji nie wyśle, bramki
-- nie dostanie. To jest ta sama granica, co przy 0032 (ręcznie sklecony INSERT
-- do `deposit_events` omija `deposit_refunds` całkowicie) i ten sam model
-- zagrożenia: bronimy się przed WŁASNYM dwuklikiem, nie przed członkiem
-- tenanta piszącym do PostgREST-a z palca. Autorytatywnym niezmiennikiem
-- pieniędzy pozostaje suma z 0011, obowiązująca KAŻDĄ rolę i każdą ścieżkę.
--
-- ---------------------------------------------------------------------
-- KOD BŁĘDU: 23P01
-- ---------------------------------------------------------------------
--
-- Klasa 23 (integrity_constraint_violation), kod 23P01 — ZWERYFIKOWANY na
-- żywym PostgREST-cie tego repo:
--
--   23P01 (ta bramka)          → HTTP 400, body {"code":"23P01", ...}
--   23514 (niezmiennik 0011)   → HTTP 400, body {"code":"23514", ...}
--
-- Czyli: ten sam status, co odmowa, obok której stoi — a rozróżnienie niesie
-- `error.code`, który supabase-js podaje surowym SQLSTATE. Po nim akcja panelu
-- odróżnia „stan się zmienił" od „rozliczenie przekracza pobranie", bo to są
-- DWA różne zdania do operatora i dwie różne następne czynności (odśwież ekran
-- vs popraw kwotę). Nagłówek 0011 zapowiadał dla klasy 23xxx status 409 —
-- na obecnej wersji PostgREST-a jest 400; sprostowanie zapisane tutaj, bo
-- migracji się nie przepisuje.
--
-- Dlaczego nie P0001 i nie własny P0xxx: PostgREST zjada klasę P0xxx do
-- gołego 500 bez kodu w odpowiedzi (zweryfikowane przy Zadaniu 4, nagłówek
-- 0010 — z tego powodu 0011 spłaciło dług P0012/P0013). Odmowa bez kodu jest
-- dla wołającego nierozróżnialna od awarii.
-- Dlaczego nie 40001 (serialization_failure), semantycznie najbliższy: klasa
-- 40 mapuje się na 500, czyli odmowa REGULAMINOWA szłaby do logów i monitoringu
-- jako awaria serwera. Wybór kodu jest tu funkcją mapowania PostgREST-a — tak
-- samo jak w 0011.
--
-- IDEMPOTENCJA MIGRACJI: `add column if not exists`, `drop constraint if
-- exists` + `add`, `create or replace function`. Baza lokalna bywa
-- współdzielona i dogrywana ręcznie.

-- ---------------------------------------------------------------------
-- 1. Saldo, wobec którego podjęto decyzję
-- ---------------------------------------------------------------------

alter table public.deposit_events
  add column if not exists expected_balance_grosze int;

comment on column public.deposit_events.expected_balance_grosze is
  'Saldo kaucji (w groszach), które wołający ZASTAŁ podejmując tę decyzję — przesłanka rozliczenia, nie jego wynik (ADR-072). Bramka deposit_events_gate odmawia zapisu, gdy rejestr pokazuje w tej chwili inne saldo: drugie żądanie dwukliku deklaruje saldo sprzed pierwszego. NULL = wiersz nie jest decyzją operatora podjętą wobec salda (pobranie, zwrot księgowany po potwierdzeniu przelewu) i bramki nie uruchamia.';

-- NADMIAROWA DEKLARACJA JEST ODRZUCANA, NIE ZEROWANA (wzorzec 0006/0011/0031).
-- `collected` bramki salda nie przechodzi w ogóle (pobranie może saldo
-- wyłącznie zwiększyć — 0011), więc deklaracja przy pobraniu byłaby liczbą,
-- której NIKT nigdy nie sprawdzi. Cicho zignorowana wyglądałaby jak działające
-- zabezpieczenie.
--
-- Ujemne saldo jest niereprezentowalne: niezmiennik 0011 trzyma saldo >= 0,
-- więc deklaracja ujemna jest zawsze pomyłką wołającego. Przy rodzajach
-- innych niż `collected` ta gałąź CHECK-a jest NIEOSIĄGALNA i tak ma być:
-- ograniczenia tabeli sprawdzają się PO triggerach BEFORE, więc bramka
-- odrzuci taki wiersz wcześniej, kodem 23P01 (ta sama kolejność, przez którą
-- gałąź 23505 w `bookDepositEvent` okazała się martwa — nagłówek 0031).
-- CHECK zostaje jako zdanie STRUKTURALNE: trzyma także wtedy, gdy trigger
-- zostanie wyłączony (`session_replication_role`) albo zdjęty.
--
-- `expected_balance_grosze is null` stoi JAWNIE na początku — CHECK z wynikiem
-- NULL PRZECHODZI (trójwartościowa logika SQL; ta sama pułapka, co przy
-- `reason_code` w 0011 i `provider_reference` w 0031).
alter table public.deposit_events
  drop constraint if exists deposit_events_expected_balance_shape;

alter table public.deposit_events
  add constraint deposit_events_expected_balance_shape check (
    expected_balance_grosze is null
    or (kind <> 'collected' and expected_balance_grosze >= 0)
  );

-- ---------------------------------------------------------------------
-- 2. Bramka rejestru: niezmiennik sumy (0011) + deklaracja stanu (0034)
-- ---------------------------------------------------------------------
--
-- Definicja skopiowana z 0011 W CAŁOŚCI (language, search_path, wczesne
-- wyjście dla `collected`, advisory lock, re-check sumy) — `create or replace`
-- nadpisuje także atrybuty funkcji, więc okrojona kopia po cichu zdjęłaby
-- zabezpieczenia (lekcja `app.join_waitlist` z 0011). Dołożony jest WYŁĄCZNIE
-- blok deklaracji stanu.
--
-- KOLEJNOŚĆ SPRAWDZEŃ: deklaracja PRZED sumą. Gdy rejestr ruszył się pod
-- decyzją, komunikat „rozliczenie przekracza pobraną kwotę" jest prawdziwy,
-- ale myli: zaprasza do poprawienia kwoty, podczas gdy poprawić trzeba
-- ODCZYT ekranu. Diagnoza precyzyjniejsza idzie pierwsza.
--
-- WIELE WIERSZY JEDNYM POLECENIEM (potrącenie + zwrot z jednego modalu):
-- bramka widzi wiersze wstawione wcześniej TYM SAMYM poleceniem (reguły
-- widoczności triggerów, uzasadnienie w nagłówku 0011), więc DRUGI wiersz
-- pary zastaje saldo pomniejszone już o pierwszy. Deklaracja jest z tego
-- powodu NARASTAJĄCA: potrącenie deklaruje saldo S, zwrot deklaruje S minus
-- potrącenie. Każdy wiersz mówi o saldzie, które ma zastać W SWOJEJ CHWILI —
-- i dzięki temu jest samoopisujący się, zamiast zależeć od pozycji w tablicy.

create or replace function app.deposit_events_gate() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_collected bigint;
  v_settled bigint;
begin
  -- Pobranie może saldo wyłącznie zwiększyć — bez locka i re-checku.
  if new.kind = 'collected' then
    return new;
  end if;

  -- Serializacja rozliczeń per (tenant, zamówienie). Lock zwalnia koniec
  -- transakcji; kolizja hasha kosztuje wyłącznie chwilę oczekiwania.
  perform pg_advisory_xact_lock(
    hashtextextended(new.tenant_id::text || ':deposit:' || new.order_id::text, 0)
  );

  select
    coalesce(sum(amount_grosze) filter (where kind = 'collected'), 0),
    coalesce(sum(amount_grosze) filter (where kind in ('refunded','deducted')), 0)
    into v_collected, v_settled
  from public.deposit_events
  where tenant_id = new.tenant_id and order_id = new.order_id;

  -- ADR-072: decyzja podjęta wobec salda, którego już nie ma, nie jest tą
  -- decyzją. Przegrana ścieżka dwukliku wychodzi TĘDY — bez wiersza w
  -- rejestrze i bez ani jednego grosza zatrzymanego drugi raz.
  if new.expected_balance_grosze is not null
     and v_collected - v_settled <> new.expected_balance_grosze then
    raise exception
      'Saldo kaucji zmieniło się od chwili decyzji (decyzja wobec % gr, w rejestrze % gr).',
      new.expected_balance_grosze, v_collected - v_settled
      using errcode = '23P01';
  end if;

  if v_settled + new.amount_grosze > v_collected then
    raise exception
      'Rozliczenie kaucji przekracza pobraną kwotę (pobrano % gr, rozliczono % gr, żądanie % gr).',
      v_collected, v_settled, new.amount_grosze
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function app.deposit_events_gate() is
  'Bramka rejestru kaucji: advisory lock per (tenant, zamówienie) + dwa sprawdzenia w transakcji. 1) ADR-072: wiersz z expected_balance_grosze wchodzi tylko wtedy, gdy rejestr NADAL pokazuje zadeklarowane saldo — serializuje rozliczenie niosące samo potrącenie oraz całe rozliczenie w obiegu ręcznym, których unikat 0032 nie obejmuje; rzuca 23P01. 2) ADR-026: zwroty + potrącenia nie przekroczą pobrań dla żadnej roli; rzuca 23514.';

comment on table public.deposit_events is
  'REJESTR zdarzeń kaucji (append-only): pobranie, zwrot, potrącenie. Stan kaucji to suma zdarzeń, a nie kolumna statusowa — historia rozliczenia jest tu dowodem w sporze z klientem, więc nie może być nadpisywana. Niezmiennik sumy (zwroty + potrącenia <= pobrania) egzekwuje trigger deposit_events_gate (0011, ADR-026) dla każdej roli; strukturalny powód potrącenia pilnuje CHECK deposit_events_structured_reason. Od 0031 (ADR-069) wiersz niesie OBIEG (provider) i DOWÓD u dostawcy (provider_reference): w obiegu stripe wiersz powstaje wyłącznie po ODCZYCIE potwierdzającym, nigdy z odpowiedzi na żądanie zapisu. Od 0034 (ADR-072) wiersz może nieść też PRZESŁANKĘ decyzji (expected_balance_grosze) — saldo zastane przez operatora; ta sama bramka odmawia zapisu, gdy rejestr pokazuje inne, co serializuje rozliczenia nieobjęte unikatem jednego zwrotu w locie z 0032.';
