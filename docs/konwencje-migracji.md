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
   do charakteru tabeli) opartych o `app.tenant_id()` — patrz wzorzec
   w `0001_core.sql` **z poprawką 0060 (ADR-126)**:
   - każdy człon `tenant_id = app.tenant_id()` MUSI nieść obok siebie
     `and (select app.is_current_tenant_member())`. Sam claim z JWT nie jest
     dowodem dostępu: po usunięciu członkostwa token żyje jeszcze do godziny;
   - zamiast `app.is_superadmin()` (claim) używać
     `(select app.is_current_superadmin())`;
   - rolę ownera sprawdzać WYŁĄCZNIE przez `(select app.is_tenant_owner())`.
     **Nie wpisywać inline `exists (select 1 from public.members …)`** —
     odwołanie do `members` wewnątrz polityki daje `42P17` w parze
     z podzapytaniem w polityce SELECT na members;
   - owijka `(select …)` jest OBOWIĄZKOWA: robi z bramki InitPlan (jedno
     wykonanie na zapytanie). Gołe wywołanie liczy się PER WIERSZ, bo te
     funkcje mają przypięty `search_path` i nie podlegają inliningowi;
   - predykat wieszać przy CZŁONIE TENANTOWYM, nie na całości wyrażenia:
     przy `… OR superadmin` doklejenie go na końcu odcięłoby superadmina.

   Bramka `packages/db/test/live-membership-predicates.test.ts` sprawdza ten
   inwariant automatycznie dla wszystkich polityk — nowa polityka bez
   predykatu to czerwony build, nie przeoczenie recenzenta.
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

## Funkcje w schemacie `app` = `revoke all ... from public` w tej samej migracji

`create function` nadaje w PostgreSQL EXECUTE roli PUBLIC **domyślnie**, a
schemat `app` jest wystawiony przez PostgREST — każda nowa funkcja bez
jawnego revoke jest więc od urodzenia wołalna publicznym kluczem anon
z przeglądarki. Dlatego każda migracja tworząca lub podmieniająca funkcję
`app.*` MUSI w tym samym pliku:

1. `revoke all on function app.<fn>(...) from public;`
2. nadać jawne granty wyłącznie rolom, które funkcji potrzebują
   (`anon` / `authenticated` / `service_role`) — z uzasadnieniem
   w komentarzu, dlaczego dana rola dostaje EXECUTE.

Stan zastany wyczyściła migracja `0064` (zdjęcie PUBLIC ze wszystkich
istniejących funkcji `app.*`; regrant wyłącznie tam, gdzie rola wykonuje
funkcję bezpośrednio — np. helper CHECK-a `app.delivery_pricing_valid`
dla piszących ról API). Konwencji pilnuje introspekcyjna bramka
`packages/db/test/function-acls.test.ts`: czyta ACL-e wprost z `pg_proc`
(z `acldefault`, więc funkcję bez jawnego ACL klasyfikuje tak, jak robi
to silnik — jako PUBLIC), a EXECUTE dla PUBLIC/anon poza jawną allowlistą
publicznych RPC pali build. **Nowa funkcja wchodzi do bramki
automatycznie** — funkcja dla roli anon wymaga wpisu do allowlisty
w teście wraz z uzasadnieniem; dla PUBLIC wyjątków nie ma.

Uwaga praktyczna: funkcje wyzwalaczy nie potrzebują EXECUTE dla ról API
(uprawnienie sprawdza się przy `create trigger` względem właściciela
tabeli), ale funkcje wołane w CHECK-ach tabel wykonuje ROLA PISZĄCA
wiersz — zdjęcie PUBLIC bez regrantu wywraca INSERT/UPDATE tej tabeli.

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
`app.is_superadmin()` są zdefiniowane. Gdy `SUPABASE_LOCAL_URL` nie jest
ustawione, test NIE pomija się po cichu: strażnik
(`test/helpers/integration-env.ts`) failuje suitę z listą brakujących
zmiennych, chyba że pominięcia zażądano jawnie flagą
`ALLOW_INTEGRATION_SKIP=1` (tak robi job `ci`, którego testy integracyjne
pokrywa równoległy job `rls`). Uruchomienie z lokalnym stackiem jest
wymagane przed każdym mergem zmiany schematu.

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

