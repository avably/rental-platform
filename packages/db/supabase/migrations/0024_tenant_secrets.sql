-- 0024_tenant_secrets.sql
-- Sekrety tenanta (ADR-052) — zamknięcie długu ADR-031 o dwóch głowach:
-- credentiale dostawcy leżały w tenant_settings JAWNIE, a zapis ustawień
-- był otwarty dla KAŻDEGO członka, mimo że UI pokazywał je jako sprawę
-- właściciela.
--
-- Ta migracja robi pięć rzeczy:
--   1. zakłada public.tenant_secrets — GENERYCZNY magazyn sekretów tenanta
--      (klucz → koperta szyfrogramu), świadomie NIE „credentiale kuriera":
--      token Fakturowni z fazy 3 (Z8) wchodzi tu bez migracji schematu,
--   2. zawęża ZAPIS public.tenant_settings do roli owner (RLS 0007 pozwalał
--      każdemu członkowi — bramka istniała wyłącznie w interfejsie),
--   3. przebudowuje CHECK klucza globkurier_credentials: hasło nie jest już
--      częścią tego ustawienia i baza ODMAWIA jego zapisu pod tym kluczem,
--   4. przenosi wiersze sprzed migracji do nowego kształtu (bez kroków
--      ręcznych na produkcji),
--   5. dokłada app.tenant_secret_is_set() dla ekranu ustawień.
--
-- DLACZEGO SZYFROWANIE APLIKACYJNE, A NIE VAULT — rozpoznanie w naszym
-- Supabase (pełne uzasadnienie w ADR-052):
--   * supabase_vault 0.3.1 JEST zainstalowany i działa (pgsodium dostępny,
--     ale nieinstalowany), więc wariant bazodanowy był realną opcją,
--   * ALE `service_role` ma SELECT na vault.decrypted_secrets, a właścicielem
--     obiektów schematu `vault` jest `supabase_admin`; rola `postgres`, którą
--     biegną nasze migracje, NIE jest jego członkiem — REVOKE z migracji jest
--     CICHYM NO-OPEM (zweryfikowane: granty po REVOKE bez zmian). Nie mamy
--     więc jak odebrać service_role wglądu w jawne sekrety WSZYSTKICH
--     najemców, a klucz service_role żyje w aplikacji,
--   * klucz root Vaulta czyta skrypt `vault.getkey_script` z pliku
--     /etc/postgresql-custom/pgsodium_root.key, który leży w warstwie
--     kontenera, a NIE na wolumenie danych — odtworzenie kontenera przy
--     zachowanym wolumenie daje nowy klucz i CICHO nieodszyfrowywalne
--     szyfrogramy,
--   * na Supabase hostowanym nie jesteśmy właścicielem klucza root, więc nie
--     mamy dźwigni ROTACJI — a w fazie 3 pod tym samym wzorcem ma leżeć token
--     rozliczeniowy.
-- Szyfrowanie w @avably/core (AES-256-GCM, klucz w zmiennej środowiskowej)
-- odwraca te trzy rzeczy: baza — łącznie z service_role, Studio, zrzutem
-- pg_dump i kopią zapasową — widzi WYŁĄCZNIE szyfrogram, a klucz mieszka
-- w innej domenie zaufania (env aplikacji). Atakujący potrzebuje dwóch
-- niezależnych kompromitacji zamiast jednej.
--
-- CENA, KTÓRĄ PŁACIMY ŚWIADOMIE: migracja SQL nie ma dostępu do klucza, więc
-- nie umie zaszyfrować istniejących haseł — patrz punkt 4.

-- ---------------------------------------------------------------------
-- 1. public.tenant_secrets
-- ---------------------------------------------------------------------

