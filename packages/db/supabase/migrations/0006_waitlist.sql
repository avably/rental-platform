-- 0006_waitlist.sql
-- Waitlista produktu — model danych, RLS i jedyna ścieżka zapisu.
--
-- Tabela PLATFORMOWA, nie per-tenant: zapisy zbiera Avably jako produkt,
-- zanim jakikolwiek tenant istnieje. Stąd BRAK kolumny tenant_id i brak
-- polityk opartych o app.tenant_id() — izolacja nie przebiega tu między
-- najemcami, tylko między publicznością (anon) a platformą (superadmin).
--
-- UWAGA dla macierzy izolacji: automatyczna introspekcja w
-- packages/db/test/helpers/seed-tenants.ts (listTenantTables) wybiera tabele
-- PO KOLUMNIE tenant_id, więc tej tabeli NIE obejmuje. Bramka fail-closed dla
-- tabel platformowych jest osobna (listPlatformTablesWithoutRls) i tabela
-- musi ją spełniać — patrz packages/db/test/rls-isolation.test.ts.
--
-- Zawartość:
--   1. public.waitlist_signups — wiersz zapisu + deduplikacja po lower(email),
--   2. RLS fail-closed: anon i authenticated bez SELECT/UPDATE/DELETE,
--      odczyt wyłącznie dla superadmina (wzorzec z 0004),
--   3. app.join_waitlist(...) — SECURITY DEFINER RPC, jedyna ścieżka zapisu.

-- ---------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------

-- Konwencja projektu (0001, 0005): zbiory wartości to text + CHECK, nie
-- natywne typy enum — rozszerzenie listy jest wtedy zwykłą migracją bez
-- ALTER TYPE i bez blokad na typie współdzielonym przez inne obiekty.
create table public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) between 3 and 320),
  rental_type text not null
    check (rental_type in ('tools_construction','event','sports_outdoor','machinery','other')),
  other_equipment text check (other_equipment is null or length(other_equipment) <= 500),
  inventory_range text not null
    check (inventory_range in ('r1_20','r21_100','r101_500','r500_plus','launching')),
  current_process text not null
    check (current_process in ('calendar_spreadsheet','messages_phone','internal_tool','none')),
  pilot_interest boolean not null default false,
  phone text check (phone is null or length(phone) between 6 and 32),
  consent_at timestamptz not null,
  locale text not null default 'pl' check (locale in ('en','pl')),
  source text check (source is null or length(source) <= 200),
  campaign text check (campaign is null or length(campaign) <= 200),
  created_at timestamptz not null default now(),

  -- „Inne" wymaga doprecyzowania, a każdy inny typ wynajmu NIE MOŻE nieść
  -- tej wartości — inaczej pole staje się drugim, nieskatalogowanym
  -- wymiarem danych obok rental_type.
  constraint waitlist_signups_other_equipment_matches_type check (
    (rental_type = 'other' and other_equipment is not null and length(btrim(other_equipment)) > 0)
    or (rental_type <> 'other' and other_equipment is null)
  ),

  -- Telefon zbieramy WYŁĄCZNIE od chętnych na pilotaż — to jedyna podstawa,
  -- na jaką zgadza się zapisujący. Bez pilotażu numer nie ma prawa istnieć
  -- w wierszu, choćby przyszedł z formularza.
  constraint waitlist_signups_phone_requires_pilot check (
    phone is null or pilot_interest
  )
);

comment on table public.waitlist_signups is
  'Waitlista produktu (platformowa, bez tenant_id). Zapis wyłącznie przez app.join_waitlist(); odczyt wyłącznie dla superadmina. Single opt-in z zapisanym consent_at — double opt-in świadomie odroczony.';

comment on column public.waitlist_signups.consent_at is
  'Moment wyrażenia zgody. Zgoda jest warunkiem zapisu — kolumna jest NOT NULL, więc wiersz bez zgody jest niereprezentowalny.';

comment on column public.waitlist_signups.phone is
  'Telefon opcjonalny, dozwolony tylko przy pilot_interest = true (CHECK waitlist_signups_phone_requires_pilot).';

-- Deduplikacja case-insensitive. To jest JEDYNY mechanizm deduplikacji:
-- świadomie nie ma wcześniejszego SELECT-a (wyścig między odczytem a
-- zapisem + wymagałby prawa odczytu, którego ścieżka publiczna nie ma).
create unique index waitlist_signups_email_lower_key
  on public.waitlist_signups (lower(email));

