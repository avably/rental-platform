-- 0053_api_keys.sql
-- Klucze API per najemca dla publicznego API rezerwacji (M1, ADR-108).
--
-- STAN PRZED: jedyna publiczna droga do rezerwacji to Server Action
-- storefrontu (app.public_checkout). Zewnętrzny konsument maszynowy (wtyczka
-- WordPress — M2, embed — M3) nie ma się czym uwierzytelnić: tenant_secrets
-- (0024) trzyma sekrety WYCHODZĄCE (kurier, płatności), a nie przychodzące
-- poświadczenia klientów API.
--
-- STAN PO: tabela public.api_keys trzyma WYŁĄCZNIE sha256 surowego klucza
-- (wzorzec invitations.token_hash — surowy klucz istnieje tylko w ręku
-- klienta i przez moment w akcji panelu, która go generuje) + prefiks
-- identyfikacyjny do listy w panelu. Weryfikację klucza przychodzącego robi
-- app.verify_api_key — wąska ścieżka SECURITY DEFINER przyjmująca HASH
-- (nigdy surowy klucz: aplikacja hashuje przed wyjściem w sieć, więc surowy
-- klucz nie przechodzi nawet przez PostgREST) i zwracająca tenanta.
--
-- CO WIDZI ANON przez tę ścieżkę o kluczach, których NIE zna (pytanie
-- kontrolne ADR-108): nic. Funkcja odpowiada wyłącznie na pytanie „czy TEN
-- hash jest żywym kluczem" — a policzenie hasha wymaga posiadania surowego
-- klucza (preimage sha256). Zgadywanie hashy to przestrzeń 2^256; funkcja
-- nie zwraca żadnych danych o innych kluczach, nie rozróżnia „nie istnieje"
-- od „odwołany" i nie przyjmuje wzorców/prefiksów. Enumeracja niemożliwa
-- z konstrukcji.
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md):
--   * tabela per-tenant: tenant_id + indeks od tenant_id + RLS w tej samej
--     migracji + wpis w SAMPLE_ROW_FACTORIES/MUTATION_PATCHES (macierz RLS),
--   * revoke all PRZED grantami na nowej tabeli,
--   * funkcja z przypiętym search_path (pg_catalog, public, app),
--   * comment on z kontraktem.

-- ---------------------------------------------------------------------
-- 1. Tabela public.api_keys
-- ---------------------------------------------------------------------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Etykieta operatora („WordPress — strona firmowa”). Przycięta CHECK-iem,
  -- bo trafia na listę w panelu i do niczego więcej nie służy.
  name text not null check (length(btrim(name)) between 1 and 80),
  -- sha256(surowy klucz) hex — NIGDY plaintext. Unikat globalny: dwa wpisy
  -- z tym samym hashem to ten sam klucz, a lookup weryfikacji idzie po tej
  -- kolumnie.
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  -- Pierwsze znaki surowego klucza (avbl_ + 8 hex) — identyfikacja na
  -- ekranie („który to klucz”), bez wartości kryptograficznej.
  key_prefix text not null check (key_prefix ~ '^avbl_[0-9a-f]{8}$'),
  created_at timestamptz not null default now(),
  -- Odwołanie = znacznik, nie DELETE: lista w panelu ma pokazywać historię,
  -- a weryfikacja filtruje po `revoked_at is null`. Wiersz odwołany nie
  -- wraca do życia (aplikacja nie zeruje tej kolumny).
  revoked_at timestamptz,
  -- Ostatnie użycie — aktualizowane przez app.verify_api_key z dławieniem
  -- (raz na minutę), żeby gorąca ścieżka odczytów nie pisała przy każdym
  -- żądaniu.
  last_used_at timestamptz
);

comment on table public.api_keys is
  'Klucze publicznego API rezerwacji per najemca (M1, ADR-108). Wyłącznie sha256 surowego klucza (wzorzec invitations.token_hash) + prefiks do identyfikacji. Odczyt: członek tenanta. Mutacje: owner. Zero grantów dla anon — weryfikacja przychodzącego klucza wyłącznie przez app.verify_api_key.';

create index api_keys_tenant_id_created_at_idx
  on public.api_keys (tenant_id, created_at);

