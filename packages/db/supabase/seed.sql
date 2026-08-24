-- Zasiew lokalny/CI (uruchamiany automatycznie przez `supabase db reset`).
--
-- ADR-234/0099: sekret zapisu app.nip_lookup_cache. Wartość PONIŻEJ jest
-- WYŁĄCZNIE testowa/lokalna — bezpieczna do commitowania, bo nie chroni
-- niczego realnego (lokalna/CI baza nie ma prawdziwych danych rejestru firm
-- ani prawdziwych organizacji). NIGDY nie używać tej wartości na produkcji —
-- prod dostaje WŁASNY, losowy sekret przez OPS (patrz nagłówek migracji
-- 0099_nip_lookup_cache_write_secret.sql). Testy (packages/db/test/
-- nip-lookup-cache.test.ts, apps/panel/test/*) i CI (.github/workflows/
-- ci.yml, joby `rls`/`e2e`) muszą przekazywać DOKŁADNIE tę samą wartość jako
-- REGISTRY_CACHE_WRITE_SECRET — inaczej zapis do cache'a odrzuci je 42501,
-- tak jak odrzuciłby prawdziwego atakującego.
update app.registry_config
set write_secret_hash = encode(extensions.digest('local-ci-test-registry-secret-nigdy-na-prod', 'sha256'), 'hex'),
    updated_at = now()
where id = true;
