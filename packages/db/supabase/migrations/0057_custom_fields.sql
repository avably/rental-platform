-- 0057_custom_fields.sql
-- Pola własne per najemca: definicje, wartości TYPOWANE i bramka zgodności
-- (C6-A1 część 1, ADR-118).
--
-- STAN PRZED: schemat opisuje wyłącznie to, co przewidział produkt. Najemca,
-- który w arkuszu prowadził trzy własne kolumny (numer uprawnień, kaucja
-- w gotówce, stan licznika), nie ma ich gdzie przenieść — a to jest bariera
-- wejścia przy migracji z arkusza, nie kosmetyka.
--
-- STAN PO:
--   * public.custom_field_definitions — definicje per najemca (etykieta, typ,
--     wymagalność, opcje selecta, pozycja, widoczność panel/checkout/umowa,
--     encja docelowa, archiwizacja);
--   * kolumna jsonb `custom_fields` na public.customers, public.orders
--     i public.products — mapa ID DEFINICJI → wartość, wartości TYPOWANE
--     (liczba jest liczbą, checkbox boolem), nie stringi;
--   * app.custom_fields_validate — trigger BEFORE INSERT OR UPDATE na tych
--     trzech tabelach: jedyna bramka zgodności wartości z definicją;
--   * app.custom_field_definitions_guard — trigger na definicjach: kształt
--     opcji, niezmienność encji, ZAMROŻENIE typu po pierwszej wartości;
--   * app.custom_fields_in_use — odczyt „która definicja ma już wartości"
--     dla panelu (SECURITY INVOKER, więc RLS encji jest tu bramką).
--
-- DLACZEGO JSONB NA ENCJI, A NIE OSOBNA TABELA WARTOŚCI. Odczyt encji jest
-- gorącą ścieżką (lista zamówień, karta klienta, checkout, umowa PDF), a mapa
-- klucz→wartość na wierszu daje go BEZ JOINA i BEZ nowej powierzchni izolacji:
-- wartość dziedziczy RLS wiersza, który ją niesie. Osobna tabela wartości
-- dokładałaby czwartą tabelę per-tenant do macierzy izolacji i komplet polityk
-- na dane, które i tak są widoczne dokładnie wtedy, gdy widoczny jest rodzic.
-- KOSZT tej decyzji jest jeden i jest tu spłacony: klucz JSONB nie ma klucza
-- obcego, więc „wartość pod ID CUDZEJ definicji" musi odrzucić WALIDACJA.
-- Robi to trigger, jawnym filtrem `tenant_id = new.tenant_id` — nie RLS,
-- nie aplikacja.
--
-- DLACZEGO BEZ TYPU „PLIK". To decyzja, nie przeoczenie (ADR-118, ADR-113):
-- pole plikowe wpuszczałoby skany dowodów tożsamości tylnymi drzwiami —
-- dokładnie to, czego zakazuje decyzja o zakresie zbieranych danych.
--
-- CZEGO TRIGGER ŚWIADOMIE NIE EGZEKWUJE: WYMAGALNOŚCI. `required` jest regułą
-- FORMULARZA (rdzeń: @avably/core/custom-fields), nie reprezentowalności
-- wiersza. Gdyby pilnowała jej baza, dodanie nowego pola wymaganego
-- unieważniałoby WSTECZ każdy istniejący wiersz i blokowało każdą niezwiązaną
-- aktualizację (zmiana statusu zamówienia sprzed roku). Bramka bazy odpowiada
-- na pytanie „czy ta wartość jest śmieciem", a nie „czy formularz kompletny".
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md):
--   * tabela per-tenant: tenant_id + indeks od tenant_id + RLS w tej samej
--     migracji + wpis w SAMPLE_ROW_FACTORIES/MUTATION_PATCHES (macierz RLS),
--   * revoke all PRZED grantami na nowej tabeli,
--   * funkcje z przypiętym search_path (pg_catalog, public, app),
--   * comment on z kontraktem i listą odmów,
--   * kody odmów wyłącznie standardowe: 22023 (nieistniejąca lub cudza
--     definicja), 23514 (wartość niezgodna z definicją, zamrożony typ,
--     zablokowana archiwizacja), 42501 (RLS). Zero P0xxx — PostgREST zamienia
--     je na gołe 500.

-- === BEGIN PROD MIGRATION 0057 ===

