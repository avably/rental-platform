-- 0005_i18n.sql
-- Rusztowanie międzynarodowe: język tenanta i waluta planu.
--
-- Kontekst: produkt jest międzynarodowy od startu (EN+PL), GTM startuje w PL.
-- Baza nie może zakładać ani polskiego, ani PLN — inaczej pierwszy tenant
-- spoza PL wymaga migracji danych zamiast wpisu w kolumnie.
--
-- Zawartość:
--   1. tenants.locale — język storefrontu najemcy,
--   2. plans.currency — waluta ceny planu.
--
-- Bez nowych tabel, więc bez nowych polityk RLS i bez zmian w liście
-- packages/db/test/schema.test.ts — kolumny dziedziczą polityki swoich tabel.

-- ---------------------------------------------------------------------
-- 1. tenants.locale
-- ---------------------------------------------------------------------

-- OŚ NIEZALEŻNA od języka panelu. Panel wybiera język prefiksem ścieżki
-- (/en, /pl) per użytkownik; ta kolumna ustala język PUBLICZNEGO storefrontu
-- najemcy — kupujący ma zobaczyć sklep w języku wybranym przez najemcę, a nie
-- w języku swojej przeglądarki.
--
-- Domyślnie 'pl', bo pierwsi najemcy są z rynku polskiego. To domyślność
-- DANYCH, nie założenie kodu: kod czyta kolumnę.
alter table public.tenants add column locale text not null default 'pl'
  check (locale in ('en','pl'));

comment on column public.tenants.locale is
  'Język storefrontu najemcy (BCP 47, podzbiór LOCALES z @avably/core). Oś niezależna od języka panelu, który wybiera prefiks ścieżki.';

-- ---------------------------------------------------------------------
-- 2. plans.currency
-- ---------------------------------------------------------------------

-- Cena planu bez waluty jest niepełną informacją — dopóki wszystko jest
-- w PLN, "199" da się czytać, ale pierwszy plan w EUR czyni kolumnę
-- price_grosze dwuznaczną. Waluta idzie obok ceny, zanim dojdzie drugi rynek.
--
-- Nazwa price_grosze zostaje: to jednostka PODRZĘDNA (grosze/cents), a zmiana
-- nazwy kolumny to osobna migracja z przepisaniem odczytów — nie mieszamy jej
-- z rebrandem. Semantyka: price_grosze = cena w jednostkach podrzędnych
-- waluty `currency`.
alter table public.plans add column currency text not null default 'PLN'
  check (currency in ('PLN','EUR','USD'));

comment on column public.plans.currency is
  'Waluta ceny planu (ISO 4217, podzbiór SUPPORTED_CURRENCIES z @avably/core). price_grosze wyraża cenę w jednostkach podrzędnych TEJ waluty.';
