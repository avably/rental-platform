# Spis zmiennych środowiskowych Avably (artefakt DR)

Kompletny rejestr WSZYSTKICH zmiennych środowiskowych obu aplikacji (panel + storefront)
oraz pakietów współdzielonych. Element I5 (Disaster Recovery): konfiguracja żyje dziś
wyłącznie w panelu Vercela — bez tego spisu grozi jej utrata przy odtwarzaniu środowiska.

**Zasady:**
- **BEZ WARTOŚCI.** Ten plik zawiera wyłącznie nazwy i przeznaczenie. Żadnych sekretów,
  kluczy, tokenów ani adresów produkcyjnych. Wartości żyją w Vercelu (per projekt) i w
  lokalnym `.env.local` (niecommitowanym).
- **Placeholdery w `.env.example`.** Kompletny zestaw nazw z pustymi/przykładowymi
  wartościami leży w `apps/panel/.env.example` i `apps/storefront/.env.example`.
- **Prefiks `AVABLY_` jest świadomy** (ADR-049, awaria 2.6c). Przestrzenie `STRIPE_*`,
  `VERCEL_*` należą do dostawcy — systemowe zmienne Vercela przykryłyby nasze wartości.
  Dlatego nasze zmienne mają własny prefiks. **Nigdy nie używaj nazw z przestrzeni
  dostawcy** dla naszej konfiguracji.
- **Build-time vs runtime.** `NEXT_PUBLIC_*` to stała BUILD-TIME: Turbopack wmurowuje ją
  do bundla klienta w chwili `next build`. Zmiana takiej zmiennej **wymaga przebudowy** —
  restart procesu nic nie zmienia. Pozostałe zmienne są czytane w RUNTIME po stronie
  serwera (per żądanie) i nigdy nie trafiają do bundla klienta.
- **Sekret = nie może wyciec do klienta ani do repo.** Zmienne oznaczone „tak" trzymamy
  jako sensitive w Vercelu; nigdy nie dostają prefiksu `NEXT_PUBLIC_`.

## Jak zbudowano ten spis (metoda skanu)

Zbiór nazw pochodzi z dwóch przejść po `origin/main` (nie po stale checkout):

1. **Dostęp bezpośredni** — `git grep -hoE 'process\.env\.[A-Z_]+|NEXT_PUBLIC_[A-Z_]+' apps packages`.
2. **Dostęp pośredni** — `process.env[STALA]`, gdzie `STALA` to nazwana stała ze
   stringiem (np. `STRIPE_SECRET_KEY_ENV = "AVABLY_STRIPE_SECRET_KEY"`). Tych odczytów
   **grep kontrolny z pkt 1 NIE łapie** — rozwiązano ręcznie po źródle stałych.

