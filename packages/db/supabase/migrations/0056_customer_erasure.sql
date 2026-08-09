-- 0056_customer_erasure.sql — usunięcie/anonimizacja klienta + retencja treści
-- e-maili (C2b, ADR-116; ryzyka R2 i R3 rejestru).
--
-- STAN PRZED: wypożyczalnia NIE MIAŁA żadnej ścieżki realizacji art. 17 RODO.
-- Panel potrafił klienta założyć, edytować i zbanować — nie potrafił go usunąć
-- ani zanonimizować. Każde żądanie usunięcia danych kończyło się ręcznym SQL-em
-- na produkcji, czyli operacją bez śladu, bez zasięgu i bez gwarancji, że
-- objęła WSZYSTKIE kopie danych osobowych. Druga kopia — `email_logs.body`
-- (0035/0037: pełny HTML wiadomości z imieniem, adresem i telefonem) — leżała
-- w bazie bezterminowo, bo zadania retencyjnego nie było.
--
-- STAN PO: jedna funkcja `app.erase_customer` obejmująca KAŻDĄ kopię danych
-- osobowych klienta, jedna funkcja retencyjna `app.purge_email_log_bodies`
-- i ślad w `public.audit_log` po każdej operacji.
--
-- DLACZEGO JEDNA FUNKCJA, A NIE „usuń" I „zanonimizuj" OSOBNO: rozstrzygnięcie
-- ADR-116. Operator ma JEDNĄ intencję („zrealizuj żądanie usunięcia danych"),
-- a to, czy da się usunąć wiersz, jest faktem o BAZIE, nie decyzją człowieka —
-- `orders_customer_fk` (0007) jest NO ACTION, więc klient z zamówieniem nie da
-- się skasować (23503). Funkcja wybiera więc MAKSYMALNE usunięcie, jakie jest
-- dopuszczalne: brak zamówień → twarde usunięcie wiersza; są zamówienia →
-- anonimizacja w miejscu (dane osobowe znikają, `id` i historia rozliczeniowa
-- zostają, bo obowiązek podatkowy przebija prawo do usunięcia W ZAKRESIE
-- rozliczeń). Wystawienie operatorowi wyboru między dwoma przyciskami
-- oznaczałoby, że część żądań kończy się gorszym z dwóch wyników.
--
-- DLACZEGO SECURITY DEFINER (rozstrzygnięcie ADR-116): DWIE z trzech operacji
-- są pod RLS NIEWYKONALNE Z ZAŁOŻENIA i nie chcemy tego zmieniać:
--   * `email_logs` jest APPEND-ONLY (0021: brak polityki i grantu UPDATE/DELETE
--     dla `authenticated`) — dopisanie polityki UPDATE oddałoby KAŻDEMU
--     członkowi prawo przepisywania historii wysyłki, czyli dowodu, co
--     naprawdę poszło do klienta;
--   * `audit_log` przyjmuje INSERT wyłącznie od superadmina (0004) — właściciel
--     najemcy nie ma jak zapisać własnego śladu, a bez śladu operacja jest
--     nieudowadnialna wobec organu.
-- DEFINER zamyka oba wyjątki w JEDNEJ, wąskiej operacji zamiast rozluźniać
-- polityki dla wszystkich zapytań.
--
-- CO ZASTĘPUJE RLS WEWNĄTRZ DEFINERA (bo RLS tu NIE OBOWIĄZUJE):
--   1. `v_tenant := app.tenant_id()` — najemca WYŁĄCZNIE z claimu JWT, nigdy
--      z argumentu; brak claimu → 42501 (fail-closed, dotyczy też klienta
--      z BYPASSRLS, który grantu i tak nie dostaje);
--   2. `app.is_tenant_owner()` — bramka roli czytana z tabeli `members`, nie
--      z claimu (0007), więc nieaktualny token nie podniesie uprawnień;
--   3. JAWNY filtr `tenant_id = v_tenant` w KAŻDYM zapytaniu — identyfikator
--      z żądania nigdy nie sięga cudzego wiersza; cudzy albo nieistniejący
--      identyfikator daje TĘ SAMĄ odmowę 22023 (zero wyroczni istnienia).
--
-- ZASIĘG ANONIMIZACJI — komplet kopii danych osobowych klienta w schemacie
-- (przegląd wszystkich kolumn `email|phone|name|address|nip|body|recipient`):
--   * `customers` — profil (e-mail, imię i nazwisko, telefon, firma, NIP, adres,
--     język),
--   * `orders` — MIGAWKA adresu dostawy (`delivery_address_*`); istnieje
--     wyłącznie przy `delivery_address_source='custom'`, bo CHECK
--     `orders_delivery_address_shape` wymusza NULL-e w pozostałych wypadkach,
--   * `email_logs` — `recipient` + `body` (0035/0037),
--   * `contract_documents` — `recipient` (0026),
--   * `order_notes` — wolny tekst operatora (0039),
--   * `customer_bans` — znormalizowany e-mail i telefon (0040).
-- ŚWIADOMIE NIETKNIĘTE: `email_logs.subject` — tematy są STAŁYMI nagłówkami
-- szablonu (`emailMessages(locale).rentalLifecycle[…].heading`), nie niosą
-- danych klienta, a niosą informację CO wysłano; `orders.delivery_point_*` —
-- to adres paczkomatu, czyli obiektu publicznego, potrzebny do reklamacji
-- przewozowej; `account_email_logs` — dotyczy kont operatorów, adresat trzymany
-- jako HMAC (0025).
--
-- PLIKI UMÓW SĄ POZA SQL-em: `docs/konwencje-migracji.md` zabrania kasowania
-- `storage.objects` wprost z SQL (rozjazd metadanych z plikiem). Funkcja
-- ZWRACA więc listę ścieżek PDF-ów, a bajty kasuje warstwa aplikacji przez
-- Storage API. Kolejność jest istotą poprawności: NAJPIERW baza (wiersze
-- zredagowane), POTEM pliki — odwrotna zostawiałaby skasowane umowy przy
-- nieusuniętych danych. Lista wraca przy KAŻDYM wywołaniu, także powtórnym,
-- więc przerwane sprzątanie plików domyka się ponowieniem operacji.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md):
--   * funkcje z przypiętym `search_path` (pg_catalog, public, app),
--   * `revoke all` PRZED grantami, granty minimalne (żadnego `anon`),
--   * `comment on` z kontraktem i jawną listą SQLSTATE odmów,
--   * wyłącznie standardowe SQLSTATE (42501/22023/23514) — `P0xxx` PostgREST
--     zamienia w gołe 500,
--   * BEZ nowej tabeli, więc macierz izolacji RLS nie wymaga nowych fabryk.

