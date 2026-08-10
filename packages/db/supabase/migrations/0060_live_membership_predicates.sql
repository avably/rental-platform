-- 0060_live_membership_predicates.sql
-- Predykaty LIVE w RLS: cofnięte członkostwo i cofnięty superadmin działają
-- natychmiast, bez czekania na wygaśnięcie tokenu (R12a, audyt H-01, ADR-126).
--
-- STAN PRZED: `app.tenant_id()` i `app.is_superadmin()` (0001_core.sql:90-103)
-- czytają WYŁĄCZNIE claimy JWT, wypełniane raz, przy wystawieniu tokenu
-- (hook `app.custom_access_token`, 0003_auth.sql). Usunięcie wiersza
-- z `public.members` albo z `app.superadmins` nie unieważnia już wydanego
-- tokenu: żyje on do `exp` (3600 s, config.toml) i przez ten czas PRZECHODZI
-- PRZEZ KAŻDĄ politykę opartą o te dwie funkcje. Guard panelu tego nie łata,
-- bo omija go zarówno surowy PostgREST (anon key jedzie do przeglądarki,
-- sesja siedzi w ciasteczku, rola `authenticated` ma granty na tabelach
-- tenanckich), jak i Storage — a tam leżą umowy PDF z danymi osobowymi
-- klientów. Były członek ma komplet: URL, klucz publiczny i ważny JWT.
--
-- STAN PO: dwie bezparametrowe funkcje pytające ŹRÓDŁO PRAWDY, nie claim:
--   * app.is_current_tenant_member() — czy auth.uid() jest DZIŚ członkiem
--     tenanta wskazanego przez claim,
--   * app.is_current_superadmin()    — czy auth.uid() ma DZIŚ wiersz
--     w app.superadmins,
-- wpięte w komplet 125 polityk (152 wyrażenia USING/WITH CHECK) na
-- 34 tabelach `public`, `storage.objects` i `app.superadmins`, plus w dwie
-- funkcje bramkujące upload do Storage. Dodatkowo `app.is_tenant_owner()`
-- awansuje na SECURITY DEFINER i wchodzi w miejsce 16 kopii inline'owego
-- EXISTS (uzasadnienie niżej, przy rekurencji). Cofnięcie uprawnień działa od
-- następnego zapytania, bez odświeżania tokenu i bez unieważniania sesji.
--
-- DLACZEGO BEZPARAMETROWE, A NIE `is_current_tenant_member(p_tenant_id)`
-- (dosłowne zalecenie audytu). To jedyny szczegół dzielący „za darmo" od
-- „wyraźnie wolniej". Argument brany z KOLUMNY czyni podzapytanie
-- SKORELOWANYM, więc funkcja — która nie podlega inliningowi, bo jest
-- SECURITY DEFINER — wykonuje się RAZ NA WIERSZ: lista 5 000 zamówień to
-- 5 000 wywołań. Wersja bezparametrowa jest logicznie równoważna, bo warunek
-- `tenant_id = app.tenant_id()` i tak przypina wiersz do tenanta z claimu,
-- a predykat odpowiada na pytanie „czy TEN tenant nadal jest mój". W politykach
-- jest owinięta w `(select …)`, więc planer robi z niej InitPlan — JEDNO
-- wykonanie na całe zapytanie, niezależnie od liczby wierszy.
--
-- DLACZEGO SECURITY DEFINER JEST OBOWIĄZKOWY — I CO SIĘ NAPRAWDĘ DZIEJE BEZ
-- NIEGO (zmierzone, bo zalecenie audytu przewidywało co innego). Audyt i
-- rekomendacja zakładały, że wariant INVOKER skończy się błędem 42P17
-- („infinite recursion detected in policy"). Pomiar na lokalnym Postgresie
-- 17.6 pokazał inny, GORSZY przebieg:
--   * dla użytkownika BEZ członkostwa predykat po prostu zwraca false — cicho,
--     bez żadnego błędu;
--   * dla PRAWDZIWEGO członka zapytanie wywala się na `54001 stack depth limit
--     exceeded` po ~766 ramkach rekurencji, co na zewnątrz wygląda jak HTTP 500
--     na każdym żądaniu panelu i Storage.
-- Powód rozbieżności: funkcja z przypiętym `search_path` NIE PODLEGA
-- inliningowi, więc pętla domyka się dopiero w RUNTIME (wywołanie funkcji →
-- polityka → wywołanie funkcji), a nie przy planowaniu — a detektor 42P17
-- działa na etapie rozwijania planu. SECURITY DEFINER przecina to u źródła:
-- funkcja działa z uprawnieniami właściciela (`postgres`), który jest
-- właścicielem obu tabel i ma `rolbypassrls`, a repo NIGDZIE nie używa
-- `force row level security`. Ten sam wzorzec chroni już
-- `app.custom_access_token` (0003) i `app.verify_api_key` (0053).
--
-- SKĄD ZATEM BIERZE SIĘ 42P17 (i dlaczego ta migracja rusza owner-checki).
-- Prawdziwe 42P17 nie ma źródła w predykacie, tylko w konstrukcji z 0001:
-- polityki NA `public.members` zawierały inline `exists (select 1 from
-- public.members m … role = 'owner')`, czyli odwołanie do members wewnątrz
-- polityki na members. Na `main` to nie rekurencjowało. Zaczyna, gdy polityka
-- SELECT na members dostaje PODZAPYTANIE `(select …)` — czyli dokładnie wtedy,
-- gdy wpinamy tam predykat live. Zmierzona macierz (INSERT do members jako
-- członek):
--   inline EXISTS + stara polityka SELECT      → OK
--   inline EXISTS + nowa polityka SELECT       → 42P17
--   bez inline EXISTS + nowa polityka SELECT   → OK
-- Dlatego 0060 USUWA inline EXISTS z polityk i nazywa go istniejącą bramką
-- `app.is_tenant_owner()` — a tę awansuje na SECURITY DEFINER, żeby wywołanie
-- z polityki na members nie wchodziło ponownie w RLS members.
--
-- GDZIE PREDYKAT ŚWIADOMIE NIE TRAFIA:
--   1. Do wnętrza `app.is_tenant_owner()`. Ta bramka SAMA czyta members na
--      żywo, więc poziom ownera nigdy nie był dziurawy — predykat członkostwa
--      stoi obok niej, nie w niej.
--   2. Do atomu `d.tenant_id = app.tenant_id()` wewnątrz `not exists`
--      w polityce `storage.objects.rental_contracts_own_orphan_delete`.
--      Dodanie go TAM odwróciłoby sens warunku: przy braku członkostwa
--      podzapytanie byłoby puste, więc `NOT EXISTS` stałby się prawdą i człon
--      ROZLUŹNIŁBY politykę zamiast ją zacieśnić. Predykat wisi na członie
--      nadrzędnym, gdzie zamyka dostęp.
--   3. Do polityk publicznych/anonimowych sklepu
--      (`product_images_public_read`, `site_images_public_read`,
--      `plans.authenticated_select`). Nie dotyczą członkostwa; dla roli `anon`
--      `app.tenant_id()` i tak jest NULL, więc żaden człon tenantowy nie
--      przechodzi ani przed zmianą, ani po niej.
--
-- DLACZEGO PREDYKAT STOI TAKŻE PRZY POLITYKACH OWNERA, GDZIE JEST NADMIAROWY.
-- `app.is_tenant_owner()` (0007) już dziś czyta members na żywo, więc poziom
-- ownera nie był dziurawy. Predykat i tak tam wchodzi — po to, by inwariant
-- „każde wyrażenie polityki dotykające app.tenant_id() zawiera też
-- app.is_current_tenant_member()" dał się sprawdzić MECHANICZNIE, jednym
-- zapytaniem do pg_policies, bez czytania 125 polityk okiem. Blok kontrolny
-- na końcu tej migracji ten inwariant egzekwuje i wywraca migrację, gdyby
-- rewrite był niekompletny.
--
-- CO SIĘ ZMIENIA W `app.is_tenant_owner()` I DLACZEGO TO BEZPIECZNE:
--   * SECURITY INVOKER → SECURITY DEFINER. Wymuszone przez powyższą analizę
--     rekurencji: bramka jest teraz wołana także z polityk NA `public.members`.
--     Uzasadnienie bezpieczeństwa z 0007 zostaje w mocy — funkcja jest
--     BEZPARAMETROWA i na sztywno przypięta do `app.tenant_id()` oraz
--     `auth.uid()`, więc wywołana wprost nie mówi nic o cudzych tenantach,
--     odpowiada wyłącznie na pytanie „czy JA jestem właścicielem SWOJEGO
--     tenanta z claimu". Jedyny jej konsument poza politykami,
--     `app.erase_customer` (0056), jest sam SECURITY DEFINER i wołał ją już
--     dotąd z podniesionymi prawami — tam nie zmienia się nic.
--   * Wywołania w politykach owinięte w `(select …)`. Dotąd stało tam gołe
--     `app.is_tenant_owner()`, liczone PER WIERSZ (funkcja ma przypięty
--     search_path, więc nie podlega inliningowi). Po zmianie to InitPlan —
--     19 polityk przestaje wołać ją raz na wiersz.
--   * 16 kopii inline'owego EXISTS znika na rzecz jednej nazwanej bramki.
--     To jest dokładnie ten sam argument, którym 0007 uzasadniało powstanie
--     `app.is_tenant_owner()`: „rozjazd między kopiami to cicha dziura".
--
-- ZNANY, ZAMIERZONY SKUTEK — UŻYTKOWNIK W DWÓCH ORGANIZACJACH. Hook wybiera
-- do claimu NAJSTARSZE członkostwo. Użytkownik należący do A i B, usunięty
-- z A, niesie w tokenie `tenant_id = A`, którego nie jest już członkiem —
-- i od tej chwili nie widzi NICZEGO, także danych B, aż do odświeżenia
-- tokenu (≤3600 s), po którym hook wskaże B. To jest zachowanie POPRAWNE
-- (utrata dostępu do A jest właśnie celem zmiany), ale zauważalne jako
-- „pusty panel do czasu przelogowania". Domknięcie tej luki użyteczności
-- należy do R12b (unieważnianie sesji wyzwalaczem), nie tutaj.
--
-- CZEGO TA MIGRACJA NIE ZAŁATWIA: sesji jako takiej. Token pozostaje ważny
-- do `exp` i nadal przechodzi przez `auth`; zamykamy dostęp DO DANYCH, a nie
-- samą sesję. Odbieranie sesji wyzwalaczem `AFTER DELETE` oraz guard panelu
-- czytający rolę z bazy zamiast z claimu to R12b (obrona w głąb).
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): brak nowych tabel, więc
-- bez zmian w macierzy izolacji i bez fabryk w seed-tenants.ts; funkcje
-- z przypiętym search_path; `revoke all` przed grantami; żadnych nowych
-- indeksów — oba predykaty trafiają w klucz główny
-- (`public.members(tenant_id,user_id)`, `app.superadmins(user_id)`).

