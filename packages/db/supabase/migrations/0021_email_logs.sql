-- 0021_email_logs.sql
-- Historia wysłanych e-maili (Faza 2, Zadanie 2.8) — ADR-045.
--
-- PROBLEM, KTÓRY TO ZAMYKA: wysyłka jest krokiem PO utrwalonej operacji i
-- NIGDY jej nie blokuje (ADR-033, wzorzec 8b). Powód niewysłania wracał
-- dotąd wyłącznie jako string w wyniku akcji — operator widział go raz, w
-- formularzu, po czym przepadał. Po deployu na produkcję nieudana wysyłka
-- nie zostawiała ŻADNEGO śladu: ani „czy klient dostał potwierdzenie", ani
-- „dlaczego nie". Ta migracja daje trwały rejestr obu odpowiedzi.
--
-- Zawartość:
--   1. tabela public.email_logs (per tenant, append-only),
--   2. RLS + revoke przed grantami + polityki (wzorzec 0007),
--   3. app.log_public_checkout_email() — jedyna ścieżka zapisu logu ze
--      storefrontu (anon nie dostaje grantu na tabelę).
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md, nagłówki 0007/0013):
--   * zbiory wartości to text + CHECK, nie enumy — dopisanie rodzaju
--     wiadomości to zwykła migracja bez ALTER TYPE,
--   * revoke all PRZED grantami na każdej nowej tabeli (0006/0008),
--   * FK ZŁOŻONY (tenant_id, order_id) → orders — wiersz międzytenantowy
--     jest niereprezentowalny niezależnie od polityk RLS (0007/0013),
--   * indeksy zaczynają się od tenant_id,
--   * wyłącznie standardowe SQLSTATE (22023/23503/23514) — kody P0xxx
--     PostgREST zjada do gołego 500 bez treści (nagłówek 0011).