-- === BEGIN PROD MIGRATION 0056 ===

-- ---------------------------------------------------------------------
-- 1. Znacznik anonimizacji na public.customers
-- ---------------------------------------------------------------------
-- Karta klienta musi UMIEĆ POWIEDZIEĆ, że dane zostały usunięte — inaczej
-- operator widzi wiersz z adresem `@dane-usuniete.invalid` i nie wie, czy to
-- skutek żądania RODO, czy literówka przy zakładaniu klienta. Znacznik jest
-- też warunkiem idempotencji: powtórne wywołanie nie nadpisuje zastanych
-- danych po raz drugi i nie mnoży wpisów w dzienniku.

alter table public.customers
  add column if not exists anonymized_at timestamptz;

comment on column public.customers.anonymized_at is
  'Chwila realizacji żądania usunięcia danych (art. 17 RODO, C2b/ADR-116). NULL = klient zwykły. Ustawiane WYŁĄCZNIE przez app.erase_customer — bezpośredni zapis odbija trigger customers_erasure_gate.';

-- Znacznik bez ochrony byłby OŚWIADCZENIEM, nie dowodem: `authenticated` ma
-- tabelaryczny grant UPDATE na `customers` (0007), więc dowolny członek mógłby
-- wpisać `anonymized_at = now()` przez PostgREST BEZ usunięcia choćby jednego
-- pola i wyprodukować kartę, która kłamie, że dane usunięto. Granty kolumnowe
-- tego nie zamkną (przywilej tabelaryczny jest nadrzędny), więc bramką jest
-- trigger, a przepustką — ustawienie transakcyjne zapalane przez funkcję
-- anonimizacji. Fail-closed także dla `service_role`: jedyną drogą do znacznika
-- jest funkcja.
create or replace function app.customers_erasure_gate()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  if new.anonymized_at is distinct from old.anonymized_at
     and coalesce(current_setting('app.customer_erasure', true), '') <> 'on'
  then
    raise exception
      'Znacznika usunięcia danych nie ustawia się wprost — służy do tego wyłącznie operacja usunięcia danych klienta.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function app.customers_erasure_gate() is
  'Bramka znacznika anonimizacji (C2b, ADR-116): customers.anonymized_at zmienia się WYŁĄCZNIE w transakcji app.erase_customer (ustawienie app.customer_erasure). Odmowa: 23514.';

