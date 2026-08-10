-- 0061_revoke_sessions_on_role_removal.sql
-- Unieważnianie SESJI przy odebraniu roli (R12b, obrona w głąb H-01, ADR-127).
--
-- GRANICA WOBEC R12a (uczciwie). R12a (0060) wpięło predykaty LIVE
-- (`app.is_current_tenant_member`, `app.is_current_superadmin`) w komplet
-- polityk RLS: cofnięte członkostwo/superadmin jest już odcinane OD DANYCH
-- natychmiast, także dla surowego PostgREST trzymającego ważny JWT. To jest
-- twarda izolacja. Ta migracja jej NIE zastępuje i nie udaje, że unieważnia
-- token: access token to bezstanowy JWT ważny do `exp` (3600 s, config.toml) —
-- PostgREST honoruje go niezależnie od `auth.sessions`. To, co tu robimy, to
-- skrócenie DRUGIEJ osi problemu: SESJI. Usunięcie wiersza z `auth.sessions`
-- zabija token ODŚWIEŻAJĄCY (kaskadą lecą refresh tokeny), więc po wygaśnięciu
-- bieżącego access tokenu przeglądarka nie dostanie nowego — i domyka to UX,
-- na który guard aplikacji (osobno w tej samej gałęzi R12b) reaguje czystym
-- wylogowaniem zamiast cichego 403. Łączny dowód „dziura zamknięta" (surowy
-- token po unieważnieniu sesji ODBIJA SIĘ o RLS) opiera się na R12a i jest
-- pokazany testem w packages/db/test/session-revocation.test.ts.
--
-- CO POWSTAJE:
--   1. app.revoke_user_sessions(p_user_id uuid) — SECURITY DEFINER, kasuje
--      wiersze auth.sessions danego użytkownika. BEZ grantów dla anon/
--      authenticated: gdyby rola API mogła ją wołać z własnym argumentem,
--      powstałby prymityw „wyloguj DOWOLNEGO użytkownika". Woła ją WYŁĄCZNIE
--      wyzwalacz, przekazując cel z OLD wiersza.
--   2. app.revoke_sessions_on_role_removal() — funkcja wyzwalacza AFTER DELETE,
--      wspólna dla obu tabel (obie mają kolumnę user_id). Cel to OLD.user_id,
--      NIGDY wartość z wejścia — to jest ta różnica, która oddziela poprawne
--      odcięcie odebranego członka od prymitywu wylogowania cudzej sesji.
--   3. Wyzwalacze AFTER DELETE na public.members i app.superadmins.
--
-- DLACZEGO WYZWALACZ SUPERADMINA. Panel NIE MA ścieżki odbierania superadmina
-- (nadanie/odebranie to service-role poza samoobsługą — 0003), więc żaden kod
-- aplikacji nie mógłby zawołać unieważnienia po odebraniu wpisu z
-- app.superadmins. Wyzwalacz łapie to bez względu na kanał (Studio, service-
-- role, przyszły endpoint).
--
-- DLACZEGO TYLKO AFTER DELETE, A NIE AFTER UPDATE (downgrade owner→staff).
-- Świadome pominięcie (ADR-127). Degradacja ownera do staffa jest już domknięta
-- DWIEMA warstwami bez ruszania sesji: (a) w BAZIE — polityki ownera stoją na
-- `app.is_tenant_owner()` (0007, awansowana na DEFINER w 0060), która czyta
-- members.role NA ŻYWO, więc operacje owner-only odbijają się natychmiast; (b)
-- w APLIKACJI — guard panelu (R12b) czyta rolę z bazy, nie z claimu, więc
-- zdegradowany owner traci wejścia owner-only od następnego żądania. Wyrzucanie
-- go z sesji przy każdej zmianie roli byłoby brutalne (przelogowanie przy
-- rutynowej zmianie uprawnień) bez zysku bezpieczeństwa — obie dziury już
-- zamknięte. Wyzwalacz odpala się więc tylko przy PEŁNYM cofnięciu (usunięcie
-- członkostwa / superadmina), gdzie stary tenant_id/superadmin w claimie jest
-- w całości nieaktualny i ponowne logowanie jest właściwym lekarstwem.
--
-- KASKADY SĄ NIESZKODLIWE. `members` wisi na `tenants` i `auth.users` z
-- ON DELETE CASCADE, `app.superadmins` na `auth.users` z ON DELETE CASCADE.
--   * Usunięcie tenanta → kasuje jego członków → wyzwalacz unieważnia ich
--     sesje. To POPRAWNE: ich claim tenant_id właśnie przestał istnieć.
--   * Usunięcie konta (auth.users) → kaskaduje na members/superadmins ORAZ na
--     auth.sessions (FK). `delete from auth.sessions where user_id = OLD` trafia
--     wtedy w wiersze już znikające tą samą kaskadą — kasuje 0 lub te same
--     wiersze, nigdy nie rzuca. Nieszkodliwe z definicji.
-- Wyzwalacz jest AFTER DELETE, więc odpala się dopiero, gdy BEFORE-owy
-- `members_last_owner_guard` (0051) przepuścił usunięcie — nie ma styku, w
-- którym unieważnienie sesji wyprzedziłoby guard ostatniego ownera.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md): brak nowych tabel → bez
-- zmian w macierzy izolacji RLS i bez fabryk w seed-tenants.ts; funkcje
-- SECURITY DEFINER z przypiętym search_path i wyłącznie schema-kwalifikowanymi
-- odwołaniami; `revoke all` przed (nie)grantami; żadnych nowych indeksów —
-- `delete from auth.sessions where user_id = ...` trafia w indeks
-- auth.sessions(user_id) obecny w schemacie GoTrue.