-- ---------------------------------------------------------------------
-- 1. Predykaty live
-- ---------------------------------------------------------------------

create or replace function app.is_current_tenant_member() returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select exists (
    select 1
    from public.members m
    where m.tenant_id = app.tenant_id()
      and m.user_id = auth.uid()
  )
$$;

comment on function app.is_current_tenant_member() is
  'R12a/H-01: czy auth.uid() jest DZIŚ członkiem tenanta z claimu JWT. '
  'Bezparametrowa celowo — argument z kolumny dałby podzapytanie skorelowane '
  'i wywołanie per wiersz. W politykach używać WYŁĄCZNIE jako '
  '(select app.is_current_tenant_member()) — wtedy planer robi InitPlan. '
  'SECURITY DEFINER jest wymagany: INVOKER zapętla RLS na public.members (42P17).';

create or replace function app.is_current_superadmin() returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select exists (
    select 1
    from app.superadmins s
    where s.user_id = auth.uid()
  )
$$;

comment on function app.is_current_superadmin() is
  'R12a/H-01: czy auth.uid() ma DZIŚ wiersz w app.superadmins (zamiast claimu '
  'app_metadata.superadmin). W politykach WYŁĄCZNIE jako '
  '(select app.is_current_superadmin()). SECURITY DEFINER wymagany: INVOKER '
  'zapętla RLS na app.superadmins (42P17).';