-- Osobna TABELA, nie kolejny klucz w tenant_settings. Powód nie jest
-- kosmetyczny: „ten wiersz zawiera sekret" ma być własnością STRUKTURY, nie
-- konwencji nazewniczej. Dzięki temu (a) polityki RLS dla sekretów są inne
-- niż dla zwykłej konfiguracji i nie trzeba ich rozstrzygać per klucz,
-- (b) test „w kolumnie nie ma wartości jawnej" ma jedno miejsce do
-- sprawdzenia dla wszystkich sekretów, dziś i w fazie 3, (c) dołożenie
-- sekretu nie wymaga dokładania CHECK-a kształtu do tenant_settings.
create table public.tenant_secrets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Identyfikator sekretu w tej samej konwencji co tenant_settings.key —
  -- ustawienie i jego sekret mają się nazywać rozpoznawalnie parami
  -- (globkurier_credentials ↔ globkurier_password).
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,63}$'),

  -- Koperta szyfrogramu — dla bazy NIEPRZEZROCZYSTY tekst. Format produkuje
  -- i czyta wyłącznie @avably/core/secrets:
  --   v1:<wersja_klucza>:<iv>:<tag>:<szyfrogram>   (człony base64url)
  -- Baza nie zna i nie ma znać ani klucza, ani algorytmu; pilnuje tylko, żeby
  -- pod tą kolumną nie dało się przemycić czegoś, co kopertą nie jest.
  ciphertext text not null check (
    ciphertext ~ '^v1:[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
    and length(ciphertext) between 24 and 8192
  ),

  -- Wersja klucza, którym zaszyfrowano — kolumna, a nie tylko człon koperty,
  -- bo po rotacji trzeba UMIEĆ ZAPYTAĆ „które wiersze siedzą jeszcze na
  -- starym kluczu". Człon koperty jest jednak źródłem prawdy dla deszyfracji,
  -- więc CHECK niżej pilnuje, żeby te dwa zapisy nie mogły się rozjechać:
  -- rozjazd oznaczałby raport rotacji kłamiący o stanie faktycznym.
  key_version integer not null check (key_version >= 1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (tenant_id, key),

  constraint tenant_secrets_key_version_matches_envelope check (
    ciphertext like ('v1:' || key_version::text || ':%')
  )
);

comment on table public.tenant_secrets is
  'Sekrety tenanta (klucz → koperta szyfrogramu). Szyfruje i odszyfrowuje WYŁĄCZNIE @avably/core/secrets (AES-256-GCM, klucz w env aplikacji) — baza nigdy nie widzi wartości jawnej. Wzorzec generyczny: globkurier_password (ADR-052), docelowo token rozliczeniowy fazy 3.';
comment on column public.tenant_secrets.ciphertext is
  'Koperta v1:<wersja_klucza>:<iv>:<tag>:<szyfrogram> (base64url). Nieprzezroczysta dla bazy. AAD koperty wiąże ją z (tenant_id, key) — szyfrogram przeniesiony do innego wiersza NIE odszyfruje się (fail-closed), więc podmiana wiersza nie jest cichym przejęciem integracji.';
comment on column public.tenant_secrets.key_version is
  'Wersja klucza szyfrującego (AVABLY_SECRETS_KEY_V<n>). Kolumna istnieje po to, by dało się ZAPYTAĆ o wiersze do przeszyfrowania po rotacji; spójność z kopertą trzyma CHECK tenant_secrets_key_version_matches_envelope.';

create index on public.tenant_secrets (key_version);

-- ---------------------------------------------------------------------
-- 2. RLS, granty i polityki tenant_secrets
-- ---------------------------------------------------------------------

alter table public.tenant_secrets enable row level security;

-- REVOKE PRZED GRANT-em (wzorzec 0006/0007): bez tego `alter default
-- privileges` Supabase zostawia anon i authenticated komplet uprawnień,
-- w tym TRUNCATE, które NIE PODLEGA RLS.
revoke all on public.tenant_secrets from anon, authenticated;
grant select, insert, update, delete on public.tenant_secrets to authenticated, service_role;

