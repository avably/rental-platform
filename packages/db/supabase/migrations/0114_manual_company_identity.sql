-- =====================================================================
-- 0114 — DANE FIRMOWE RĘCZNE, GDY REJESTR NIE ODPOWIADA (ADR-276)
-- =====================================================================
--
-- DECYZJA WŁAŚCICIELA 2026-08-26, ŚWIADOMIE TYMCZASOWA. ADR-234 (0096-0099)
-- postawił twardy warunek: organizacji nie da się założyć bez NIP-u, dla
-- którego istnieje DOWÓD weryfikacji w `app.nip_lookup_cache` (wiersz
-- zapisany wyłącznie przez serwer panelu, z sekretem 0099). Warunek jest
-- poprawny co do intencji i BLOKUJE REALNYCH KLIENTÓW:
--
--   • MF Biała lista zna wyłącznie podatników VAT. Przedsiębiorca ZWOLNIONY
--     PODMIOTOWO (art. 113 ust. 1 ustawy o VAT — do 200 tys. zł obrotu) w
--     wykazie NIE FIGURUJE. To nie jest wąski margines: mała wypożyczalnia
--     na starcie jest dokładnie tym przypadkiem, czyli sporą częścią grupy
--     docelowej.
--   • Fallback GUS BIR1.1 wymaga klucza (`GUS_BIR_USER_KEY`), którego na
--     produkcji dziś NIE MA — `gusUserKey()` zwraca null i hybryda degraduje
--     się do samego MF (apps/panel/lib/registry/gus.ts).
--
--   Suma tych dwóch: klient wpisuje POPRAWNY, ISTNIEJĄCY NIP, dostaje
--   „Rejestr chwilowo niedostępny, spróbuj ponownie", a ponowna próba nie
--   zmienia niczego, bo nic nie jest chwilowe. Konto nie powstaje NIGDY.
--   Bramka broniąca „danych z rejestru" odbierała nam klientów, których
--   rejestr po prostu nie opisuje.
--
-- CO TA MIGRACJA ZMIENIA. Wariant RĘCZNY staje się DOZWOLONY: gdy dla
-- podanego NIP-u nie ma dowodu w cache'u, `app.create_tenant` przyjmuje
-- nazwę rejestrową i REGON OD WOŁAJĄCEGO i zakłada organizację — ale
-- ZNACZY JĄ jako niezweryfikowaną. Znacznikiem jest nowa kolumna
-- `public.tenants.registry_verified_at`.
--
-- ══ DLACZEGO STEMPEL, A NIE `boolean` ══
--
-- `registry_verified_at timestamptz` odpowiada na dwa pytania jedną
-- kolumną: CZY (null vs nie-null) i KIEDY. Drugie jest potrzebne planowi
-- powrotu (ADR-276): po podpięciu klucza GUS chcemy re-weryfikować dane
-- najstarsze i te sprzed zmiany danych w rejestrze — a „kiedy ostatnio
-- potwierdzone" jest jedyną informacją, po której da się je uszeregować.
-- `boolean` kazałby dokładać drugą kolumnę przy pierwszej takiej potrzebie.
--
-- ══ STEMPLA NIE DA SIĘ WSTRZYKNĄĆ — I TO JEST TU CAŁE BEZPIECZEŃSTWO ══
--
-- Wariant ręczny z definicji przyjmuje nazwę firmy od użytkownika, więc
-- pole `legal_name` przestaje być dowodem czegokolwiek. Dowodem zostaje
-- WYŁĄCZNIE `registry_verified_at`, i ta kolumna jest NIEPODRABIALNA
-- KONSTRUKCYJNIE, na trzech niezależnych poziomach:
--
--   1. `app.create_tenant` NIE MA parametru, którym dałoby się ją podać.
--      Stempel powstaje jedynie w gałęzi „trafiony cache" jako `now()`.
--      Żądanie z `p_registry_verified_at` odbija się od PostgREST jako
--      „funkcja nie istnieje" (PGRST202) — nie ma czego walidować, bo nie
--      ma czego przyjąć.
--   2. `public.tenants` nie ma polityki UPDATE dla `authenticated` — jedyne
--      polityki zapisu to `superadmin_*` (0001). Owner nie może zrobić
--      `PATCH /tenants` na żadnej kolumnie, w tym na tej.
--   3. Jedyna droga zapisu na `tenants` dla ownera, `app.update_organization`
--      (0093), pisze DOKŁADNIE dwie kolumny (`name`, `locale`) — dopisanie
--      trzeciej wymagałoby migracji, nie żądania HTTP.
--
--   Symetrycznie w drugą stronę: gdy cache JEST trafiony, `legal_name` i
--   `regon` biorą się Z CACHE'A, a `p_legal_name`/`p_regon` od wołającego są
--   IGNOROWANE. Inaczej dałoby się skleić stempel weryfikacji z własną
--   nazwą firmy — czyli dokładnie to, przed czym broniło 0098.
--
-- ══ CZEGO TA MIGRACJA NIE OSŁABIA ══
--
-- Wszystkie zastane bramki `create_tenant` zostają CO DO ZNAKU: wymagane
-- zalogowanie (28000), potwierdzony e-mail (P0001), limit 2 organizacji na
-- użytkownika (P0002), akceptacja obowiązującego regulaminu (P0003/22023),
-- slugi zarezerwowane (22023), unikat sluga z indeksu (23505), suma
-- kontrolna NIP (22023). NIP pozostaje WYMAGANY produktowo (formularz +
-- akcja serwerowa) i dalej musi mieć poprawną sumę kontrolną, gdy jest
-- podany — wariant ręczny dotyczy WYŁĄCZNIE tego, czy rejestr POTWIERDZIŁ
-- dane firmy, nie tego, czy NIP w ogóle ma sens.
--
-- Ryzyko przyjęte świadomie i nazwane wprost: po tej migracji użytkownik z
-- potwierdzonym e-mailem może założyć organizację, podając dowolną nazwę
-- firmy przy poprawnym syntaktycznie NIP-ie. To jest CENA decyzji
-- właściciela, nie przeoczenie. Sufit nadużycia nie rośnie: limit 2
-- organizacji na użytkownika i wymóg potwierdzonego e-maila stoją bez
-- zmian, a każdy taki wiersz jest OZNACZONY (`registry_verified_at is
-- null`) — widoczny i w panelu najemcy, i w zapytaniu superadmina.
--
-- ══ `p_nip` DALEJ OPCJONALNY W SYGNATURZE ══
--
-- Powód bez zmian od 0098 (blast radius): `app.create_tenant` jest fabryką
-- tenanta w >40 plikach testowych obu pakietów. Twardy wymóg produktowy stoi
-- w formularzu i akcji serwerowej. `p_legal_name`/`p_regon` idą tą samą
-- drogą — opcjonalne w sygnaturze, ale ODRZUCANE (22023), gdy przyjdą BEZ
-- `p_nip`: dane firmowe bez NIP-u byłyby polem, którego nic w produkcie nie
-- czyta ani nie potrafi później zweryfikować. Ciche zignorowanie takiego
-- wywołania byłoby gorsze — wołający zobaczyłby sukces i puste kolumny.