Bez kompletu tych zmiennych suita failuje z listą braków — pominięcie
wymaga jawnej flagi `ALLOW_INTEGRATION_SKIP=1` (strażnik
`test/helpers/integration-env.ts`; ta sama kopia w `apps/panel` i
`apps/storefront`). Zadanie `test` w `turbo.json` deklaruje
`SUPABASE_LOCAL_*` w `env`, więc zmienne z powłoki docierają do vitest
także pod `turbo run test`, a ich wartości wchodzą do hasha cache —
zielony wynik przebiegu z pominięciami nie zostanie odtworzony z cache
w przebiegu z kompletem zmiennych. Nowa tabela per-tenant, poza RLS,
musi też dostać
wpis w `SAMPLE_ROW_FACTORIES` (`seed-tenants.ts`) — brak fabryki to
świadomy, głośny błąd testu, a nie ciche pominięcie tabeli.

W CI ten harness uruchamia osobny job `rls` w `.github/workflows/ci.yml`
(równolegle do joba `ci`): `supabase/setup-cli` + `supabase start` w
kontenerach, zmienne z `supabase status -o env`, `pnpm --filter
@avably/db test`.

## Zakres macierzy izolacji: tylko tabele bazowe

Macierz testów izolacji (`listTenantTables`) obejmuje wyłącznie TABELE
BAZOWE schematu `public` z kolumną `tenant_id` (introspekcja przez
`pg_tables`). Widoki są poza automatyczną macierzą: ewentualny przyszły
widok per-tenant MUSI być tworzony z `security_invoker = true` (inaczej
omija RLS tabel bazowych) i dostać jawny test izolacji w
`rls-isolation.test.ts`. Tabele izolowane inaczej niż po kolumnie
`tenant_id` (dziś: `tenants`, izolowana po `id`) również mają jawne
testy poza macierzą. Nowa tabela per-tenant, poza wpisem w
`SAMPLE_ROW_FACTORIES`, musi też dostać wpis w `MUTATION_PATCHES`.

## Podpisane uploady i Storage

Migracja wprowadzająca podpisany upload musi wejść przed kodem aplikacji
(`migration-before-code`) i mieć testy integracyjne, które sprawdzają cały
kontrakt bucketa, nie tylko istnienie wpisu w `storage.buckets`:

1. jawność albo prywatność bucketa zgodną z decyzją architektoniczną;
2. dokładny `file_size_limit` i pełną allowlistę `allowed_mime_types`;
3. komplet polityk `storage.objects`, w tym związanie INSERT z dokładnym,
   niewygasłym biletem bieżącego tenanta i użytkownika; sam kształt ścieżki
   nie jest autoryzacją, a UPDATE obiektu pozostaje zabroniony, jeśli aplikacja
   nie ma jawnego przepływu podmiany bajtów;
4. definicję, granty i zachowanie każdej funkcji `SECURITY DEFINER`;
5. `md5(pg_get_functiondef(...))` każdej nowej lub zmienionej funkcji
   `SECURITY DEFINER`, porównane po zastosowaniu dokładnego bloku migracji.

Jeśli zaostrzenie polityki zamyka ścieżkę zapisu starej wersji aplikacji,
`migration-before-code` oznacza skoordynowane okno: dokładny blok migracji jest
stosowany bezpośrednio przed wdrożeniem nowego kodu, a stara wersja nie może
pozostać aktywna dłużej niż trwa kontrolowany deploy. Tę niekompatybilność
trzeba wpisać do checklisty PROD i opisu PR.

Obiekty Storage usuwa się wyłącznie przez Storage API. Bezpośredni `DELETE`
z `storage.objects` w SQL jest zabroniony: omija warstwę zarządzającą
obiektem i może rozjechać metadane z faktycznym plikiem.

Jeżeli upload ma sprzątanie retencyjne, chroniony job musi wymagać osobnego
sekretu cron. Przed mergem obowiązują trzy bramki: nazwa sekretu jest
udokumentowana, wywołanie bez poprawnego sekretu jest odrzucane, a
uwierzytelnione wywołanie joba kończy się sukcesem na lokalnym środowisku
z rzeczywistym Storage. Wartości sekretów produkcyjnych nie trafiają do
repozytorium ani do raportu PR.
