-- 0031_deposit_provider_link.sql
-- Z5 / ADR-068: kaucja online — pobranie razem z najmem (decyzja właściciela
-- D1) i REALNY zwrot częściowym refundem tej samej transakcji (D4).
--
-- ---------------------------------------------------------------------
-- CO TA MIGRACJA ROZSTRZYGA
-- ---------------------------------------------------------------------
--
-- Rejestr `deposit_events` powstał w 0007 jako księga OPERATORA: pobrałem
-- gotówkę, oddałem gotówkę, potrąciłem za szkodę. Każdy wiersz był
-- twierdzeniem człowieka o zdarzeniu, przy którym ten człowiek był obecny.
-- Od Z3 kaucja jedzie w tym samym PaymentIntencie co najem (0029: kwota =
-- najem + kaucja + dostawa), więc pobranie i zwrot przestały być czynnością
-- człowieka, a stały się stanem U DOSTAWCY. Wiersz rejestru przestał być
-- twierdzeniem o tym, co zrobiłem — jest teraz twierdzeniem o tym, co ZROBIŁ
-- DOSTAWCA. A o tym wolno twierdzić wyłącznie po ODCZYCIE (ADR-049).
--
-- Stąd dwie kolumny i jedna tabela:
--   1. `deposit_events.provider` — czyj to obieg. Bez tego rejestr miesza
--      gotówkę w kasie z pieniędzmi na koncie dostawcy i nie da się
--      odpowiedzieć na pytanie „czy klient dostał przelew, czy tylko
--      wpisaliśmy, że dostał",
--   2. `deposit_events.provider_reference` — CO u dostawcy jest dowodem
--      tego wiersza (`pi_...` przy pobraniu, `re_...` przy zwrocie).
--      Wiersz `stripe` bez odnośnika jest niedowodliwy, więc CHECK go
--      wymaga,
--   3. `public.deposit_refunds` — rejestr ŻĄDAŃ zwrotu, osobny od rejestru
--      ZDARZEŃ (uzasadnienie niżej, sekcja 3).
--
-- ---------------------------------------------------------------------
-- CZEGO TA MIGRACJA NIE RUSZA (i dlaczego to jest ważne)
-- ---------------------------------------------------------------------
--
-- `deposit_events` zostaje APPEND-ONLY: bez grantów UPDATE/DELETE (0007),
-- z politykami wyłącznie select/insert. Bramka `app.deposit_events_gate`
-- z 0011 — advisory lock per (tenant, zamówienie), re-check sumy w
-- transakcji, saldo nieujemne — nie jest w tym pliku dotykana ani jednym
-- znakiem. To nie jest ostrożność: bramka 0011 jest jedyną warstwą, która
-- broni przed zwrotem większym niż pobranie NIEZALEŻNIE od tego, co
-- odpowie dostawca. Kaucja online dokłada drugą warstwę (dostawca też
-- odmówi nadmiarowego refundu), ale dwie warstwy są tu celem, nie
-- nadmiarem — pierwsza łapie błąd NASZ, druga cudzy.
--
-- ŻADNEGO NOWEGO `kind`. Decyzja właściciela D1 odrzuca pre-autoryzację
-- (blokadę środków) na rzecz pobrania i zwrotu, więc `authorized` nie
-- powstaje. Powód jest rynkowy, nie techniczny: BLIK i Przelewy24 —
-- metody, którymi płaci polski klient wynajmu — nie mają blokady środków
-- w ogóle. Kaucja dostępna wyłącznie przy karcie byłaby kaucją dostępną
-- dla mniejszości klientów, a najem z kaucją „tylko kartą" to najem
-- z ukrytym warunkiem. (ADR-068 rozwija: pre-autoryzacja wygasa po 7 dniach,
-- czyli w środku normalnego najmu, i wymagałaby odnawiania blokady, o
-- którym klient nie wie.)
--
-- IDEMPOTENCJA CAŁOŚCI: create table if not exists / drop ... if exists /
-- add — migracja wgrana dwa razy nie pada (baza lokalna bywa współdzielona
-- i dogrywana ręcznie).