-- ---------------------------------------------------------------------
-- 1. Tabela public.custom_field_definitions
-- ---------------------------------------------------------------------
create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Encja docelowa. NIEZMIENNA po utworzeniu (guard): przeniesienie definicji
  -- między encjami osierociłoby każdą zapisaną wartość, bo wartości siedzą na
  -- wierszach TAMTEJ encji.
  entity text not null check (entity in ('customer', 'order', 'product')),
  -- Siedem typów fazy A. Bez „pliku" (patrz nagłówek), bez multi-selecta
  -- i adresu — te dołożymy, gdy zawoła rynek, a dołożenie typu jest dopisaniem
  -- gałęzi, nie migracją danych.
  field_type text not null check (
    field_type in ('text', 'textarea', 'number', 'date', 'select', 'checkbox', 'phone')
  ),
  label text not null check (length(btrim(label)) between 1 and 60),
  -- Podpowiedź pod polem. Opcjonalna; pusty ciąg jest niereprezentowalny,
  -- żeby „brak podpowiedzi" miał jedną reprezentację (NULL).
  help_text text check (help_text is null or length(btrim(help_text)) between 1 and 200),
  required boolean not null default false,
  -- Opcje selecta. Tablica stringów; dla pozostałych typów MUSI być pusta.
  -- Kształt elementów sprawdza guard, nie CHECK — CHECK nie może zawierać
  -- podzapytania, a walidacja elementów tablicy bez podzapytania się nie da.
  options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options) = 'array')
    check (field_type = 'select' or options = '[]'::jsonb),
  position int not null default 0 check (position between 0 and 9999),
  -- Widoczność. Panel domyślnie tak (pole bez miejsca w panelu byłoby
  -- niewypełnialne przez operatora); checkout i umowa domyślnie nie —
  -- powierzchnie publiczne i dokumentowe wybiera się świadomie.
  show_in_panel boolean not null default true,
  show_in_checkout boolean not null default false,
  show_in_contract boolean not null default false,
  -- ARCHIWIZACJA ZAMIAST USUNIĘCIA. Los danych jest tu ZDEFINIOWANY: wiersze
  -- zachowują zapisane wartości i pozostają czytelne, a pole znika
  -- z formularzy. Wymuszone brakiem grantu i polityki DELETE dla
  -- `authenticated` — nie dobrą wolą aplikacji.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.custom_field_definitions is
  'Definicje pól własnych per najemca (C6-A1, ADR-118). Odczyt: członek tenanta (pola renderują się na formularzach każdego). Mutacje: WYŁĄCZNIE owner — definicja zmienia kształt danych całej organizacji. Bez DELETE: definicje się archiwizuje (archived_at), żeby zapisane wartości zostały czytelne.';

comment on column public.custom_field_definitions.entity is
  'Encja, do której pole się przypina (customer|order|product). Niezmienna po utworzeniu — guard odrzuca zmianę (23514), bo osierociłaby zapisane wartości.';
comment on column public.custom_field_definitions.field_type is
  'Typ wartości. ZAMROŻONY po pierwszej zapisanej wartości (guard, 23514) — zero migracji typów w danych najemcy.';
comment on column public.custom_field_definitions.options is
  'Opcje selecta: tablica unikatowych (bez względu na wielkość liter) niepustych stringów, 1..50 pozycji. Dla pozostałych typów pusta tablica. Gdy definicja jest w użyciu, opcji nie da się usunąć — tylko dołożyć.';
comment on column public.custom_field_definitions.archived_at is
  'Znacznik archiwizacji. Pole znika z formularzy, wartości zostają; trigger wartości blokuje DODANIE i ZMIANĘ wartości pod zarchiwizowaną definicją (23514), ale pozwala je USUNĄĆ — inaczej usunięcie danych klienta (ADR-116) trafiałoby na ścianę.';

-- Indeks listowania: dokładnie tak czyta ekran ustawień i (w części 2)
-- renderer formularza.
create index custom_field_definitions_tenant_entity_position_idx
  on public.custom_field_definitions (tenant_id, entity, position, created_at);

-- Etykieta jest tym, co operator widzi na formularzu i w umowie — dwa żywe
-- pola o tej samej nazwie na tej samej encji dają dokument, którego nie da się
-- czytać. Unikat CZĘŚCIOWY: zarchiwizowane definicje wychodzą spod niego, więc
-- nazwę da się użyć ponownie po archiwizacji poprzedniczki.
create unique index custom_field_definitions_active_label_key
  on public.custom_field_definitions (tenant_id, entity, lower(btrim(label)))
  where archived_at is null;

