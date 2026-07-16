-- 0011_deposit_settlement.sql
-- Rozliczanie kaucji w BAZIE (Faza 1, Zadanie 5): strukturalny powód
-- potrącenia oraz niezmiennik salda rejestru deposit_events. Decyzje:
-- ADR-026 (kształt powodu + niezmiennik), ADR-027 (relacja rozliczenia
-- z payment_status — świadomie POZA bazą, w akcji panelu).
--
-- DLACZEGO W BAZIE: 0007 zapowiedział niezmiennik sumy wprost w komentarzu
-- tabeli („egzekwuje Zadanie 5"). Członek tenanta ma przez RLS bezpośredni
-- INSERT do deposit_events (rejestracja zdarzeń to praca lady), więc reguła
-- trzymana wyłącznie w akcji panelu byłaby do ominięcia jednym żądaniem
-- PostgREST — dokładnie ten sam argument, co przy bramkach 0010 (ADR-024/
-- ADR-025). CHECK wierszowy nie wystarcza: niezmiennik jest MIĘDZYWIERSZOWY
-- (suma zwrotów i potrąceń vs suma pobrań), a dwie równoległe transakcje
-- widzą nawzajem niezatwierdzone salda — stąd trigger z advisory lockiem
-- i re-checkiem w transakcji (wzorzec app.generate_order_number z 0007
-- i app.assert_unit_available z 0010).
--
-- ZERO NOWYCH TABEL: kolumna reason_code na deposit_events, CHECK, trigger
-- i spłata długu kodów w join_waitlist. Macierz izolacji RLS, granty
-- (append-only: bez UPDATE/DELETE — 0007) i rejestr fabryk wierszy bez
-- zmian. Bramka obowiązuje KAŻDĄ rolę, także service_role.
--
-- KODY BŁĘDÓW (asertowane w testach, mapowane na komunikaty w panelu):
--   23514 (check_violation) — potrącenie bez kodu powodu / kod spoza listy /
--     'other' bez doprecyzowania / kod przy pobraniu lub zwrocie (CHECK),
--     oraz rozliczenie przekraczające pobraną kaucję (trigger — ograniczenie
--     na wartościach, ta sama klasa co maszyna stanów w ADR-025),
--   22023 (invalid_parameter_value) — walidacje app.join_waitlist po
--     spłacie długu P0012/P0013 (sekcja 3).
-- Wyłącznie klasy mapowane przez PostgREST (22xxx → 400, 23xxx → 409):
-- kody własne P0xxx PostgREST zjada do gołego 500 bez kodu w odpowiedzi
-- (zweryfikowane na żywej bazie przy Zadaniu 4 — nagłówek 0010).

-- ---------------------------------------------------------------------
-- 1. Strukturalny powód potrącenia (decyzja wiążąca nr 4 planu fazy 1)
-- ---------------------------------------------------------------------
--
-- Anty-wzorzec starkita: powód potrącenia jako notatka tekstowa — nie da
-- się po nim raportować ani spierać strukturalnie. Kod powodu jest DANĄ
-- (lista zamknięta CHECK-iem, rozszerzenie = zwykła migracja jak przy
-- każdym zbiorze text+CHECK od 0001), a `reason` zostaje doprecyzowaniem:
-- opcjonalnym dla kodów z listy, wymaganym dla 'other' (wzorzec zależności
-- warunkowych z 0006). Nadmiarowy kod przy pobraniu/zwrocie jest ODRZUCANY,
-- nie zerowany po cichu — cisza ukryłaby błąd wywołującego (0006).

alter table public.deposit_events add column reason_code text;

comment on column public.deposit_events.reason_code is
  'Strukturalny powód potrącenia (ADR-026): damage | late_return | missing_part | cleaning | other. Wymagany dla kind=deducted, zabroniony dla pozostałych zdarzeń; other wymaga doprecyzowania w reason.';

-- Defensywny backfill dla środowisk z danymi sprzed 0011: stary CHECK
-- gwarantował niepusty reason przy każdym deducted, więc para
-- ('other', dotychczasowy reason) jest zawsze legalna wobec nowego CHECK-a.
update public.deposit_events
  set reason_code = 'other'
  where kind = 'deducted' and reason_code is null;

-- Kod zastępuje dawny wymóg tekstu — tekst bez kodu to dokładnie
-- anty-wzorzec, który ta migracja usuwa.
alter table public.deposit_events
  drop constraint deposit_events_deduction_requires_reason;

-- `reason_code is not null` stoi JAWNIE przed testem przynależności do listy:
-- `null in (...)` daje NULL, NULL propaguje się przez koniunkcję, a CHECK
-- z wynikiem NULL PRZECHODZI (trójwartościowa logika SQL) — bez tego strażnika
-- potrącenie bez kodu prześlizgnęłoby się przez bramkę (złapane testem).
alter table public.deposit_events
  add constraint deposit_events_structured_reason check (
    case when kind = 'deducted'
      then reason_code is not null
        and reason_code in ('damage','late_return','missing_part','cleaning','other')
        and (reason_code <> 'other' or (reason is not null and length(btrim(reason)) > 0))
      else reason_code is null
    end
  );

-- ---------------------------------------------------------------------
-- 2. Niezmiennik salda: zwroty + potrącenia <= pobrania
-- ---------------------------------------------------------------------
--
-- MECHANIZM WYŚCIGU: advisory lock na (tenant, zamówienie) + re-check sumy
-- w tej samej transakcji (wzorzec app.generate_order_number z 0007 i
-- app.assert_unit_available z 0010; pełne uzasadnienie poprawności — 0010).
-- Dwa równoległe rozliczenia tego samego zamówienia serializują się na locku,
-- a snapshot drugiej transakcji (READ COMMITTED: nowe zapytanie = nowy
-- snapshot) widzi już zatwierdzone zdarzenie pierwszej.
--
-- Pobranie ('collected') locka NIE bierze: może saldo wyłącznie zwiększyć,
-- a serializowanie pobrań kosztowałoby czekanie bez żadnej gwarancji w zamian.
-- Równoległe pobranie może co najwyżej sprawić, że rozliczenie zobaczy saldo
-- sprzed pobrania i odmówi ZA OSTROŻNIE — nigdy odwrotnie.
--
-- BULK: PostgREST przyjmuje tablicę wierszy jako jedno polecenie INSERT.
-- Reguły widoczności triggerów Postgresa (rozdz. „Visibility of Data
-- Changes"): wiersze wstawione wcześniej TYM SAMYM poleceniem są widoczne
-- w zapytaniach BEFORE-triggera kolejnych wierszy — dwa zwroty w jednym
-- poleceniu nie ominą więc re-checku (przypięte testem deposit-gates).
--
-- UPDATE/DELETE celowo bez bramki: rejestr jest append-only na poziomie
-- UPRAWNIEŃ (0007: brak grantów UPDATE/DELETE dla authenticated i
-- service_role) i POLITYK (tylko select/insert), a trigger na DELETE
-- zabiłby kaskadę z orders/tenants, którą 0007 jawnie zostawił jako
-- jedyną drogę zniknięcia wiersza.
--
-- SECURITY INVOKER (jak bramki 0010): re-check czyta deposit_events przez
-- RLS wywołującego — członek widzi komplet zdarzeń WŁASNEGO tenanta, a FK
-- złożony (tenant_id, order_id) nie dopuszcza zdarzeń międzytenantowych,
-- więc to jedyny zbiór, w którym suma ma sens. Definer byłby nadmiarem.

create or replace function app.deposit_events_gate() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_collected bigint;
  v_settled bigint;
begin
  -- Pobranie może saldo wyłącznie zwiększyć — bez locka i re-checku.
  if new.kind = 'collected' then
    return new;
  end if;

  -- Serializacja rozliczeń per (tenant, zamówienie). Lock zwalnia koniec
  -- transakcji; kolizja hasha kosztuje wyłącznie chwilę oczekiwania.
  perform pg_advisory_xact_lock(
    hashtextextended(new.tenant_id::text || ':deposit:' || new.order_id::text, 0)
  );

  select
    coalesce(sum(amount_grosze) filter (where kind = 'collected'), 0),
    coalesce(sum(amount_grosze) filter (where kind in ('refunded','deducted')), 0)
    into v_collected, v_settled
  from public.deposit_events
  where tenant_id = new.tenant_id and order_id = new.order_id;

  if v_settled + new.amount_grosze > v_collected then
    raise exception
      'Rozliczenie kaucji przekracza pobraną kwotę (pobrano % gr, rozliczono % gr, żądanie % gr).',
      v_collected, v_settled, new.amount_grosze
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function app.deposit_events_gate() is
  'Bramka rejestru kaucji (ADR-026): advisory lock per (tenant, zamówienie) + re-check sumy w transakcji. Zwroty + potrącenia nie przekroczą pobrań dla żadnej roli. Rzuca 23514.';

create trigger deposit_events_gate
  before insert on public.deposit_events
  for each row execute function app.deposit_events_gate();

-- 0007 zapowiadał niezmiennik w komentarzu tabeli — komentarz dogania stan.
comment on table public.deposit_events is
  'REJESTR zdarzeń kaucji (append-only): pobranie, zwrot, potrącenie. Stan kaucji to suma zdarzeń, a nie kolumna statusowa — historia rozliczenia jest tu dowodem w sporze z klientem, więc nie może być nadpisywana. Niezmiennik sumy (zwroty + potrącenia <= pobrania) egzekwuje trigger deposit_events_gate (0011, ADR-026) dla każdej roli; strukturalny powód potrącenia pilnowany CHECK-iem deposit_events_structured_reason.';


-- ---------------------------------------------------------------------
-- 3. Spłata długu 0006: join_waitlist na standardowych SQLSTATE
-- ---------------------------------------------------------------------
--
-- P0012 (brak zgody) i P0013 (walidacje) były dekoracją: PostgREST zjada
-- kody P0xxx do gołego 500 „Something went wrong" bez kodu w odpowiedzi
-- (odkryte w Zadaniu 4, nagłówek 0010) — wywołujący nie miał po czym
-- rozpoznać odmowy. Wszystkie odmowy walidacyjne to niepoprawne parametry
-- wywołania, więc dostają jednolicie 22023 (invalid_parameter_value,
-- klasa 22xxx → 400). Rozróżnienia P0012/P0013 nikt nie konsumował
-- (storefront mapuje każdy błąd RPC na server_error, walidację robi Zod
-- przed RPC — grep po obu kodach czysty poza 0006).
--
-- Definicja skopiowana z 0006 W CAŁOŚCI (security definer + przypięty
-- search_path bez zmian) — `create or replace` nadpisuje też atrybuty,
-- więc okrojona kopia po cichu zdjęłaby zabezpieczenia. Zmienione są
-- WYŁĄCZNIE wartości errcode (9 miejsc).
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
    raise exception 'Zapis na waitlistę wymaga zgody.' using errcode = '22023';
  end if;

  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Nieprawidłowy adres e-mail.' using errcode = '22023';
  end if;

  if p_rental_type is null
     or p_rental_type not in ('tools_construction','event','sports_outdoor','machinery','other') then
    raise exception 'Nieprawidłowy typ wynajmu.' using errcode = '22023';
  end if;

  if p_inventory_range is null
     or p_inventory_range not in ('r1_20','r21_100','r101_500','r500_plus','launching') then
    raise exception 'Nieprawidłowy zakres inwentarza.' using errcode = '22023';
  end if;

  if p_current_process is null
     or p_current_process not in ('calendar_spreadsheet','messages_phone','internal_tool','none') then
    raise exception 'Nieprawidłowy obecny proces.' using errcode = '22023';
  end if;

  -- Zależności warunkowe egzekwowane też tutaj (nie tylko CHECK-iem), żeby
  -- RPC wywołane wprost dawało czytelny błąd zamiast naruszenia constraintu.
  if p_rental_type = 'other' and v_other is null then
    raise exception 'Typ „other" wymaga doprecyzowania sprzętu.' using errcode = '22023';
  end if;

  -- Nadmiarowe other_equipment przy innym typie jest ODRZUCANE, nie
  -- po cichu zerowane: cisza ukryłaby błąd po stronie wywołującego.
  if p_rental_type <> 'other' and v_other is not null then
    raise exception 'Doprecyzowanie sprzętu jest dozwolone wyłącznie dla typu „other".' using errcode = '22023';
  end if;

  if v_phone is not null and not v_pilot then
    raise exception 'Telefon jest dozwolony wyłącznie przy zgłoszeniu do pilotażu.' using errcode = '22023';
  end if;

  if p_locale is null or p_locale not in ('en','pl') then
    raise exception 'Nieobsługiwany język.' using errcode = '22023';
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