-- ---------------------------------------------------------------------
-- 1. deposit_events: czyj obieg i co jest dowodem
-- ---------------------------------------------------------------------
--
-- DEFAULT 'manual' JEST CZĘŚCIĄ DECYZJI, NIE WYGODĄ. Wszystko, co w
-- rejestrze już leży, powstało z ręki operatora — i wszystko, co powstanie
-- z ręki operatora później, ma się nazywać tak samo. Obieg `stripe` musi
-- być WPISANY JAWNIE przez ścieżkę, która ma na to dowód; gdyby default
-- brzmiał 'stripe', pomyłka wołającego produkowałaby wiersze udające
-- potwierdzenie u dostawcy. Kierunek pomyłki wybiera się tu raz.
--
-- Konwencja text+CHECK, nie enum (0007/0013): drugi dostawca w fazie 4 to
-- zwykła migracja, bez ALTER TYPE i blokad.

alter table public.deposit_events
  add column if not exists provider text not null default 'manual';

alter table public.deposit_events
  drop constraint if exists deposit_events_provider_valid;

alter table public.deposit_events
  add constraint deposit_events_provider_valid
  check (provider in ('manual', 'stripe'));

alter table public.deposit_events
  add column if not exists provider_reference text;

comment on column public.deposit_events.provider is
  'Obieg, w którym pieniądze naprawdę się poruszyły: manual = kasa/przelew operatora (ADR-035), stripe = konto połączone najemcy (ADR-068). Default manual — obieg dostawcy wymaga JAWNEGO wpisania przez ścieżkę, która ma potwierdzenie ODCZYTEM.';
comment on column public.deposit_events.provider_reference is
  'Odnośnik u dostawcy będący DOWODEM tego wiersza: pi_... przy pobraniu (kaucja jedzie w intencie najmu — D1/D4), re_... przy zwrocie. Wymagany dla provider=stripe, zabroniony dla manual.';

-- STRUKTURALNY ODNOŚNIK, DOKŁADNIE JAK STRUKTURALNY POWÓD Z 0011.
-- Wiersz `stripe` bez odnośnika to zdanie „dostawca to zrobił" bez wskazania
-- czego — czyli anty-wzorzec notatki tekstowej w wersji groźniejszej, bo
-- dotyczy pieniędzy klienta. Nadmiarowy odnośnik przy `manual` jest
-- ODRZUCANY, nie zerowany po cichu (wzorzec 0006/0011): cisza ukryłaby błąd
-- wywołującego.
--
-- `provider_reference is not null` stoi JAWNIE przed testem długości —
-- ta sama pułapka trójwartościowej logiki, co strażnik `reason_code is not
-- null` w 0011 i `coalesce` w CHECK-ach jsonb z 0013/0014: CHECK z wynikiem
-- NULL PRZECHODZI.
alter table public.deposit_events
  drop constraint if exists deposit_events_provider_reference_shape;

alter table public.deposit_events
  add constraint deposit_events_provider_reference_shape check (
    case when provider = 'stripe'
      then provider_reference is not null
        and length(btrim(provider_reference)) between 1 and 255
      else provider_reference is null
    end
  );

-- UNIKAT ODNOŚNIKA = IDEMPOTENCJA KSIĘGOWANIA PIENIĘDZY.
--
-- Ten sam refund potrafi zostać potwierdzony DWIEMA drogami, obiema
-- legalnymi: bezpośrednim `GET /v1/refunds/{id}` z akcji panelu i
-- zdarzeniem `charge.refund.updated` z webhooka (Z4). Obie są odczytem,
-- obie mają prawo zadziałać, a dostawca nie gwarantuje, która pierwsza.
-- Bez tego unikatu drugie potwierdzenie dopisałoby DRUGI wiersz `refunded`
-- na tę samą kwotę: rejestr twierdziłby, że oddaliśmy kaucję dwa razy,
-- a bramka 0011 zapaliłaby się dopiero wtedy, gdyby suma przekroczyła
-- pobranie — czyli przy pełnym zwrocie ZAWSZE, a przy częściowym CZASEM.
-- „Czasem cicho, czasem 23514" to najgorszy możliwy kształt tej pomyłki.
--
-- Zakres: (provider, provider_reference) bez `tenant_id`. Przestrzeń
-- identyfikatorów jest DOSTAWCY i jest globalna — `re_...` należy do
-- dokładnie jednego konta połączonego. Dopisanie `tenant_id` do klucza
-- pozwoliłoby dwóm najemcom zaksięgować ten sam refund, czyli dokładnie
-- to, przed czym unikat ma bronić.
--
-- Partial index (`where provider_reference is not null`), bo obieg manual
-- odnośnika nie ma i miliony NULL-i nie mają się o co bić.
drop index if exists public.deposit_events_provider_reference_unique;

