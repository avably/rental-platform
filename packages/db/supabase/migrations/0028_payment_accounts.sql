-- 0028_payment_accounts.sql
-- Z2 / ADR-065: konto najemcy u dostawcy płatności (Connect Express) jako
-- OSOBNY BYT, z kolumnami stanu traktowanymi jak CACHE PREZENTACYJNY.
--
-- PUŁAPKA, OD KTÓREJ TRZEBA ZACZĄĆ. `public.tenants` ma od 0001 kolumny
-- `stripe_customer_id` i `stripe_subscription_id`. Wyglądają jak gotowe
-- miejsce na to konto i NIM NIE SĄ — należą do FAZY 4 i opisują PRZECIWNY
-- kierunek pieniędzy: najemca płaci NAM za subskrypcję SaaS. Tu chodzi
-- o pieniądze, które klient najemcy płaci NAJEMCY, a my tylko pośredniczymy.
-- Wsadzenie Connect w tamte kolumny zbiłoby dwie różne relacje finansowe
-- w jedno pole: id konta odbiorcy środków i id płatnika abonamentu żyłyby
-- pod tą samą nazwą, a faza 4 nie miałaby gdzie usiąść. Osobna tabela jest
-- DECYZJĄ (ADR-065), nie wygodą.
--
-- DRUGA RZECZ, KTÓREJ NIE WOLNO PRZEOCZYĆ: kolumny `charges_enabled`,
-- `payouts_enabled`, `details_submitted`, `requirements_due` to KOPIA ROBOCZA
-- do wyświetlenia, a nie podstawa decyzji o pieniądzach. Prawda o gotowości
-- konta mieszka u dostawcy i wolno ją poznać wyłącznie przez
-- `GET /v1/accounts/{id}` wykonany przez SERWER (reguła naczelna fazy 3,
-- ADR-049). Wiersz mówi „tak wyglądało konto o `last_synced_at`" — i tyle.
-- Dlatego zapis tych kolumn jest otwarty dla każdego członka (patrz polityki):
-- skłamana kopia prezentacyjna kosztuje mylący napis, a nie pieniądze, bo
-- każda ścieżka płatnicza i tak odczytuje stan na nowo.
--
-- TRZECIA: `charges_enabled` i `payouts_enabled` zostają ROZDZIELNE.
-- Konto `restricted` przyjmuje płatność i blokuje wypłatę — zwinięcie obu
-- w jedno „gotowe" albo zablokowałoby sprzedaż działającemu najemcy, albo
-- (gorzej) zamilczałoby o tym, że pieniądze utknęły u dostawcy.
--
-- IDEMPOTENCJA: całość przez `if not exists` / `drop ... if exists` —
-- migracja wgrana dwa razy nie pada (baza lokalna jest współdzielona między
-- sesjami i bywa dogrywana ręcznie).

-- ---------------------------------------------------------------------
-- 1. public.payment_accounts
-- ---------------------------------------------------------------------

create table if not exists public.payment_accounts (
  -- PK = tenant_id: JEDEN wiersz na najemcę. Nie „na razie jeden" — dwa
  -- konta oznaczałyby dwa możliwe cele środków dla tego samego sklepu
  -- i pytanie „na które poszły te pieniądze" bez odpowiedzi w danych.
  tenant_id uuid primary key references public.tenants(id) on delete cascade,

  -- Konwencja text+CHECK, nie enum (nagłówek 0007/0013): dołożenie drugiego
  -- dostawcy w fazie 4 to zwykła migracja, bez ALTER TYPE i blokad.
  provider text not null default 'stripe' check (provider in ('stripe')),

  -- Identyfikator konta u dostawcy (acct_...). Jedyna kolumna, która NIE jest
  -- cache'em: to ona wskazuje, o czyje pieniądze chodzi.
  provider_account_id text not null check (length(provider_account_id) between 3 and 255),

  -- --- kopia prezentacyjna stanu, ZAWSZE z odczytu ---
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,

  -- Wymagania blokujące konto TERAZ (currently_due + past_due u dostawcy).
  -- jsonb, bo lista identyfikatorów dostawcy jest jego słownikiem — własny
  -- CHECK na wartościach zamieniłby zmianę u niego w naszą awarię zapisu.
  requirements_due jsonb not null default '[]'::jsonb
    check (jsonb_typeof(requirements_due) = 'array'),

  -- Powód ostatniej nieudanej synchronizacji — wzorzec `domains.last_error`
  -- (ADR-046): porażka jest WARTOŚCIĄ do pokazania z przyciskiem ponowienia,
  -- nie ciszą. NULL = ostatni odczyt się udał.
  last_error text,

  -- Kiedy kopia powstała. Bez tej kolumny ekran nie miałby jak powiedzieć
  -- „stan sprzed trzech dni", a najemca czytałby stary napis jak bieżący.
  last_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Konto u dostawcy należy do JEDNEGO najemcy. Bez tego unikatu członek
  -- tenanta A mógłby wpisać sobie `provider_account_id` tenanta B i czytać
  -- (naszymi rękami) stan cudzego konta, a w Z3 kierować do niego płatności.
  constraint payment_accounts_provider_account_unique unique (provider, provider_account_id)
);