-- ODCZYT: KAŻDY członek tenanta. Decyzja świadoma, nie przeoczenie.
--
-- Rozważana alternatywa (odczyt tylko dla ownera) rozbija PRODUKT: nadanie
-- przesyłki biegnie sesją działającego pracownika (loadCourierApi dostaje
-- klienta z RLS), więc sekret nieczytelny dla członka oznacza „tylko
-- właściciel może nadać paczkę" — regresja, o którą nikt nie prosił.
--
-- Cena tego odczytu jest mała i policzalna: członek dostaje SZYFROGRAM, a nie
-- sekret. Klucz nie mieszka w bazie, nie wychodzi do przeglądarki i nie ma
-- go w żadnej odpowiedzi API. Do tego członek i tak DYSPONUJE zdolnością,
-- której ten sekret udziela (nadaje przesyłki naszym UI) — odebranie mu
-- szyfrogramu nie odebrałoby mu tej zdolności, kupiłoby tylko złudzenie.
--
-- Asymetria, którą naprawiamy, jest gdzie indziej i domykają ją polityki
-- zapisu niżej: członek nie ZMIENIA integracji i nie WYDOBYWA wartości
-- jawnej (ta nie wraca do UI w ogóle — ADR-052).
--
-- Superadmin NIE dostaje odczytu (brak `or app.is_superadmin()`, inaczej niż
-- w tenant_settings): wsparcie techniczne rozwiązuje zgłoszenia bez wglądu
-- w cudze credentiale, a szyfrogram i tak nic mu nie mówi — jedyne, co by
-- dawał, to poszerzona powierzchnia ataku.
create policy tenant_select on public.tenant_secrets for select
  using (tenant_id = app.tenant_id());

-- ZAPIS: wyłącznie owner. To jest bramka, której dotąd nie było.
create policy owner_insert on public.tenant_secrets for insert
  with check (tenant_id = app.tenant_id() and app.is_tenant_owner());
create policy owner_update on public.tenant_secrets for update
  using (tenant_id = app.tenant_id() and app.is_tenant_owner())
  with check (tenant_id = app.tenant_id() and app.is_tenant_owner());
create policy owner_delete on public.tenant_secrets for delete
  using (tenant_id = app.tenant_id() and app.is_tenant_owner());

-- ---------------------------------------------------------------------
-- 3. tenant_settings: ZAPIS zawężony do ownera
-- ---------------------------------------------------------------------

-- Dług ADR-031, druga głowa. 0007 dawało INSERT/UPDATE każdemu członkowi
-- tenanta, a ekran ustawień prezentował je jako sprawę właściciela — bramka
-- istniała więc wyłącznie w interfejsie i znikała przy pierwszym żądaniu
-- wysłanym poza UI (PostgREST przyjmuje je od dowolnego zalogowanego członka).
--
-- ODCZYT zostaje przy członku (polityka tenant_select z 0007 nietknięta):
-- prefiks numeracji, cennik dostaw, nadawca i domyślna paczka to dane
-- OPERACYJNE, bez których pracownik nie wystawi zamówienia ani nie nada
-- przesyłki. Zawężenie odczytu zablokowałoby pracę lady, a nie ochroniło
-- niczego — po tej migracji w tenant_settings nie ma już wartości sekretnej.
drop policy tenant_insert on public.tenant_settings;
drop policy tenant_update on public.tenant_settings;

create policy owner_insert on public.tenant_settings for insert
  with check (tenant_id = app.tenant_id() and app.is_tenant_owner());
create policy owner_update on public.tenant_settings for update
  using (tenant_id = app.tenant_id() and app.is_tenant_owner())
  with check (tenant_id = app.tenant_id() and app.is_tenant_owner());

-- ---------------------------------------------------------------------
-- 4. globkurier_credentials bez hasła + przeniesienie istniejących wierszy
-- ---------------------------------------------------------------------

-- KOLEJNOŚĆ JEST ISTOTNA: najpierw zdejmujemy stary CHECK (wymagał hasła),
-- potem czyścimy dane, dopiero na końcu zakładamy nowy (zabrania hasła).
-- Odwrotna kolejność wywróciłaby migrację na własnych danych.
alter table public.tenant_settings
  drop constraint tenant_settings_globkurier_credentials_valid;