-- ---------------------------------------------------------------------
-- 1. public.email_logs
-- ---------------------------------------------------------------------
--
-- REJESTR PRÓB, NIE SKRZYNKA NADAWCZA: wiersz powstaje po KAŻDEJ próbie
-- wysyłki — udanej ('sent' + provider_message_id od dostawcy) i nieudanej
-- ('failed' + powód). Rejestr wyłącznie udanych wysyłek nie odpowiadałby
-- na pytanie, które w ogóle wywołało to zadanie („dlaczego klient nic nie
-- dostał"), a to jest jedyny powód istnienia tej tabeli.
--
-- APPEND-ONLY (wzorzec deposit_events z 0007): brak polityk i grantów
-- UPDATE/DELETE. Historia, którą da się poprawić po fakcie, nie jest
-- dowodem na to, co wyszło do klienta.
--
-- BEZ TREŚCI WIADOMOŚCI: zapisujemy metadane (rodzaj, odbiorca, temat),
-- nigdy html/text. Treść to duplikat szablonu z @avably/emails powiększony
-- o dane osobowe klienta, rosnący z każdą wysyłką — a do diagnozy „czy i
-- dlaczego" nie jest potrzebny.
create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- NULLABLE Z ROZMYSŁEM: nie każda wiadomość dotyczy zamówienia —
  -- zaproszenie do organizacji (0003/ADR-036) nie ma z czym się związać.
  -- Kolumna bez wartości jest tu stanem legalnym, nie brakiem danych.
  order_id uuid,

  -- Rodzaje odpowiadają JEDEN DO JEDNEGO ścieżkom wysyłki w kodzie:
  --   rental_* (5)            — cykl najmu, panel: TEMPLATE_FOR_STATUS
  --                             (zamowienia/[id]/rental-email.ts),
  --   invitation              — zaproszenie do organizacji (panel/lib/email.ts),
  --   return_label,
  --   pickup_return_reminder  — zwroty (zamowienia/[id]/return-email.ts, ADR-043),
  --   checkout_confirmation,
  --   new_order_notification  — checkout storefrontu (lib/checkout/emails.ts, ADR-042).
  --
  -- checkout_confirmation jest ODDZIELNE od rental_confirmed, mimo wspólnego
  -- szablonu: to inna ścieżka (publiczna, anonowa) i inna diagnoza przy
  -- awarii. Sklejenie ich kosztowałoby dokładnie tę informację, po którą
  -- operator otwiera historię.
  kind text not null check (kind in (
    'rental_confirmed',
    'rental_ready_for_pickup',
    'rental_picked_up',
    'rental_returned',
    'rental_cancelled',
    'invitation',
    'return_label',
    'pickup_return_reminder',
    'checkout_confirmation',
    'new_order_notification'
  )),

  -- DANE OSOBOWE (ADR-045, decyzja D3): adres odbiorcy to dana osobowa w
  -- rozumieniu RODO i jest tu przetwarzany na podstawie prawnie
  -- uzasadnionego interesu (dowód wykonania umowy najmu + obsługa
  -- reklamacji „nie dostałem potwierdzenia"). Retencja: 24 miesiące od
  -- created_at, potem czyszczenie wsadowe. CZYSZCZENIA TU NIE MA I TO JEST
  -- DECYZJA: cron kasujący dane bez ekranu, na którym najemca to widzi i
  -- potwierdza, jest gorszy niż jego brak. Implementacja: faza 5 (RODO),
  -- razem z eksportem i usuwaniem danych klienta.
  recipient text not null check (length(btrim(recipient)) between 3 and 320),

  subject text not null check (length(subject) between 1 and 500),

  status text not null check (status in ('sent','failed')),

  -- Identyfikator wiadomości u dostawcy (Resend). Jest WYŁĄCZNIE przy
  -- sukcesie i tylko wtedy, gdy dostawca go zwrócił — stąd nullable nawet
  -- dla status='sent'. To jedyny uchwyt do korelacji z panelem dostawcy
  -- przy sporze „wysłaliśmy, a nie doszło".
  provider_message_id text,

  -- Powód porażki, dokładnie ten, który dziś operator widzi raz w
  -- formularzu (komunikat EmailTransportError albo błąd renderowania).
  error text,

  created_at timestamptz not null default now(),

  -- Para status ↔ kolumny wyniku. Bez tego CHECK-a dałoby się zapisać
  -- 'failed' bez powodu — czyli dokładnie ten bezużyteczny ślad, którego
  -- ta tabela ma być końcem (wzorzec strażnika reason_code z 0011).
  constraint email_logs_result_shape check (
    (status = 'sent' and error is null)
    or (status = 'failed' and provider_message_id is null and length(btrim(coalesce(error, ''))) > 0)
  ),

  -- FK ZŁOŻONY — bramka spójności tenanta, której RLS nie zapewnia
  -- (uzasadnienie: 0007, order_items_order_fk): log wskazujący zamówienie
  -- CUDZEGO tenanta jest niereprezentowalny (23503).
  --
  -- SET NULL, NIE CASCADE: usunięcie zamówienia (owner-only ścieżka naprawy
  -- pomyłki, 0007) nie może wymazać dowodu, że coś do klienta wyszło —
  -- rejestr traci wtedy powiązanie, nie wiersz. Lista kolumn `(order_id)`
  -- jest OBOWIĄZKOWA: goły `set null` zerowałby też tenant_id (not null),
  -- więc usunięcie zamówienia wywracałoby się na 23502.
  constraint email_logs_order_fk
    foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete set null (order_id)
);

-- Ekran globalny /historia-emaili: „wiadomości tenanta, od najnowszej".
create index email_logs_tenant_created_idx
  on public.email_logs (tenant_id, created_at desc);

-- Sekcja „Wysłane wiadomości" na ekranie zamówienia.
create index email_logs_tenant_order_idx
  on public.email_logs (tenant_id, order_id);

comment on table public.email_logs is
  'Historia prób wysyłki e-maili per tenant (ADR-045): sukces (sent + provider_message_id) i porażka (failed + error). APPEND-ONLY — bez grantów i polityk UPDATE/DELETE. Metadane bez treści wiadomości. order_id nullable: zaproszenie nie dotyczy zamówienia.';
comment on column public.email_logs.order_id is
  'Zamówienie, którego dotyczy wiadomość; NULL dla wiadomości spoza cyklu zamówienia (zaproszenie) oraz po usunięciu zamówienia (on delete set null — rejestr przeżywa zamówienie).';
comment on column public.email_logs.recipient is
  'Adres odbiorcy — DANA OSOBOWA (ADR-045 D3). Retencja 24 miesiące od created_at; czyszczenie wsadowe wchodzi w fazie 5 (RODO), tu celowo niezaimplementowane.';
comment on column public.email_logs.provider_message_id is
  'Identyfikator wiadomości u dostawcy poczty (Resend). NULL przy porażce oraz gdy dostawca id nie zwrócił.';
comment on column public.email_logs.error is
  'Powód niewysłania (komunikat transportu/renderowania). NOT NULL przy status=failed — pilnuje CHECK email_logs_result_shape.';

-- ---------------------------------------------------------------------
-- 2. RLS + GRANT-y
-- ---------------------------------------------------------------------

alter table public.email_logs enable row level security;

-- REVOKE PRZED GRANT-em (wzorzec 0006/0008): nowa tabela rodzi się z
-- kompletem uprawnień z default privileges, w tym z TRUNCATE, które NIE
-- PODLEGA politykom RLS.
revoke all on public.email_logs from anon, authenticated;

-- anon: NIC. Storefront pisze wyłącznie przez app.log_public_checkout_email
-- (punkt 3) — grant na tabelę wystawiłby przez PostgREST cudzą historię
-- wysyłek gołym kluczem anonimowym.
--
-- Brak UPDATE/DELETE dla KOGOKOLWIEK poza service_role to druga połowa
-- append-only (pierwsza: brak polityk niżej). RLS jest fail-closed, więc
-- brak polityki = brak dostępu — ale grant bez polityki i tak byłby
-- mylącym sygnałem w audycie uprawnień.
grant select, insert on public.email_logs to authenticated;
grant select, insert, update, delete on public.email_logs to service_role;

-- Odczyt: członek tenanta + superadmin (wzorzec 0007 — podgląd superadmina
-- idzie zwykłą sesją, RLS jest bramką, nie service-role).
create policy tenant_select on public.email_logs for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());