-- ---------------------------------------------------------------------
-- 2. RLS + granty
-- ---------------------------------------------------------------------
alter table public.custom_field_definitions enable row level security;
revoke all on public.custom_field_definitions from anon, authenticated;

-- Bez DELETE dla `authenticated`: usunięcie definicji zostawiłoby na wierszach
-- wartości bez etykiety i bez typu, czyli dane nieczytelne. Archiwizacja jest
-- UPDATE-em. `service_role` ma DELETE wyłącznie na potrzeby sprzątania
-- (kaskada z tenants i teardown testów).
grant select, insert, update on public.custom_field_definitions to authenticated;
grant select, insert, update, delete on public.custom_field_definitions to service_role;

-- Odczyt: każdy członek tenanta. Definicja nie jest sekretem — jest kształtem
-- formularza, który ten sam członek i tak wypełnia.
create policy tenant_select on public.custom_field_definitions for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());

-- Mutacje: WYŁĄCZNIE właściciel. Granica ta sama co przy kluczach API (0053)
-- i sekretach (0024): definicja pola dotyka wszystkich danych organizacji
-- i wszystkich jej dokumentów, więc nie jest czynnością lady.
create policy tenant_insert on public.custom_field_definitions for insert
  with check (tenant_id = app.tenant_id() and app.is_tenant_owner());
create policy tenant_update on public.custom_field_definitions for update
  using (tenant_id = app.tenant_id() and app.is_tenant_owner())
  with check (tenant_id = app.tenant_id() and app.is_tenant_owner());

-- ---------------------------------------------------------------------
-- 3. Kolumny wartości na encjach
-- ---------------------------------------------------------------------
--
-- `not null default '{}'` — „brak pól własnych" ma JEDNĄ reprezentację (pusty
-- obiekt), więc żaden odczyt nie musi rozróżniać NULL od {}. Istniejące wiersze
-- dostają domyślną wartość, więc migracja jest bezpieczna dla żywych danych
-- i dla app.public_checkout / app.create_order (nie znają nowej kolumny,
-- a default ją wypełni).
alter table public.customers add column custom_fields jsonb not null default '{}'::jsonb;
alter table public.orders    add column custom_fields jsonb not null default '{}'::jsonb;
alter table public.products  add column custom_fields jsonb not null default '{}'::jsonb;

-- Kształt kontenera pilnuje CHECK (tani, deklaratywny), zawartość — trigger.
alter table public.customers
  add constraint customers_custom_fields_object check (jsonb_typeof(custom_fields) = 'object');
alter table public.orders
  add constraint orders_custom_fields_object check (jsonb_typeof(custom_fields) = 'object');
alter table public.products
  add constraint products_custom_fields_object check (jsonb_typeof(custom_fields) = 'object');

comment on column public.customers.custom_fields is
  'Wartości pól własnych klienta (C6-A1, ADR-118): mapa ID definicji → wartość TYPOWANA. Zgodność z definicją wymusza trigger customers_custom_fields_validate. Czyszczone przez app.erase_customer (art. 17 RODO).';
comment on column public.orders.custom_fields is
  'Wartości pól własnych zamówienia (C6-A1, ADR-118): mapa ID definicji → wartość TYPOWANA. Zgodność wymusza trigger orders_custom_fields_validate. Czyszczone przez app.erase_customer razem z resztą kopii danych klienta.';
comment on column public.products.custom_fields is
  'Wartości pól własnych produktu (C6-A1, ADR-118): mapa ID definicji → wartość TYPOWANA. Zgodność wymusza trigger products_custom_fields_validate.';

-- Indeksy GIN pod operator `?` (istnienie klucza) — używa go bramka
-- zamrożenia typu, a w części 2 użyją filtry list po polach własnych. To jest
-- cała przewaga typowanych wartości: filtrowanie jest tanie od pierwszego dnia.
create index customers_custom_fields_gin on public.customers using gin (custom_fields);
create index orders_custom_fields_gin    on public.orders    using gin (custom_fields);
create index products_custom_fields_gin  on public.products  using gin (custom_fields);

