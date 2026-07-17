-- 0018_product_images.sql
-- Zdjęcia produktów (Faza 2, Zadanie 2.2): metadane w public.product_images +
-- pliki w Supabase Storage z izolacją tenantów NA ZAPISIE.
--
-- Zawartość (dwie sekcje, jedna migracja — wzorzec 0016):
--   1. public.product_images — tabela metadanych zdjęcia (per-tenant, RLS
--      wzorcem 0007, FK ZŁOŻONY do products, klucz kandydujący (tenant_id,id)),
--   2. Storage — bucket PUBLICZNY `product-images` + polityki na storage.objects,
--      które bramkują ZAPIS (insert/update/delete) do ścieżki własnego tenanta,
--      a ODCZYT zostawiają publiczny.
--
-- ROZSTRZYGNIĘCIE (ADR-040): izolacja dotyczy ZAPISU (ścieżka + claim tenanta) i
-- tabeli product_images (RLS). ODCZYT plików jest PUBLICZNY — zdjęcie produktu
-- jest treścią publicznego storefrontu (pokazuje je anonimowy kupujący, Faza 2.4).
-- To świadome odejście od dosłownego „odczyt cross-tenant odrzucony" z roadmapy:
-- karta katalogu z natury jest publiczna, a bramkowanie odczytu wymuszałoby
-- podpisywane URL-e na treści, która i tak ma być widoczna bez logowania.
-- Izolowany zostaje ZAPIS: nikt nie wgra ani nie skasuje pliku w cudzym folderze.
--
-- Konwencja ścieżki obiektu: `{tenant_id}/{product_id}/{uuid}`. Pierwszy segment
-- ścieżki (folder najwyższego poziomu) = tenant właściciel; polityki zapisu
-- porównują go z `app.tenant_id()` wołającego. To ta sama własność, którą w
-- tabelach daje kolumna tenant_id + RLS, przeniesiona na przestrzeń nazw plików.

-- ---------------------------------------------------------------------
-- 1. public.product_images — metadane zdjęcia
-- ---------------------------------------------------------------------
--
-- Wiersz opisuje JEDEN plik w buckecie `product-images`. Ścieżka pliku
-- (storage_path) jest jedynym łącznikiem między tabelą a obiektem Storage —
-- baza nie zna zawartości pliku, Storage nie zna tenanta poza pierwszym
-- segmentem ścieżki. Spójność (kasowanie wiersza RAZEM z obiektem) egzekwuje
-- warstwa aplikacji; baza pilnuje wyłącznie, by wiersz należał do właściwego
-- tenanta i wskazywał produkt TEGO SAMEGO tenanta (FK złożony niżej).
create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,

  -- Ścieżka obiektu w buckecie `product-images`, konwencja
  -- `{tenant_id}/{product_id}/{uuid}`. Bez FK do storage.objects (osobny
  -- schemat, właściciel supabase_storage_admin) — łącznikiem jest ścieżka,
  -- a sprzątanie sieroty (wiersz bez pliku / plik bez wiersza) należy do
  -- aplikacji, która kasuje oba w jednej akcji.
  storage_path text not null check (length(btrim(storage_path)) between 1 and 1024),

  -- Kolejność prezentacji miniatur. Zwykła korekta lady (przeciągnięcie
  -- kafelka), więc int bez unikalności — dwa zdjęcia z tym samym sort_order
  -- są dozwolone (rozstrzyga wtedy created_at). Default 0: nowe zdjęcie ląduje
  -- na początku, dopóki operator nie ustawi porządku.
  sort_order int not null default 0,

  -- Tekst alternatywny (a11y). NULLABLE — nie każde zdjęcie ma opis w chwili
  -- wgrania; uzupełnia je ekran dostępności (Zadanie 2.7). NULL = brak opisu,
  -- semantycznie różne od pustego stringa, więc bez defaultu ''.
  alt_text text check (alt_text is null or length(btrim(alt_text)) between 1 and 500),

  created_at timestamptz not null default now(),

  -- Klucz kandydujący (wzorzec każdej tabeli-rodzica, ADR-019): pozwala
  -- ewentualnym dzieciom wskazywać zdjęcie kluczem złożonym (tenant_id, id).
  constraint product_images_tenant_id_key unique (tenant_id, id),

  -- FK ZŁOŻONY (ADR-019) — sedno izolacji tabeli. Bez niego zdjęcie z własnym,
  -- poprawnym tenant_id mogłoby wskazywać product_id CUDZEGO tenanta: RLS by to
  -- przepuściło (sprawdza tylko tenant_id WSTAWIANEGO wiersza), a macierz
  -- izolacji nie zobaczyłaby, bo pyta o dostęp do cudzych wierszy, nie o cudze
  -- referencje. Klucz (tenant_id, product_id) → products(tenant_id, id) czyni
  -- wiersz łączący dwa tenanty NIEREPREZENTOWALNYM (odrzuca baza: 23503).
  -- CASCADE: zdjęcie należy do produktu — usunięcie produktu kasuje metadane
  -- (pliki w Storage sprząta aplikacja przed usunięciem produktu; osierocony
  -- obiekt bez wiersza jest niewidoczny dla panelu i storefrontu).
  constraint product_images_product_fk
    foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete cascade
);

-- Listing zdjęć produktu w panelu i (Faza 2.4) w storefroncie filtruje po
-- (tenant_id, product_id) i sortuje po (sort_order, created_at).
create index product_images_tenant_product_idx
  on public.product_images (tenant_id, product_id, sort_order, created_at);