revoke all on function app.is_current_tenant_member() from public, anon;
revoke all on function app.is_current_superadmin() from public, anon;
grant execute on function app.is_current_tenant_member() to authenticated, service_role;
grant execute on function app.is_current_superadmin() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1b. app.is_tenant_owner() — awans na SECURITY DEFINER
-- ---------------------------------------------------------------------
-- Ciało bez zmian (0007). Zmienia się WYŁĄCZNIE tryb wykonania, bo od tej
-- migracji bramka jest wołana także z polityk NA `public.members`, gdzie
-- wariant INVOKER wchodziłby ponownie w RLS tej samej tabeli. Uzasadnienie
-- bezpieczeństwa i brak nowej powierzchni — patrz nagłówek.

create or replace function app.is_tenant_owner() returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select exists (
    select 1
    from public.members m
    where m.tenant_id = app.tenant_id()
      and m.user_id = auth.uid()
      and m.role = 'owner'
  )
$$;

comment on function app.is_tenant_owner() is
  'Czy auth.uid() jest właścicielem tenanta z claimu JWT. Od 0060 SECURITY '
  'DEFINER: bramka jest wołana z polityk na public.members, gdzie INVOKER '
  'wchodziłby ponownie w RLS tej samej tabeli. W politykach WYŁĄCZNIE jako '
  '(select app.is_tenant_owner()) — bez owijki liczy się per wiersz.';