-- Istniejące wiersze: zdejmujemy pole `password`, resztę zostawiamy
-- nietkniętą (e-mail i środowisko to konfiguracja, nie sekret).
--
-- DLACZEGO NIE PRZENOSIMY HASŁA DO tenant_secrets: migracja SQL nie ma
-- dostępu do klucza szyfrującego (mieszka w env aplikacji — o to w tym
-- wariancie chodzi), więc jedyne, co mogłaby zrobić, to przepisać hasło
-- JAWNIE do nowej tabeli. Byłby to ten sam dług pod nowym adresem, a
-- dodatkowo unieważniłby obietnicę tabeli („ta kolumna nigdy nie zawiera
-- wartości jawnej") i test, który tej obietnicy pilnuje.
--
-- Usunięcie hasła to nie utrata danych, tylko WYMUSZONA ROTACJA — i jest
-- właściwą odpowiedzią, bo te hasła leżały jawnie, czytelne dla każdego
-- członka tenanta i dla każdego, kto miał wgląd w wiersz. Sekret, który był
-- wystawiony, przenosi się do naprawionego systemu jako sekret nadal
-- wystawiony. Ścieżka powrotu właściciela to zwykły formularz ustawień,
-- który i tak działa w trybie „nadpisz, nie odczytuj" — ZERO kroków
-- ręcznych na produkcji, ekran sam pokazuje „brak" zamiast
-- „skonfigurowane".
update public.tenant_settings
   set value = value - 'password',
       updated_at = now()
 where key = 'globkurier_credentials'
   and value ? 'password';

-- Nowy CHECK. Zwrotka względem 0013: `password` nie jest już wymagane —
-- jest ZAKAZANE. To nie jest kosmetyka, tylko zapora: bez niej pierwszy
-- regres w kodzie panelu (albo żądanie wysłane wprost do PostgREST)
-- odłożyłby hasło z powrotem jawnie, a wszystkie testy szyfrowania nadal
-- świeciłyby na zielono — bo dotyczą innej tabeli.
--
-- coalesce(..., false) wokół całej koniunkcji jak w 0013: brak klucza w jsonb
-- daje NULL, a CHECK z wynikiem NULL PRZECHODZI (trójwartościowa logika SQL).
alter table public.tenant_settings
  add constraint tenant_settings_globkurier_credentials_valid check (
    key <> 'globkurier_credentials' or coalesce((
      jsonb_typeof(value) = 'object'
      and jsonb_typeof(value->'email') = 'string'
      and length(value->>'email') between 3 and 320
      and (value->>'environment') in ('test','production')
      and not (value ? 'password')
    ), false)
  );

comment on constraint tenant_settings_globkurier_credentials_valid on public.tenant_settings is
  'Kształt tenant_settings.globkurier_credentials po ADR-052: {email, environment} — CZĘŚĆ JAWNA. Hasło jest ZAKAZANE pod tym kluczem (żyje zaszyfrowane w public.tenant_secrets, key=globkurier_password); zakaz jest zaporą przed cofnięciem sekretu do plaintextu regresem w kodzie.';

comment on column public.tenant_settings.key is
  'Identyfikator ustawienia (snake_case). Znane klucze: order_number_prefix (0007), globkurier_credentials (0013, od 0024 BEZ hasła), courier_sender, courier_parcel, delivery_pricing (0013), email_sender (0014). Sekrety NIE trafiają tutaj — patrz public.tenant_secrets (0024).';

-- ---------------------------------------------------------------------
-- 5. app.tenant_secret_is_set — stan integracji bez dotykania szyfrogramu
-- ---------------------------------------------------------------------

-- Ekran ustawień musi pokazać „skonfigurowane / brak", i tylko tyle. Mógłby
-- to wyliczyć zwykłym SELECT-em po tenant_secrets, ale wtedy szyfrogram
-- wędrowałby przez PostgREST do warstwy, która go nie potrzebuje — a każde
-- niepotrzebne przeniesienie sekretu (choćby zaszyfrowanego) to powierzchnia,
-- na której kiedyś ktoś go zaloguje. Funkcja zwraca BOOLEAN i nic więcej.
--
-- SECURITY INVOKER (jawnie): odpowiedź ma być prawdziwa w granicach polityk
-- wywołującego — funkcja nie jest obejściem RLS, tylko wąskim widokiem.
create or replace function app.tenant_secret_is_set(p_key text) returns boolean
language sql stable security invoker as $$
  select exists (
    select 1
    from public.tenant_secrets s
    where s.tenant_id = app.tenant_id()
      and s.key = p_key
  )
$$;

alter function app.tenant_secret_is_set(text) set search_path = pg_catalog;

grant execute on function app.tenant_secret_is_set(text) to authenticated, service_role;

comment on function app.tenant_secret_is_set(text) is
  'Czy tenant wywołującego ma ustawiony sekret o danym kluczu. Zwraca WYŁĄCZNIE boolean — ekran ustawień pokazuje stan „skonfigurowane / brak" i nigdy nie dostaje szyfrogramu (ADR-052).';
