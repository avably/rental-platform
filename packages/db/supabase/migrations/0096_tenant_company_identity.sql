-- =====================================================================
-- 0096 — DANE FIRMOWE PIERWSZEJ KLASY NA public.tenants (ADR-234, L1)
-- =====================================================================
--
-- KONTEKST. Do tej pory jedynym miejscem, gdzie NIP tenanta w ogóle mógł
-- istnieć, był `tenant_settings.contract_document.nip` (0026) — pole
-- OPCJONALNE w bycie o zupełnie innym przeznaczeniu (dane do PDF-u umowy),
-- wypełniane ręcznie na ekranie /ustawienia-umow, bez żadnej weryfikacji.
-- ADR-234 wprowadza NIP jako WYMAGANY i ZWERYFIKOWANY krok zakładania
-- organizacji (/organizacja/nowa) — to wymaga miejsca na tożsamość firmową
-- NIEZALEŻNEGO od dokumentu umowy, bo:
--   (a) organizacja może istnieć (i mieć NIP) zanim ktokolwiek dotknie
--       ekranu umów,
--   (b) `contract_document` ma sztywny CHECK pięciu kluczy (0026) — nie da
--       się do niego dopisać `regon`/`legal_name` bez złamania kontraktu
--       PDF-a, ani zseedować częściowo (patrz uzasadnienie w 0098).
--
-- CO TA MIGRACJA ROBI: trzy nowe kolumny na `public.tenants` (nip, regon,
-- legal_name) — WSZYSTKIE nullable, istniejące wiersze zostają NULL (zero
-- backfillu, zero zgadywania cudzych danych firmowych). Funkcja czystej sumy
-- kontrolnej NIP (współdzielony algorytm z `packages/core/src/registry/nip.ts`
-- — DWIE niezależne implementacje tego samego wzoru, bo baza broni się
-- niezależnie od aplikacji, patrz komentarz w tamtym pliku) jako CHECK na
-- kolumnie `nip` — żaden writer (aplikacja, service_role, ręczny SQL) nie
-- wstawi syntaktycznie niepoprawnego NIP-u, niezależnie od tego, czy przeszedł
-- przez `app.create_tenant` (0098) czy nie.
--
-- ŚWIADOMIE BEZ GLOBALNEGO UNIQUE na `nip` (brief SPEC C: "na start"). Ta
-- sama firma może w teorii mieć więcej niż jedną organizację na platformie
-- (np. dwie różne marki jednego przedsiębiorcy) — unikat zamknąłby tę furtkę
-- bez decyzji właściciela. Indeks (bez unikatu) starcza pod przyszłe
-- wyszukiwanie/raportowanie i pod ewentualny unikat później.

alter table public.tenants add column nip text;
alter table public.tenants add column regon text;
alter table public.tenants add column legal_name text;

-- ---------------------------------------------------------------------
-- app.nip_checksum_valid — suma kontrolna NIP (wagi 6,5,7,2,3,4,5,6,7, mod 11)
-- ---------------------------------------------------------------------
-- IMMUTABLE + SQL czyste (zero odczytu tabel) — używalne wprost w CHECK.
-- Reszta z dzielenia równa 10 jest ODRZUCANA automatycznie: żadna cyfra
-- 0-9 nie może być jej równa, więc porównanie `= ostatnia_cyfra` samo w
-- sobie daje `false` bez osobnej gałęzi.
create or replace function app.nip_checksum_valid(p_nip text)
returns boolean
language sql
immutable
as $$
  select p_nip ~ '^[0-9]{10}$'
    and (
      substring(p_nip from 1 for 1)::int * 6 +
      substring(p_nip from 2 for 1)::int * 5 +
      substring(p_nip from 3 for 1)::int * 7 +
      substring(p_nip from 4 for 1)::int * 2 +
      substring(p_nip from 5 for 1)::int * 3 +
      substring(p_nip from 6 for 1)::int * 4 +
      substring(p_nip from 7 for 1)::int * 5 +
      substring(p_nip from 8 for 1)::int * 6 +
      substring(p_nip from 9 for 1)::int * 7
    ) % 11 = substring(p_nip from 10 for 1)::int;
$$;

comment on function app.nip_checksum_valid(text) is
  'ADR-234: suma kontrolna polskiego NIP (10 cyfr, wagi 6,5,7,2,3,4,5,6,7, mod 11). '
  'Lustro packages/core/src/registry/nip.ts#isValidNipChecksum — DWIE niezależne implementacje '
  'tego samego wzoru (baza broni się niezależnie od aplikacji). IMMUTABLE, używalna w CHECK.';

-- ACL (konwencja 0064/ADR-132, bramka test/function-acls.test.ts): `create
-- function` nadaje EXECUTE roli PUBLIC domyślnie — revoke jest OBOWIĄZKOWY
-- dla każdej nowej funkcji app.*, niezależnie od tego, czy jest wywoływana
-- WPROST przez PostgREST. `authenticated` dostaje grant celowo (nie tylko
-- `service_role`): CHECK na `tenants.nip` wywoła tę funkcję W KONTEKŚCIE
-- ROLI WYKONUJĄCEJ zapytanie — dla `app.create_tenant` (SECURITY DEFINER)
-- to zawsze właściciel funkcji (postgres, ma niejawne prawa do własnych
-- obiektów), ale `superadmin_update` (0001) dopuszcza też BEZPOŚREDNI
-- `UPDATE public.tenants` przez PostgREST jako `authenticated` (bramkowany
-- RLS-em `app.is_superadmin()`) — bez grantu ta ścieżka dostałaby permission
-- denied na CHECK-u, nie na RLS-ie. Funkcja nie czyta żadnej tabeli i nie ma
-- efektów ubocznych, więc grant nie otwiera niczego poza samą arytmetyką.
revoke all on function app.nip_checksum_valid(text) from public;
grant execute on function app.nip_checksum_valid(text) to authenticated, service_role;

alter table public.tenants
  add constraint tenants_nip_checksum_check check (nip is null or app.nip_checksum_valid(nip));

-- REGON: 9 albo 14 cyfr (GUS wystawia oba warianty — jednostka lokalna ma 14).
alter table public.tenants
  add constraint tenants_regon_shape_check check (regon is null or regon ~ '^[0-9]{9}([0-9]{5})?$');

create index tenants_nip_idx on public.tenants (nip) where nip is not null;

comment on column public.tenants.nip is
  'ADR-234: NIP organizacji, zweryfikowany przeciw MF Białej liście / GUS BIR1.1 przy zakładaniu '
  '(app.create_tenant, 0098) albo NULL dla organizacji sprzed tej migracji. Suma kontrolna wymuszona '
  'CHECK-iem (app.nip_checksum_valid); BEZ globalnego UNIQUE na start (brief SPEC C — jedna firma może '
  'mieć więcej niż jedną organizację, decyzja właściciela odłożona).';
comment on column public.tenants.regon is
  'ADR-234: REGON z rejestru (MF Białej listy albo GUS BIR1.1), towarzyszy nip. NULL, gdy nip jest NULL '
  'albo źródło nie podało REGON-u.';
comment on column public.tenants.legal_name is
  'ADR-234: pełna nazwa firmy z rejestru (może różnić się od tenants.name — nazwy handlowej/marki '
  'wybranej przez właściciela na ekranie onboardingu). Dane wyłącznie informacyjne/dowodowe; nazwa '
  'handlowa (tenants.name) zostaje jedynym źródłem prawdy dla UI/sklepu.';
