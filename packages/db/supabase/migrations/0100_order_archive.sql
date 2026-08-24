-- 0100_order_archive.sql
-- ARCHIWIZACJA ZAMÓWIEŃ (SOFT) — decyzja właściciela, ADR-242.
--
-- UWAGA WŁAŚCICIELA (z nakładki przeglądu żywego ekranu): „[/zamowienia/{id}]
-- Potrzebna możliwość usuwania zamówienia lub archiwizacji." Właściciel wybrał
-- ARCHIWIZACJĘ SOFT, NIE twarde usuwanie: zamówienie znika z aktywnej listy,
-- ale ZOSTAJE w bazie — historia, faktury, rejestr kaucji i ciągłość
-- numeracji dokumentów pozostają nietknięte, a operacja jest ODWRACALNA
-- (przywrócenie zeruje flagę).
--
-- DLACZEGO TRZECIA, NIEZALEŻNA OŚ — a nie nowa wartość order_status. orders ma
-- dwie NIEZALEŻNE osie: order_status (pending…cancelled) i payment_status
-- (0007). Filozofia tabeli mówi wprost, że „zamówienia się ANULUJE, nie
-- kasuje" (komentarz przy polityce tenant_delete, 0007). Archiwum to pytanie
-- ORTOGONALNE do obu osi: zarówno zamówienie `cancelled`, jak i `returned`
-- może zostać zarchiwizowane albo nie. Dopisanie 'archived' do CHECK-a
-- order_status skleiłoby dwa niezależne pytania w jedną kolumnę (ta sama
-- pułapka, którą 0007 opisuje przy rozdzieleniu order/payment status) i
-- zniszczyłoby informację o tym, w jakim stanie domenowym zamówienie było,
-- gdy je archiwizowano. Dlatego archiwum to OSOBNA kolumna widoczności:
-- archived_at NULL = aktywne, wartość = zarchiwizowane (i znacznik KIEDY).
--
-- BEZ ZMIAN POLITYK RLS. Archiwizacja/przywracanie to zwykły UPDATE na
-- orders, a istniejąca polityka `tenant_update` (0007) pokrywa go w całości:
--   using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id())
-- Wiersz da się zmienić WYŁĄCZNIE w obrębie własnego tenanta — tenant A nie
-- zarchiwizuje ani nie przywróci zamówienia tenanta B (dowód: goła mutacja
-- w macierzy izolacji + sonda order-archive-isolation.test.ts). Nowa kolumna
-- dziedziczy polityki orders (macierz izolacji od 0007). NIE dopisujemy ani
-- nie rozluźniamy żadnej polityki — dodanie własnej polityki UPDATE byłoby
-- zbędne i tylko poszerzyłoby powierzchnię do audytu.
--
-- BRAMKA ZAPISU (app.orders_write_gate, 0049) NIETKNIĘTA. Bramka bada zmiany
-- order_status / payment_status / payment_provider / waluty / dat; UPDATE
-- ustawiający sam archived_at nie dotyka żadnej z tych osi, więc przechodzi
-- bramkę bez zmian i wypełnia updated_at przez jej istniejącą gałąź. Archiwum
-- jest FLAGĄ WIDOCZNOŚCI — świadomie NIE bramkujemy przejść NULL↔wartość:
-- operacja jest odwracalna i nie niesie niezmiennika do ochrony (inaczej niż
-- waluta czy identyfikator płatności).
--
-- INDEKS — PARTIAL NA ZARCHIWIZOWANYCH. Aktywna lista (domyślna, gorąca
-- ścieżka: `archived_at is null`) jest obsłużona istniejącymi indeksami
-- tenanta (orders_tenant_id_idx / _dates_ / _status_ z 0007) — zarchiwizowane
-- to rzadki podzbiór, więc partial index `where archived_at is null` pokrywałby
-- WIĘKSZOŚĆ wierszy i niósł znikomą selektywność. Indeksujemy więc RZADKĄ
-- stronę: widok „Zarchiwizowane" filtruje `archived_at is not null` i sortuje
-- malejąco po czasie archiwizacji — partial index na tym predykacie jest mały
-- (tylko zarchiwizowane) i od razu podaje właściwą kolejność.

-- === BEGIN PROD MIGRATION 0100 ===

-- ---------------------------------------------------------------------
-- 1. Kolumna archived_at (trzecia oś: widoczność)
-- ---------------------------------------------------------------------
-- NULLABLE bez wartości domyślnej: NULL = aktywne (stan istniejących
-- wierszy), wartość = zarchiwizowane. `if not exists` — idempotencja.
alter table public.orders
  add column if not exists archived_at timestamptz;

comment on column public.orders.archived_at is
  'Archiwizacja SOFT zamówienia (ADR-242): NULL = aktywne (na aktywnej liście), wartość = zarchiwizowane (znika z aktywnej listy, KIEDY je zarchiwizowano). Trzecia oś NIEZALEŻNA od order_status/payment_status — ortogonalna do stanu domenowego. Odwracalna (przywrócenie = ustaw NULL). NIE dotyka faktur/kaucji/historii płatności ani numeracji — to wyłącznie flaga widoczności. Ustawiana/zerowana przez archiveOrderAction/restoreOrderAction (panel) pod RLS tenant_update (0007).';

-- ---------------------------------------------------------------------
-- 2. Indeks partial dla widoku „Zarchiwizowane"
-- ---------------------------------------------------------------------
-- Tylko zarchiwizowane wiersze (rzadka strona), w kolejności widoku
-- (najświeższa archiwizacja u góry). Aktywną listę obsługują indeksy
-- tenanta z 0007. `if not exists` — idempotencja.
create index if not exists orders_tenant_archived_idx
  on public.orders (tenant_id, archived_at desc)
  where archived_at is not null;

-- === END PROD MIGRATION 0100 ===