-- ---------------------------------------------------------------------
-- 4. app.custom_fields_validate — bramka zgodności wartości z definicją
-- ---------------------------------------------------------------------
--
-- To JEST bramka, nie uprzejmość: surowe API (PostgREST) ma tę samą drogę do
-- kolumny co panel, więc „walidacja w formularzu" nie chroni niczego.
--
-- SECURITY INVOKER (domyślny) świadomie: funkcja nie potrzebuje żadnego
-- przywileju ponad wołającego, a izolację daje jej JAWNY filtr
-- `tenant_id = new.tenant_id` przy szukaniu definicji — nie widoczność wiersza.
-- Dzięki temu bramka działa identycznie dla sesji najemcy, dla `service_role`
-- (BYPASSRLS) i dla wywołań z wnętrza funkcji SECURITY DEFINER
-- (app.public_checkout, app.create_order), które RLS mają wyłączone.
--
-- Argument triggera niesie encję — jedna funkcja obsługuje trzy tabele, więc
-- reguła istnieje w JEDNYM egzemplarzu i nie da się jej rozjechać między
-- klientem, zamówieniem a produktem.
create or replace function app.custom_fields_validate()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_entity text := tg_argv[0];
  v_old    jsonb := '{}'::jsonb;
  v_key    text;
  v_value  jsonb;
  v_text   text;
  v_num    numeric;
  v_def    record;
