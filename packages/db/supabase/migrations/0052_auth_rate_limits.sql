-- 0052_auth_rate_limits.sql
-- Współdzielony licznik rate-limit dla tras publicznych (L2, ADR-106).
--
-- STAN PRZED: limit tempa (@avably/security/rate-limit) liczy w pamięci
-- procesu — na hostingu bezstanowym każda instancja/lambda ma WŁASNY licznik,
-- więc limit globalny praktycznie nie istnieje (TODO(infra) w docblocku
-- modułu). Ścieżka Upstash wymaga konta u dodatkowego dostawcy i nigdy nie
-- została skonfigurowana.
--
-- STAN PO: licznik okna stałego w Postgresie — tabela platformowa
-- public.rate_limit_counters + funkcja app.check_rate_limit (SECURITY
-- DEFINER). Wszystkie instancje aplikacji współdzielą bazę, więc limit jest
-- globalny bez nowego dostawcy i bez akcji właściciela.
--
-- DLACZEGO OKNO STAŁE, NIE PRZESUWNE (rozstrzygnięcie ADR-106): jeden
-- atomowy upsert na wywołanie (INSERT … ON CONFLICT DO UPDATE), zero
-- przechowywania znaczników czasu per żądanie. Koszt: na granicy okien
-- chwilowy burst do 2× progu — akceptowalny dla dławienia auth (progi są
-- małe, to nie billing).
--
-- BEZ tenant_id — limit działa PRZED zalogowaniem (trasy anonimowe), klucz
-- to wymiar techniczny (prefix:akcja:ip/email), nie dane tenanta. Macierz
-- RLS nie autowykryje tej tabeli jako per-tenant, dlatego JAWNIE: RLS
-- włączone, ZERO polityk i zero grantów dla anon/authenticated — jedyna
-- droga do liczników to app.check_rate_limit. Test negatywny:
-- packages/db/test/auth-rate-limit.test.ts.
--
-- RYZYKO SZCZĄTKOWE (spisane w ADR-106): funkcja ma grant dla anon (limit
-- musi działać dla niezalogowanych), więc posiadacz klucza anon może wołać
-- ją wprost i (a) pre-wyczerpać zgadywalny klucz — to samo osiąga spamując
-- formularz, żadna nowa klasa ataku; (b) puchnąć tabelę unikatowymi
-- kluczami — ograniczone twardym capem długości klucza (128), walidacją
-- argumentów (22023) i leniwym sprzątaniem przy każdym zapisie.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md):
--   * revoke all PRZED grantami na nowej tabeli (0006/0008),
--   * funkcja z przypiętym search_path (pg_catalog, public, app),
--   * wyłącznie standardowe SQLSTATE (22023) — P0xxx PostgREST zjada do 500,
--   * comment on function z kontraktem i kodami odmowy.

-- ---------------------------------------------------------------------
-- 1. Tabela platformowa public.rate_limit_counters
-- ---------------------------------------------------------------------
--
-- Jeden wiersz = jeden klucz limitu w jednym oknie stałym. Klucz niesie
-- prefiks przestrzeni (panel-auth-rl / storefront-public-rl) już po stronie
-- aplikacji, więc tabela nie zna semantyki wymiarów.
create table public.rate_limit_counters (
  bucket_key text not null check (length(bucket_key) between 1 and 128),
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (bucket_key, window_start)
);

comment on table public.rate_limit_counters is
  'Liczniki okna stałego rate-limitu (L2, ADR-106). Tabela platformowa BEZ tenant_id — limity działają przed zalogowaniem. Zero grantów dla anon/authenticated; dostęp wyłącznie przez app.check_rate_limit.';

alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from anon, authenticated;
-- ZERO polityk RLS z konstrukcji: nawet gdyby grant wrócił regresją, brak
-- polityk dalej odcina anon/authenticated od wierszy.

-- Leniwe sprzątanie skanuje po czasie — indeks poza kluczem głównym.
create index rate_limit_counters_window_start_idx
  on public.rate_limit_counters (window_start);

-- ---------------------------------------------------------------------
-- 2. app.check_rate_limit — jedyna droga do liczników
-- ---------------------------------------------------------------------
create or replace function app.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (success boolean, remaining integer)
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  -- Twarde capy argumentów: funkcja jest wykonywalna kluczem anon, więc
  -- walidacja to jedyna zapora przed śmieciowymi kluczami i absurdalnymi
  -- oknami. 22023 = invalid_parameter_value (PostgREST → 400).
  if p_key is null or length(p_key) not between 1 and 128
     or p_limit is null or p_limit not between 1 and 1000
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'nieprawidlowe argumenty rate-limit' using errcode = '22023';
  end if;

  -- Okno stałe: początek okna wyznacza zaokrąglenie zegara w dół do
  -- wielokrotności szerokości okna — wszystkie instancje liczą to samo okno
  -- bez koordynacji.
  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  -- Leniwe sprzątanie (bez pg_cron):
  --  a) stare okna bieżącego klucza — utrzymuje ~1 wiersz per aktywny klucz,
  delete from public.rate_limit_counters c
   where c.bucket_key = p_key
     and c.window_start < v_window_start;
  --  b) ograniczona porcja globalnie wygasłych wierszy (window_start starszy
  --     niż maksymalna dozwolona szerokość okna ⇒ okno na pewno zamknięte);
  --     LIMIT trzyma koszt pojedynczego wywołania w ryzach.
  delete from public.rate_limit_counters c
   where c.ctid in (
     select t.ctid
       from public.rate_limit_counters t
      where t.window_start < clock_timestamp() - interval '1 day'
      limit 50
   );

  -- Atomowy inkrement: dwie instancje trafiające w to samo okno nie zgubią
  -- żadnego zliczenia (upsert na kluczu głównym).
  insert into public.rate_limit_counters as c (bucket_key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
  do update set count = c.count + 1
  returning c.count into v_count;

  return query select v_count <= p_limit, greatest(0, p_limit - v_count);
end;
$$;

comment on function app.check_rate_limit(text, integer, integer) is
  'Atomowy licznik okna stałego dla rate-limitu (L2, ADR-106). Zwraca (success, remaining); success=false gdy licznik przekroczył p_limit w bieżącym oknie. Nie zwraca cudzych kluczy ani zawartości tabeli. Odmowy: 22023 przy złych argumentach (klucz 1–128 znaków, limit 1–1000, okno 1–86400 s). Leniwe sprzątanie starych okien przy każdym zapisie.';

revoke all on function app.check_rate_limit(text, integer, integer) from public;
grant execute on function app.check_rate_limit(text, integer, integer)
  to anon, authenticated, service_role;