revoke all on function app.is_tenant_owner() from public, anon;
grant execute on function app.is_tenant_owner() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Bramki uploadu do Storage — predykat wchodzi DO WNĘTRZA funkcji
-- ---------------------------------------------------------------------
-- Polityki `product_images_tenant_insert` i `site_images_tenant_insert`
-- (0038) nie wymieniają `app.tenant_id()` we własnym wyrażeniu — sięgają po
-- niego POŚREDNIO, przez te dwie funkcje. Czysto tekstowe wyszukanie polityk
-- „opartych o app.tenant_id()" ich NIE ZNAJDUJE, a bez tej poprawki zostałaby
-- realna, choć wąska dziura: były członek z ważnym tokenem i biletem uploadu
-- wystawionym przed odebraniem dostępu mógłby jeszcze wgrać plik (bilet żyje
-- 15 minut). Predykat jest tu wołany bez owijki `(select …)`: funkcja i tak
-- dostaje argument z kolumny, więc liczy się per wiersz, a INSERT obiektu
-- Storage to jeden wiersz.

create or replace function app.can_upload_product_image(p_storage_path text) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select exists (
    select 1
    from public.product_image_uploads u
    join public.products p
      on p.tenant_id = u.tenant_id
     and p.id = u.product_id
    where u.storage_path = p_storage_path
      and u.tenant_id = app.tenant_id()
      and u.requested_by = auth.uid()
      and u.status = 'pending'
      and u.expires_at > clock_timestamp()
  )
  and app.is_current_tenant_member();
$$;

create or replace function app.can_upload_site_image(p_storage_path text) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select exists (
    select 1
    from public.site_image_uploads u
    join public.sites s
      on s.tenant_id = u.tenant_id
     and s.id = u.site_id
    where u.storage_path = p_storage_path
      and u.tenant_id = app.tenant_id()
      and u.requested_by = auth.uid()
      and u.status = 'pending'
      and u.expires_at > clock_timestamp()
  )
  and app.is_current_tenant_member();