create unique index deposit_events_provider_reference_unique
  on public.deposit_events (provider, provider_reference)
  where provider_reference is not null;

comment on index public.deposit_events_provider_reference_unique is
  'Jedno zdarzenie kaucji na jeden odnośnik u dostawcy. Refund bywa potwierdzony dwiema drogami naraz (GET z panelu i webhook charge.refund.updated) — bez tego unikatu drugie potwierdzenie księgowałoby zwrot po raz drugi.';

-- 0011 zapowiadał niezmiennik w komentarzu tabeli; teraz komentarz dogania
-- także rozdział obiegów.
comment on table public.deposit_events is
  'REJESTR zdarzeń kaucji (append-only): pobranie, zwrot, potrącenie. Stan kaucji to suma zdarzeń, a nie kolumna statusowa — historia rozliczenia jest tu dowodem w sporze z klientem, więc nie może być nadpisywana. Niezmiennik sumy (zwroty + potrącenia <= pobrania) egzekwuje trigger deposit_events_gate (0011, ADR-026) dla każdej roli; strukturalny powód potrącenia pilnuje CHECK deposit_events_structured_reason. Od 0031 (ADR-068) wiersz niesie OBIEG (provider) i DOWÓD u dostawcy (provider_reference): w obiegu stripe wiersz powstaje wyłącznie po ODCZYCIE potwierdzającym, nigdy z odpowiedzi na żądanie zapisu.';

-- ---------------------------------------------------------------------
-- 2. Rejestr ŻĄDAŃ zwrotu — public.deposit_refunds
-- ---------------------------------------------------------------------
--
-- DLACZEGO OSOBNA TABELA, SKORO REJESTR ZDARZEŃ JUŻ JEST.
--
-- Bo to dwa różne zdania o świecie, a zlanie ich w jedno jest dokładnie tą
-- pomyłką, którą całe Z5 ma wykluczyć:
--
--   deposit_events  — „pieniądze SIĘ PORUSZYŁY" (fakt, potwierdzony
--                     odczytem, append-only, wchodzi do salda),
--   deposit_refunds — „POPROSILIŚMY, żeby się poruszyły" (zamiar, o
--                     zmiennym stanie, NIE wchodzi do salda).
--
-- Gdyby żądanie zwrotu miało być wierszem rejestru zdarzeń, musiałby on
-- albo wchodzić do salda przed potwierdzeniem (czyli kłamać), albo mieć
-- status i być aktualizowany (czyli zerwać append-only, na którym stoi
-- wartość dowodowa rejestru w sporze z klientem). Trzecie wyjście —
-- nietrzymanie żądania NIGDZIE — kosztuje trzy rzeczy naraz:
--
--   1. DWUKLIK NA PIENIĄDZACH. „Zwróć kaucję" wciśnięte dwa razy bez
--      trwałego śladu to dwa żądania refundu. Klucz idempotencji dostawcy
--      musiałby wtedy powstawać z (zamówienie, kwota) — a wtedy drugi,
--      LEGALNY zwrot częściowy tej samej kwoty w ciągu doby zostałby
--      po cichu zjedzony jako duplikat. Identyfikator wiersza jest kluczem
--      naturalnym: jedno żądanie = jeden klucz,
--   2. STAN POŚREDNI. `POST /v1/refunds` bardzo często odpowiada
--      `status: pending` (BLIK i P24 tak właśnie działają — pieniądze
--      wracają przez system rozliczeniowy, nie natychmiast). Operator musi
--      widzieć „zwrot w toku" po odświeżeniu strony, po wylogowaniu i
--      jutro — a nie tylko w komunikacie formularza, który zniknął,
--   3. POWÓD ODMOWY. ADR-046: porażka jest WARTOŚCIĄ do zapisania i
--      pokazania, nie ciszą. `last_error` żyje tu z tego samego powodu, co
--      w `domains` i `payment_accounts`.
--
-- Ta tabela jest też PUNKTEM ZACZEPIENIA WEBHOOKA: zdarzenie
-- `charge.refund.updated` niesie `re_...` i nic więcej. Po `re_...`
-- odnajdujemy tenanta i zamówienie tutaj, jednym trafieniem w unikat —
-- tak samo jak Z4 odnajduje zamówienie po `orders.provider_payment_intent_id`
-- (0029), a nie po polach z ciała zdarzenia.