-- ---------------------------------------------------------------------
-- 2. RLS — fail-closed
-- ---------------------------------------------------------------------

alter table public.waitlist_signups enable row level security;

-- REVOKE PRZED GRANT-em, i to nie jest formalność. Supabase ma w schemacie
-- public `alter default privileges ... grant all on tables to anon,
-- authenticated`, więc KAŻDA nowo utworzona tabela startuje z kompletem
-- domyślnych uprawnień dla obu ról publicznych — w tym TRUNCATE.
--
-- TRUNCATE jest tu istotny, bo NIE PODLEGA politykom RLS: rola z tym
-- uprawnieniem czyści tabelę niezależnie od tego, jak szczelne są polityki.
-- Zweryfikowane na żywej bazie: przed tym revoke `set role anon; truncate
-- public.waitlist_signups;` kasowało wszystkie wiersze. Polityki poniżej
-- broniłyby SELECT/UPDATE/DELETE i nie zauważyłyby tego w ogóle.
--
-- Stąd: najpierw zabieramy WSZYSTKO obu rolom publicznym, potem nadajemy
-- wyłącznie to, co jest potrzebne. Kolejność ma znaczenie — grant przed
-- revoke zostałby zdjęty.
revoke all on public.waitlist_signups from anon, authenticated;

-- anon nie dostaje NIC: ścieżka publiczna idzie wyłącznie przez RPC
-- (SECURITY DEFINER). Bez grantu tabelarycznego PostgREST nie wystawia tej
-- tabeli publiczności w ogóle — odmowa następuje na poziomie uprawnień,
-- zanim RLS dojdzie do głosu (dwie niezależne bramki, nie jedna).
--
-- authenticated dostaje SAM SELECT — i tak przefiltrowany polityką
-- superadmin_select. Brak INSERT/UPDATE/DELETE znaczy, że nawet zepsuta
-- polityka nie da zalogowanemu użytkownikowi prawa zapisu.
grant select on public.waitlist_signups to authenticated;
grant select, insert on public.waitlist_signups to service_role;

-- Odczyt listy = dane osobowe zapisujących. Tylko superadmin (wzorzec z
-- 0004: claim `superadmin` w JWT, weryfikowany przez app.is_superadmin()).
-- Brak polityk INSERT/UPDATE/DELETE dla authenticated i anon jest CELOWY —
-- RLS jest domyślnie fail-closed, więc brak polityki = brak dostępu.
create policy superadmin_select on public.waitlist_signups for select
  to authenticated
  using (app.is_superadmin());