-- Zapis: KAŻDY członek tenanta. Wysyłka jest pracą lady (zmiana statusu,
-- etykieta zwrotna), więc log musi powstać z tej samej sesji, która wysyła
-- — inaczej ślad zostawiałby wyłącznie owner.
create policy tenant_insert on public.email_logs for insert
  with check (tenant_id = app.tenant_id());

-- ---------------------------------------------------------------------
-- 3. app.log_public_checkout_email — zapis logu ze storefrontu
-- ---------------------------------------------------------------------
--
-- STOREFRONT NIE MA KLUCZA SERVICE-ROLE (twarda konwencja) i nie dostanie
-- grantu na tabelę. Zapis idzie więc wąską funkcją SECURITY DEFINER —
-- dokładnie tym samym wzorcem, którym idzie sam checkout (app.public_checkout,
-- 0020/ADR-042): jedna funkcja, jawny zakres, zero dostępu do tabeli.
--
-- Bramki (odmowa = 22023, jak w 0020 — PostgREST przenosi ją do wołającego):
--   * rodzaj ograniczony do DWÓCH ścieżek checkoutu. Bez tego anon mógłby
--     wstrzykiwać w historię wpisy udające cykl najmu albo zaproszenie,
--   * zamówienie MUSI istnieć u tego tenanta (rozwiązanie order_number →
--     order_id dzieje się TUTAJ; wołający nigdy nie widzi order_id, więc
--     odpowiedź RPC checkoutu nie musi go nieść),
--   * limit wpisów per zamówienie — checkout wysyła najwyżej dwie
--     wiadomości, więc każdy nadmiar to nadużycie, nie użycie.
--
-- p_order_number, NIE p_order_id: numer zamówienia wołający i tak zna
-- (dostał go z checkoutu), a identyfikator wewnętrzny nie musi opuszczać
-- bazy. Numer jest unikalny w obrębie tenanta (0007).
create or replace function app.log_public_checkout_email(
  p_tenant_id uuid,
  p_order_number text,
  p_kind text,
  p_recipient text,
  p_subject text,
  p_status text,
  p_provider_message_id text default null,
  p_error text default null
) returns void
language plpgsql
security definer
as $$
declare
  v_order_id uuid;
  v_count int;
begin
  if p_kind not in ('checkout_confirmation','new_order_notification') then
    raise exception 'Nieobsługiwany rodzaj wiadomości checkoutu: %', p_kind
      using errcode = '22023';
  end if;

  select o.id into v_order_id
  from public.orders o
  where o.tenant_id = p_tenant_id and o.order_number = p_order_number;

  if v_order_id is null then
    raise exception 'Zamówienie nie istnieje w tym tenancie.'
      using errcode = '22023';
  end if;

  select count(*) into v_count
  from public.email_logs el
  where el.tenant_id = p_tenant_id and el.order_id = v_order_id;

  -- 10 przy dwóch wiadomościach na zamówienie zostawia zapas na ponowienia
  -- operatora z panelu, a odcina zalewanie rejestru skryptem.
  if v_count >= 10 then
    raise exception 'Przekroczono limit wpisów dziennika dla tego zamówienia.'
      using errcode = '22023';
  end if;

  insert into public.email_logs (
    tenant_id, order_id, kind, recipient, subject, status, provider_message_id, error
  ) values (
    p_tenant_id, v_order_id, p_kind, p_recipient, p_subject, p_status,
    p_provider_message_id, p_error
  );
end;
$$;

alter function app.log_public_checkout_email(uuid, text, text, text, text, text, text, text)
  set search_path = pg_catalog, public;

grant execute on function app.log_public_checkout_email(uuid, text, text, text, text, text, text, text)
  to anon, service_role;

comment on function app.log_public_checkout_email(uuid, text, text, text, text, text, text, text) is
  'Zapis wpisu historii wysyłki z checkoutu storefrontu (ADR-045): jedyna anonowa ścieżka do public.email_logs — anon NIE ma grantu na tabelę. Rodzaj ograniczony do checkout_confirmation|new_order_notification; order_number rozwiązywany na order_id w obrębie tenanta; limit 10 wpisów na zamówienie. Odmowy: 22023. SECURITY DEFINER.';
