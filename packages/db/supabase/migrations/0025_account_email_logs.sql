-- 0025_account_email_logs.sql
-- Platformowy dziennik wysyłek maili KONT (ADR-054) — zamyka dług „Platformowy
-- dziennik wysyłek kont" z fazy 2 (#dlugi-fazy-2), otwarty świadomie w ADR-048.
--
-- PROBLEM, KTÓRY TO ZAMYKA. Maile KONT (potwierdzenie rejestracji, reset hasła)
-- lecą przez Send Email Hook (ADR-048) ZANIM użytkownik ma jakąkolwiek
-- organizację. public.email_logs (0021, ADR-045) jest PER-TENANT
-- (tenant_id NOT NULL + RLS izolacji) — dziennik NAJEMCY, nie platformy — więc
-- wysyłka konta do niego nie pasuje (nie ma tenant_id, do którego wiersz mógłby
-- należeć). Skutek: gdy wysyłka konta padnie, jedynym śladem jest log Auth
-- u dostawcy. Poczuliśmy to realnie przy diagnozie linku potwierdzenia
-- (PR #72/#74): brakowało TRWAŁEGO, własnego śladu „poszło / nie poszło i
-- dlaczego". Ta tabela daje ten ślad — na osobnej, platformowej osi.
--
-- DLACZEGO OSOBNA TABELA, A NIE ROZLUŹNIENIE email_logs (ADR-054, decyzja D1).
-- email_logs.tenant_id jest NOT NULL Z POWODU IZOLACJI i to zostaje: dodanie
-- tam wierszy „platformowych" z tenant_id NULL wywróciłoby cały model (macierz
-- RLS per-tenant, FK złożony, indeksy od tenant_id) i zamazało granicę między
-- korespondencją najemcy z klientem a korespondencją platformy z użytkownikiem.
-- To dwa różne dzienniki dla dwóch różnych pytań — trzymamy je osobno.
--
-- MODEL PRYWATNOŚCI (ADR-054, decyzja D2). NIE zapisujemy adresu jawnie ani
-- żadnego tokenu. Adresata utrwalamy jako recipient_hash: HMAC-SHA256 z
-- adresu znormalizowanego (lower+trim), kluczowany SEKRETEM HOOKA, w hex.
--   * jednokierunkowy — dekodowanie hex daje 32 losowe bajty, nie adres
--     (odporne na fałszywy zielony z lekcji PR #75: to nie base64 plaintextu),
--   * kluczowany — pusta przestrzeń adresów e-mail jest przeliczalna, więc goły
--     SHA-256 dałoby się złamać słownikiem; HMAC z sekretem to zamyka bez
--     wprowadzania NOWEGO sekretu (hook i tak wymaga tego klucza i loguje
--     dopiero PO jego weryfikacji — patrz account-email-hook.ts),
--   * deterministyczny — pozwala skorelować zgłoszenie konkretnego użytkownika
--     („nie dostałem potwierdzenia") bez przechowywania adresu: wsparcie
--     hashuje zgłoszony adres tym samym kluczem i znajduje wiersz.
-- Hash liczy APLIKACJA — do bazy NIE trafia nawet plaintext adresu. Kolumna ma
-- CHECK „64 znaki hex", więc adres w postaci jawnej jest w niej
-- NIEREPREZENTOWALNY (druga, niezależna bramka prywatności obok kodu aplikacji).
-- RODO: to dane PLATFORMY (nie tenanta), minimalizacja przez pseudonim zamiast
-- PII; czyta wyłącznie superadmin.
--
-- ZAPIS: WYŁĄCZNIE service_role z serwera (ADR-054, decyzja D3), z webhooka
-- (apps/panel/app/api/webhooks/** — jedyne sankcjonowane miejsce klienta
-- service-role, egzekwowane regułą ESLint). Tabela NIE dostaje grantu zapisu
-- dla anon/authenticated, więc NIE MA publicznej powierzchni zapisu — inaczej
-- niż waitlist/log_public_checkout (SECURITY DEFINER RPC dla anon), bo tam
-- pisze kontekst BEZ klucza service-role (storefront), a tu pisze webhook,
-- który ten klucz ma. Superadminowy dziennik diagnostyczny nie może mieć
-- endpointu zapisu otwartego dla każdego (integralność > wygoda).
--
-- KONWENCJE UTRZYMANE (docs/konwencje-migracji.md, nagłówki 0006/0021):
--   * tabela PLATFORMOWA (bez tenant_id): oś izolacji to publiczność (anon) vs
--     platforma (superadmin), nie najemca vs najemca — jak waitlist_signups.
--     Automatyczna macierz per-tenant (listTenantTables) jej NIE obejmuje;
--     obejmuje ją bramka platformowa listPlatformTablesWithoutRls, którą ta
--     tabela musi spełnić (RLS włączone) — patrz packages/db/test/
--     rls-isolation.test.ts,
--   * zbiory wartości to text + CHECK, nie enumy (dopisanie rodzaju to zwykła
--     migracja bez ALTER TYPE),
--   * revoke all PRZED grantami na nowej tabeli (0006/0008) — TRUNCATE nie
--     podlega RLS,
--   * klucz główny uuid z gen_random_uuid() (jak email_logs/waitlist) —
--     świadomie BEZ kolumny identity, żeby nie rodzić sekwencji objętej
--     bramką uprawnień do sekwencji (0009),
--   * append-only: brak grantów i polityk UPDATE/DELETE (jak deposit_events/
--     email_logs) — historia, którą da się poprawić, nie jest dowodem,
--   * strażnik pary status ↔ reason CHECK-iem (jak email_logs_result_shape).

-- ---------------------------------------------------------------------
-- 1. public.account_email_logs
-- ---------------------------------------------------------------------
--
-- REJESTR PRÓB WYSYŁKI, NIE SKRZYNKA: wiersz powstaje po KAŻDEJ próbie wysłania
-- maila konta na granicy transportu — udanej ('sent') i nieudanej ('failed' +
-- powód). Rejestr wyłącznie udanych nie odpowiadałby na pytanie, które wywołało
-- to zadanie („dlaczego użytkownik nic nie dostał").
create table public.account_email_logs (
  id uuid primary key default gen_random_uuid(),

  -- Rodzaj akcji konta. Zbiór = obsługiwane ścieżki Send Email Hook (ADR-048,
  -- SUPPORTED_ACTIONS): potwierdzenie rejestracji i reset hasła. Rozszerzenie
  -- (magiclink, email_change) to dopisanie wartości tu ORAZ szablonu w hooku.
  action text not null check (action in ('signup', 'recovery')),

  status text not null check (status in ('sent', 'failed')),

  -- ADRES ADRESATA W POSTACI PSEUDONIMU (ADR-054 D2): HMAC-SHA256(lower+trim
  -- adresu) kluczowany sekretem hooka, hex. NIGDY pełny adres, nigdy token.
  -- CHECK „dokładnie 64 znaki hex" czyni adres jawny NIEREPREZENTOWALNYM w tej
  -- kolumnie — próba zapisania plaintextu (który zawiera '@' i nie jest 64-hex)
  -- pada na 23514, zanim cokolwiek się utrwali. To druga bramka prywatności:
  -- działa nawet wtedy, gdyby aplikacja pomyliła hash z adresem.
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),

  -- Powód niepowodzenia — SANITYZOWANY w aplikacji: komunikaty transportu
  -- potrafią nieść adres odbiorcy, więc aplikacja usuwa z niego adres i token
  -- przed zapisem (account-email-hook.ts, redactReason). Tu obowiązuje CHECK
  -- pary status↔reason niżej; NULL przy 'sent', niepusty przy 'failed'.
  reason text check (reason is null or length(reason) between 1 and 2000),

  created_at timestamptz not null default now(),

  -- Para status ↔ reason (wzorzec strażnika email_logs_result_shape z 0021).
  -- Bez tego CHECK-a dałoby się zapisać 'failed' bez powodu — czyli bezużyteczny
  -- ślad, którego ten dziennik ma być końcem — albo 'sent' z powodem błędu.
  constraint account_email_logs_result_shape check (
    (status = 'sent' and reason is null)
    or (status = 'failed' and length(btrim(coalesce(reason, ''))) > 0)
  )
);

-- Diagnostyka platformowa: „ostatnie wysyłki, od najnowszej".
create index account_email_logs_created_idx
  on public.account_email_logs (created_at desc);

comment on table public.account_email_logs is
  'Platformowy dziennik prób wysyłki maili KONT (ADR-054): signup/recovery, sent/failed + powód. Bez tenant_id (osobna oś od email_logs/0021). APPEND-ONLY. Adresat jako recipient_hash (HMAC, nigdy plaintext), zero tokenów. Zapis: service_role z webhooka. Odczyt: wyłącznie superadmin.';
comment on column public.account_email_logs.action is
  'Rodzaj akcji konta: signup (potwierdzenie rejestracji) | recovery (reset hasła). Lustro SUPPORTED_ACTIONS z ADR-048.';
comment on column public.account_email_logs.recipient_hash is
  'Pseudonim adresata: HMAC-SHA256(lower+trim adresu) kluczowany sekretem hooka, hex (64 znaki). NIGDY pełny adres — CHECK 64-hex czyni plaintext niereprezentowalnym (ADR-054 D2). Deterministyczny: pozwala skorelować zgłoszenie użytkownika bez przechowywania PII.';
comment on column public.account_email_logs.reason is
  'Powód niepowodzenia (sanityzowany: bez adresu i tokenu). NOT NULL przy status=failed, NULL przy sent — pilnuje CHECK account_email_logs_result_shape.';

-- ---------------------------------------------------------------------
-- 2. RLS — fail-closed, oś publiczność (anon) vs platforma (superadmin)
-- ---------------------------------------------------------------------

alter table public.account_email_logs enable row level security;

-- REVOKE PRZED GRANT-em (wzorzec 0006/0008): nowa tabela rodzi się z kompletem
-- domyślnych uprawnień dla ról publicznych, w tym TRUNCATE, które NIE PODLEGA
-- politykom RLS. Najpierw zabieramy wszystko, potem nadajemy tylko konieczne.
revoke all on public.account_email_logs from anon, authenticated;

-- anon: NIC. Nie ma publicznej ścieżki zapisu ani odczytu — zapis idzie
-- wyłącznie service_role z webhooka. Bez grantu PostgREST nie wystawia tabeli
-- anonowi w ogóle (odmowa na uprawnieniach, zanim RLS dojdzie do głosu).
--
-- authenticated: SAM SELECT, i tak przefiltrowany polityką superadmin_select.
-- Zwykły zalogowany użytkownik dostaje pustą listę (maskowanie 404 — istnienie
-- wpisów nie wycieka), nie błąd. Brak INSERT/UPDATE/DELETE dla authenticated to
-- druga połowa append-only i gwarancja, że żaden użytkownik nie dopisze ani nie
-- ruszy wiersza, choćby polityka była zepsuta.
grant select on public.account_email_logs to authenticated;
grant select, insert on public.account_email_logs to service_role;

-- Odczyt = dane diagnostyczne platformy. WYŁĄCZNIE superadmin (wzorzec 0004/0006:
-- claim `superadmin` w JWT, weryfikowany przez app.is_superadmin()). Brak
-- polityk INSERT/UPDATE/DELETE dla authenticated i anon jest CELOWY — RLS jest
-- fail-closed, więc brak polityki = brak dostępu. service_role (BYPASSRLS)
-- pisze mimo braku polityki insert, ma za to jawny GRANT insert wyżej.
create policy superadmin_select on public.account_email_logs for select
  to authenticated
  using (app.is_superadmin());