$$;

-- ---------------------------------------------------------------------
-- 3. Przepisanie polityk (125 polityk, 152 wyrażenia USING/WITH CHECK)
-- ---------------------------------------------------------------------
-- `alter policy`, nie drop+create: polityka ani na moment nie znika, więc
-- nie ma okna, w którym tabela stoi bez reguły. Wszystko w jednej
-- transakcji migracji.
--
-- Reguła przepisania, stosowana na ATOMACH wyrażenia (kształt zdania
-- logicznego zostaje nietknięty):
--   `X = app.tenant_id()`  →  `X = app.tenant_id() and (select app.is_current_tenant_member())`
--   `app.is_superadmin()`  →  `(select app.is_current_superadmin())`
--
-- Predykat członkostwa MUSI wisieć przy członie tenantowym, a nie na całości
-- wyrażenia. Przy kształcie `tenant_id = app.tenant_id() or app.is_superadmin()`
-- doklejenie `and (select app.is_current_tenant_member())` na końcu ODEBRAŁOBY
-- dostęp superadminowi, który członkiem tego tenanta nie jest i nigdy nie był.

-- app.superadmins
alter policy own_or_superadmin_select on app.superadmins
  using (
    user_id = auth.uid()
    or (select app.is_current_superadmin())
  );

-- public.account_email_logs
alter policy superadmin_select on public.account_email_logs
  using (
    (select app.is_current_superadmin())
  );

-- public.api_keys
alter policy tenant_insert on public.api_keys
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_select on public.api_keys
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.api_keys
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );

-- public.audit_log
alter policy superadmin_insert on public.audit_log
  with check (
    (select app.is_current_superadmin())
    and actor_user_id = auth.uid()
  );
alter policy tenant_select on public.audit_log
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );

-- public.contract_documents
alter policy tenant_insert on public.contract_documents
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and created_by = auth.uid()
  );
alter policy tenant_select on public.contract_documents
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );

-- public.courier_shipments
alter policy tenant_delete on public.courier_shipments
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_insert on public.courier_shipments
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.courier_shipments
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.courier_shipments
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.custom_field_definitions
alter policy tenant_insert on public.custom_field_definitions
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_select on public.custom_field_definitions
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.custom_field_definitions
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );

-- public.customer_bans
alter policy tenant_delete on public.customer_bans
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_insert on public.customer_bans
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.customer_bans
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );

-- public.customers
alter policy tenant_delete on public.customers
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_insert on public.customers
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.customers
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.customers
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.deposit_events
alter policy tenant_insert on public.deposit_events
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.deposit_events
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );

-- public.deposit_refunds
alter policy tenant_insert on public.deposit_refunds
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.deposit_refunds
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.deposit_refunds
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.domains
alter policy tenant_delete on public.domains
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_insert on public.domains
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.domains
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.domains
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.email_logs
alter policy tenant_insert on public.email_logs
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.email_logs
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );

-- public.invitations
alter policy tenant_delete on public.invitations
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_insert on public.invitations
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_select on public.invitations
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.invitations
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );

-- public.members
alter policy tenant_delete on public.members
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_insert on public.members
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_select on public.members
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.members
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );

-- public.order_items
alter policy tenant_delete on public.order_items
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_insert on public.order_items
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.order_items
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.order_items
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.order_notes
alter policy tenant_delete on public.order_notes
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_insert on public.order_notes
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.order_notes
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.order_notes
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.orders
alter policy tenant_delete on public.orders
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_insert on public.orders
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.orders
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.orders
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.payment_accounts
alter policy owner_delete on public.payment_accounts
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy owner_insert on public.payment_accounts
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_select on public.payment_accounts
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_update on public.payment_accounts
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.pickup_locations
alter policy tenant_delete on public.pickup_locations
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_insert on public.pickup_locations
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.pickup_locations
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.pickup_locations
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.pricing_tiers
alter policy tenant_delete on public.pricing_tiers
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_insert on public.pricing_tiers
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.pricing_tiers
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.pricing_tiers
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.product_images
alter policy tenant_delete on public.product_images
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_insert on public.product_images
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.product_images
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.product_images
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.product_units
alter policy tenant_delete on public.product_units
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_insert on public.product_units
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.product_units
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.product_units
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.products
alter policy tenant_delete on public.products
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_insert on public.products
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.products
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.products
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.review_comment_attachments
alter policy superadmin_delete on public.review_comment_attachments
  using (
    (select app.is_current_superadmin())
  );