> **Uwaga dla bramki DoD.** Kontrolny `git grep` (dostęp kropkowy) zwraca **mniej** nazw
> niż ten spis, bo nie widzi dostępu pośredniego `process.env[STALA]`. Każda nazwa z
> grepu kontrolnego JEST w spisie (żadna używana zmienna nie zgubiona); dodatkowe pozycje
> w spisie to realne odczyty rozwiązane ze stałych (kolumna „odczyt: pośredni"). To nie
> rozjazd, tylko granica mechanicznej kontroli.

## Tabela — zmienne produkcyjne (Vercel)

Legenda: **BT** = build-time (`NEXT_PUBLIC_*`), **RT** = runtime (serwer). Projekt: **P** =
panel, **S** = storefront.

| Nazwa | Przeznaczenie | Apka / pakiet | Projekt Vercela | BT/RT | Wymagana | Sekret | Uwagi |
|---|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Adres API projektu Supabase (klient + serwer) | oba + `packages/db` | P + S | BT | tak | nie | Publiczny URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Klucz publikowalny Supabase (nowy format), klient | oba (`packages/core`) | P + S | BT | tak (albo legacy anon) | nie | Chroniony RLS. Preferowany nad anon. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Legacy klucz anon — fallback dla publishable | oba (`packages/core`) | P + S | BT | opcjonalna (fallback) | nie | Zostawić do migracji na publishable; potem kandydat do usunięcia. |
| `SUPABASE_SECRET_KEY` | Sekretny klucz Supabase (`sb_secret_…`), serwer — omija RLS | oba (`packages/db`) | P + S | RT | tak (albo legacy service role) | **tak** | Nowy format. Wygrywa nad service role, gdy są obie. |
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy service role — fallback dla secret key | oba (`packages/db`) | P + S | RT | opcjonalna (fallback) | **tak** | Kandydat do usunięcia po migracji na `SUPABASE_SECRET_KEY`. |
| `AVABLY_SECRETS_KEY_CURRENT` | Numer wersji klucza, którym SZYFRUJEMY nowe/nadpisywane sekrety najemców (ADR-052) | panel (`packages/core`/secrets) | P | RT | tak (sekrety najemców) | nie | Odczyt pośredni (`resolveSecretsKeyring`). Liczba całkowita ≥ 1, nie materiał klucza. **KRYTYCZNE dla DR** — wskazuje `…_V<n>` do użycia. |
| `AVABLY_SECRETS_KEY_V1..N` | Materiał klucza AES-256 (base64, 32 B) per wersja — odszyfrowuje koperty sekretów najemców (`v1:<wersja>:…`, ADR-052) | panel (`packages/core`/secrets) | P | RT | tak (sekrety najemców) | **tak** | Odczyt pośredni (prefiks `AVABLY_SECRETS_KEY_V`). **KRYTYCZNE dla DR** — bez klucza danej wersji koperty są NIEODWRACALNIE nieczytelne; przedmiot depozytu klucza (I5.4). Rotacja: dołóż `_V<n+1>` i przestaw `_CURRENT`. |
| `AVABLY_STRIPE_SECRET_KEY` | Sekretny klucz platformowego konta Stripe | oba (`packages/core`) | P + S | RT | tak (płatności) | **tak** | Odczyt pośredni. Kolizja: NIE `STRIPE_SECRET_KEY`. |
| `AVABLY_STRIPE_PUBLISHABLE_KEY` | Klucz publikowalny Stripe (wydawany z serwera na checkout) | oba (`packages/core`) | P + S | RT | tak (płatności) | nie | Odczyt pośredni. Kolizja: NIE `STRIPE_PUBLISHABLE_KEY`. Świadomie serwerowy, nie `NEXT_PUBLIC_`. |
| `AVABLY_STRIPE_WEBHOOK_SECRET` | Sekret podpisu webhooka Stripe (Connect / direct charge) | panel (`webhooks/stripe`) | P | RT | tak (webhooki) | **tak** | Odczyt pośredni. Kolizja: NIE `STRIPE_WEBHOOK_SECRET`. |
| `AVABLY_STRIPE_WEBHOOK_SECRET_THIN` | Sekret podpisu wariantu thin-payload webhooka | panel (`webhooks/stripe`) | P | RT | opcjonalna | **tak** | Odczyt pośredni. Uzupełnia zwykły webhook secret. |
| `AVABLY_STRIPE_BILLING_WEBHOOK_SECRET` | Sekret podpisu webhooka subskrypcji platformy (Stripe Billing) | panel (`webhooks/stripe-billing`) | P | RT | tak (billing) | **tak** | Odczyt pośredni. |
| `RESEND_API_KEY` | Klucz API Resend do maili transakcyjnych | oba (`packages/core`) | P + S | RT | tak (maile) | **tak** | Bez klucza transport odmawia (ADR-033). |
| `RESEND_FROM_EMAIL` | Nadpisanie adresu nadawcy maili | oba (`packages/core`) | P + S | RT | opcjonalna | nie | Domyślna wartość gwarantuje odmowę dostawcy — ustawić zweryfikowany adres. |
| `UPSTASH_REDIS_REST_URL` | Endpoint REST Upstash Redis (rate limit) | oba (`packages/security`) | P + S | RT | tak (rate limit) | nie | Adres. |
| `UPSTASH_REDIS_REST_TOKEN` | Token REST Upstash Redis | oba (`packages/security`) | P + S | RT | tak (rate limit) | **tak** | Panel potrzebuje PEŁNEGO tokenu (`redis.del`). |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Klucz witryny widgetu Turnstile (klient) | oba | P + S | BT | tak (CAPTCHA) | nie | Publiczny site key. |
| `TURNSTILE_SECRET_KEY` | Sekret serwerowej weryfikacji Turnstile | oba (`packages/security`) | P + S | RT | tak (CAPTCHA) | **tak** | Usunięcie CICHO wyłącza CAPTCHA (dev-skip) — nie kasować na prod. |
| `CRON_SECRET` | Bearer autoryzujący Vercel Cron → trasy jobów panelu | panel (`app/api/jobs/*`) | P | RT | tak (cron) | **tak** | Ustawiany też automatycznie przez Vercel Cron. |
| `AVABLY_VERCEL_API_TOKEN` | Token API Vercela do rejestracji domen sklepów | panel (`packages/core/vercel`) | P | RT | tak (rejestracja domen) | **tak** | Odczyt pośredni. Kolizja: NIE `VERCEL_API_TOKEN`. |
| `AVABLY_STOREFRONT_PROJECT_ID` | Id projektu storefrontu (CEL rejestracji domen) | panel (`packages/core/vercel`) | P | RT | tak (rejestracja domen) | nie | Odczyt pośredni. Kolizja: NIE `VERCEL_PROJECT_ID` (bramka anty-samorejestracja). |
| `AVABLY_VERCEL_TEAM_ID` | Id zespołu Vercela | panel (`packages/core/vercel`) | P | RT | opcjonalna | nie | Odczyt pośredni. Konto osobiste nie ma zespołu. |
| `GUS_BIR_USER_KEY` | Klucz użytkownika GUS BIR (odpytanie NIP → dane firmy) | panel (`lib/registry`) | P | RT | opcjonalna | **tak** | Bez klucza degradacja do samego MF. |
| `GUS_BIR_ENV` | Wybór środowiska GUS BIR (`test` / produkcja) | panel (`lib/registry`) | P | RT | opcjonalna | nie | `test` → publiczny klucz testowy. |
| `MF_WHITELIST_BASE_URL` | Nadpisanie bazowego URL API białej listy VAT (MF) | panel (`lib/registry`) | P | RT | opcjonalna | nie | Odczyt pośredni. Ma domyślną wartość. |
| `REGISTRY_CACHE_WRITE_SECRET` | Sekret serwerowy potwierdzający, że zapisu cache NIP dokonuje NASZ panel | panel (`lib/registry`) | P | RT | tak (zapis cache NIP) | **tak** | Nigdy `NEXT_PUBLIC_`. |
| `SUPABASE_EMAIL_HOOK_SECRET` | Weryfikacja podpisu webhooka email-hook Supabase Auth | panel (`webhooks/supabase-email`) | P | RT | tak (maile auth przez hook) | **tak** | Odczyt pośredni (stała `HOOK_SECRET_ENV`). |
| `AVABLY_CHECKOUT_TICKET_SECRET` | Sekret podpisu biletów checkoutu (serwer) | storefront (`lib/checkout`) | S | RT | tak (checkout) | **tak** | Odczyt pośredni. Serwerowy — bez `NEXT_PUBLIC_`. |
| `AVABLY_FORM_TICKET_SECRET` | Sekret podpisu biletów formularza kontaktowego | storefront (`lib/contact`) | S | RT | tak (formularz kontaktu) | **tak** | Odczyt pośredni. |
| `UNSPLASH_ACCESS_KEY` | Klucz API Unsplash do wyszukiwarki zdjęć w panelu | panel (`lib/unsplash`) | P | RT | opcjonalna (funkcja) | **tak** | Bez klucza image-picker Unsplash niedostępny. |
| `NEXT_PUBLIC_SITE_URL` | Kanoniczny adres strony marketingowej (derywacja marki / adresu nadawcy) | panel (`packages/core/brand`) | P | BT | opcjonalna | nie | Ma domyślną wartość. Kanon: `www.avably.io` / `www.starkit.pl`. |
| `REVIEW_MODE` | Flaga włączająca nakładkę/bramki trybu przeglądu uwag | panel (`lib/review-*`) | P | RT | opcjonalna (flaga) | nie | Domyślnie WYŁĄCZONA na prod (`!== "1"` → 404). |
| `REVIEW_INGEST_TOKEN` | Współdzielony sekret storefront ↔ panel dla wsadu uwag | panel + storefront | P + S | RT | opcjonalna (funkcja review) | **tak** | Ta sama wartość po obu stronach. |
| `REVIEW_INGEST_URL` | Adres endpointu wsadu uwag w panelu (cel relay storefrontu) | storefront (`lib/review-relay`) | S | RT | opcjonalna (funkcja review) | nie | — |
| `REVIEW_STOREFRONT_URL` | Adres storefrontu dla nakładki przeglądu (iframe) | panel (superadmin) | P | RT | opcjonalna (funkcja review) | nie | — |
| `REVIEW_TENANT_URL` | Adres sklepu najemcy dla nakładki przeglądu | panel (superadmin) | P | RT | opcjonalna (funkcja review) | nie | — |

## Tabela — zmienne SYSTEMOWE dostawcy (NIE ustawiać ręcznie)

Vercel/Node ustawiają je same. Czytamy je tylko do odczytu; **nie definiuj ich w naszej
konfiguracji** (kolizja: ADR-049).

| Nazwa | Przeznaczenie | Apka / pakiet | BT/RT | Uwagi |
|---|---|---|---|---|
| `VERCEL` | Detekcja uruchomienia na Vercelu (`=== "1"`) dla rate-limit | `packages/security` | RT | Ustawia Vercel. |
| `VERCEL_PROJECT_ID` | Id projektu, w którym biegnie proces (bramka anty-samorejestracja domen) | panel (`packages/core/vercel`) | RT | Ustawia Vercel (System Environment Variables). Odczyt pośredni. NIGDY nasza konfiguracja. |
| `NODE_ENV` | Standardowe środowisko Node (`development`/`production`/`test`) | oba + `packages/core` | BT+RT | Ustawia framework/CI. |

## Tabela — zmienne LOKALNE / CI (testy integracyjne — NIE w Vercelu)

Używane wyłącznie przez suity testowe / e2e / seed. Trafiają do lokalnego `.env.local`
i do środowiska CI, **nigdy do projektów Vercela**.

| Nazwa | Przeznaczenie | Gdzie | Sekret | Uwagi |
|---|---|---|---|---|
| `SUPABASE_LOCAL_URL` | Connection string lokalnej bazy (nie adres API!) | testy, seed | nie | Zła wartość = timeouty 20 s. |
| `SUPABASE_LOCAL_API_URL` | Adres API lokalnego Supabase | testy, e2e | nie | — |
| `SUPABASE_LOCAL_ANON_KEY` | Anon key lokalnego Supabase | testy | nie | Lokalny, demo. |
| `SUPABASE_LOCAL_SERVICE_ROLE_KEY` | Service role lokalnego Supabase | testy, e2e | (lokalny) | Lokalny, demo — nie produkcyjny sekret. |
| `ALLOW_INTEGRATION_SKIP` | Pozwala suitom integracyjnym pominąć się, gdy brak env lokalnego Supabase | helpers testów, CI | nie | Strażnik środowiskowy — bez env suity padają CELOWO. |
| `E2E_STRIPE_STUB_PORT` | Port atrapy Stripe w e2e | `packages/e2e/stub` | nie | Tylko e2e. |
| `FAZA4A_RAPORT` | Flaga diagnostyczna raportu w jednym teście integracyjnym storefrontu | `apps/storefront/test` | nie | Tylko test. Kandydat do przeglądu. |

## Zmienne martwe / kandydaci do przeglądu

- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`** — legacy fallbacki dla
  nowych kluczy (`…PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`). Trzymać do zakończenia
  migracji na nowe formaty, potem usunąć.
- **`NEXT_PUBLIC_POSTHOG_KEY`** — NIE jest dziś odczytywany w produkcji. Istnieje wyłącznie
  jako cel „tripwire" analityki (`analytics-consent-tripwire.test.ts` w obu apkach), który
  pilnuje, żeby klucz analityki NIE pojawił się bez banera zgód i polityk (ADR: analityka +
  cookies w tym samym PR). Do wpisania do env DOPIERO przy realnej integracji PostHog.
- **`FAZA4A_RAPORT`** — martwa poza jednym testem; do przeglądu przy sprzątaniu suity.

## Dziennik

- **2026-08-24** — utworzenie spisu (I5 / DR, ADR-252). Skan `origin/main`. 34 zmienne
  produkcyjne (Vercel): 5 build-time (`NEXT_PUBLIC_*`), 29 runtime; 3 systemowe dostawcy,
  7 lokalnych/CI. Rozjazd względem briefu:
  grep kontrolny (dostęp kropkowy) undercountuje o odczyty pośrednie `process.env[STALA]`
  (Stripe `AVABLY_*`, bilety, Vercel domeny, email-hook) — rozwiązane ręcznie po stałych.
- **2026-08-24** — domknięcie luki zgłoszonej przez runbook DR (ADR-256): dopisano
  `AVABLY_SECRETS_KEY_CURRENT` i `AVABLY_SECRETS_KEY_V1..N` (klucze szyfrujące sekrety
  najemców, ADR-052, czytane przez `resolveSecretsKeyring` w panelu). Pierwotny skan
  kropkowy je pominął — odczyt idzie prefiksem/stałą, nie literałem. Bez nich sekrety
  najemców są nieodwracalne; oznaczone **KRYTYCZNE dla DR** (przedmiot depozytu klucza,
  I5.4). Domknięte w ramach I5.6 (pełny eksport najemcy, ADR-258).