-- ---------------------------------------------------------------------
-- 3. app.join_waitlist — jedyna ścieżka zapisu
-- ---------------------------------------------------------------------
--
-- DECYZJA: SECURITY DEFINER RPC zamiast wąskiej polityki INSERT-only dla anon.
-- Kryterium = najmniejsza powierzchnia:
--
--   * Polityka INSERT-only wymaga `grant insert on public.waitlist_signups
--     to anon`. PostgREST wystawia wtedy CAŁĄ tabelę pod POST /rest/v1/
--     waitlist_signups, a klient adresuje KAŻDĄ kolumnę, na którą ma grant —
--     w tym consent_at (podstawienie momentu zgody), created_at i id.
--     Zamknięcie tego wymaga rozbudowanego WITH CHECK powtarzającego logikę,
--     a powierzchnia i tak zostaje wielkości tabeli.
--   * RPC daje anonowi execute na JEDNEJ funkcji o ustalonej sygnaturze.
--     Kolumny nieobecne w sygnaturze (id, created_at, consent_at) ustala
--     wyłącznie serwer i klient nie ma jak ich dotknąć. Tabela pozostaje bez
--     jakiegokolwiek grantu dla anon.
--
-- SECURITY DEFINER (właściciel: postgres, BYPASSRLS) świadomie omija RLS przy
-- INSERT — dlatego walidacja poniżej jest JAWNA i pełna, a nie „ufamy
-- politykom". CHECK-i tabeli obowiązują niezależnie od trybu funkcji i są
-- ostatnią bramką integralności.
--
-- search_path przypięty (wzorzec z 0002): bez tego wywołujący mógłby
-- podstawić własne obiekty pod nieskwalifikowane nazwy — przy SECURITY
-- DEFINER oznaczałoby to wykonanie ich z uprawnieniami właściciela funkcji.
--
-- Zwraca 'success' albo 'duplicate'. Nie zwraca ŻADNYCH danych wiersza —
-- ścieżka publiczna nie ma prawa odczytu i RPC tego nie obchodzi.
create or replace function app.join_waitlist(
  p_email text,
  p_rental_type text,
  p_inventory_range text,
  p_current_process text,
  p_consent boolean,
  p_other_equipment text default null,
  p_pilot_interest boolean default false,
  p_phone text default null,
  p_locale text default 'pl',
  p_source text default null,
  p_campaign text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_email text := lower(btrim(p_email));
  v_other text := nullif(btrim(coalesce(p_other_equipment, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_pilot boolean := coalesce(p_pilot_interest, false);
  v_inserted uuid;
begin
  -- Zgoda jest warunkiem zapisu — sprawdzana PRZED czymkolwiek innym.
  if coalesce(p_consent, false) is not true then
    raise exception 'Zapis na waitlistę wymaga zgody.' using errcode = 'P0012';
  end if;

  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Nieprawidłowy adres e-mail.' using errcode = 'P0013';
  end if;

  if p_rental_type is null
     or p_rental_type not in ('tools_construction','event','sports_outdoor','machinery','other') then
    raise exception 'Nieprawidłowy typ wynajmu.' using errcode = 'P0013';
  end if;

  if p_inventory_range is null
     or p_inventory_range not in ('r1_20','r21_100','r101_500','r500_plus','launching') then
    raise exception 'Nieprawidłowy zakres inwentarza.' using errcode = 'P0013';
  end if;

  if p_current_process is null
     or p_current_process not in ('calendar_spreadsheet','messages_phone','internal_tool','none') then
    raise exception 'Nieprawidłowy obecny proces.' using errcode = 'P0013';
  end if;

  -- Zależności warunkowe egzekwowane też tutaj (nie tylko CHECK-iem), żeby
  -- RPC wywołane wprost dawało czytelny błąd zamiast naruszenia constraintu.
  if p_rental_type = 'other' and v_other is null then
    raise exception 'Typ „other" wymaga doprecyzowania sprzętu.' using errcode = 'P0013';
  end if;

  -- Nadmiarowe other_equipment przy innym typie jest ODRZUCANE, nie
  -- po cichu zerowane: cisza ukryłaby błąd po stronie wywołującego.
  if p_rental_type <> 'other' and v_other is not null then
    raise exception 'Doprecyzowanie sprzętu jest dozwolone wyłącznie dla typu „other".' using errcode = 'P0013';
  end if;

  if v_phone is not null and not v_pilot then
    raise exception 'Telefon jest dozwolony wyłącznie przy zgłoszeniu do pilotażu.' using errcode = 'P0013';
  end if;

  if p_locale is null or p_locale not in ('en','pl') then
    raise exception 'Nieobsługiwany język.' using errcode = 'P0013';
  end if;

  -- UTM bez walidacji treści (świadomie — to dane marketingowe, nie sterujące),
  -- ale z przycięciem długości: pole ma CHECK <= 200, a wejście jest publiczne.
  insert into public.waitlist_signups (
    email, rental_type, other_equipment, inventory_range, current_process,
    pilot_interest, phone, consent_at, locale, source, campaign
  )
  values (
    v_email, p_rental_type, v_other, p_inventory_range, p_current_process,
    v_pilot, v_phone, now(), p_locale,
    left(nullif(btrim(coalesce(p_source, '')), ''), 200),
    left(nullif(btrim(coalesce(p_campaign, '')), ''), 200)
  )
  on conflict (lower(email)) do nothing
  returning id into v_inserted;

  -- Brak zwróconego id = konflikt na unikalnym indeksie po lower(email).
  -- Deduplikacja rozstrzyga się WYŁĄCZNIE tutaj, atomowo — bez wyścigu,
  -- który miałby miejsce przy sprawdzaniu SELECT-em przed zapisem.
  if v_inserted is null then
    return 'duplicate';
  end if;

  return 'success';
end;
$$;

-- Publiczność wywołuje RPC anon keyem BEZ sesji — to jedyne uprawnienie
-- anona związane z waitlistą. `authenticated` również, bo zalogowany
-- użytkownik panelu odwiedzający LP to ta sama ścieżka publiczna.
grant execute on function app.join_waitlist(
  text, text, text, text, boolean, text, boolean, text, text, text, text
) to anon, authenticated;
