# Konwencje migracji bazy danych

Ten dokument opisuje zasady pracy z migracjami Supabase/Postgres w
`packages/db`. Obowiązuje dla wszystkich zmian schematu od Fazy 0.

## Lokalizacja i nazewnictwo

- Migracje leżą w `packages/db/supabase/migrations/`.
- Nazwa pliku: `NNNN_nazwa.sql`, gdzie `NNNN` to czterocyfrowy, rosnący
  numer porządkowy (`0001`, `0002`, ...), a `nazwa` krótko opisuje treść
  migracji (np. `0002_stripe_webhooks.sql`).
- Numer nigdy nie jest ponownie wykorzystywany ani cofany — nawet jeśli
  migracja zostanie odrzucona przed mergem, kolejna migracja dostaje
  następny wolny numer.

## Zakaz zmian bez migracji

Schemat bazy zmienia się wyłącznie przez nowy plik migracji. Ręczne zmiany
w Studio lub bezpośrednio na bazie (lokalnej czy zdalnej) są zabronione —
nie przetrwają `supabase db reset` i rozjadą środowiska.

## Każda nowa tabela = RLS w tej samej migracji

Migracja, która tworzy nową tabelę, musi w tym samym pliku:

1. Włączyć RLS: `alter table public.<tabela> enable row level security;`.
2. Dodać komplet polityk (`select`/`insert`/`update`/`delete` odpowiednie
   do charakteru tabeli) opartych o `app.tenant_id()` /
   `app.is_superadmin()` — patrz wzorzec w `0001_core.sql`.
3. Nadać jawne `GRANT`y na tabelę dla ról `authenticated` /
   `service_role` (i `anon`, jeśli dotyczy). CLI Supabase 2.109+ **nie**
   eksponuje nowych tabel w schemacie `public` automatycznie dla ról API —
   brak jawnego `GRANT` oznacza, że tabela jest praktycznie niedostępna
   nawet z poprawnymi politykami RLS.
4. Dla tabel per-tenant: kolumna `tenant_id uuid not null references
   public.tenants(id)` oraz indeks zaczynający się od `tenant_id`.
5. Dodać wpis do testu izolacji (`packages/db/test/schema.test.ts`, patrz
   Task 5 roadmapy) — nowa tabela musi pojawić się na liście sprawdzanej
   automatycznie pod kątem `rowsecurity = true`.

Migracja bez RLS na nowej tabeli nie przechodzi review.

## Lokalny Supabase — standard dev

- Uruchomienie stacku: `supabase start` (z katalogu `packages/db`).
- Zastosowanie migracji od zera: `supabase db reset` — musi przechodzić
  bez błędów przed każdym commitem zmieniającym schemat.
- Analityka (`[analytics]` w `supabase/config.toml`) jest **celowo
  wyłączona** lokalnie (`enabled = false`) — kontener analityki nie
  startuje poprawnie pod Colimą; nie włączać tego ustawienia bez
  weryfikacji na docelowym środowisku Docker.
- Klucze i URL-e do lokalnego stacku (API, DB, anon/service key) pobiera
  się z `supabase status`.

## Testy schematu

`packages/db/test/schema.test.ts` łączy się z lokalną bazą (zmienna
`SUPABASE_LOCAL_URL`, domyślnie
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` z `supabase
status`) i weryfikuje, że każda tabela z tego dokumentu istnieje, ma
`rowsecurity = true` oraz że funkcje `app.tenant_id()` i
`app.is_superadmin()` są zdefiniowane. Test jest pomijany
(`describe.skipIf`), gdy `SUPABASE_LOCAL_URL` nie jest ustawione (np. w
zwykłym `pnpm test` z roota bez uruchomionego lokalnego Supabase) —
uruchomienie z lokalnym stackiem jest wymagane przed każdym mergem zmiany
schematu.

## Macierz testów izolacji RLS (bramka CI)

`packages/db/test/rls-isolation.test.ts` + harness
`packages/db/test/helpers/seed-tenants.ts` to najważniejszy test
bezpieczeństwa w repo: dla KAŻDEJ tabeli z kolumną `tenant_id`
(wykrywanej automatycznie przez `information_schema.columns` +
`pg_tables.rowsecurity` — nie trzeba edytować testu przy nowej tabeli)
sprawdza, że tenant A nie widzi ani nie modyfikuje (SELECT/INSERT/UPDATE/
DELETE) danych tenanta B, oraz że każda taka tabela ma włączone RLS
(z testem-przynętą dowodzącym, że regres — nowa tabela bez RLS — zostanie
wykryty).

Wymaga, poza `SUPABASE_LOCAL_URL`, trzech dodatkowych zmiennych (wartości
z `supabase status -o env`, uruchomione z katalogu `packages/db`):

- `SUPABASE_LOCAL_API_URL` — bazowy URL API (`API_URL`),
- `SUPABASE_LOCAL_ANON_KEY` — klucz anon (`ANON_KEY`),
- `SUPABASE_LOCAL_SERVICE_ROLE_KEY` — klucz service-role (`SERVICE_ROLE_KEY`).

Bez kompletu tych zmiennych cały plik testu jest pomijany
(`describe.skipIf`). Nowa tabela per-tenant, poza RLS, musi też dostać
wpis w `SAMPLE_ROW_FACTORIES` (`seed-tenants.ts`) — brak fabryki to
świadomy, głośny błąd testu, a nie ciche pominięcie tabeli.

W CI ten harness uruchamia osobny job `rls` w `.github/workflows/ci.yml`
(równolegle do joba `ci`): `supabase/setup-cli` + `supabase start` w
kontenerach, zmienne z `supabase status -o env`, `pnpm --filter
@rental/db test`.
