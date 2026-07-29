-- 0042_normalize_phone_prefix.sql
-- Domknięcie długu z ADR-080: app.normalize_phone rozumie prefiksy kraju,
-- więc „+48 501 234 567", „0048 501 234 567" i „501 234 567" dają TEN SAM
-- klucz. Bez tego zbanowany klient wracał BEZ prefiksu i przechodził
-- checkout (48501234567 != 501234567). BEZ nowego ADR — decyzja mieści się
-- w ZAMKNIĘTYM zakresie długu ADR-080 (rozwiązanie MINIMALNE w SQL, bez
-- libphonenumber; pełna kanonizacja E.164 czeka na realny pilot).
--
-- STAN PRZED (0040): app.normalize_phone zostawiało SAME CYFRY. Ten sam numer
-- w dwóch formatach z prefiksem/bez prefiksu dawał dwa różne ciągi, więc ban
-- po telefonie łapał tylko IDENTYCZNIE sformatowany numer. Dług spisany w
-- komentarzu funkcji (0040) i w ADR-080.
--
-- DLACZEGO TYLKO app.normalize_phone (jedno miejsce, zero dotknięcia
-- public_checkout ani triggera): obie ścieżki — ZAPIS klucza banu
-- (app.customer_bans_fill, 0040) i DOPASOWANIE w checkoucie
-- (app.public_checkout, ostatnie ciało w 0041) — wołają app.normalize_phone
-- W RUNTIME (rozwiązanie nazwy funkcji następuje przy wywołaniu). Zmiana
-- SAMEJ normalizacji przez create-or-replace kanonizuje OBIE ścieżki naraz,
-- symetrycznie, jednym źródłem reguły. Alternatywa „porównuj w checkoucie po
-- dwóch wariantach wejścia" ROZJECHAŁABY reguły zapisu i dopasowania (dokładnie
-- to, przed czym ostrzega nagłówek 0040) i wymagałaby kopii 18-argumentowego
-- ciała public_checkout — świadomie odrzucona. public_checkout i trigger
-- pozostają NIETKNIĘTE (ich md5 się nie zmienia; jedyna zmieniana funkcja to
-- app.normalize_phone).
--
-- REGUŁA DETERMINISTYCZNA (opis pełny w komentarzu funkcji): nie da się
-- w ogólności odróżnić kodu kraju od początku numeru krajowego, więc reguła
-- jest CELOWO wąska i jawna — zdejmij wiodące „00" (międzynarodowy prefiks
-- dostępu), a następnie, gdy zostało DOKŁADNIE 11 cyfr zaczynających się od
-- „48", zdejmij „48" (kod kraju PL) do 9-cyfrowej postaci krajowej. GTM jest
-- najpierw PL, więc kanonizujemy PL; inne kody kraju zostają nietknięte
-- (RESZTA DŁUGU, patrz komentarz funkcji). 9-cyfrowy numer z puli geograficznej
-- „48" (Radom) ma 9 cyfr, nie 11 — reguła go nie rusza.
--
-- md5 (raport PM): liczone przez md5(pg_get_functiondef('app.normalize_phone
-- (text)'::regprocedure)) PRZED i PO zastosowaniu TEGO pliku na lokalnej bazie.
-- public_checkout i customer_bans_fill: md5 BEZ ZMIAN (nie dotykane).

-- ---------------------------------------------------------------------
-- 1. app.normalize_phone — kanonizacja prefiksu kraju (reguła PL +48)
-- ---------------------------------------------------------------------
create or replace function app.normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  with stripped as (
    -- Same cyfry (jak 0040): myślniki, spacje, nawiasy, wiodący „+" znikają.
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d
  ),
  no_intl as (
    -- „00" to międzynarodowy prefiks dostępu, odpowiednik „+": „0048 501…"
    -- == „+48 501…". Zdejmujemy JEDEN wiodący „00", żeby forma z „00" zeszła
    -- się z formą zapisaną przez „+".
    select case when d like '00%' then substr(d, 3) else d end as d from stripped
  )
  select nullif(
    case
      -- KANONIZACJA PL (+48). Krajowy numer PL ma 9 cyfr, więc 11 cyfr
      -- zaczynających się od „48" to ten sam numer z kodem kraju z przodu —
      -- zdejmujemy „48", żeby „+48 501 234 567", „0048 501 234 567" i
      -- „501 234 567" dały ten sam 9-cyfrowy klucz.
      when length(d) = 11 and left(d, 2) = '48' then substr(d, 3)
      else d
    end,
    ''
  )
  from no_intl;
$$;

comment on function app.normalize_phone(text) is
  'Normalizacja numeru telefonu do klucza dopasowania (NULL gdy brak cyfr). Jedno źródło reguły dla ZAPISU banu (trigger customer_bans) i DOPASOWANIA w app.public_checkout (R6b, ADR-080). IMMUTABLE. REGUŁA (0042, deterministyczna): 1) same cyfry; 2) zdejmij wiodące „00" (międzynarodowy prefiks dostępu); 3) jeśli zostało dokładnie 11 cyfr zaczynających się od „48" — zdejmij „48" (kod kraju PL) do 9-cyfrowej postaci krajowej. Skutek: „+48 501 234 567" == „0048 501 234 567" == „501 234 567". Reguła CELOWO wąska (nie da się w ogólności odróżnić kodu kraju od numeru): rusza tylko dla 11-cyfrowego PL, więc 9-cyfrowy numer z puli „48" (Radom) zostaje nietknięty. RESZTA DŁUGU (ADR-080): inne kody kraju NIE są kanonizowane (np. „+49…" vs krajowy DE się nie zrównają) — pełne E.164 (libphonenumber) czeka na realny pilot.';

revoke all on function app.normalize_phone(text) from public;
grant execute on function app.normalize_phone(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Przeliczenie kluczy istniejących banów tą samą regułą
-- ---------------------------------------------------------------------
--
-- Bany zapisane przed 0042 trzymają klucz w STAREJ postaci (same cyfry, np.
-- „48501234567"). Bez przeliczenia stary ban nie złapałby checkoutu w nowym
-- kanonicznym formacie („501234567"). Reguła jest IDEMPOTENTNA i można ją
-- zaaplikować wprost do zapisanego klucza cyfrowego: app.normalize_phone
-- najpierw zdejmuje nie-cyfry (klucz już jest cyfrowy → bez zmian), potem
-- stosuje kanonizację 00/48. To PRZELICZENIE MIGAWKI, a nie ponowny odczyt
-- z customers — zgodnie z ADR-080 klucz banu jest migawką z chwili decyzji
-- operatora, więc kanonizujemy zapisany klucz, nie bieżący (mógł być
-- edytowany) numer klienta.
--
-- Guard `is distinct from`: nie dotykamy wierszy już kanonicznych (bez
-- pustych zapisów i bez zmiany created_at/reszty — UPDATE tylko tego pola).
update public.customer_bans
set phone_normalized = app.normalize_phone(phone_normalized)
where phone_normalized is not null
  and phone_normalized is distinct from app.normalize_phone(phone_normalized);