drop trigger if exists customers_erasure_gate on public.customers;
create trigger customers_erasure_gate
  before update on public.customers
  for each row execute function app.customers_erasure_gate();

-- ---------------------------------------------------------------------
-- 2. app.erase_customer — realizacja art. 17 w obrębie jednego najemcy
-- ---------------------------------------------------------------------

create or replace function app.erase_customer(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_tenant      uuid := app.tenant_id();
  v_email       text;
  v_anonymized  timestamptz;
  v_placeholder text;
  v_order_ids   uuid[];
  v_paths       text[];
  v_addresses   int := 0;
  v_logs        int := 0;
  v_contracts   int := 0;
  v_notes       int := 0;
  v_bans        int := 0;
  v_mode        text;
begin
  -- (1) Najemca wyłącznie z claimu. Bez claimu nie ma czego filtrować, więc
  -- jedyną poprawną odpowiedzią jest odmowa — nigdy „zrób to na wszystkich".
  if v_tenant is null then
    raise exception 'Brak kontekstu najemcy.' using errcode = '42501';
  end if;

  -- (2) Bramka roli. Usunięcie danych klienta jest nieodwracalne i obejmuje
  -- historię wysyłki, więc trzyma się tej samej granicy co polityka
  -- `tenant_delete` na `customers` (0007) i hurtowy eksport klientów (ADR-111):
  -- WŁAŚCICIEL organizacji, nie każdy członek.
  if not app.is_tenant_owner() then
    raise exception
      'Usunięcie danych klienta jest zastrzeżone dla właściciela organizacji.'
      using errcode = '42501';
  end if;

  if p_customer_id is null then
    raise exception 'Nie wskazano klienta.' using errcode = '22023';
  end if;

  -- (3) Wiersz WYŁĄCZNIE z własnego najemcy. `for update` blokuje go na czas
  -- operacji, żeby równoległa edycja karty nie wpisała danych osobowych
  -- z powrotem między czyszczeniem kopii a zapisem znacznika.
  select c.email, c.anonymized_at
    into v_email, v_anonymized
    from public.customers c
   where c.tenant_id = v_tenant
     and c.id = p_customer_id
     for update;

  -- Cudzy identyfikator i identyfikator nieistniejący dają IDENTYCZNĄ odmowę:
  -- rozróżnienie zdradzałoby, że u sąsiada taki klient istnieje.
  if not found then
    raise exception
      'Klient nie istnieje albo nie należy do Twojej organizacji.'
      using errcode = '22023';
  end if;

  -- Adres zastępczy jest DETERMINISTYCZNY (z `id`) i nieodwracalny — nie jest
  -- skrótem e-maila, bo skrót adresu daje się odgadnąć słownikiem dla znanej
  -- osoby, czyli nie byłby anonimizacją. Domena `.invalid` jest zarezerwowana
  -- (RFC 2606), więc pod ten adres nic nigdy nie wyjdzie, a determinizm
  -- utrzymuje unikat `customers_tenant_email_key` przy ponowieniu.
  v_placeholder := 'usuniety-' || replace(p_customer_id::text, '-', '') || '@dane-usuniete.invalid';

  select coalesce(array_agg(o.id), array[]::uuid[])
    into v_order_ids
    from public.orders o
   where o.tenant_id = v_tenant
     and o.customer_id = p_customer_id;

  -- Ścieżki PDF-ów wracają ZAWSZE (także przy powtórce) — to one domykają
  -- przerwane sprzątanie plików.
  select coalesce(array_agg(d.storage_path), array[]::text[])
    into v_paths
    from public.contract_documents d
   where d.tenant_id = v_tenant
     and d.order_id = any (v_order_ids);

  -- (4) Powtórka nie jest błędem ani pracą: stan docelowy już osiągnięty
  -- (wzorzec idempotencji z bana klienta, R6b). Bez wpisu w dzienniku, bo
  -- dziennik notuje ZMIANY, a tu nic się nie zmienia.
  if v_anonymized is not null then
    return jsonb_build_object(
      'mode', 'already_anonymized',
      'contract_paths', to_jsonb(v_paths),
      'orders', cardinality(v_order_ids)
    );
  end if;

  -- (5) Historia wysyłki: adresat zastąpiony, TREŚĆ skasowana. Dwa dopasowania,
  -- bo `email_logs` nie ma klucza obcego do klienta: po zamówieniach klienta
  -- ORAZ po samym adresie — wiersze osierocone przez usunięte zamówienie mają
  -- `order_id` NULL (`on delete set null`, 0021) i tylko adres je wiąże.
  update public.email_logs e
     set recipient = v_placeholder,
         body = null
   where e.tenant_id = v_tenant
     and (
       e.order_id = any (v_order_ids)
       or lower(btrim(e.recipient)) = lower(btrim(v_email))
     )
     and (e.recipient <> v_placeholder or e.body is not null);
  get diagnostics v_logs = row_count;

  update public.contract_documents d
     set recipient = v_placeholder
   where d.tenant_id = v_tenant
     and d.order_id = any (v_order_ids)
     and d.recipient <> v_placeholder;
  get diagnostics v_contracts = row_count;

  -- Migawka adresu dostawy na zamówieniu. `delivery_address_source` musi
  -- zniknąć RAZEM z polami: CHECK `orders_delivery_address_shape` dopuszcza
  -- komplet NULL-i tylko wtedy, gdy źródło też jest NULL-em. Warunek na końcu
  -- oszczędza wiersze, które migawki nie mają — inaczej anonimizacja
  -- bezpotrzebnie przesuwałaby `updated_at` całej historii klienta (a to
  -- karencja rekoncyliacji płatności, L11/ADR-104).
  update public.orders o
     set delivery_address_source = null,
         delivery_address_name = null,
         delivery_address_street = null,
         delivery_address_zip = null,
         delivery_address_city = null,
         delivery_address_phone = null
   where o.tenant_id = v_tenant
     and o.customer_id = p_customer_id
     and (o.delivery_address_source is not null
          or o.delivery_address_name is not null
          or o.delivery_address_street is not null
          or o.delivery_address_zip is not null
          or o.delivery_address_city is not null
          or o.delivery_address_phone is not null);
  get diagnostics v_addresses = row_count;

  -- Notatki operatora to JEDYNA kolumna bez schematu — wolny tekst do 10 000
  -- znaków, w którym dane osobowe potrafią siedzieć w dowolnym miejscu
  -- i w dowolnej formie. Redakcja selektywna byłaby zgadywaniem, więc notatki
  -- zamówień tego klienta ZNIKAJĄ w całości; operator jest o tym uprzedzony
  -- w oknie potwierdzenia (ADR-116).
  delete from public.order_notes n
   where n.tenant_id = v_tenant
     and n.order_id = any (v_order_ids);
  get diagnostics v_notes = row_count;

  -- Ban trzyma znormalizowany e-mail i telefon — czyli dokładnie te dane,
  -- których żąda się usunąć. Zostawienie wpisu utrzymywałoby identyfikowalną
  -- listę osób po realizacji żądania usunięcia. Twarde usunięcie klienta
  -- kasuje ban kaskadą (0040), więc anonimizacja robi to samo — dwie drogi
  -- do tego samego skutku nie mogą kończyć się różnym stanem.
  delete from public.customer_bans b
   where b.tenant_id = v_tenant
     and b.customer_id = p_customer_id;
  get diagnostics v_bans = row_count;

  if cardinality(v_order_ids) = 0 then
    -- Brak zamówień = brak obowiązku podatkowego przy tym kliencie, więc nie
    -- ma czego zachowywać: wiersz znika w całości (maksimum tego, co art. 17
    -- pozwala osiągnąć).
    delete from public.customers c
     where c.tenant_id = v_tenant
       and c.id = p_customer_id;
    v_mode := 'deleted';
  else
    -- Przepustka do znacznika obowiązuje TYLKO w tej transakcji i tylko na
    -- czas tego zapisu — gasimy ją od razu, żeby dalsze instrukcje transakcji
    -- nie mogły się na nią załapać.
    perform set_config('app.customer_erasure', 'on', true);

    update public.customers c
       set email = v_placeholder,
           full_name = null,
           phone = null,
           company_name = null,
           nip = null,
           address_street = null,
           address_zip = null,
           address_city = null,
           locale = null,
           anonymized_at = now()
     where c.tenant_id = v_tenant
       and c.id = p_customer_id;

    perform set_config('app.customer_erasure', 'off', true);
    v_mode := 'anonymized';
  end if;

  -- (6) Ślad. `subject` to identyfikator klienta, nie jego dane — wpis ma
  -- dowodzić, że operacja się odbyła, a nie przechowywać tego, co usunęła.
  -- W `details` wyłącznie LICZBY: dziennik z e-mailem klienta byłby kolejną
  -- kopią danych osobowych, tyle że w tabeli, której nie da się wyczyścić.
  insert into public.audit_log (tenant_id, actor_user_id, action, subject, details)
  values (
    v_tenant,
    auth.uid(),
    case when v_mode = 'deleted' then 'customer.erased.deleted' else 'customer.erased.anonymized' end,
    p_customer_id::text,
    jsonb_build_object(
      'zamowienia', cardinality(v_order_ids),
      'adresy_dostawy', v_addresses,
      'logi_email', v_logs,
      'umowy', v_contracts,
      'notatki', v_notes,
      'bany', v_bans,
      'pliki_umow', cardinality(v_paths)
    )
  );

  return jsonb_build_object(
    'mode', v_mode,
    'contract_paths', to_jsonb(v_paths),
    'orders', cardinality(v_order_ids),
    'delivery_addresses', v_addresses,
    'email_logs', v_logs,
    'contract_documents', v_contracts,
    'order_notes', v_notes,
    'bans', v_bans
  );
end;
$$;

comment on function app.erase_customer(uuid) is
  'Realizacja art. 17 RODO na kliencie najemcy (C2b, ADR-116). Wejście: identyfikator klienta. Wyjście: jsonb {mode: deleted|anonymized|already_anonymized, contract_paths: [ścieżki PDF do skasowania przez Storage API], liczniki}. Zasięg: customers, orders.delivery_address_*, email_logs (recipient+body), contract_documents.recipient, order_notes (usuwane), customer_bans (usuwane). SECURITY DEFINER — email_logs i audit_log są pod RLS niezapisywalne dla najemcy; wewnątrz: tenant z claimu, bramka app.is_tenant_owner(), jawny filtr tenant_id w każdym zapytaniu. Odmowy: 42501 (brak najemcy / nie właściciel), 22023 (brak lub cudzy klient).';

revoke all on function app.erase_customer(uuid) from public, anon;
grant execute on function app.erase_customer(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. app.purge_email_log_bodies — retencja treści wiadomości (R3)
-- ---------------------------------------------------------------------
-- `body` (0035) to pełny HTML wysłanej wiadomości: imię, nazwisko, adres,
-- telefon i kwoty. Metadane wysyłki (kto, co, kiedy, z jakim skutkiem) są
-- potrzebne do obsługi reklamacji przez cały okres przedawnienia; TREŚĆ jest
-- potrzebna tylko do podglądu „co dokładnie poszło", a ten interesuje
-- operatora w oknie liczonym w tygodniach. Domyślne 90 dni rozstrzyga ADR-116.
--
-- WYŁĄCZNIE service_role: retencja z natury przekracza granicę najemcy (jeden
-- przebieg czyści wszystkich), więc sesja najemcy nie może jej wywołać ani
-- przypadkiem, ani celowo. To jedyna funkcja w repo, która świadomie działa
-- ponad izolacją — dlatego nie dostaje grantu dla `authenticated`.
create or replace function app.purge_email_log_bodies(
  p_days int default 90,
  p_limit int default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_cutoff timestamptz;
  v_purged int := 0;
begin
  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'Okres retencji musi mieścić się w zakresie 1–3650 dni.'
      using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'Wielkość porcji musi mieścić się w zakresie 1–100000.'
      using errcode = '22023';
  end if;

  v_cutoff := now() - make_interval(days => p_days);

  -- Porcja z `skip locked`: przebieg nie czeka na wiersze zajęte przez
  -- równoległą anonimizację i nie blokuje jej sam. Wpis w dzienniku powstaje
  -- PER NAJEMCA — każdy ma wtedy własny, widoczny dla siebie dowód, że
  -- retencja się wykonała.
  with kandydaci as (
    select e.id
      from public.email_logs e
     where e.body is not null
       and e.created_at < v_cutoff
     order by e.created_at
     limit p_limit
     for update skip locked
  ),
  wyczyszczone as (
    update public.email_logs e
       set body = null
      from kandydaci k
     where e.id = k.id
    returning e.tenant_id
  ),
  slad as (
    insert into public.audit_log (tenant_id, actor_user_id, action, subject, details)
    select w.tenant_id,
           null,
           'retention.email_body_purged',
           null,
           jsonb_build_object('dni_retencji', p_days, 'wyczyszczone', count(*))
      from wyczyszczone w
     group by w.tenant_id
    returning 1
  )
  select count(*)::int into v_purged from wyczyszczone;

  return jsonb_build_object('purged', v_purged, 'days', p_days, 'cutoff', v_cutoff);
end;
$$;

comment on function app.purge_email_log_bodies(int, int) is
  'Retencja treści wysłanych wiadomości (C2b/R3, ADR-116): kasuje email_logs.body starsze niż p_days (domyślnie 90), metadane wysyłki zostawia nietknięte. Porcja p_limit wierszy, ślad w audit_log per najemca. SECURITY DEFINER i grant WYŁĄCZNIE dla service_role — przebieg z natury przekracza granicę najemcy. Odmowy: 22023 (parametry poza zakresem).';

revoke all on function app.purge_email_log_bodies(int, int) from public, anon, authenticated;
grant execute on function app.purge_email_log_bodies(int, int) to service_role;

-- === END PROD MIGRATION 0056 ===