-- === BEGIN PROD MIGRATION 0061 ===

-- ---------------------------------------------------------------------
-- 1. app.revoke_user_sessions — kasuje sesje jednego użytkownika
-- ---------------------------------------------------------------------
--
-- SECURITY DEFINER: `auth.sessions` należy do supabase_auth_admin, a rola
-- `authenticated` nie ma do niej GRANT-u (i mieć nie powinna). Funkcja działa
-- z prawami właściciela migracji, który tą tabelą zarządza — dokładnie ten sam
-- wzorzec, którym 0003 (custom_access_token) i 0039 (tenant_member_emails)
-- sięgają do schematu `auth`. Usunięcie sesji kaskaduje na refresh tokeny
-- (auth.refresh_tokens.session_id → auth.sessions ON DELETE CASCADE w GoTrue).
--
-- Argument p_user_id jest tu BEZPIECZNY wyłącznie dlatego, że jedynym
-- wołającym jest wyzwalacz podający OLD.user_id. Brak grantu dla anon/
-- authenticated jest częścią kontraktu bezpieczeństwa, nie higieną: to on
-- odbiera każdemu spoza wyzwalacza możliwość wskazania cudzego user_id.
create or replace function app.revoke_user_sessions(p_user_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, auth, app
as $$
  delete from auth.sessions where user_id = p_user_id;
$$;

comment on function app.revoke_user_sessions(uuid) is
  'R12b/H-01: kasuje wszystkie wiersze auth.sessions użytkownika (refresh tokeny lecą kaskadą). '
  'SECURITY DEFINER — auth.sessions należy do supabase_auth_admin. BEZ grantów dla anon/authenticated: '
  'wołana wyłącznie przez wyzwalacz z OLD.user_id; wystawienie jej roli API dałoby prymityw wylogowania cudzej sesji. '
  'NIE unieważnia access tokenu (bezstanowy JWT ważny do exp) — twardą izolacją danych jest R12a (predykaty live w RLS).';

-- Domknięcie powierzchni PostgREST: żadna rola API nie wykonuje tej funkcji.
revoke all on function app.revoke_user_sessions(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Funkcja wyzwalacza — cel z OLD, nigdy z wejścia
-- ---------------------------------------------------------------------
--
-- Wspólna dla members i superadmins: obie tabele mają kolumnę `user_id`, więc
-- `OLD.user_id` rozwiązuje się poprawnie dla każdej z nich. SECURITY DEFINER,
-- bo `app.revoke_user_sessions` nie ma grantu dla roli, która wykonuje DELETE
-- (owner usuwa członka jako `authenticated`); definer wykonuje ją prawami
-- właściciela. Zero danych na wyjściu — funkcja tylko unieważnia sesje i
-- zwraca OLD (wartość AFTER-triggera i tak jest ignorowana).
create or replace function app.revoke_sessions_on_role_removal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, app
as $$
begin
  perform app.revoke_user_sessions(OLD.user_id);
  return OLD;
end;
$$;

comment on function app.revoke_sessions_on_role_removal() is
  'R12b/H-01: funkcja wyzwalacza AFTER DELETE na public.members i app.superadmins. Unieważnia sesje '
  'użytkownika z OLD.user_id (NIGDY z wejścia — to odróżnia odcięcie odebranego członka od prymitywu '
  'wylogowania cudzej sesji). SECURITY DEFINER, bo app.revoke_user_sessions nie ma grantu dla roli API.';

-- ---------------------------------------------------------------------
-- 3. Wyzwalacze AFTER DELETE
-- ---------------------------------------------------------------------
--
-- AFTER (nie BEFORE): odpala się dopiero po tym, jak usunięcie faktycznie
-- zaszło — a więc po przepuszczeniu przez BEFORE-owy members_last_owner_guard
-- (0051). Osierocenie tenanta i unieważnienie sesji nie mogą się wyprzedzić.
create trigger revoke_sessions_on_member_delete
  after delete on public.members
  for each row execute function app.revoke_sessions_on_role_removal();

create trigger revoke_sessions_on_superadmin_delete
  after delete on app.superadmins
  for each row execute function app.revoke_sessions_on_role_removal();

-- === END PROD MIGRATION 0061 ===
