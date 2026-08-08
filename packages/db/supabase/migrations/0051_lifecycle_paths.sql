-- 0051_lifecycle_paths.sql
-- Ścieżki WYGASZANIA cyklu życia (L4, ADR-105). Rdzeń rezerwacyjny miał
-- wszędzie tworzenie i nigdzie wygaszania: członka można było dodać, ale nie
-- usunąć; zaproszenie wysłać, ale nie odwołać. Ta migracja domyka dwie z tych
-- luk PO STRONIE BAZY — bo obie da się obejść surowym żądaniem na kluczu
-- użytkownika, więc warstwa aplikacji nie jest tu bramką, tylko interfejsem.
--
-- Zawartość:
--   1. invitations.revoked_at — odwołanie zaproszenia (model: znacznik czasu,
--      nie kolumna statusu; uzasadnienie w ADR-105 D2),
--   2. app.accept_invitation — ODRZUCA zaproszenie odwołane (bez tego kolumna
--      z pkt 1 jest odwołaniem, które niczego nie odwołuje: przycisk mówi
--      sukces, a link dalej wpuszcza obcego do tenanta),
--   3. app.members_last_owner_guard() + trigger na public.members — tenant nie
--      może zostać bez ownera (usunięcie ani degradacja ostatniego).
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md, nagłówki 0007/0011/0013):
--   * guard rzuca STANDARDOWYM SQLSTATE 23514 (check_violation) — kody P0xxx
--     PostgREST potrafi zjeść do gołego 500 bez treści, a ten komunikat ma
--     dojechać do operatora,
--   * funkcje SECURITY DEFINER z przypiętym search_path i wyłącznie
--     schema-kwalifikowanymi odwołaniami,
--   * brak nowych tabel → macierz izolacji RLS (packages/db/test/helpers/
--     seed-tenants.ts) nie wymaga nowych fabryk ani patchy mutacji.

-- === BEGIN PROD MIGRATION 0051 ===

-- ---------------------------------------------------------------------
-- 1. invitations.revoked_at (ADR-105 D2)
-- ---------------------------------------------------------------------
--
-- Znacznik czasu, nie kolumna `status`: status zaproszenia jest FUNKCJĄ trzech
-- niezależnych faktów (accepted_at, revoked_at, expires_at) i kolumna `status`
-- musiałaby być z nimi ręcznie synchronizowana przy każdym zapisie — czyli
-- dawałaby drugie, rozjeżdżalne źródło prawdy. Prezentację statusu liczy
-- warstwa odczytu (panel: accepted → revoked → expired → pending).
--
-- RLS: żadnych nowych polityk. Odwołanie to UPDATE na invitations, a polityka
-- tenant_update (0001_core.sql) już ogranicza je do ownera własnego tenanta.
alter table public.invitations
  add column revoked_at timestamptz;

comment on column public.invitations.revoked_at is
  'Moment odwołania zaproszenia przez ownera (ADR-105). NULL = nieodwołane. Odwołane zaproszenie jest odrzucane przez app.accept_invitation niezależnie od expires_at/accepted_at.';

-- ---------------------------------------------------------------------
-- 2. app.accept_invitation — odwołanie MUSI odrzucać token
-- ---------------------------------------------------------------------
--
-- Pełna redefinicja (create or replace) zamiast łatki: ciało funkcji jest
-- jednym miejscem prawdy o warunkach wejścia do tenanta i czyta się je
-- w całości. Zmiana wobec 0003_auth.sql to WYŁĄCZNIE nowy warunek revoked_at
-- — reszta ciała jest przeniesiona bez modyfikacji.
--
-- Kolejność warunków: odwołanie sprawdzamy PRZED wygaśnięciem i adresem, bo
-- „odwołane" jest faktem mocniejszym (decyzja ownera) niż upływ czasu, a
-- komunikat ma nie sugerować, że wystarczy poprosić o przedłużenie.
create or replace function app.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth, app
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invitation record;
begin
  if v_user_id is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;

  select u.email into v_user_email from auth.users u where u.id = v_user_id;

  select i.* into v_invitation
  from public.invitations i
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if not found then
    raise exception 'Zaproszenie nie istnieje lub token jest nieprawidłowy.' using errcode = 'P0003';
  end if;

  if v_invitation.accepted_at is not null then
    raise exception 'Zaproszenie zostało już wykorzystane.' using errcode = 'P0004';
  end if;

  if v_invitation.revoked_at is not null then
    raise exception 'Zaproszenie zostało odwołane.' using errcode = 'P0007';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'Zaproszenie wygasło.' using errcode = 'P0005';
  end if;

  if lower(v_invitation.email) <> lower(coalesce(v_user_email, '')) then
    raise exception 'Zaproszenie zostało wystawione na inny adres e-mail.' using errcode = 'P0006';
  end if;

  insert into public.members (tenant_id, user_id, role)
  values (v_invitation.tenant_id, v_user_id, v_invitation.role)
  on conflict (tenant_id, user_id) do nothing;

  update public.invitations set accepted_at = now() where id = v_invitation.id;

  return v_invitation.tenant_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Guard ostatniego ownera (ADR-105 D3)
