-- 0066_trial_clock.sql
-- ADR-135 / J2 faza 1: lokalny zegar triala — tenants.trial_ends_at.
--
-- KONTEKST. LP obiecuje „trial 14 dni bez karty" i (FAQ) „po czternastu
-- dniach nic się samo nie zdarzy". Do tej migracji zegar triala nie istniał
-- NIGDZIE: tenants.status='trialing' (default z 0001) nie miał daty końca,
-- więc ekran planu nie miał czego pokazać. Faza 1 J2 (decyzja PM po spike'u
-- 2026-08-10: rdzeń = stripe-native, kolejność = fazowanie) daje tenantowi
-- lokalny zegar i ekran stanu — i NIC poza tym.
--
-- ZASADA „JEDEN ZEGAR, NALEŻY DO STRIPE'A" (dunning, zasada 1) NIE JEST
-- ZŁAMANA: w fazie 1 Stripe'a nie ma, więc lokalny zegar jest JEDYNYM.
-- Od fazy 2 (subskrypcja Stripe) prawdą o trialu staje się subskrypcja
-- u dostawcy, a trial_ends_at zostaje PROJEKCJĄ tej prawdy (pisaną przez
-- webhook service-rolem) — nigdy drugim, równoległym licznikiem.
--
-- ZERO EGZEKWOWANIA (twarda granica fazy 1): trial_ends_at w przeszłości
-- NICZEGO nie zamyka, nie przekierowuje i nie blokuje — żaden guard panelu
-- ani bramka publicznej powierzchni tej kolumny NIE CZYTA (pilnuje tego
-- test apps/panel/test/trial-zero-enforcement.test.ts). Backfill
-- created_at + 14 dni daje wszystkim istniejącym tenantom datę w
-- PRZESZŁOŚCI — to POPRAWNE: ekran pokazuje stan zgodny z prawdą
-- i z obietnicą LP („nic się samo nie zdarzy"), a egzekucję wprowadzi
-- dopiero faza 2+ świadomą decyzją (okno dunningowe, zasada 8).
--
-- ŻADNYCH zmian w tenants.status, CHECK-ach statusów, bramkach publicznych
-- (predykat 0065) ani politykach zapisu z 0064. Znany punkt fazy 2 (W9 ze
-- spike'u): subscriptions.status wciąż BEZ CHECK-a (m.in. brak 'paused') —
-- domknie go migracja webhooka, nie ta.

-- === BEGIN PROD MIGRATION 0066 ===

-- ---------------------------------------------------------------------
-- 1. Kolumna zegara + backfill istniejących tenantów
-- ---------------------------------------------------------------------

alter table public.tenants
  add column trial_ends_at timestamptz;

comment on column public.tenants.trial_ends_at is
  'Koniec 14-dniowego triala (ADR-135, J2 faza 1). W fazie 1 zegar JEDYNY i wyłącznie '
  'INFORMACYJNY: niczego nie egzekwuje — data w przeszłości nie zamyka panelu ani sklepu '
  '(obietnica LP: „po czternastu dniach nic się samo nie zdarzy"). Od fazy 2 prawdę o trialu '
  'przejmuje subskrypcja Stripe, a ta kolumna zostaje PROJEKCJĄ stanu u dostawcy (pisze webhook '
  'service-rolem) — jeden zegar, nigdy dwa. NULL = bez terminu (wiersz założony poza '
  'app.create_tenant, np. przez service-role w testach).';

-- Backfill: created_at + 14 dni. Dla wszystkich istniejących tenantów data
-- wypada w przeszłości — CELOWO (patrz nagłówek): trial niczego nie
-- egzekwuje, a ekran ma pokazywać prawdę, nie fikcyjnie odnowiony trial.
update public.tenants
   set trial_ends_at = created_at + interval '14 days'
 where trial_ends_at is null;

-- ---------------------------------------------------------------------
-- 2. app.create_tenant — nowy tenant dostaje zegar triala
-- ---------------------------------------------------------------------

-- Pełna, najświeższa definicja (baza: 0023 — bramka slugów zarezerwowanych);
-- JEDYNĄ zmianą jest trial_ends_at w INSERT do tenants. Stare pliki migracji
-- nietknięte (wzorzec 0065).
create or replace function app.create_tenant(p_slug text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth, app
as $$
declare
  v_user_id uuid := auth.uid();
  v_email_confirmed boolean;
  v_tenant_count int;
  v_tenant_id uuid;
  v_host text;
begin
  if v_user_id is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;

  select (u.email_confirmed_at is not null)
    into v_email_confirmed
  from auth.users u
  where u.id = v_user_id;

  if coalesce(v_email_confirmed, false) is false then
    raise exception 'Adres e-mail nie został zweryfikowany.' using errcode = 'P0001';
  end if;

  select count(distinct m.tenant_id) into v_tenant_count
  from public.members m
  where m.user_id = v_user_id;

  if v_tenant_count >= 2 then
    raise exception 'Limit 2 organizacji na użytkownika został osiągnięty.' using errcode = 'P0002';
  end if;

  -- BRAMKA SLUGÓW ZAREZERWOWANYCH (0023). Bez niej najemca brał adres, pod
  -- którym routing nigdy nie znajdzie jego sklepu (ADR-039).
  if lower(btrim(p_slug)) = any (app.reserved_subdomains()) then
    raise exception 'Adres „%" jest zarezerwowany — wybierz inny.', lower(btrim(p_slug))
      using errcode = '22023';
  end if;

  -- ZEGAR TRIALA (0066, ADR-135): now() + 14 dni w TEJ SAMEJ transakcji co
  -- created_at (default now()), więc trial_ends_at - created_at = dokładnie
  -- 14 dni. Wartość wyłącznie informacyjna w fazie 1 — patrz komentarz kolumny.
  insert into public.tenants (slug, name, trial_ends_at)
  values (p_slug, p_name, now() + interval '14 days')
  returning id into v_tenant_id;

  insert into public.members (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner');

  -- Subdomena platformy (Zadanie 2.6). Lustro ROOT_DOMAIN z @avably/core.
  v_host := lower(p_slug) || '.avably.io';
  if v_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
     and length(v_host) <= 253
  then
    -- ON CONFLICT: host mógł już zostać zajęty (np. wcześniejszy tenant o tym
    -- slugu skasowany i odtworzony). UNIQUE na `domain` jest globalny, więc
    -- kolizja nie może wywrócić onboardingu — brak wiersza jest widoczny na
    -- ekranie domen i naprawialny, przerwana rejestracja organizacji nie.
    insert into public.domains (tenant_id, domain, kind, verified, verified_at)
    values (v_tenant_id, v_host, 'subdomain', true, now())
    on conflict (domain) do nothing;
  end if;

  return v_tenant_id;
end;
$$;

comment on function app.create_tenant(text, text) is
  'Onboarding organizacji: tenant + członkostwo ownera + subdomena w JEDNEJ transakcji. '
  'Slugi zarezerwowane odrzuca 22023 (0023, lustro RESERVED_SUBDOMAINS). Od 0066 (ADR-135) '
  'nowy tenant dostaje trial_ends_at = now() + 14 dni — zegar informacyjny fazy 1 J2, '
  'w fazie 2 przejmowany przez subskrypcję Stripe jako projekcja.';

-- ACL restated (konwencja ADR-132 / docs/konwencje-migracji.md): migracja
-- podmieniająca funkcję app.* jawnie potwierdza uprawnienia w tym samym
-- pliku. create or replace zachowuje ACL, ale stan ma być czytelny z tej
-- migracji, nie z archeologii. authenticated: onboarding woła zalogowany
-- użytkownik z panelu (bramki w ciele: potwierdzony e-mail, limit 2 org).
-- anon celowo BEZ grantu.
revoke all on function app.create_tenant(text, text) from public;
grant execute on function app.create_tenant(text, text) to authenticated;

-- === END PROD MIGRATION 0066 ===