create table if not exists public.deposit_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,

  -- Kwota ŻĄDANA, w groszach, zawsze dodatnia — jak w deposit_events (0007).
  -- Kwota FAKTYCZNIE zwrócona mieszka w deposit_events i pochodzi z odczytu;
  -- te dwie liczby mogą się różnić i wtedy prawdą jest ta druga.
  amount_grosze int not null check (amount_grosze > 0),

  provider text not null default 'stripe' check (provider in ('stripe')),

  -- `re_...` — NULL dopóki dostawca nie odpowiedział na żądanie. To jest
  -- najniebezpieczniejszy stan w całej tabeli (wysłaliśmy, nie wiemy co
  -- z tego wyszło) i dlatego ma własną nazwę statusu, a nie NULL-a
  -- udającego „nic się nie stało".
  provider_reference text
    check (provider_reference is null or length(btrim(provider_reference)) between 1 and 255),

  -- 'requested' — żądanie wysłane, odpowiedzi NIE ZNAMY (awaria sieci,
  --               timeout, restart procesu w połowie). Wymaga uzgodnienia
  --               z dostawcą, nie ponowienia w ciemno,
  -- 'pending'   — dostawca przyjął żądanie i zwrócił identyfikator.
  --               TO NIE JEST ZWROT: pieniędzy u klienta jeszcze nie ma,
  --               a rejestr zdarzeń jest w tym stanie PUSTY,
  -- 'succeeded' — ODCZYT potwierdził `succeeded`; dopiero teraz istnieje
  --               wiersz `refunded` w deposit_events,
  -- 'failed'    — dostawca odmówił albo refund upadł. ZERO wiersza
  --               w rejestrze zdarzeń, powód w last_error.
  status text not null default 'requested'
    check (status in ('requested', 'pending', 'succeeded', 'failed')),

  last_error text,

  -- Bez FK: ślad musi przetrwać usunięcie konta pracownika (wzorzec
  -- deposit_events.created_by z 0007 i courier_shipments z 0013).
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deposit_refunds_tenant_id_key unique (tenant_id, id),

  -- FK ZŁOŻONY (tenant_id, order_id) — bramka spójności tenanta, której
  -- RLS nie zapewnia (uzasadnienie: 0007, order_items_order_fk). Wiersz
  -- międzytenantowy jest niereprezentowalny niezależnie od polityk.
  constraint deposit_refunds_order_fk
    foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete cascade
);

-- Odnośnik dostawcy jest unikatowy globalnie — patrz uzasadnienie zakresu
-- przy unikacie deposit_events wyżej. Poza `create table`, bo `create table
-- if not exists` na istniejącej tabeli nie robi NIC, a na tym unikacie stoi
-- odnajdywanie zamówienia przez webhook (lekcja 0030).
drop index if exists public.deposit_refunds_provider_reference_unique;

create unique index deposit_refunds_provider_reference_unique
  on public.deposit_refunds (provider, provider_reference)
  where provider_reference is not null;