-- ---------------------------------------------------------------------
-- 1. Kolumna znacznika
-- ---------------------------------------------------------------------
alter table public.tenants add column registry_verified_at timestamptz;

comment on column public.tenants.registry_verified_at is
  'ADR-276: MOMENT potwierdzenia danych firmowych w rejestrze (MF Biała lista / GUS BIR1.1). '
  'NULL = dane wpisane RĘCZNIE albo brak danych firmowych — organizacja działa, ale nazwa rejestrowa/REGON '
  'nie mają pokrycia w rejestrze. Stempluje WYŁĄCZNIE app.create_tenant w gałęzi "trafiony '
  'app.nip_lookup_cache" (0114); nie ma parametru RPC ani polityki UPDATE, którą dałoby się go wstrzyknąć. '
  'Hak pod re-weryfikację po podpięciu klucza GUS (plan powrotu z ADR-276) — samej re-weryfikacji jeszcze nie ma.';

-- ---------------------------------------------------------------------
-- 2. Backfill: organizacje, które PRZESZŁY weryfikację przed tą migracją
-- ---------------------------------------------------------------------
-- Przed 0114 `tenants.legal_name` mogła zostać zapisana DOKŁADNIE JEDNĄ
-- drogą dostępną najemcy: `app.create_tenant` (0098), które brało ją z
-- `app.nip_lookup_cache` i odmawiało, gdy wiersza w cache'u nie było. Zatem
-- „nip is not null and legal_name is not null" PRZED tą migracją znaczy
-- „potwierdzone w rejestrze" — a momentem potwierdzenia był `created_at`
-- tenanta (cache sprawdzany w TEJ SAMEJ transakcji co insert).
--
-- Zostawienie tych wierszy z NULL-em byłoby fałszywym oskarżeniem: ekran
-- pokazałby „Dane niezweryfikowane w rejestrze" organizacji, której dane
-- rejestr faktycznie potwierdził. Wybieramy stempel PRAWDZIWY (created_at),
-- nie `now()` — `now()` twierdziłby, że weryfikacja miała miejsce podczas
-- wdrożenia migracji, czyli kłamałby o tym, co ta kolumna mierzy.
--
-- Jedyna inna droga zapisu tych kolumn to `superadmin_update` (0001) —
-- czyli my, ręcznie. Takich wpisów nie ma (ADR-234 wszedł 2026-08-24,
-- dwa dni przed tą migracją).
update public.tenants
   set registry_verified_at = created_at
 where nip is not null
   and legal_name is not null
   and registry_verified_at is null;