comment on table public.payment_accounts is
  'Konto najemcy u dostawcy płatności (Connect Express, ADR-065). OSOBNY byt od tenants.stripe_customer_id/stripe_subscription_id (0001), które należą do fazy 4 i opisują przeciwny kierunek pieniędzy. Kolumny stanu to CACHE PREZENTACYJNY z odczytu GET /v1/accounts/{id}; nigdy podstawa decyzji o pobraniu środków.';
comment on column public.payment_accounts.provider_account_id is
  'Identyfikator konta u dostawcy. Ustawiany RAZ przy zakładaniu konta; UPDATE zmieniający tę wartość jest odrzucany (23514, trigger payment_accounts_write_gate) — przepisanie jej byłoby przekierowaniem cudzych pieniędzy jednym żądaniem. Zmiana konta = usunięcie wiersza przez właściciela i ponowny onboarding.';
comment on column public.payment_accounts.charges_enabled is
  'Czy konto PRZYJMUJE płatności — kopia z ostatniego odczytu u dostawcy (last_synced_at). ADR-049: to nie jest dowód, tylko ostatnia znana migawka. Ścieżka pobrania środków (Z3) odczytuje stan na nowo.';
comment on column public.payment_accounts.payouts_enabled is
  'Czy konto WYPŁACA środki najemcy. Kolumna ROZDZIELNA od charges_enabled świadomie: konto restricted przyjmuje płatność i blokuje wypłatę, więc brak błędu przy płatności nie dowodzi, że najemca zobaczy pieniądze.';
comment on column public.payment_accounts.requirements_due is
  'Wymagania dostawcy blokujące konto TERAZ (currently_due + past_due). Tablica jsonb identyfikatorów ze słownika DOSTAWCY — bez własnego CHECK-a na wartościach, bo zmiana jego słownika nie ma być naszą awarią zapisu. Pusta lista przy koncie niegotowym znaczy „dostawca weryfikuje", nie „nic nie trzeba".';
comment on column public.payment_accounts.last_error is
  'Powód ostatniej nieudanej synchronizacji stanu (wzorzec domains.last_error, ADR-046). Trafia na ekran najemcy, więc port wycina z niego klucz API bezwarunkowo.';

-- Indeks od tenant_id daje PRIMARY KEY (jeden wiersz na najemcę), więc
-- osobnego nie zakładamy. Drugi indeks jest po (provider, provider_account_id)
-- z unikatu wyżej — tą ścieżką chodzi Z4, szukając wiersza po id konta
-- z ciała webhooka.

-- ---------------------------------------------------------------------
-- 2. RLS, granty i polityki
-- ---------------------------------------------------------------------

alter table public.payment_accounts enable row level security;

-- REVOKE PRZED GRANT-em (wzorzec 0006/0007/0024): bez tego `alter default
-- privileges` Supabase zostawia anon i authenticated komplet uprawnień,
-- w tym TRUNCATE, które NIE PODLEGA RLS.
revoke all on public.payment_accounts from anon, authenticated;
grant select, insert, update, delete on public.payment_accounts to authenticated, service_role;

-- ODCZYT: każdy członek tenanta. Stan integracji płatniczej to informacja
-- operacyjna (pracownik na ladzie musi wiedzieć, czy płatność online jest
-- dostępna), a wiersz nie zawiera żadnego sekretu — klucze API należą do
-- PLATFORMY i mieszkają w env, nie tutaj.
--
-- Superadmin NIE dostaje odczytu (jak w tenant_secrets 0024): wsparcie
-- techniczne nie potrzebuje wglądu w to, u kogo najemca ma konto.
drop policy if exists tenant_select on public.payment_accounts;
create policy tenant_select on public.payment_accounts for select
  using (tenant_id = app.tenant_id());