-- ---------------------------------------------------------------------
--
-- Bez tego usuwanie członków robi tenanta NIEZARZĄDZALNYM: zapraszać, usuwać
-- i zmieniać ustawienia może wyłącznie owner (polityki 0001_core.sql), więc
-- tenant bez ownera to tenant zamknięty na klucz od środka — i to stan, do
-- którego prowadzi jedno kliknięcie „usuń siebie".
--
-- DLACZEGO TRIGGER, A NIE SERVER ACTION: polityki RLS pozwalają ownerowi
-- usunąć KAŻDY wiersz members swojego tenanta, a PostgREST jest wystawiony
-- publicznie — kto ma token ownera i klucz anon, ten robi DELETE bez naszego
-- kodu po drodze. Guard w akcji serwerowej broniłby wyłącznie przycisku.
--
-- SECURITY DEFINER: funkcja czyta auth.users (wykrycie kaskady, niżej), do
-- której rola `authenticated` nie ma GRANT-u. Nie zwraca danych — jedyne, co
-- z niej wychodzi, to przepuszczenie wiersza albo wyjątek — więc nie ma czym
-- przeciec między tenantami; pytania zadaje wyłącznie o wiersze tenanta
-- mutowanego wiersza (OLD.tenant_id), nigdy o cudze.
--
-- KASKADY: `members` wisi na `tenants` i `auth.users` z ON DELETE CASCADE.
-- Usunięcie tenanta (albo konta ostatniego ownera) kasuje jego członkostwa
-- i guard NIE MA PRAWA tego blokować — inaczej nie da się skasować ani
-- organizacji, ani użytkownika. Kaskadę rozpoznajemy po tym, że wiersz
-- rodzica już nie istnieje: akcje referencyjne odpalają się jako AFTER na
-- rodzicu, więc w momencie naszego BEFORE na dziecku rodzic jest już usunięty.
create or replace function app.members_last_owner_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, app
as $$
declare
  v_keeps_owner boolean;
begin
  -- Wiersz, który nie był ownerem, nie ma jak osierocić tenanta. Tak samo
  -- update, po którym ten sam wiersz DALEJ jest ownerem tego samego tenanta.
  if OLD.role <> 'owner'
     or (TG_OP = 'UPDATE'
         and NEW.role = 'owner'
         and NEW.tenant_id = OLD.tenant_id
         and NEW.user_id = OLD.user_id) then
    v_keeps_owner := true;
  -- Kaskada usunięcia rodzica — patrz nagłówek sekcji.
  elsif not exists (select 1 from public.tenants t where t.id = OLD.tenant_id)
        or not exists (select 1 from auth.users u where u.id = OLD.user_id) then
    v_keeps_owner := true;
  else
    -- Zapytanie widzi zmiany dokonane wcześniej W TYM SAMYM poleceniu, więc
    -- zbiorcze `delete from members where tenant_id = ...` też rozbija się
    -- o guard — na ostatnim ownerze, nie na pierwszym.
    v_keeps_owner := exists (
      select 1 from public.members m
      where m.tenant_id = OLD.tenant_id
        and m.role = 'owner'
        and m.user_id <> OLD.user_id
    );
  end if;

  if not v_keeps_owner then
    raise exception
      'Organizacja musi mieć co najmniej jednego właściciela — nie można usunąć ani zdegradować ostatniego.'
      using errcode = '23514';
  end if;

  if TG_OP = 'UPDATE' then
    return NEW;
  end if;
  return OLD;
end;
$$;

comment on function app.members_last_owner_guard() is
  'Guard ostatniego ownera tenanta (ADR-105): blokuje usunięcie i degradację ostatniego wiersza members o roli owner, przepuszczając kaskady usunięcia tenanta/konta. Rzuca 23514.';

create trigger members_last_owner_guard
  before delete or update on public.members
  for each row execute function app.members_last_owner_guard();

-- === END PROD MIGRATION 0051 ===