comment on table public.product_images is
  'Metadane zdjęcia produktu. Plik leży w buckecie Storage product-images pod ścieżką {tenant_id}/{product_id}/{uuid}; storage_path jest jedynym łącznikiem. Izolacja zapisu: RLS tej tabeli + polityki storage.objects (ADR-040).';
comment on column public.product_images.storage_path is
  'Ścieżka obiektu w buckecie product-images, konwencja {tenant_id}/{product_id}/{uuid}. Pierwszy segment = tenant właściciel (bramka zapisu w storage.objects).';
comment on column public.product_images.alt_text is
  'Tekst alternatywny (a11y). NULL = brak opisu; uzupełnia ekran dostępności (Zadanie 2.7).';

-- ---------------------------------------------------------------------
-- 2. RLS + GRANT-y na public.product_images (wzorzec 0007)
-- ---------------------------------------------------------------------

alter table public.product_images enable row level security;

-- REVOKE PRZED GRANT-em (wzorzec 0006/0007, ADR-016): Supabase'owe
-- `alter default privileges` zostawia anon i authenticated komplet uprawnień,
-- w tym TRUNCATE — które NIE PODLEGA RLS i czyści tabelę mimo najszczelniejszych
-- polityk. Kolejność istotna: grant przed revoke zostałby zdjęty.
revoke all on public.product_images from anon, authenticated;

-- anon nie dostaje NIC na tej tabeli. Publiczny odczyt LISTY zdjęć przez
-- anonimowy storefront (bez claimu tenanta) to Zadanie 2.4 — dostanie własną,
-- wąską ścieżkę (widok/RPC z jawnie wybranymi kolumnami), nie grant na tabelę.
-- Sam PLIK jest publiczny (bucket public), ale to inna oś niż odczyt metadanych.
grant select, insert, update, delete on public.product_images to authenticated, service_role;

-- Wzorzec polityk z 0007: odczyt dla członków tenanta + superadmina; zapis
-- (insert/update/delete) dla KAŻDEGO członka tenanta. Zarządzanie zdjęciami jest
-- pracą lady (jak pricing_tiers i order_items, gdzie kasowanie też jest korektą
-- członka, nie zastrzeżoną dla ownera operacją) — dodanie i usunięcie kafelka
-- jest odwracalne (ponowny upload), inaczej niż nieodwracalne usunięcie produktu
-- czy klienta. Stąd DELETE dla członka, nie tylko ownera.
create policy tenant_select on public.product_images for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.product_images for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.product_images for update
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
create policy tenant_delete on public.product_images for delete
  using (tenant_id = app.tenant_id());

-- ---------------------------------------------------------------------
-- 3. Storage — bucket publiczny + polityki write-gated na storage.objects
-- ---------------------------------------------------------------------
--
-- Bucket PUBLICZNY: odczyt obiektów idzie ścieżką /storage/v1/object/public/…
-- bez claimu (ADR-040 — zdjęcie produktu jest treścią publicznego storefrontu).
-- `on conflict (id) do nothing`: migracja jest idempotentna wobec ponownego
-- `supabase db reset` i nie wywraca się, gdyby bucket istniał.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Polityki na storage.objects (RLS jest tam włączone domyślnie przez Supabase).
-- Bramka ZAPISU: operacja dozwolona wyłącznie, gdy pierwszy segment ścieżki
-- (`(storage.foldername(name))[1]`, folder najwyższego poziomu) równa się
-- `app.tenant_id()` wołającego. To lustro izolacji tabel: przestrzeń nazw
-- plików jest podzielona po tenantach tak, jak wiersze po kolumnie tenant_id.
-- Odmowa polityki = 42501 (insufficient_privilege), spójnie z macierzą tabel.
--
-- `drop policy if exists` przed każdym `create`: storage.objects to tabela
-- WSPÓŁDZIELONA (nie tworzona w tej migracji), więc czynimy sekcję odporną na
-- ponowne zastosowanie, zamiast zakładać czysty stan jak przy tabelach public.
--
-- Osobne polityki per operacja (nie jedna `for all`): INSERT sprawdza tylko
-- WITH CHECK (wiersz nowy — USING nie ma czego czytać), a UPDATE/DELETE
-- sprawdzają USING na wierszu istniejącym; rozdzielenie czyni każdą bramkę
-- czytelną i osobno testowalną (dowód mutacyjny celuje w jedną z nich).

drop policy if exists product_images_tenant_insert on storage.objects;
create policy product_images_tenant_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1]::uuid = app.tenant_id()
  );

drop policy if exists product_images_tenant_update on storage.objects;
create policy product_images_tenant_update on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1]::uuid = app.tenant_id()
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1]::uuid = app.tenant_id()
  );

drop policy if exists product_images_tenant_delete on storage.objects;
create policy product_images_tenant_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1]::uuid = app.tenant_id()
  );

-- ODCZYT publiczny (ADR-040). Bucket public obsługuje anonimową ścieżkę
-- /object/public/… bez polityki, ale jawna polityka SELECT `using bucket = …`
-- dokumentuje decyzję U ŹRÓDŁA i pokrywa też odczyt obiektu przez klienta z
-- sesją (np. kontrola pozytywna: właściciel czyta własny plik API-owym GET-em).
-- Świadomie BEZ warunku tenanta w USING — odczyt jest publiczny z definicji,
-- warunek na foldername tylko udawałby izolację, której ta oś nie ma.
drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects for select
  using (bucket_id = 'product-images');
