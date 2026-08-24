-- 0099_nip_lookup_cache_write_secret.sql
-- LUKA ZNALEZIONA W RECENZJI PRZED MERGE (ADR-234, 0097): zapis do cache'a
-- NIP dawał się SFABRYKOWAĆ przez zalogowanego usera, obchodząc wymóg
-- właściciela „NIP realnie istnieje w rejestrze".
--
-- PROBLEM. `app.nip_lookup_cache_put` (0097) miała `grant execute ... to
-- authenticated` i walidowała WYŁĄCZNIE kształt danych (NIP 10 cyfr, source
-- w {mf,gus}, data to obiekt) — NIE sprawdzała, że wołający jest NASZYM
-- serwerem. Schemat `app` jest wystawiony przez PostgREST (panel wszędzie
-- woła `supabase.schema("app").rpc(...)`), więc RPC jest osiągalne WPROST z
-- konsoli przeglądarki byle jakim ważnym JWT-em `authenticated`. Efekt: user
-- mógł wywołać `nip_lookup_cache_put('7740001454', {legalName:"COKOLWIEK",
-- regon:"cokolwiek", ...}, 'mf')` dla DOWOLNEGO NIP-u z poprawną sumą
-- kontrolną, a `app.create_tenant` (0098) — które ufa SAMEJ OBECNOŚCI wiersza
-- w cache'u jako dowodowi weryfikacji — przepuściłoby go jak prawdziwy wynik
-- MF/GUS. Nie jest to luka izolacji ani finansowa (dane są informacyjne, nie
-- ma tu cudzych pieniędzy/danych), ale wprost obchodzi decyzję właściciela
-- „NIP wymagany I WERYFIKOWANY" — samofabrykacja pól, którym baza miała
-- ufać jako świadectwu rejestru.
--
-- FIX — WZORZEC IDENTYCZNY z `app.checkout_ticket_keys` (0059, R13/H-02):
-- zapis wymaga SEKRETU PLATFORMY, którego przeglądarka (i JWT zalogowanego
-- usera) nie zna i znać nie może — zna go WYŁĄCZNIE serwer panelu (env
-- `REGISTRY_CACHE_WRITE_SECRET`, NIGDY `NEXT_PUBLIC_`). Sekret trzymamy jako
-- SHA-256 w jednowierszowej tabeli `app.registry_config` (nie GUC): tabela z
-- ZEREM grantów (łącznie z `service_role` — czyta WYŁĄCZNIE właściciel
-- funkcji przez SECURITY DEFINER, wzorzec `checkout_ticket_keys`) jest
-- jednoznacznie nieosiągalna przez PostgREST niezależnie od trybu poolera,
-- podczas gdy GUC-a dałoby się teoretycznie odczytać `current_setting()`
-- z dowolnego bezpośredniego połączenia SQL — w tym systemie WYŁĄCZNIE
-- PostgREST ma taki dostęp, więc różnica jest czysto obronna (defense in
-- depth), ale zerowe grantowanie tabeli jest jednoznaczniejsze niż poleganie
-- na tym, że nikt nigdy nie doda funkcji odczytującej GUC-a. SHA-256 (nie
-- surowy sekret jak w 0059) jest dodatkową warstwą: nawet gdyby kiedyś ktoś
-- przez pomyłkę dograntował odczyt tej tabeli, wyciekłby hash, nie sekret.
--
-- FAIL-CLOSED, ŚWIADOMIE ODWROTNIE NIŻ 0059. `checkout_ticket_keys` bez
-- sekretu PRZEPUSZCZA z ostrzeżeniem (dev-skip — blokowanie całego
-- checkoutu na starcie byłoby gorsze niż otwarta bramka w dev/CI). TU jest
-- odwrotnie: `write_secret_hash IS NULL` (sekret nieskonfigurowany) odrzuca
-- KAŻDY zapis. Powód: cały sens tej migracji to odebranie userowi możliwości
-- samodzielnego uwiarygodnienia NIP-u — „przepuszczaj, gdy nie ma sekretu"
-- byłoby dokładnie tą samą luką z dodatkowym krokiem. Cena: środowisko bez
-- skonfigurowanego sekretu ma CAŁKOWICIE zablokowane zakładanie organizacji
-- przez NIP (prefill dalej działa — patrz `apps/panel/lib/registry/
-- lookup-action.ts`, zapis do cache'a jest best-effort i nie blokuje
-- wyniku pokazanego userowi — ale `create_tenant` nigdy nie znajdzie wiersza
-- w cache'u, więc zawsze odmówi 22023 „NIP nie został zweryfikowany").
-- Local/CI: `packages/db/supabase/seed.sql` (nowy plik) zasiewa znany sekret
-- testowy — bezpieczny do commitowania, nie chroni niczego realnego.
--
-- ODMOWA errcode='42501' (insufficient_privilege — standardowa klasa 42,
-- NIE nowy kod P0), ŚWIADOMIE, nie 22023 obok reszty walidacji tej funkcji:
-- to jest odmowa UPRAWNIENIA („nie masz prawa pisać"), a nie odmowa
-- WALIDACJI KSZTAŁTU („to, co przysłałeś, jest źle uformowane") — te dwie
-- klasy trzyma osobno cała reszta bazy (np. `app.update_organization`, 0093:
-- 42501 dla braku uprawnień, 22023 dla złych danych). Zweryfikowane
-- empirycznie przy 0098 (patrz komentarz w 0098_create_tenant_nip.sql), że
-- PostgREST przepuszcza 42501 z pełną treścią — dokładnie tak samo jak
-- 22023, obie klasy standardowe. Kod NIE jest wyrocznią dla atakującego:
-- ta sama odmowa 42501 wychodzi zarówno przy braku `p_write_secret`, jak i
-- przy złym sekrecie, jak i przy nieskonfigurowanym `write_secret_hash`.
--
-- CZEGO TA MIGRACJA NIE RUSZA: `app.nip_lookup_cache_get` (odczyt danych
-- PUBLICZNYCH z rejestru — bez zmian, brief SPEC B), `app.nip_lookup_cache`
-- (tabela cache — bez zmian), `app.create_tenant` (0098 — bez zmian; gate
-- „czy wiersz istnieje w cache'u" był już poprawny, luka była WCZEŚNIEJ,
-- w tym, JAK ten wiersz mógł powstać).
--
-- === OPS (właściciel/PM, PRZED merge tego PR-a — kolejność wdrożenia jest
-- częścią tej migracji, nie dodatkiem, WZORZEC 0059) ===
--   1. wygeneruj sekret:              openssl rand -hex 32
--   2. wstaw go do env Vercela PANELU jako REGISTRY_CACHE_WRITE_SECRET
--      (serwerowy, BEZ NEXT_PUBLIC_), Production + Preview,
--   3. policz i wstaw HASH TEJ SAMEJ wartości do bazy (bezpośrednie
--      połączenie SQL jako postgres — Supabase SQL Editor albo psql; NIE
--      przez REST/service_role, bo tabela ma zero grantów nawet dla niego):
--        update app.registry_config
--        set write_secret_hash = encode(extensions.digest('<TA SAMA WARTOŚĆ>', 'sha256'), 'hex'),
--            updated_at = now()
--        where id = true;
--   4. dopiero potem merge / deploy kodu panelu.
-- Do czasu kroku 3: migracja jest już zastosowana, ale KAŻDA próba
-- zakończenia zakładania organizacji przez NIP kończy się odmową (fail-
-- closed) — nie jest to cichy regres bezpieczeństwa, jest to widoczna
-- (użytkownik dostaje błąd) blokada funkcji do czasu dokończenia OPS.
-- Rotacja: nadpisz `write_secret_hash` nowym hashem + podmień env — jeden
-- aktywny sekret na raz wystarcza (zapis, nie długożyjący token sesji).

-- ---------------------------------------------------------------------
-- 1. app.registry_config — hash sekretu zapisu (jednowierszowa)
-- ---------------------------------------------------------------------
create table app.registry_config (
  id boolean primary key default true,
  constraint registry_config_singleton check (id),
  -- 64 hex znaki = dokładnie SHA-256; NULL = sekret nieskonfigurowany
  -- (fail-closed, patrz wyżej). CHECK chroni przed pomyłką przy wklejaniu
  -- (ucięty/zły format hash), nie przed złym sekretem.
  write_secret_hash text check (write_secret_hash is null or write_secret_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

alter table app.registry_config enable row level security;

-- ZERO GRANTÓW, ŁĄCZNIE Z service_role — wzorzec app.checkout_ticket_keys
-- (0059). Jedyna droga odczytu to SECURITY DEFINER `nip_lookup_cache_put`
-- niżej (właściciel funkcji omija RLS/granty na własnych obiektach); jedyna
-- droga zapisu to bezpośrednie połączenie SQL jako postgres (OPS wyżej).
revoke all on table app.registry_config from public;
revoke all on table app.registry_config from anon, authenticated, service_role;

comment on table app.registry_config is
  'ADR-234/0099: hash (SHA-256) sekretu zapisu do app.nip_lookup_cache. ZERO grantów (nawet service_role) — '
  'czyta WYŁĄCZNIE app.nip_lookup_cache_put przez SECURITY DEFINER. Wartość NIE JEST W REPO — wstawia ją '
  'właściciel/PM na prodzie (patrz OPS w nagłówku migracji) i musi być hashem IDENTYCZNYM z '
  'REGISTRY_CACHE_WRITE_SECRET w env panelu. NULL = sekret nieskonfigurowany = KAŻDY zapis do cache''a '
  'odrzucony (fail-closed, odwrotnie niż checkout_ticket_keys — tu bezpieczna awaria to blokada, nie przepuszczenie).';

insert into app.registry_config (id, write_secret_hash) values (true, null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. app.nip_lookup_cache_put — dodatkowy parametr p_write_secret
-- ---------------------------------------------------------------------
-- DROP jawny: nowy parametr zmienia listę typów, więc `create or replace`
-- NIE zastąpiłoby starej sygnatury (text,jsonb,text,text) — zostawiłoby OBA
-- overloady żywe, z ambiguous-call przy wywołaniach bez p_write_secret
-- (dokładnie ta sama pułapka, którą 0098 rozwiązało dla app.create_tenant).
drop function if exists app.nip_lookup_cache_put(text, jsonb, text, text);

create or replace function app.nip_lookup_cache_put(
  p_nip text,
  p_data jsonb,
  p_source text,
  p_request_id text default null,
  p_write_secret text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app, extensions
as $$
declare
  v_expected_hash text;
begin
  if auth.uid() is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;

  select c.write_secret_hash into v_expected_hash
  from app.registry_config c
  where c.id = true;

  -- BRAMKA SEKRETU (0099) — jeden komunikat i jeden kod dla wszystkich
  -- przyczyn odmowy (brak sekretu skonfigurowanego / brak p_write_secret /
  -- zły p_write_secret), z tego samego powodu co assert_checkout_ticket
  -- (0059): rozróżnienie w treści błędu byłoby wyrocznią dla atakującego
  -- próbującego zgadnąć sekret.
  if v_expected_hash is null
     or p_write_secret is null
     or encode(extensions.digest(p_write_secret, 'sha256'), 'hex') <> v_expected_hash then
    raise exception 'Brak uprawnień do zapisu w rejestrze.' using errcode = '42501';
  end if;

  -- Walidacja kształtu — NIETKNIĘTA wobec 0097.
  if p_nip !~ '^[0-9]{10}$' then
    raise exception 'Nieprawidłowy NIP.' using errcode = '22023';
  end if;
  if p_source not in ('mf', 'gus') then
    raise exception 'Nieprawidłowe źródło danych rejestru.' using errcode = '22023';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Nieprawidłowe dane rejestru.' using errcode = '22023';
  end if;

  insert into app.nip_lookup_cache (nip, data, source, request_id, fetched_at)
  values (p_nip, p_data, p_source, p_request_id, now())
  on conflict (nip) do update
    set data = excluded.data,
        source = excluded.source,
        request_id = excluded.request_id,
        fetched_at = excluded.fetched_at;
end;
$$;

comment on function app.nip_lookup_cache_put(text, jsonb, text, text, text) is
  'ADR-234/0099: zapis (upsert) wyniku wyszukiwania NIP do cache. Wymaga p_write_secret zgodnego z hashem w '
  'app.registry_config — bez niego (albo gdy sekret nieskonfigurowany) odmowa 42501, niezależnie od poprawności '
  'kształtu danych. Zamyka lukę: zalogowany user z konsoli przeglądarki NIE MOŻE już sam sobie uwiarygodnić '
  'dowolnego NIP-u — sekret zna wyłącznie serwer panelu (env REGISTRY_CACHE_WRITE_SECRET, nigdy NEXT_PUBLIC_).';

revoke all on function app.nip_lookup_cache_put(text, jsonb, text, text, text) from public, anon;
grant execute on function app.nip_lookup_cache_put(text, jsonb, text, text, text) to authenticated, service_role;