-- ---------------------------------------------------------------------
-- 3. app.create_tenant — wariant ręczny + stempel weryfikacji
-- ---------------------------------------------------------------------
-- BAZUJE NA 0098 (najświeższa definicja — [[create-or-replace-szukaj-
-- ostatniej-definicji]]: 0070 dodał regulamin, 0092 aktywną preferencję,
-- 0098 NIP; TA migracja jest przepisana W CAŁOŚCI wobec 0098, żadna z
-- tamtych poprawek nie ginie). `create or replace` NIE UMIE dołożyć
-- parametrów — dopisałoby PRZECIĄŻENIE, a dwa przeciążenia w schemacie
-- wystawionym przez PostgREST to niejednoznaczność przy każdym wywołaniu.
-- Stąd drop + create, dokładnie jak w 0098.
drop function if exists app.create_tenant(text, text, uuid, text);

create or replace function app.create_tenant(
  p_slug text,
  p_name text,
  p_terms_version_id uuid default null,
  p_nip text default null,
  p_legal_name text default null,
  p_regon text default null
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
  -- [0114] Stempel weryfikacji rejestrowej. Ustawiany WYŁĄCZNIE w gałęzi
  -- „trafiony cache" — nie ma parametru, z którego mógłby przyjść.
  v_registry_verified_at timestamptz;
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

  -- [0114] Dane firmowe bez NIP-u nie mają jak istnieć — patrz nagłówek
  -- migracji. ODMOWA, nie ciche zignorowanie: wołający dostałby inaczej
  -- „sukces" i puste kolumny.
  if p_nip is null and (p_legal_name is not null or p_regon is not null) then
    raise exception 'Nazwa rejestrowa i REGON wymagają podania NIP-u.' using errcode = '22023';
  end if;

  -- [0098/0114] NIP — WARUNKOWY na obecności p_nip (patrz uzasadnienie
  -- opcjonalności w nagłówku migracji), ale gdy podany, SUMA KONTROLNA JEST
  -- BEZWZGLĘDNA: zła suma odrzuca całe wywołanie PRZED jakimkolwiek zapisem
  -- (żaden efekt uboczny na pół drogi).
  --
  -- ŚWIADOMIE errcode='22023' dla wszystkich odmów walidacyjnych, NIE nowy
  -- kod klasy P0 (jak P0001/P0002/P0003 wyżej — zastane, sprzed 0098).
  -- ZWERYFIKOWANE EMPIRYCZNIE przy 0098 (raw curl + supabase-js przez
  -- PostgREST, lokalny Supabase 2.109.1): PostgREST przepuszcza pełny
  -- `code`+`message` dla klas standardowych (22 = data exception,
  -- 42 = access rule violation), ale WŁASNY kod spoza P0001 (np. P0004)
  -- dostaje ogólne HTTP 500 „Something went wrong" BEZ kodu i treści.
  if p_nip is not null then
    v_nip := regexp_replace(p_nip, '[^0-9]', '', 'g');

    if not app.nip_checksum_valid(v_nip) then
      raise exception 'NIP jest nieprawidłowy.' using errcode = '22023';
    end if;

    select c.data ->> 'regon', c.data ->> 'legalName'
      into v_regon, v_legal_name
    from app.nip_lookup_cache c
    where c.nip = v_nip;

    if v_legal_name is not null then
      -- ŚCIEŻKA REJESTROWA (bez zmian wobec 0098 co do ŹRÓDŁA danych):
      -- legal_name/regon pochodzą Z CACHE'A, parametry wołającego są tu
      -- IGNOROWANE — inaczej dałoby się skleić stempel weryfikacji z własną
      -- nazwą firmy. Wiersz w cache'u może powstać wyłącznie przez
      -- app.nip_lookup_cache_put z sekretem platformy (0099), więc jego
      -- obecność jest dowodem realnego zapytania do MF/GUS.
      v_registry_verified_at := now();
    else
      -- ŚCIEŻKA RĘCZNA [0114] — rejestr nie potwierdził (podmiot zwolniony
      -- z VAT, brak klucza GUS, awaria rejestru). Dane bierzemy OD
      -- WOŁAJĄCEGO i NIE STEMPLUJEMY: v_registry_verified_at zostaje NULL.
      v_legal_name := nullif(btrim(coalesce(p_legal_name, '')), '');
      v_regon := nullif(regexp_replace(coalesce(p_regon, ''), '[^0-9]', '', 'g'), '');

      -- Limit długości jak w app.update_organization (0093) dla nazwy
      -- handlowej: kolumna jest bez limitu, więc stawia go funkcja.
      if v_legal_name is not null and length(v_legal_name) > 200 then
        raise exception 'Nazwa rejestrowa firmy jest za długa.' using errcode = '22023';
      end if;

      -- LUSTRO CHECK-u kolumny (0096: `^[0-9]{9}([0-9]{5})?$`) — sprawdzamy
      -- tu, żeby oddać czytelne 22023 zamiast surowego 23514 z CHECK-u,
      -- którego panel pokazałby jako „coś poszło nie tak" (wzorzec 0093).
      if v_regon is not null and v_regon !~ '^[0-9]{9}([0-9]{5})?$' then
        raise exception 'REGON jest nieprawidłowy — podaj 9 albo 14 cyfr.' using errcode = '22023';
      end if;
    end if;
  end if;

  if lower(btrim(p_slug)) = any (app.reserved_subdomains()) then
    raise exception 'Adres „%" jest zarezerwowany — wybierz inny.', lower(btrim(p_slug))
      using errcode = '22023';
  end if;

  insert into public.tenants (slug, name, trial_ends_at, nip, regon, legal_name, registry_verified_at)
  values (p_slug, p_name, now() + interval '14 days', v_nip, v_regon, v_legal_name, v_registry_verified_at)
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

comment on function app.create_tenant(text, text, uuid, text, text, text) is
  'Onboarding organizacji: tenant + członkostwo ownera + AKTYWNA PREFERENCJA (0092, ADR-224) + DOWÓD AKCEPTACJI REGULAMINU (0070, ADR-141) + subdomena w JEDNEJ transakcji. Slugi zarezerwowane odrzuca 22023 (0023); trial_ends_at = now() + 14 dni (0066, ADR-135). Wymuszenie twarde regulaminu (D5): przy obowiązującej wersji brak p_terms_version_id → P0003, wersja inna niż obowiązująca → 22023; bez obowiązującej wersji NULL przechodzi. [0098/ADR-234] p_nip OPCJONALNY (kompatybilność wsteczna z flotą fixture''ów), ale GDY PODANY, suma kontrolna jest BEZWZGLĘDNA (22023). [0114/ADR-276] DWA WARIANTY danych firmowych: (a) REJESTROWY — dla p_nip istnieje wiersz w app.nip_lookup_cache (0097/0099, zapis wyłącznie z sekretem platformy): legal_name/regon biorą się Z CACHE''A, parametry wołającego są IGNOROWANE, registry_verified_at = now(); (b) RĘCZNY — brak wiersza w cache''u: legal_name/regon biorą się z p_legal_name/p_regon (walidacja długości i kształtu REGON-u, 22023), a registry_verified_at zostaje NULL. Stempla NIE DA SIĘ podać parametrem — powstaje wyłącznie w wariancie (a). p_legal_name/p_regon BEZ p_nip → 22023.';

revoke all on function app.create_tenant(text, text, uuid, text, text, text) from public;
grant execute on function app.create_tenant(text, text, uuid, text, text, text) to authenticated;