alter policy superadmin_insert on public.review_comment_attachments
  with check (
    (select app.is_current_superadmin())
  );
alter policy superadmin_select on public.review_comment_attachments
  using (
    (select app.is_current_superadmin())
  );
alter policy superadmin_update on public.review_comment_attachments
  using (
    (select app.is_current_superadmin())
  )
  with check (
    (select app.is_current_superadmin())
  );

-- public.review_comments
alter policy superadmin_delete on public.review_comments
  using (
    (select app.is_current_superadmin())
  );
alter policy superadmin_insert on public.review_comments
  with check (
    (select app.is_current_superadmin())
  );
alter policy superadmin_select on public.review_comments
  using (
    (select app.is_current_superadmin())
  );
alter policy superadmin_update on public.review_comments
  using (
    (select app.is_current_superadmin())
  )
  with check (
    (select app.is_current_superadmin())
  );

-- public.site_sections
alter policy tenant_delete on public.site_sections
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_insert on public.site_sections
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.site_sections
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.site_sections
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.sites
alter policy tenant_delete on public.sites
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_insert on public.sites
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.sites
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.sites
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.subscriptions
alter policy superadmin_insert on public.subscriptions
  with check (
    (select app.is_current_superadmin())
  );
alter policy superadmin_update on public.subscriptions
  using (
    (select app.is_current_superadmin())
  )
  with check (
    (select app.is_current_superadmin())
  );
alter policy tenant_delete on public.subscriptions
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_insert on public.subscriptions
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_select on public.subscriptions
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.subscriptions
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );

-- public.tenant_secrets
alter policy owner_delete on public.tenant_secrets
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy owner_insert on public.tenant_secrets
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy owner_update on public.tenant_secrets
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_select on public.tenant_secrets
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.tenant_settings
alter policy owner_insert on public.tenant_settings
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy owner_update on public.tenant_settings
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_delete on public.tenant_settings
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_select on public.tenant_settings
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );

-- public.tenants
alter policy own_select on public.tenants
  using (
    (id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy superadmin_delete on public.tenants
  using (
    (select app.is_current_superadmin())
  );
alter policy superadmin_insert on public.tenants
  with check (
    (select app.is_current_superadmin())
  );
alter policy superadmin_update on public.tenants
  using (
    (select app.is_current_superadmin())
  )
  with check (
    (select app.is_current_superadmin())
  );

-- public.usage_counters
alter policy tenant_delete on public.usage_counters
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
    and (select app.is_tenant_owner())
  );
alter policy tenant_insert on public.usage_counters
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy tenant_select on public.usage_counters
  using (
    (tenant_id = app.tenant_id() and (select app.is_current_tenant_member()))
    or (select app.is_current_superadmin())
  );
alter policy tenant_update on public.usage_counters
  using (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  )
  with check (
    tenant_id = app.tenant_id()
    and (select app.is_current_tenant_member())
  );

-- public.waitlist_signups
alter policy superadmin_select on public.waitlist_signups
  using (
    (select app.is_current_superadmin())
  );

-- storage.objects
alter policy product_images_tenant_delete on storage.objects
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (app.tenant_id())::text
    and (select app.is_current_tenant_member())
  );