-- ZAŁOŻENIE KONTA: wyłącznie właściciel. To jest decyzja o tym, DOKĄD PŁYNĄ
-- PIENIĄDZE ze sklepu — najcięższa decyzja finansowa w panelu. Bramka jest
-- w bazie, a nie w interfejsie, bo PostgREST przyjmuje INSERT od każdego
-- zalogowanego członka (dokładnie ten dług zamykała 0024 dla tenant_settings).
drop policy if exists owner_insert on public.payment_accounts;
create policy owner_insert on public.payment_accounts for insert
  with check (tenant_id = app.tenant_id() and app.is_tenant_owner());

-- AKTUALIZACJA: każdy członek — ale WYŁĄCZNIE kopii prezentacyjnej, bo
-- `provider_account_id` pilnuje trigger niżej.
--
-- Decyzja świadoma, nie przeoczenie. Odświeżenie stanu konta to czynność
-- diagnostyczna („czy płatność online już działa?"), którą wykonuje ten, kto
-- akurat stoi przy ladzie. Zawężenie jej do właściciela nie ochroniłoby
-- niczego: skłamana kopia prezentacyjna kosztuje mylący napis na ekranie,
-- a nie pieniądze — każda ścieżka płatnicza odczytuje stan u dostawcy na nowo
-- (ADR-049). Cena jest znana i zapisana; korzyść — pracownik nie czeka na
-- właściciela, żeby zobaczyć, czy KYC przeszło.
drop policy if exists tenant_update on public.payment_accounts;
create policy tenant_update on public.payment_accounts for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());

-- USUNIĘCIE: właściciel. Skasowanie wiersza to odłączenie sklepu od konta
-- odbiorcy środków i jedyna droga do podpięcia innego konta.
drop policy if exists owner_delete on public.payment_accounts;
create policy owner_delete on public.payment_accounts for delete
  using (tenant_id = app.tenant_id() and app.is_tenant_owner());

-- ---------------------------------------------------------------------
-- 3. Bramka zapisu: niezmienność konta + świeżość updated_at
-- ---------------------------------------------------------------------
--
-- Polityka RLS nie umie porównać wiersza PRZED i PO (USING widzi stary,
-- WITH CHECK nowy, ale żadna nie widzi obu naraz), a właśnie tego wymaga
-- reguła „identyfikatora konta nie wolno PRZEPISAĆ". Bez niej członek
-- tenanta jednym UPDATE przez PostgREST przekierowałby przyszłe wpłaty
-- klientów na dowolne konto Connect naszej platformy. Unikat z punktu 1
-- broni tylko przed wskazaniem konta ZAJĘTEGO przez innego najemcę; ten
-- trigger domyka resztę.
--
-- Kod 23514 (check_violation) — ta sama klasa co bramki 0010/0015/0027,
-- mapowana przez PostgREST na 409. P0001 ginęłoby w gołym 500.

create or replace function app.payment_accounts_write_gate() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  if tg_op = 'UPDATE' then
    if new.provider_account_id is distinct from old.provider_account_id then
      -- Bez WARTOŚCI identyfikatorów w komunikacie: trafia on do last_error
      -- i na ekran najemcy (ta sama zasada co w porcie domen).
      raise exception
        'Identyfikatora konta płatności nie można zmienić. Usuń konto i przejdź onboarding od nowa.'
        using errcode = '23514';
    end if;

    if new.provider is distinct from old.provider then
      raise exception 'Dostawcy płatności nie można zmienić po założeniu konta.'
        using errcode = '23514';
    end if;

    -- Znacznik świeżości pisze BAZA, nie wołający: `updated_at` ustawiany
    -- z aplikacji kłamie przy każdym zapisie, który tę kolumnę pominie.
    new.updated_at := now();
  end if;

  return new;
end;
$$;

comment on function app.payment_accounts_write_gate() is
  'Bramka zapisu payment_accounts (ADR-065): provider_account_id i provider są NIEZMIENNE po założeniu konta (23514) — przepisanie ich byłoby przekierowaniem pieniędzy klientów jednym UPDATE. Ustawia też updated_at po stronie bazy.';

drop trigger if exists payment_accounts_write_gate on public.payment_accounts;
create trigger payment_accounts_write_gate
  before update on public.payment_accounts
  for each row execute function app.payment_accounts_write_gate();
