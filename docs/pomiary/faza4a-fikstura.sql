-- FIKSTURA ADR-184 DO OGLĘDZIN RĘCZNYCH — dwa najemcy, po 200 pozycji katalogu.
--
-- POMIAR JEJ NIE POTRZEBUJE. Suita `apps/storefront/test/koszt-odslony.integration.test.ts`
-- zakłada sobie własną fiksturę (o losowych identyfikatorach, żeby nie kasować
-- cudzej na współdzielonej bazie lokalnej) i po sobie sprząta — dzięki temu
-- rachunek odsłony jest bramką CI, a nie jednorazowym pomiarem.
--
-- Ten plik zostaje do OGLĘDZIN W PRZEGLĄDARCE: katalog 200 pozycji ze stałymi
-- adresami, pod którym da się kliknąć sklep i zobaczyć te same liczby
-- w zakładce sieci. Dwaj najemcy mają TEN SAM slug sprzętu na pozycji nr 1 —
-- to jest fikstura izolacji: żądanie do B nie ma prawa dostać pozycji A.
--
-- Idempotentna: kasuje najemców po slugu i zakłada od nowa.

begin;

delete from public.tenants where slug in ('faza4a-alfa', 'faza4a-beta');

insert into public.tenants (id, slug, name, status, locale)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'faza4a-alfa', 'Wypozyczalnia Alfa', 'active', 'pl'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'faza4a-beta', 'Wypozyczalnia Beta', 'active', 'pl');

insert into public.tenant_settings (tenant_id, key, value)
select t.id, 'currency', '"PLN"'::jsonb
from public.tenants t where t.slug in ('faza4a-alfa', 'faza4a-beta');

-- Pozycje: 200 na najemcę. Nazwa i slug niosą numer, więc każda pozycja jest
-- rozróżnialna w wyjściu — pomiar nie może stać na pozycjach nierozróżnialnych.
insert into public.products (
  tenant_id, name, slug, description, base_price_day_grosze, deposit_grosze,
  auto_increment_multiplier, buffer_before_days, buffer_after_days, active, custom_fields
)
select
  t.id,
  case when t.slug = 'faza4a-alfa' then 'Alfa sprzet ' else 'Beta sprzet ' end || lpad(i::text, 3, '0'),
  -- POZYCJA 001 MA TEN SAM SLUG U OBU NAJEMCÓW — fikstura testu izolacji.
  case when i = 1 then 'wiertarka-udarowa-sds'
       else (case when t.slug = 'faza4a-alfa' then 'alfa-sprzet-' else 'beta-sprzet-' end || lpad(i::text, 3, '0'))
  end,
  'Opis pozycji numer ' || i || ' — tekst dlugosci zblizonej do produkcyjnej, zeby pomiar rozmiaru koperty nie stal na pustych polach. Sprzet budowlany do wynajmu krotko- i dlugoterminowego.',
  10000 + i * 37,
  20000 + i * 11,
  1.0, 1, 1, true,
  '{}'::jsonb
from public.tenants t
cross join generate_series(1, 200) as i
where t.slug in ('faza4a-alfa', 'faza4a-beta');

-- Trzy zdjęcia na pozycję (produkcyjnie kafel bierze pierwsze, strona sprzętu wszystkie).
insert into public.product_images (tenant_id, product_id, storage_path, sort_order, alt_text)
-- Ścieżka MUSI mieć kształt `tenant/produkt/uuid.webp` (CHECK
-- product_images_storage_path_shape) — inaczej fikstura nie wejdzie.
select p.tenant_id, p.id,
       p.tenant_id::text || '/' || p.id::text || '/' || gen_random_uuid()::text || '.webp',
       n,
       'Zdjecie ' || n || ' pozycji ' || p.name
from public.products p
cross join generate_series(0, 2) as n
where p.tenant_id in ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002');

-- Dwa progi cenowe na pozycję.
insert into public.pricing_tiers (tenant_id, product_id, tier_days, multiplier, label, sort_order)
select p.tenant_id, p.id, d.tier_days, d.multiplier, d.label, d.sort_order
from public.products p
cross join (values (3, 0.9, 'Od 3 dni', 0), (7, 0.8, 'Od tygodnia', 1)) as d(tier_days, multiplier, label, sort_order)
where p.tenant_id in ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002');

commit;

select t.slug,
       (select count(*) from public.products p where p.tenant_id = t.id) as pozycje,
       (select count(*) from public.product_images pi where pi.tenant_id = t.id) as zdjecia,
       (select count(*) from public.pricing_tiers pt where pt.tenant_id = t.id) as progi
from public.tenants t
where t.slug in ('faza4a-alfa', 'faza4a-beta')
order by t.slug;