begin
  if new.custom_fields is null then
    new.custom_fields := '{}'::jsonb;
  end if;

  if tg_op = 'UPDATE' then
    v_old := coalesce(old.custom_fields, '{}'::jsonb);
    -- Aktualizacja NIETYKAJĄCA pól własnych przechodzi bez walidacji. To nie
    -- jest optymalizacja, tylko warunek poprawności: po zarchiwizowaniu
    -- definicji zmiana statusu zamówienia sprzed roku musi dalej działać.
    if new.custom_fields = v_old then
      return new;
    end if;
  end if;

  -- Górna granica rozmiaru. Kolumna jest workiem na dane, których nie
  -- przewidzieliśmy — bez granicy staje się workiem na cokolwiek.
  if pg_column_size(new.custom_fields) > 8192 then
    raise exception 'Pola własne przekraczają dopuszczalny rozmiar.'
      using errcode = '23514';
  end if;

  for v_key, v_value in select * from jsonb_each(new.custom_fields) loop
    -- Klucz to ID DEFINICJI, nigdy nazwa. Wiązanie po nazwie jest kruche
    -- (zmiana etykiety gubi dane, dwie etykiety różniące się wielkością liter
    -- zlewają się w jedną) — dlatego nazwa nie ma tu wstępu. Postać kanoniczna
    -- (małe litery), bo tak wypisuje się uuid w Postgresie i tak wygląda klucz
    -- pisany przez panel.
    if v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Klucz pola własnego musi być identyfikatorem definicji.'
        using errcode = '22023';
    end if;

    -- JAWNY filtr najemcy — to jest cała ochrona przed zapisem wartości pod
    -- identyfikatorem CUDZEJ definicji. Klucz JSONB nie ma klucza obcego,
    -- więc gdyby tego filtra zabrakło, najemca A wpisałby swoim danym kształt
    -- narzucony przez definicję najemcy B (i odczytałby jej istnienie).
    -- Encja też jest w filtrze: definicja klienta nie może opisać wartości
    -- zapisanej na zamówieniu.
    select d.field_type, d.options, d.archived_at
      into v_def
      from public.custom_field_definitions d
     where d.id = v_key::uuid
       and d.tenant_id = new.tenant_id
       and d.entity = v_entity;

    -- Cudza definicja i definicja nieistniejąca dają IDENTYCZNĄ odmowę —
    -- rozróżnienie zdradzałoby, co u sąsiada istnieje.
    if not found then
      raise exception 'Pole własne nie istnieje w tej organizacji.'
        using errcode = '22023';
    end if;

    -- Zarchiwizowana definicja: wartość wolno USUNĄĆ (klucz znika z mapy),
    -- ale nie wolno jej DODAĆ ani ZMIENIĆ. Archiwizacja jest więc realnym
    -- zamrożeniem historii, a nie kosmetyką formularza.
    if v_def.archived_at is not null
       and (not (v_old ? v_key) or v_old -> v_key is distinct from v_value) then
      raise exception 'Pole własne jest zarchiwizowane — jego wartości nie da się już zmienić.'
        using errcode = '23514';
    end if;

    -- Pustkę zapisuje się USUNIĘCIEM klucza, nie JSON-owym null-em. Jedna
    -- reprezentacja braku wartości oznacza, że eksport, umowa i filtr nie
    -- muszą znać dwóch.
    if jsonb_typeof(v_value) = 'null' then
      raise exception 'Puste pole własne zapisuje się przez usunięcie klucza, nie wartością pustą.'
        using errcode = '23514';
    end if;

    if v_def.field_type in ('text', 'textarea', 'date', 'select', 'phone') then
      if jsonb_typeof(v_value) <> 'string' then
        raise exception 'Wartość pola własnego ma niewłaściwy typ.'
          using errcode = '23514';
      end if;
      v_text := v_value #>> '{}';
    end if;

    case v_def.field_type
      when 'text' then
        if length(v_text) > 200 then
          raise exception 'Wartość pola własnego jest za długa.' using errcode = '23514';
        end if;
        -- Znaki sterujące nie niosą treści, a niosą kłopot: w części 2 ta sama
        -- wartość idzie na ekran najemcy i do PDF-a. Odsiewamy je u ŹRÓDŁA,
        -- żeby żadna powierzchnia nie musiała ufać, że ktoś to zrobił za nią.
        if v_text ~ '[[:cntrl:]]' then
          raise exception 'Wartość pola własnego zawiera niedozwolone znaki.'
            using errcode = '23514';
        end if;

      when 'textarea' then
        if length(v_text) > 2000 then
          raise exception 'Wartość pola własnego jest za długa.' using errcode = '23514';
        end if;
        -- Tekst długi ma prawo do łamania wierszy i tabulatora — i do niczego
        -- więcej z klasy znaków sterujących.
        if regexp_replace(v_text, '[' || chr(10) || chr(13) || chr(9) || ']', '', 'g') ~ '[[:cntrl:]]' then
          raise exception 'Wartość pola własnego zawiera niedozwolone znaki.'
            using errcode = '23514';
        end if;

      when 'phone' then
        if v_text !~ '^[0-9 ()+-]{6,30}$' or length(app.normalize_phone(v_text)) not between 6 and 15 then
          raise exception 'Wartość pola własnego nie jest numerem telefonu.'
            using errcode = '23514';
        end if;

      when 'date' then
        -- Data zostaje STRINGIEM ISO (jsonb nie ma typu daty), ale jest
        -- WALIDOWANA jako data — i to jest różnica między „wszystko stringiem"
        -- a wartością typowaną: '2026-02-31' nie wejdzie, więc sortowanie
        -- i filtrowanie po tej kolumnie będzie w części 2 uczciwe.
        if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'Wartość pola własnego nie jest datą.' using errcode = '23514';
        end if;
        begin
          perform v_text::date;
        exception
          when others then
            raise exception 'Wartość pola własnego nie jest datą.' using errcode = '23514';
        end;

      when 'select' then
        if not (v_def.options ? v_text) then
          raise exception 'Wartość pola własnego jest spoza listy opcji.'
            using errcode = '23514';
        end if;

      when 'number' then
        if jsonb_typeof(v_value) <> 'number' then
          raise exception 'Wartość pola własnego ma niewłaściwy typ.'
            using errcode = '23514';
        end if;
        v_num := (v_value #>> '{}')::numeric;
        if abs(v_num) > 1e12 or scale(v_num) > 6 then
          raise exception 'Wartość pola własnego jest poza dopuszczalnym zakresem.'
            using errcode = '23514';
        end if;

      when 'checkbox' then
        if jsonb_typeof(v_value) <> 'boolean' then
          raise exception 'Wartość pola własnego ma niewłaściwy typ.'
            using errcode = '23514';
        end if;

      else
        -- Nowy typ dopisany do CHECK-a bez gałęzi tutaj byłby polem BEZ
        -- walidacji. Fail-closed: wpuszczamy wyłącznie to, co umiemy sprawdzić.
        raise exception 'Nieobsługiwany typ pola własnego.' using errcode = '23514';
    end case;
  end loop;

  return new;
end;
$$;

comment on function app.custom_fields_validate() is
  'Bramka zgodności wartości pól własnych z definicją (C6-A1, ADR-118). Trigger BEFORE INSERT OR UPDATE na customers/orders/products; encja przychodzi argumentem triggera. Sprawdza: postać klucza (ID definicji), PRZYNALEŻNOŚĆ definicji do TEGO najemcy i TEJ encji (jawny filtr — jedyna ochrona przed zapisem pod cudzym ID, bo klucz JSONB nie ma klucza obcego), zamrożenie wartości pod definicją zarchiwizowaną, zgodność typu i zakresu. NIE sprawdza wymagalności (to reguła formularza — patrz nagłówek 0057). Odmowy: 22023 (zły klucz, nieistniejąca lub cudza definicja), 23514 (wszystko pozostałe).';

drop trigger if exists customers_custom_fields_validate on public.customers;
create trigger customers_custom_fields_validate
  before insert or update on public.customers
  for each row execute function app.custom_fields_validate('customer');

drop trigger if exists orders_custom_fields_validate on public.orders;
create trigger orders_custom_fields_validate
  before insert or update on public.orders
  for each row execute function app.custom_fields_validate('order');

drop trigger if exists products_custom_fields_validate on public.products;
create trigger products_custom_fields_validate
  before insert or update on public.products
  for each row execute function app.custom_fields_validate('product');

-- ---------------------------------------------------------------------
-- 5. app.custom_field_definitions_guard — reguły twarde definicji
-- ---------------------------------------------------------------------
--
-- SECURITY DEFINER, i to jest tu ROZSTRZYGNIĘCIE, nie wygoda: bramka
-- zamrożenia typu musi odpowiedzieć na pytanie „czy ISTNIEJE jakakolwiek
-- wartość pod tą definicją". Odpowiedź liczona pod RLS wołającego byłaby
-- odpowiedzią na inne pytanie („czy widzę jakąś wartość"), a każde zawężenie
-- widoczności zamieniałoby zamrożenie w fikcję — po cichu i na zielono.
-- Wewnątrz nie ma za to ani grama swobody: probe czyta WYŁĄCZNIE tabelę encji
-- z jawnym `tenant_id = old.tenant_id`, nie zwraca danych (tylko bool)
-- i nie przyjmuje niczego od wołającego poza wierszem, który baza i tak
-- właśnie modyfikuje.
create or replace function app.custom_field_definitions_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_in_use  boolean := false;
  v_options_narrowed boolean := false;
begin
  new.label := btrim(new.label);
  new.help_text := nullif(btrim(coalesce(new.help_text, '')), '');

  -- Kształt opcji selecta. Nie da się tego zrobić CHECK-iem: walidacja
  -- elementów tablicy wymaga podzapytania, a CHECK podzapytań nie przyjmuje.
  if new.field_type = 'select' then
    if jsonb_array_length(new.options) not between 1 and 50 then
      raise exception 'Lista wyboru musi mieć od 1 do 50 opcji.' using errcode = '23514';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(new.options) o
       where jsonb_typeof(o.value) <> 'string'
          or btrim(o.value #>> '{}') = ''
          or length(o.value #>> '{}') > 80
          or (o.value #>> '{}') ~ '[[:cntrl:]]'
    ) then
      raise exception 'Opcja listy wyboru musi być niepustym tekstem bez znaków sterujących.'
        using errcode = '23514';
    end if;
    if (
      select count(distinct lower(btrim(o.value #>> '{}')))
        from jsonb_array_elements(new.options) o
    ) <> jsonb_array_length(new.options) then
      raise exception 'Opcje listy wyboru nie mogą się powtarzać.' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id then
      raise exception 'Definicji pola własnego nie da się przenieść ani przenumerować.'
        using errcode = '23514';
    end if;

    -- Encja niezmienna ZAWSZE, nie tylko „w użyciu": zmiana encji na definicji
    -- bez wartości też jest bez sensu, a wyjątek od reguły byłby furtką.
    if new.entity is distinct from old.entity then
      raise exception 'Pole własne zostaje przy encji, dla której powstało.'
        using errcode = '23514';
    end if;

    v_options_narrowed := new.field_type = 'select'
      and old.field_type = 'select'
      and not (new.options @> old.options);

    if new.field_type is distinct from old.field_type or v_options_narrowed then
      select case old.entity
        when 'customer' then exists (
          select 1 from public.customers t
           where t.tenant_id = old.tenant_id and t.custom_fields ? old.id::text)
        when 'order' then exists (
          select 1 from public.orders t
           where t.tenant_id = old.tenant_id and t.custom_fields ? old.id::text)
        when 'product' then exists (
          select 1 from public.products t
           where t.tenant_id = old.tenant_id and t.custom_fields ? old.id::text)
      end into v_in_use;

      if coalesce(v_in_use, false) then
        if new.field_type is distinct from old.field_type then
          -- ZAMROŻENIE TYPU. Zmiana typu na polu z danymi to migracja danych
          -- najemcy wykonywana w locie, bez planu i bez odwrotu — kategoria
          -- nauczyła się tego kosztem swoich klientów. Droga jest jedna:
          -- zarchiwizuj i załóż nowe pole.
          raise exception 'Typ pola własnego jest zamrożony — pole ma już zapisane wartości.'
            using errcode = '23514';
        end if;
        raise exception 'Opcji używanej listy wyboru nie da się usunąć — można tylko dołożyć nowe.'
          using errcode = '23514';
      end if;
    end if;

    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

comment on function app.custom_field_definitions_guard() is
  'Reguły twarde definicji pól własnych (C6-A1, ADR-118): kształt opcji selecta (CHECK nie przyjmuje podzapytań), niezmienność encji i tożsamości, ZAMROŻENIE typu po pierwszej zapisanej wartości, zakaz zwężania listy opcji będącej w użyciu. SECURITY DEFINER wyłącznie po to, by pytanie „czy istnieje jakakolwiek wartość" nie zamieniło się w „czy widzę jakąś wartość"; probe czyta tabelę encji z jawnym filtrem tenant_id i zwraca wyłącznie wartość logiczną. Odmowa: 23514.';

drop trigger if exists custom_field_definitions_guard on public.custom_field_definitions;
create trigger custom_field_definitions_guard
  before insert or update on public.custom_field_definitions
  for each row execute function app.custom_field_definitions_guard();

-- ---------------------------------------------------------------------
-- 6. app.custom_fields_in_use — „która definicja ma już wartości"
-- ---------------------------------------------------------------------
--
-- Ekran ustawień musi wiedzieć, którego pola typu już nie wolno zmienić —
-- inaczej pokazywałby wybór, który baza i tak odrzuci.
--
-- SECURITY INVOKER, świadomie: to jedyny wariant, w którym funkcja NIE JEST
-- nową powierzchnią izolacji. RLS encji (customers/orders/products) filtruje
-- ją do najemcy wołającego, więc nie ma tu ani parametru do podstawienia,
-- ani sposobu na wyciągnięcie czegokolwiek o sąsiedzie.
create or replace function app.custom_fields_in_use()
returns table (definition_id uuid)
language sql
stable
security invoker
set search_path = pg_catalog, public, app
as $$
  select k::uuid from public.customers c, lateral jsonb_object_keys(c.custom_fields) k
  union
  select k::uuid from public.orders o, lateral jsonb_object_keys(o.custom_fields) k
  union
  select k::uuid from public.products p, lateral jsonb_object_keys(p.custom_fields) k
$$;

comment on function app.custom_fields_in_use() is
  'Identyfikatory definicji pól własnych, pod którymi istnieje choć jedna wartość w danych WOŁAJĄCEGO (C6-A1, ADR-118). SECURITY INVOKER — zasięg wyznacza RLS encji, więc funkcja nie dokłada powierzchni izolacji. Zasila blokadę zmiany typu na ekranie ustawień; źródłem prawdy pozostaje trigger custom_field_definitions_guard.';

revoke all on function app.custom_fields_in_use() from public, anon;
grant execute on function app.custom_fields_in_use() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. app.erase_customer — pola własne wchodzą do zasięgu art. 17 (ADR-116)
-- ---------------------------------------------------------------------
--
-- Kolumna, w którą operator wpisuje to, czego produkt nie przewidział, jest
-- z definicji miejscem, gdzie dane osobowe potrafią wylądować w dowolnej
-- formie (numer uprawnień, adres, cokolwiek). Zostawienie jej poza zasięgiem
-- usunięcia danych klienta zamieniłoby zamknięte ryzyko R2 w otwarte — i to
-- w tej samej migracji, która tę kolumnę wprowadza.
--
-- Poniżej PEŁNA, ponownie zdefiniowana treść funkcji z 0056 z JEDNĄ zmianą
-- merytoryczną: czyszczeniem `custom_fields` na kliencie i na jego
-- zamówieniach, policzonym w `details` dziennika pod kluczem `pola_wlasne`.
-- Reszta ciała jest identyczna z 0056 — funkcje zmieniamy w całości, bo
-- Postgres nie zna łatek na ciało.
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
  v_custom      int := 0;
  v_mode        text;
begin
  if v_tenant is null then
    raise exception 'Brak kontekstu najemcy.' using errcode = '42501';
  end if;

  if not app.is_tenant_owner() then
    raise exception
      'Usunięcie danych klienta jest zastrzeżone dla właściciela organizacji.'
      using errcode = '42501';
  end if;

  if p_customer_id is null then
    raise exception 'Nie wskazano klienta.' using errcode = '22023';
  end if;

  select c.email, c.anonymized_at
    into v_email, v_anonymized
    from public.customers c
   where c.tenant_id = v_tenant
     and c.id = p_customer_id
     for update;

  if not found then
    raise exception
      'Klient nie istnieje albo nie należy do Twojej organizacji.'
      using errcode = '22023';
  end if;

  v_placeholder := 'usuniety-' || replace(p_customer_id::text, '-', '') || '@dane-usuniete.invalid';

  select coalesce(array_agg(o.id), array[]::uuid[])
    into v_order_ids
    from public.orders o
   where o.tenant_id = v_tenant
     and o.customer_id = p_customer_id;

  select coalesce(array_agg(d.storage_path), array[]::text[])
    into v_paths
    from public.contract_documents d
   where d.tenant_id = v_tenant
     and d.order_id = any (v_order_ids);

  if v_anonymized is not null then
    return jsonb_build_object(
      'mode', 'already_anonymized',
      'contract_paths', to_jsonb(v_paths),
      'orders', cardinality(v_order_ids)
    );
  end if;

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

  -- Pola własne zamówienia (C6-A1). Czyszczenie jest CAŁOŚCIOWE, jak przy
  -- notatkach: redakcja selektywna po polach byłaby zgadywaniem, które z nich
  -- operator wypełnił danymi osoby. Trigger walidacji przepuszcza to zawsze —
  -- USUNIĘCIE klucza jest dozwolone także pod definicją zarchiwizowaną.
  update public.orders o
     set custom_fields = '{}'::jsonb
   where o.tenant_id = v_tenant
     and o.customer_id = p_customer_id
     and o.custom_fields <> '{}'::jsonb;
  get diagnostics v_custom = row_count;

  delete from public.order_notes n
   where n.tenant_id = v_tenant
     and n.order_id = any (v_order_ids);
  get diagnostics v_notes = row_count;

  delete from public.customer_bans b
   where b.tenant_id = v_tenant
     and b.customer_id = p_customer_id;
  get diagnostics v_bans = row_count;

  if cardinality(v_order_ids) = 0 then
    delete from public.customers c
     where c.tenant_id = v_tenant
       and c.id = p_customer_id;
    v_mode := 'deleted';
  else
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
           custom_fields = '{}'::jsonb,
           anonymized_at = now()
     where c.tenant_id = v_tenant
       and c.id = p_customer_id;

    perform set_config('app.customer_erasure', 'off', true);
    v_mode := 'anonymized';
  end if;

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
      'pola_wlasne', v_custom,
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
    'bans', v_bans,
    'custom_fields', v_custom
  );
end;
$$;

comment on function app.erase_customer(uuid) is
  'Realizacja art. 17 RODO na kliencie najemcy (C2b, ADR-116; zasięg rozszerzony o pola własne w C6-A1, ADR-118). Wejście: identyfikator klienta. Wyjście: jsonb {mode: deleted|anonymized|already_anonymized, contract_paths: [ścieżki PDF do skasowania przez Storage API], liczniki}. Zasięg: customers (w tym custom_fields), orders.delivery_address_* i orders.custom_fields, email_logs (recipient+body), contract_documents.recipient, order_notes (usuwane), customer_bans (usuwane). SECURITY DEFINER — email_logs i audit_log są pod RLS niezapisywalne dla najemcy; wewnątrz: tenant z claimu, bramka app.is_tenant_owner(), jawny filtr tenant_id w każdym zapytaniu. Odmowy: 42501 (brak najemcy / nie właściciel), 22023 (brak lub cudzy klient).';

revoke all on function app.erase_customer(uuid) from public, anon;
grant execute on function app.erase_customer(uuid) to authenticated;

-- === END PROD MIGRATION 0057 ===