-- ---------------------------------------------------------------------
-- 2. RLS + granty
-- ---------------------------------------------------------------------
alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;

-- Bez DELETE: odwołanie jest UPDATE-em (revoked_at), a historia kluczy
-- zostaje. Brak polityki i grantu DELETE — macierz RLS testuje odmowę.
grant select, insert, update on public.api_keys to authenticated;
grant select, insert, update, delete on public.api_keys to service_role;

-- Odczyt listy: każdy członek tenanta (prefiksy i etykiety nie są sekretem;
-- surowego klucza w tabeli nie ma).
create policy tenant_select on public.api_keys for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());

-- Mutacje (generowanie, odwołanie): wyłącznie owner — klucz API to
-- poświadczenie całej organizacji, jak zapraszanie członków (wzorzec 0001).
create policy tenant_insert on public.api_keys for insert
  with check (tenant_id = app.tenant_id() and
              exists (select 1 from public.members m
                      where m.tenant_id = app.tenant_id()
                        and m.user_id = auth.uid() and m.role = 'owner'));
create policy tenant_update on public.api_keys for update
  using (tenant_id = app.tenant_id() and
         exists (select 1 from public.members m
                 where m.tenant_id = app.tenant_id()
                   and m.user_id = auth.uid() and m.role = 'owner'))
  with check (tenant_id = app.tenant_id() and
              exists (select 1 from public.members m
                      where m.tenant_id = app.tenant_id()
                        and m.user_id = auth.uid() and m.role = 'owner'));

-- ---------------------------------------------------------------------
-- 3. app.verify_api_key — jedyna ścieżka weryfikacji klucza przychodzącego
-- ---------------------------------------------------------------------
--
-- Przyjmuje HASH (nie surowy klucz — patrz nagłówek migracji). Zwraca
-- 0 wierszy dla hasha nieznanego, odwołanego i źle sformowanego — te trzy
-- przypadki są NIEROZRÓŻNIALNE (aplikacja oddaje jednolite 401, bez
-- enumeracji). Status tenanta wraca do aplikacji, żeby route mógł odróżnić
-- „zły klucz” (401) od „sklep niedostępny” (403) — posiadacz poprawnego
-- klucza i tak zna swojego tenanta, więc to rozróżnienie nic nie ujawnia.
create or replace function app.verify_api_key(p_key_hash text)
returns table (tenant_id uuid, key_id uuid, tenant_status text)
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
begin
  -- Format twardo na wejściu: wszystko poza 64-hex kończy się pustym
  -- wynikiem (jednolita odmowa), bez dotykania tabeli.
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  -- Dławione znaczenie ostatniego użycia: zapis najwyżej raz na minutę per
  -- klucz, żeby weryfikacja na gorącej ścieżce odczytów nie kosztowała
  -- UPDATE-u przy każdym żądaniu.
  update public.api_keys k
     set last_used_at = clock_timestamp()
   where k.key_hash = p_key_hash
     and k.revoked_at is null
     and (k.last_used_at is null
          or k.last_used_at < clock_timestamp() - interval '1 minute');

  -- Lookup po hashu (indeks unikalny). Porównanie prefiksem jest tu
  -- niereprezentowalne: równość całego hasha albo nic. Filtr
  -- `revoked_at is null` czyni klucz odwołany nieodróżnialnym od
  -- nieistniejącego.
  return query
    select k.tenant_id, k.id, t.status
      from public.api_keys k
      join public.tenants t on t.id = k.tenant_id
     where k.key_hash = p_key_hash
       and k.revoked_at is null;
end;
$$;

comment on function app.verify_api_key(text) is
  'Weryfikacja klucza publicznego API (M1, ADR-108). Wejście: sha256 hex surowego klucza (aplikacja hashuje PRZED wysyłką — surowy klucz nie przechodzi przez PostgREST). Wyjście: (tenant_id, key_id, tenant_status) dla klucza żywego; 0 wierszy dla nieznanego/odwołanego/źle sformowanego — nierozróżnialnie. Nie zwraca danych o innych kluczach; enumeracja wymaga preimage sha256. Aktualizuje last_used_at z dławieniem 1 min.';

revoke all on function app.verify_api_key(text) from public;
grant execute on function app.verify_api_key(text) to anon, authenticated, service_role;