alter policy rental_contracts_own_orphan_delete on storage.objects
  using (
    bucket_id = 'rental-contracts'
    and ((storage.foldername(name))[1])::uuid = app.tenant_id()
    and (select app.is_current_tenant_member())
    and owner = auth.uid()
    and not exists (
      select 1
      from public.contract_documents d
      where d.tenant_id = app.tenant_id()
        and d.storage_path = objects.name
    )
  );
alter policy rental_contracts_tenant_insert on storage.objects
  with check (
    bucket_id = 'rental-contracts'
    and ((storage.foldername(name))[1])::uuid = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy rental_contracts_tenant_select on storage.objects
  using (
    bucket_id = 'rental-contracts'
    and ((storage.foldername(name))[1])::uuid = app.tenant_id()
    and (select app.is_current_tenant_member())
  );
alter policy review_attachments_superadmin_delete on storage.objects
  using (
    bucket_id = 'review-attachments'
    and (select app.is_current_superadmin())
  );
alter policy review_attachments_superadmin_insert on storage.objects
  with check (
    bucket_id = 'review-attachments'
    and (select app.is_current_superadmin())
  );
alter policy review_attachments_superadmin_select on storage.objects
  using (
    bucket_id = 'review-attachments'
    and (select app.is_current_superadmin())
  );
alter policy site_images_tenant_delete on storage.objects
  using (
    bucket_id = 'site-images'
    and (storage.foldername(name))[1] = (app.tenant_id())::text
    and (select app.is_current_tenant_member())
  );

-- ---------------------------------------------------------------------
-- 4. Blok kontrolny — migracja WYWRACA SIĘ, gdy rewrite jest niekompletny
-- ---------------------------------------------------------------------
-- Rewrite 125 polityk robiony ręcznie zawsze może zgubić jedną. Pominięta
-- polityka nie daje żadnego objawu — po prostu zostaje cicha dziura, która
-- wygląda jak naprawa. Dlatego kompletności nie sprawdza tu recenzent
-- czytający diff, tylko baza, w tej samej transakcji co zmiana.

do $$
declare
  v_count  int;
  v_detail text;
begin
  -- 4a. Żadna polityka nie może już pytać claimu o superadmina.
  select count(*), coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname, ', '), '')
    into v_count, v_detail
  from pg_policies
  where schemaname in ('public', 'app', 'storage')
    and (coalesce(qual, '') like '%app.is_superadmin()%'
      or coalesce(with_check, '') like '%app.is_superadmin()%');
  if v_count > 0 then
    raise exception 'R12a/H-01: % wyrażeń nadal woła app.is_superadmin() (claim JWT): %',
      v_count, v_detail;
  end if;

  -- 4b. Każde wyrażenie dotykające app.tenant_id() musi też mieć predykat live.
  --     Sprawdzane per WYRAŻENIE (osobno USING, osobno WITH CHECK), nie per
  --     polityka — inaczej poprawny USING maskowałby pominięty WITH CHECK.
  select count(*), coalesce(string_agg(what, ', '), '')
    into v_count, v_detail
  from (
    select schemaname || '.' || tablename || '.' || policyname || ' [using]' as what
    from pg_policies
    where schemaname in ('public', 'app', 'storage')
      and qual like '%app.tenant_id()%'
      and qual not like '%app.is_current_tenant_member()%'
    union all
    select schemaname || '.' || tablename || '.' || policyname || ' [with check]'
    from pg_policies
    where schemaname in ('public', 'app', 'storage')
      and with_check like '%app.tenant_id()%'
      and with_check not like '%app.is_current_tenant_member()%'
  ) t;
  if v_count > 0 then
    raise exception 'R12a/H-01: % wyrażeń przypina wiersz do claimu app.tenant_id() BEZ predykatu live: %',
      v_count, v_detail;
  end if;

  -- 4c. Pośrednie bramki uploadu (nie widać ich w tekście polityk).
  select count(*)
    into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and p.proname in ('can_upload_product_image', 'can_upload_site_image')
    and pg_get_functiondef(p.oid) like '%app.is_current_tenant_member()%';
  if v_count <> 2 then
    raise exception 'R12a/H-01: bramki uploadu Storage bez predykatu live (znaleziono %/2)', v_count;
  end if;

  -- 4d. Wszystkie trzy bramki MUSZĄ być SECURITY DEFINER i STABLE. INVOKER
  --     kończy się rekurencją (54001 albo 42P17, zależnie od ścieżki),
  --     VOLATILE zabiłoby InitPlan.
  select count(*)
    into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and p.proname in ('is_current_tenant_member', 'is_current_superadmin', 'is_tenant_owner')
    and p.prosecdef
    and p.provolatile = 's';
  if v_count <> 3 then
    raise exception 'R12a/H-01: bramki nie są SECURITY DEFINER + STABLE (znaleziono %/3)', v_count;
  end if;

  -- 4e. Bramki nie mogą być wykonywalne przez anon ani PUBLIC.
  if has_function_privilege('anon', 'app.is_current_tenant_member()', 'execute')
     or has_function_privilege('anon', 'app.is_current_superadmin()', 'execute')
     or has_function_privilege('anon', 'app.is_tenant_owner()', 'execute') then
    raise exception 'R12a/H-01: rola anon ma EXECUTE na bramkach RLS';
  end if;

  -- 4f. ŻADNA polityka nie może odwoływać się do public.members inline.
  --     To jest źródło 42P17 opisane w nagłówku: odwołanie do members
  --     wewnątrz polityki, w parze z podzapytaniem w polityce SELECT na
  --     members, domyka pętlę rozwijania polityk.
  select count(*), coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname, ', '), '')
    into v_count, v_detail
  from pg_policies
  where schemaname in ('public', 'app', 'storage')
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%FROM members%';
  if v_count > 0 then
    raise exception 'R12a/H-01: % polityk odwołuje się inline do public.members (ryzyko 42P17): %',
      v_count, v_detail;
  end if;

  -- 4g. Każde wywołanie bramki w polityce musi być owinięte w (select …),
  --     inaczej liczy się PER WIERSZ. Katalog zapisuje owinięte wywołanie
  --     zawsze jako "( SELECT app.…", więc porównujemy liczniki (Postgres
  --     nie ma lookbehind).
  select count(*), coalesce(string_agg(what, ', '), '')
    into v_count, v_detail
  from (
    select what from (
      select schemaname || '.' || tablename || '.' || policyname as what,
             (length(x) - length(replace(x, 'app.is_current_tenant_member()', '')))
               / length('app.is_current_tenant_member()')
             + (length(x) - length(replace(x, 'app.is_current_superadmin()', '')))
               / length('app.is_current_superadmin()')
             + (length(x) - length(replace(x, 'app.is_tenant_owner()', '')))
               / length('app.is_tenant_owner()') as total,
             (length(x) - length(replace(x, '( SELECT app.is_current_tenant_member()', '')))
               / length('( SELECT app.is_current_tenant_member()')
             + (length(x) - length(replace(x, '( SELECT app.is_current_superadmin()', '')))
               / length('( SELECT app.is_current_superadmin()')
             + (length(x) - length(replace(x, '( SELECT app.is_tenant_owner()', '')))
               / length('( SELECT app.is_tenant_owner()') as wrapped
      from (
        select schemaname, tablename, policyname,
               coalesce(qual, '') || ' ' || coalesce(with_check, '') as x
        from pg_policies
        where schemaname in ('public', 'app', 'storage')
      ) e
    ) c
    where total <> wrapped
  ) t;
  if v_count > 0 then
    raise exception 'R12a/H-01: % polityk woła bramkę BEZ owijki (select …) — liczenie per wiersz: %',
      v_count, v_detail;
  end if;

  select count(*)
    into v_count
  from pg_policies
  where schemaname in ('public', 'app', 'storage')
    and (coalesce(qual, '') like '%app.is_current_%'
      or coalesce(with_check, '') like '%app.is_current_%');
  raise notice 'R12a/H-01: predykaty live wpięte w % polityk', v_count;
end
$$;
