-- =====================================================================
-- 0098 — app.create_tenant PRZYJMUJE p_nip (ADR-234, L1)
-- =====================================================================
--
-- BAZUJE NA 0092 (najświeższa definicja — [[create-or-replace-szukaj-
-- ostatniej-definicji]]: 0070 dodał regulamin, 0092 dodał aktywną
-- preferencję po utworzeniu; TA migracja jest przepisana W CAŁOŚCI wobec
-- 0092, żadna z tamtych dwóch poprawek nie ginie).
--
-- CO SIĘ ZMIENIA: nowy opcjonalny parametr `p_nip text default null`.
-- CELOWO OPCJONALNY, mimo że produktowo NIP jest wymagany przy zakładaniu
-- organizacji (brief, decyzja właściciela #2) — powód jest BLAST RADIUS, nie
-- niedopatrzenie:
--
--   `app.create_tenant` jest dziś wołane z DZIESIĄTEK miejsc w testach
--   (grep na `rpcCreateTenant`/`.rpc("create_tenant"` w momencie pisania tej
--   migracji: packages/db/test/helpers/create-tenant.ts,
--   apps/panel/test/helpers/create-tenant.ts i >40 plików testowych obu
--   pakietów) jako fabryka "daj mi jakiegoś tenanta" DLA FUNKCJI NIEZWIĄZANYCH
--   z onboardingiem (katalog, zamówienia, płatności, RLS…). Zrobienie NIP-u
--   NOT NULL / wymaganego na poziomie RPC złamałoby CAŁĄ tę flotę fixture'ów
--   — nieproporcjonalne dla zadania, które dotyczy JEDNEGO ekranu
--   (/organizacja/nowa), i dokładnie ten sam kompromis, jaki 0070 przyjęło
--   dla `p_terms_version_id` (opcjonalny parametr, TWARDY gate WARUNKOWY
--   w ciele funkcji, a nie NOT NULL w sygnaturze).
--
--   TWARDY GATE PRODUKTOWY („nie da się założyć organizacji bez
--   zweryfikowanego NIP-u") stoi więc w DWÓCH miejscach, świadomie NIE w
--   sygnaturze RPC:
--     1. UI/akcja (/organizacja/nowa/form.tsx + actions.ts) — jedyna
--        PRAWDZIWA droga zakładania organizacji dla użytkownika: pole NIP
--        `required`, przycisk „Załóż organizację" zablokowany do udanej
--        weryfikacji, akcja serwerowa odmawia wywołania RPC bez potwierdzonego
--        NIP-u (bez okrążenia przez wyłączony JS — walidacja jest w Server
--        Action, nie tylko w komponencie klienckim).
--     2. TA migracja — GDY p_nip JEST podany, gate jest BEZWZGLĘDNY: zła suma
--        kontrolna albo brak odpowiadającego wpisu w app.nip_lookup_cache
--        (dowód realnej weryfikacji w rejestrze — 0097) odrzuca całe
--        wywołanie, zanim cokolwiek zostanie zapisane.
--
--   Ryzyko świadomie przyjęte i NIE ukrywane: caller z ważnym JWT, który
--   zawoła `app.create_tenant` BEZPOŚREDNIO (z pominięciem panelu) i pominie
--   `p_nip`, założy organizację bez danych firmowych — dokładnie tak, jak
--   dziś (przed tą migracją) każdy `create_tenant` robi to bez wyjątku.
--   Zamknięcie TEJ furtki (NIP naprawdę obowiązkowy dla KAŻDEGO wywołania
--   RPC) wymagałoby migracji całej floty fixture'ów na zweryfikowane NIP-y
--   testowe — odłożone jako follow-up, patrz raport zadania.
--
-- NIP JEST WERYFIKOWANY, NIE TYLKO SUMĄ KONTROLNĄ. `tenants_nip_checksum_check`
-- (0096) łapie syntaktycznie złe NIP-y niezależnie od ścieżki zapisu, ale
-- "realnie istnieje w rejestrze" (brief, decyzja właściciela #2) wymaga
-- dowodu SILNIEJSZEGO niż arytmetyka — stąd wymóg dopasowanego wiersza w
-- `app.nip_lookup_cache` (0097), zapisywanego WYŁĄCZNIE po udanym zapytaniu
-- do MF/GUS. `regon`/`legal_name` zapisywane na `tenants` pochodzą Z CACHE'A,
-- NIE z parametrów wołającego — klient nie ma jak wstrzyknąć nazwy/REGON-u
-- niezgodnych z tym, co rejestr faktycznie zwrócił dla tego NIP-u (oś
-- bezpieczeństwa z brief: „użytkownik nie wstrzyknie NIP-u obcej org").
--
-- CZEGO TA MIGRACJA ŚWIADOMIE NIE ROBI: NIE seeduje
-- `tenant_settings.contract_document`. CHECK z 0026 wymaga WSZYSTKICH pięciu
-- kluczy naraz (address, nip, email, terms_version, terms_body) z realną
-- treścią — `terms_version`/`terms_body` to WARUNKI NAJMU danej wypożyczalni
-- (tekst prawny operatora dla JEGO klientów), nie coś, co rejestr firm w
-- ogóle zna. Częściowy seed złamałby CHECK, a wypełnienie placeholderem
-- fabrykowałoby treść prawną pokazywaną klientom najemcy — gorsze niż brak
-- seedu. Adres z rejestru trafia do UI ekranu /ustawienia-umow innym
-- kanałem: przycisk „Pobierz dane" (bonus SPEC D) reużywa TĘ SAMĄ hybrydę
-- i cache, NIP startowy czyta z tenants.nip. Patrz raport zadania, punkt (c).

drop function if exists app.create_tenant(text, text, uuid);

create or replace function app.create_tenant(
  p_slug text,
  p_name text,
  p_terms_version_id uuid default null,
  p_nip text default null
)
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
  v_terms_id uuid;
  -- [0098] Tożsamość firmowa — NULL, dopóki p_nip nie przejdzie bramek niżej.
  v_nip text;
  v_regon text;
  v_legal_name text;
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

  select v.id into v_terms_id
  from public.platform_terms_versions v
  where v.effective_from is not null
    and v.effective_from <= now()
  order by v.version_no desc
  limit 1;

  if v_terms_id is not null then
    if p_terms_version_id is null then
      raise exception 'Do założenia organizacji wymagana jest akceptacja regulaminu.'
        using errcode = 'P0003';
    end if;
    if p_terms_version_id <> v_terms_id then
      raise exception 'Wskazana wersja regulaminu nie jest wersją obowiązującą — odśwież formularz i zaakceptuj aktualną.'
        using errcode = '22023';
    end if;
  elsif p_terms_version_id is not null then
    raise exception 'Wskazana wersja regulaminu nie obowiązuje.' using errcode = '22023';
  end if;

  -- [0098] WERYFIKACJA NIP — WARUNKOWA na obecności p_nip (patrz uzasadnienie
  -- opcjonalności w nagłówku migracji), ale gdy podany, BEZWZGLĘDNA: zła
  -- suma kontrolna albo brak dowodu weryfikacji w cache'u odrzuca całe
  -- wywołanie PRZED jakimkolwiek zapisem (żaden efekt uboczny na pół drogi).
  --
  -- ŚWIADOMIE errcode='22023' dla OBU odmów, NIE nowy kod klasy P0 (jak
  -- P0001/P0002/P0003 wyżej — zastane, sprzed tej migracji). ZWERYFIKOWANE
  -- EMPIRYCZNIE przy pisaniu tej migracji (raw curl + supabase-js przez
  -- PostgREST, lokalny Supabase 2.109.1): PostgREST rozpoznaje i przepuszcza
  -- pełny `code`+`message` dla klas standardowych (22 = data exception,
  -- 42 = access rule violation — 22023/42501 potwierdzone testem), ale
  -- WŁASNY kod spoza P0001 (np. P0004) dostaje ogólne HTTP 500 „Something
  -- went wrong" BEZ kodu i treści — sprawdzone też na ZASTANYM P0002 (limit
  -- organizacji), więc to nie jest usterka tej migracji, tylko odkryta przy
  -- okazji własność stosu (opisana w raporcie zadania ADR-234 dla PM/
  -- właściciela — P0002/P0003 mają ten sam problem w produkcyjnym
  -- `createTenantAction`, poza zakresem tego zadania). 22023 jest KLASĄ już
  -- używaną wyżej w tej samej funkcji (zła wersja regulaminu, zarezerwowany
  -- slug) — sprawdzona droga, więc NIP dziedziczy ją zamiast ryzykować kolejny
  -- maskowany kod.
  if p_nip is not null then
    v_nip := regexp_replace(p_nip, '[^0-9]', '', 'g');

    if not app.nip_checksum_valid(v_nip) then
      raise exception 'NIP jest nieprawidłowy.' using errcode = '22023';
    end if;

    select c.data ->> 'regon', c.data ->> 'legalName'
      into v_regon, v_legal_name
    from app.nip_lookup_cache c
    where c.nip = v_nip;

    if v_legal_name is null then
      raise exception 'NIP nie został zweryfikowany w rejestrze — użyj przycisku „Pobierz dane".'
        using errcode = '22023';
    end if;
  end if;

  if lower(btrim(p_slug)) = any (app.reserved_subdomains()) then
    raise exception 'Adres „%" jest zarezerwowany — wybierz inny.', lower(btrim(p_slug))
      using errcode = '22023';
  end if;

  insert into public.tenants (slug, name, trial_ends_at, nip, regon, legal_name)
  values (p_slug, p_name, now() + interval '14 days', v_nip, v_regon, v_legal_name)
  returning id into v_tenant_id;

  insert into public.members (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner');

  insert into app.user_active_tenant (user_id, tenant_id, updated_at)
  values (v_user_id, v_tenant_id, now())
  on conflict (user_id) do update
    set tenant_id = excluded.tenant_id,
        updated_at = now();

  if v_terms_id is not null then
    insert into public.platform_terms_acceptances (tenant_id, user_id, version_id, context)
    values (v_tenant_id, v_user_id, p_terms_version_id, 'tenant_creation');
  end if;

  v_host := lower(p_slug) || '.avably.io';
  if v_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
     and length(v_host) <= 253
  then
    insert into public.domains (tenant_id, domain, kind, verified, verified_at)
    values (v_tenant_id, v_host, 'subdomain', true, now())
    on conflict (domain) do nothing;
  end if;

  return v_tenant_id;
end;
$$;

comment on function app.create_tenant(text, text, uuid, text) is
  'Onboarding organizacji: tenant + członkostwo ownera + AKTYWNA PREFERENCJA (0092, ADR-224) + DOWÓD AKCEPTACJI REGULAMINU (0070, ADR-141) + subdomena w JEDNEJ transakcji. Slugi zarezerwowane odrzuca 22023 (0023); trial_ends_at = now() + 14 dni (0066, ADR-135). Wymuszenie twarde regulaminu (D5): przy obowiązującej wersji brak p_terms_version_id → P0003, wersja inna niż obowiązująca → 22023; bez obowiązującej wersji NULL przechodzi. [0098/ADR-234] p_nip OPCJONALNY (kompatybilność wsteczna z flotą fixture''ów — patrz nagłówek migracji), ale GDY PODANY: zła suma kontrolna → 22023, brak dowodu weryfikacji w app.nip_lookup_cache → 22023 (świadomie ta sama klasa, nie nowy kod P0 — PostgREST maskuje P0xxx spoza P0001 jako 500 bez treści, patrz komentarz w ciele funkcji); regon/legal_name zapisywane WYŁĄCZNIE z cache''a (nie z parametrów wołającego).';

revoke all on function app.create_tenant(text, text, uuid, text) from public;
grant execute on function app.create_tenant(text, text, uuid, text) to authenticated;