-- Indeks zaczyna się od tenant_id (konwencja 0007/0013). Po nim idzie
-- odczyt ekranu zamówienia („czy jest zwrot w toku") i sprzątanie.
create index if not exists deposit_refunds_tenant_order_idx
  on public.deposit_refunds (tenant_id, order_id, created_at desc);

comment on table public.deposit_refunds is
  'Rejestr ŻĄDAŃ zwrotu kaucji u dostawcy (Z5, ADR-068) — zamiar, nie fakt. Faktem jest dopiero wiersz refunded w deposit_events, powstały po ODCZYCIE. Ta tabela NIE wchodzi do salda kaucji. Istnieje po to, żeby: dwuklik nie wysłał dwóch refundów (id wiersza = klucz idempotencji dostawcy), stan pośredni („zwrot w toku") przeżył odświeżenie strony, a odmowa dostawcy miała trwały powód (last_error, ADR-046). Jest też punktem zaczepienia webhooka: zdarzenie charge.refund.updated niesie sam re_..., po którym odnajdujemy tu tenanta i zamówienie.';
comment on column public.deposit_refunds.status is
  'requested = wysłaliśmy żądanie i NIE ZNAMY odpowiedzi (wymaga uzgodnienia z dostawcą); pending = dostawca przyjął, pieniędzy u klienta jeszcze NIE MA, rejestr zdarzeń PUSTY; succeeded = odczyt potwierdził, wiersz refunded istnieje; failed = odmowa/upadek, ZERO wiersza i powód w last_error.';
comment on column public.deposit_refunds.amount_grosze is
  'Kwota ŻĄDANA w groszach. Kwota FAKTYCZNIE zwrócona jest w deposit_events i pochodzi z odczytu u dostawcy — przy rozjeździe prawdą jest ta druga.';
comment on column public.deposit_refunds.last_error is
  'Powód odmowy albo upadku zwrotu (wzorzec domains.last_error / payment_accounts.last_error, ADR-046). Bez sekretów — komunikat przechodzi przez redakcję klucza w porcie.';

-- ---------------------------------------------------------------------
-- 3. RLS i uprawnienia
-- ---------------------------------------------------------------------
--
-- REVOKE PRZED GRANT-em (wzorzec 0006/0007/0013/0028/0030): nowa tabela
-- rodzi się z kompletem default privileges, w tym TRUNCATE — które NIE
-- PODLEGA RLS w ogóle.
--
-- To jest tabela PER-TENANT (ma tenant_id), więc macierz izolacji łapie ją
-- automatycznie przez `listTenantTables`. Brak polityk zapaliłby harness
-- i tak ma być.

alter table public.deposit_refunds enable row level security;

revoke all on public.deposit_refunds from anon, authenticated;

-- anon: NIC. Klient storefrontu nie zleca zwrotów kaucji i nie ogląda ich
-- rejestru — zwrot jest decyzją operatora po odbiorze sprzętu.
--
-- UPDATE dla członka jest KONIECZNY, a nie wygodny: akcja panelu biegnie
-- z sesją operatora (service_role poza webhookami jest zakazane —
-- ograniczenie globalne 2 fazy), a to ona zapisuje odnośnik dostawcy
-- i wynik odczytu w tym samym wierszu, który przed chwilą założyła.
--
-- DELETE: brak grantu. Żądanie zwrotu pieniędzy klienta nie jest notatką
-- do skasowania — nawet nieudane. Kaskada z orders/tenants zostaje jedyną
-- drogą zniknięcia wiersza (wzorzec deposit_events z 0007).
grant select, insert, update on public.deposit_refunds to authenticated;
grant select, insert, update, delete on public.deposit_refunds to service_role;

drop policy if exists tenant_select on public.deposit_refunds;
drop policy if exists tenant_insert on public.deposit_refunds;
drop policy if exists tenant_update on public.deposit_refunds;

create policy tenant_select on public.deposit_refunds for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.deposit_refunds for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.deposit_refunds for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());

-- ---------------------------------------------------------------------
-- 4. updated_at
-- ---------------------------------------------------------------------
--
-- Wiersz zmienia stan trzy razy w ciągu jednego żądania (requested →
-- pending → succeeded), a przy zwrocie odroczonym — po godzinach, cudzą
-- ścieżką (webhook). „Kiedy to ostatnio ruszyło" jest tu pytaniem
-- diagnostycznym, nie ozdobą.

create or replace function app.deposit_refunds_touch() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.deposit_refunds_touch() is
  'Znacznik ostatniej zmiany żądania zwrotu kaucji (0031). Osobna funkcja, bo deposit_refunds nie przechodzi przez app.orders_write_gate.';

drop trigger if exists deposit_refunds_touch on public.deposit_refunds;

create trigger deposit_refunds_touch
  before update on public.deposit_refunds
  for each row execute function app.deposit_refunds_touch();
