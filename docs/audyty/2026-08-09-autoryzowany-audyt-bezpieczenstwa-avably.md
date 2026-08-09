# Autoryzowany audyt bezpieczeństwa platformy Avably

**Data badania:** 9 sierpnia 2026 r.  
**Charakter środowiska:** wdrożenie testowe, przedprodukcyjne  
**Badany stan repozytorium:** `eb321151da77ec118d083e9a1f62e55b01d88ac2` (`main`)  
**Tryb:** black-box, następnie white-box  
**Klasyfikacja:** poufne — dla właściciela Avably i osób realizujących naprawy

## 1. Streszczenie dla właściciela

Audyt nie wykazał podatności o wadze **Critical**. Potwierdzono dwa problemy o wadze **High**, dwa **Medium**, jeden **Low** oraz trzy zalecenia **Informational**.

Najważniejsze ryzyka:

1. Cofnięcie członkostwa albo uprawnień superadministratora nie odcina od razu istniejącego tokenu JWT. RLS i guardy nadal ufają claimom zapisanym przy wystawieniu tokenu, więc dostęp może utrzymywać się do odświeżenia lub wygaśnięcia tokenu — w konfiguracji repo do około godziny. Wariant superadministratora obejmuje dostęp między tenantami.
2. Funkcja `app.public_checkout` pozostaje wykonywalna rolą `anon`. Bezpośrednie wywołanie Supabase RPC omija Turnstile, honeypot i limit per IP w warstwie storefrontu. Limit bazodanowy zmniejsza skalę, ale nadal pozwala tworzyć trwałe zamówienia `pending/unpaid`, które blokują dostępność egzemplarzy.
3. Zmiana hasła opiera się na dowolnej ważnej sesji, bez dowodu, że jest to sesja recovery lub niedawno ponownie uwierzytelniona. Przy przejęciu sesji ułatwia to utrwalenie dostępu do konta.
4. Domena nie publikuje DMARC. Dla platformy wysyłającej wiadomości transakcyjne zwiększa to ryzyko podszywania się pod markę i phishingu.

Pozytywnie oceniono między innymi CSP z nonce i `strict-dynamic`, MFA/AAL2 dla superadministratora, ochronę otwartych przekierowań, izolację tenanta w nowym API v1, podpisane uploady Storage, walidację plików po magic bytes, podpisy webhooków, brak klucza `service_role` w storefroncie, ochronę wtyczki WordPress przed SSRF i przeniesieniem nagłówka `Authorization`, brak znanych podatności zależności o poziomie co najmniej High oraz brak sekretów w publicznych pakietach JavaScript.

Wdrożenie jest testowe i chronione Basic Auth. Sama bramka Basic Auth była oczekiwanym zabezpieczeniem testowym i **nie została uznana za podatność**. Publiczne API `/api/v1/**` celowo omija tę bramkę, ale bez klucza API poprawnie odpowiada `401`.

## 2. Zakres i ograniczenia

### Zakres autoryzowany

- `https://www.avably.io`
- `https://app.avably.io`
- subdomeny `*.avably.io` należące do Avably
- kod, konfiguracja, migracje i testy w repozytorium `avably/rental-platform`
- integracje wyłącznie od strony kodu i konfiguracji Avably

### Świadome ograniczenia bezpieczeństwa

- Nie wykonywano testów obciążeniowych, DoS, brute force ani credential stuffing.
- Nie utworzono kont, zamówień, rezerwacji, płatności ani wiadomości.
- Nie modyfikowano ani nie pobierano danych klientów.
- Nie testowano infrastruktury dostawców zewnętrznych.
- Nie zmieniano kodu aplikacji. Jedyną zmianą wykonaną w ramach audytu jest niniejszy raport.
- Nie użyto kont rzeczywistych klientów.
- Nie wykonano żywego testu dostępu między tenantami: wymaga dwóch kontrolowanych kont w dwóch testowych tenantach. Brak tego testu jest jawnie oznaczony.
- Nie wykonano integracyjnych testów lokalnego Supabase/Storage, ponieważ środowisko nie miało działającego Supabase CLI/Dockera. Zastąpiły je analiza migracji, istniejące testy kontraktowe oraz aktualny zielony CI.
- Nie wykonywano zapisu przez publiczny checkout ani API rezerwacji. Skutek obejścia został potwierdzony white-box, a próba live byłaby sprzeczna z zakazem tworzenia trwałych danych.
- Ustawienia w panelach Vercel, Supabase, Cloudflare i dostawców poczty nie były dostępne. Wnioski o runtime opierają się na odpowiedziach wdrożenia i konfiguracji zapisanej w repo.

### Dane dostępowe i prywatność dowodów

Dane Basic Auth przekazane przez właściciela wykorzystano wyłącznie do wejścia na testową stronę marketingową. Nie są zapisane w raporcie, logach repozytorium ani poleceniach reprodukcji. Dowody nie zawierają sekretów, tokenów sesyjnych, danych osobowych ani treści klientów.

## 3. Metodyka

Metodykę oparto na:

- [OWASP Web Security Testing Guide](https://owasp.org/www-project-web-security-testing-guide/),
- [OWASP Application Security Verification Standard 5.0](https://owasp.org/www-project-application-security-verification-standard/),
- [OWASP API Security Top 10 — 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/).

Każdy test otrzymał jeden z wyników: **potwierdzony**, **niepotwierdzony**, **zabezpieczony** albo **niewykonany z przyczyn bezpieczeństwa**. „Niepotwierdzony” nie oznacza dowodu braku podatności; oznacza brak dowodu jej występowania w wykonanym zakresie.

## 4. Model zagrożeń

### Chronione aktywa

- dane tenantów: klienci, zamówienia, dostępność, umowy, płatności i konfiguracja;
- konta operatorów i uprawnienia superadministratora;
- klucze API, sekrety integracji i dokumenty w Storage;
- integralność rezerwacji, numeracji i historii rozliczeń;
- reputacja domeny i wiarygodność wiadomości transakcyjnych;
- dostępność panelu i katalogów najemców.

### Rozważani aktorzy

- niezalogowany użytkownik internetu;
- bot automatyzujący formularze i checkout;
- złośliwa witryna próbująca CORS/CSRF/open redirect;
- były członek tenanta ze starym tokenem;
- były superadministrator ze starym tokenem;
- posiadacz skradzionego klucza API lub sesji;
- administrator instalacji WordPress z błędną konfiguracją integracji.

### Główne granice zaufania

- przeglądarka → Next.js Server Actions/route handlers;
- Next.js → Supabase Auth/PostgREST/RPC/Storage;
- claim JWT → bieżące członkostwo i uprawnienia w bazie;
- publiczny klucz Supabase `anon` → funkcje `SECURITY DEFINER`;
- publiczne API v1 → tenant wyprowadzony z klucza API;
- Avably → Stripe, Resend, Cloudflare Turnstile i pozostałe integracje;
- WordPress → publiczne API Avably.

## 5. Mapa powierzchni ataku

| Powierzchnia | Ekspozycja | Główne zabezpieczenia |
|---|---|---|
| `www.avably.io` | testowa strona marketingowa i storefront | Basic Auth poza `/api/v1/**`, CSP, HSTS, rozpoznanie tenanta server-side |
| `app.avably.io` | login, rejestracja, reset, panel, admin | Supabase Auth, Turnstile, współdzielony rate-limit, RLS, MFA superadmina |
| `/api/v1/catalog` | publiczne API odczytowe | klucz per tenant, hash SHA-256, status tenanta, limit per klucz i IP |
| `/api/v1/availability` | publiczne API odczytowe | jak wyżej, tenant wyłącznie z klucza, neutralne `404` |
| `/api/v1/reservations` | publiczne API zapisujące | klucz per tenant, limit per klucz i IP, wspólny rdzeń checkoutu |
| `app.public_checkout` | Supabase RPC dla `anon` | walidacja serwerowa, wycena w bazie, limit 3/24 h per klient i 30/h per tenant domyślnie |
| Supabase RLS | dane wszystkich tenantów | `tenant_id`, claim JWT, polityki per tabela, test macierzy izolacji |
| Supabase Storage | obrazy i dokumenty | prywatne rejestry, signed upload, bilety związane z tenantem/użytkownikiem, magic bytes |
| webhooki i joby | Stripe, e-mail, cron | podpisy, okna czasu, raw body, bearer cron, idempotencja |
| wtyczka WordPress | kod dystrybuowany najemcom | nonce, proxy przez `admin-ajax.php`, klucz tylko server-side, anty-SSRF, brak redirectów |
| publiczne chunki JS | każdy użytkownik | brak sekretów server-side; tylko dane jawnie publiczne |

## 6. Lista wykonanych testów

| Obszar/test | Wynik | Dowód skrócony |
|---|---|---|
| DNS, certyfikaty i wersje TLS | zabezpieczony | ważne certyfikaty Let's Encrypt; TLS 1.2 i 1.3; TLS 1.0/1.1 nie zostały wynegocjowane; DNSSEC obecny |
| HTTP → HTTPS | zabezpieczony | przekierowanie `308` |
| Basic Auth strony testowej | zabezpieczony / oczekiwany | bez danych dostępowych `401`; nieklasyfikowane jako luka |
| Nagłówki dynamicznych stron | zabezpieczony | CSP z nonce/`strict-dynamic`, HSTS, `nosniff`, `frame-ancestors 'none'`, XFO `DENY`, Referrer-Policy, Permissions-Policy |
| Nagłówki odpowiedzi statycznych i 404 | potwierdzony | część odpowiedzi nie ma wspólnego zestawu nagłówków — L-01 |
| CORS panelu i API | zabezpieczony | brak `Access-Control-Allow-Origin` dla obcego origin; preflight API nie otwiera originu |
| Strony panelu bez sesji | zabezpieczony | przekierowanie/login shell; brak e-maili, UUID-ów i danych domenowych w odpowiedzi |
| Endpointy cron bez sekretu | zabezpieczony | wszystkie sprawdzone joby odpowiadają `401` |
| Webhooki metodą GET | zabezpieczony | `405`; white-box potwierdza walidację podpisu i raw body |
| Open redirect przez `next` i callback auth | zabezpieczony | zewnętrzny URL odrzucony; `safeNextPath` dopuszcza tylko ścieżki lokalne |
| Turnstile na loginie | zabezpieczony | widżet wyrenderowany po hydratacji; wysłanie bez tokenu daje odmowę CAPTCHA |
| Enumeracja kont | zabezpieczony white-box | reset zwraca komunikat ogólny; login nie ujawnia, które pole było poprawne |
| CSRF | niepotwierdzony | mutacje używają Server Actions/POST i cookies SameSite; nie znaleziono skutecznej ścieżki GET zmieniającej stan |
| XSS od treści tenanta | niepotwierdzony | rich text jest modelem danych, nie HTML; linki mają allowlistę schematów; wartości szablonów są escapowane |
| SQL injection | niepotwierdzony | statyczne zapytania/RPC/PostgREST; brak interpolowanego dynamicznego SQL w aplikacji |
| SSRF | zabezpieczony | URL Unsplash ma ścisły origin; WordPress odrzuca prywatne hosty, wymaga HTTPS i nie podąża za redirectami |
| Mass assignment | zabezpieczony | wejścia przechodzą przez jawne schematy i mapowanie do allowlist pól |
| IDOR/BOLA w API v1 | zabezpieczony white-box | tenant pochodzi tylko ze zweryfikowanego klucza; produkt cudzego tenanta daje neutralne `404` |
| Dostęp między tenantami z dwiema sesjami | niewykonany z przyczyn bezpieczeństwa | brak dwóch kontrolowanych kont testowych; nie używano kont klientów |
| Cofnięcie członkostwa/superadmina przy żywym JWT | potwierdzony white-box | claim pozostaje źródłem decyzji aż do nowego tokenu — H-01 |
| Obejście antybot checkoutu przez RPC | potwierdzony white-box | `anon` ma `EXECUTE`, a funkcja sama dokumentuje pominięcie Turnstile/IP — H-02 |
| API v1 bez klucza lub z jednym kluczem syntetycznym | zabezpieczony | catalog, availability i reservations odpowiadają `401`; nie powstały dane |
| Publiczne pakiety JavaScript | zabezpieczony | przejrzano 25 chunków; brak sourcemap, kluczy prywatnych, provider secrets i service-role |
| Zależności | zabezpieczony | `pnpm audit --audit-level high`: `No known vulnerabilities found` |
| Sekrety i publiczne env | zabezpieczony | bramki `audit-public-env` i `audit-service-role` zielone; brak śledzonych `.env` i kluczy prywatnych |
| Uploady Storage | zabezpieczony white-box | bilety 15 min, ścisła ścieżka, brak UPDATE, MIME + magic bytes, usunięcie pliku przy niezgodności |
| Integralność RLS | zabezpieczony statycznie, live niewykonany | szeroka macierz testów RLS, złożone FK z `tenant_id`, stały `search_path`; zastrzeżenie H-01 |
| SPF/DMARC/DKIM | potwierdzony częściowo | SPF istnieje; DMARC nie istnieje — M-02; selektory DKIM nieznane, więc DKIM nieweryfikowalny |
| `security.txt` | potwierdzony | `404` — I-01 |

## 7. Znaleziska

### Critical

Nie potwierdzono znalezisk o wadze Critical.

### High

#### H-01 — Cofnięte uprawnienia pozostają aktywne w istniejącym JWT

**Status:** potwierdzony white-box; wariant live niewykonany bez dwóch kont testowych  
**Prawdopodobieństwo:** średnie  
**Wpływ biznesowy:** wysoki; były członek może nadal czytać i modyfikować dane swojego byłego tenanta, a były superadministrator może zachować dostęp między tenantami do czasu wygaśnięcia tokenu.

**Dowód:**

- `packages/db/supabase/migrations/0001_core.sql:90-103` — `app.tenant_id()` i `app.is_superadmin()` czytają wyłącznie `auth.jwt().app_metadata`.
- `packages/db/supabase/migrations/0003_auth.sql:46-94` — członkostwo i superadmin są odczytywane przy wystawieniu tokenu i kopiowane do claimów.
- `apps/panel/lib/auth.ts:95-113` — kontekst auth ufa claimom.
- `apps/panel/lib/auth.ts:134-182` — guard członka odczytuje na żywo status tenanta, ale nie sprawdza, czy członkostwo nadal istnieje.
- `apps/panel/lib/auth.ts:199-223` — guard superadministratora sprawdza claim i AAL2, ale nie sprawdza na żywo wpisu `app.superadmins`.
- `packages/db/supabase/migrations/0007_rental_core.sql:692-783` — typowe polityki odczytu i zapisu opierają się na `app.tenant_id()`/`app.is_superadmin()`.
- `packages/db/supabase/config.toml:166-176` — JWT ważny 3600 s; rotacja refresh tokenów jest włączona, ale nie unieważnia już wystawionego access tokenu.

**Bezpieczna reprodukcja — tylko lokalnie lub na testowym tenantcie:**

1. Zalogować kontrolowanego członka i zachować jego access token.
2. Drugim kontrolowanym kontem ownera usunąć członkostwo.
3. Bez odświeżania tokenu wykonać odczyt i odwracalną aktualizację w tabeli tenanta.
4. Oczekiwane zachowanie: natychmiastowe `403`/brak wierszy. Obecna konstrukcja nadal przedstawia poprzedni `tenant_id` i rolę.
5. Osobno powtórzyć dla kontrolowanego superadministratora po usunięciu wpisu `app.superadmins`; nie używać danych klientów.

**Zalecenie:**

- Dodać bazowe predykaty live, np. `app.is_current_tenant_member(p_tenant_id)` i `app.is_current_superadmin()`, sprawdzające `auth.uid()` w tabelach źródłowych. Funkcje muszą mieć przypięty `search_path`, minimalne granty i testy rekurencji RLS.
- Włączyć te predykaty w RLS dla danych tenantowych i w guardach aplikacji; sam guard route handlera nie zastępuje RLS.
- Przy odebraniu roli unieważniać refresh sessions. Skrócenie TTL JWT traktować jako ograniczenie okna, nie główną naprawę.
- Dodać test mutacyjny: token → usunięcie członkostwa/superadmina → natychmiastowa odmowa bez odświeżenia tokenu.

#### H-02 — Publiczne RPC checkoutu omija Turnstile, honeypot i limit per IP

**Status:** potwierdzony white-box; nie wykonywano zapisu live  
**Prawdopodobieństwo:** średnie do wysokiego  
**Wpływ biznesowy:** wysoki; automatyczne fałszywe zamówienia mogą blokować dostępność, zapełniać panel i powodować pracę operacyjną. Limit bazodanowy ogranicza, ale nie usuwa skutku.

**Dowód:**

- `apps/storefront/lib/checkout/core.ts:178-196` — honeypot, limit i Turnstile istnieją w warstwie aplikacji.
- `apps/storefront/lib/actions/checkout.ts:42-78` — prawidłowa ścieżka Server Action dostarcza te bramki przed RPC.
- `packages/db/supabase/migrations/0049_orders_currency.sql:551-599` — kod funkcji jawnie opisuje, że bezpośredni `anon` omija bramki storefrontu; domyślne limity to 3/24 h per klient i 30/h per tenant, konfigurowalne do 10 000.
- `packages/db/supabase/migrations/0049_orders_currency.sql:601-665` — throttle działa dopiero w bazie.
- `packages/db/supabase/migrations/0049_orders_currency.sql:797-840` — funkcja tworzy zamówienie i pozycje blokujące egzemplarze.
- `packages/db/supabase/migrations/0040_customer_bans.sql:735-736` — utrzymany grant `EXECUTE` dla `anon` i `authenticated`; `CREATE OR REPLACE` w 0049 zachowuje uprawnienia tej samej sygnatury.

**Bezpieczna reprodukcja — wyłącznie lokalny Supabase z danymi syntetycznymi:**

1. Uruchomić lokalny stos i utworzyć testowego tenanta, produkt oraz egzemplarz.
2. Klientem z publiczną rolą `anon` wywołać `app.public_checkout` bez przechodzenia przez Server Action i bez tokenu Turnstile.
3. Potwierdzić, że powstaje `pending/unpaid` i egzemplarz znika z dostępności.
4. Potwierdzić działanie limitów bazowych. Nie wykonywać tego na danych produkcyjnych ani tenantach klientów.

**Zalecenie:**

- Przenieść zapis checkoutu za zaufaną granicę, która może zweryfikować Turnstile i limit, a następnie wywołać funkcję niedostępną dla `anon` — np. wąski backend/Edge Function z osobnym, minimalnie uprawnionym klientem.
- Odebrać `anon` bezpośrednie `EXECUTE` do funkcji tworzącej zamówienie. Ukrycie publicznego anon key nie jest naprawą.
- Jeśli potrzebny jest model biletu: po poprawnym Turnstile wystawiać krótko żyjący, jednorazowy i atomowo konsumowany ticket związany z tenantem oraz skrótem payloadu; możliwość wystawienia ticketu nie może być publicznym RPC.
- Zachować throttle w bazie jako defense in depth oraz dodać automatyczne wygaszanie nieopłaconych `pending`, monitoring skoków i alarmy.
- Dodać negatywny test: bez zaufanego biletu/poświadczenia bezpośrednie RPC nie tworzy klienta, zamówienia ani pozycji.

### Medium

#### M-01 — Zmiana hasła nie wymaga recovery ani ponownego uwierzytelnienia

**Status:** potwierdzony w kodzie i konfiguracji repo; ustawienie runtime Supabase nieweryfikowalne  
**Prawdopodobieństwo:** średnie po przejęciu sesji  
**Wpływ biznesowy:** średni do wysokiego; napastnik z ważną sesją może zmienić hasło i utrwalić przejęcie konta.

**Dowód:**

- `apps/panel/app/[locale]/(auth)/reset/confirm/actions.ts:57-73` — wystarcza dowolny `getAuthContext`, po czym wykonywane jest `updateUser({ password })`.
- `apps/panel/app/auth/confirm/route.ts:39-53` — poprawny link recovery ustanawia sesję, ale akcja ustawienia hasła nie dowodzi, że bieżąca sesja pochodzi z tego przepływu.
- `packages/db/supabase/config.toml:234-235` — `secure_password_change = false`.

**Bezpieczna reprodukcja — konto kontrolowane:**

1. Zalogować zwykłą sesję bez używania linku recovery.
2. Otworzyć `/reset/confirm` i wysłać nowe, syntetyczne hasło.
3. Oczekiwane zachowanie: żądanie ponownego uwierzytelnienia albo recovery proof. Kod dopuszcza wywołanie `updateUser` dla każdej ważnej sesji.

**Zalecenie:**

- Włączyć `secure_password_change` w kodzie konfiguracji i środowisku Supabase.
- Rozróżnić sesję recovery od zwykłej sesji: po callbacku ustanawiać krótko żyjący, jednokrotny stan recovery albo sprawdzać wiarygodny atrybut/nonce dostawcy.
- Dla zwykłej zmiany hasła wymagać aktualnego hasła, recent auth lub MFA; po resecie unieważnić pozostałe sesje i wysłać powiadomienie o zmianie.
- Dodać test negatywny: aktywna zwykła sesja bez recovery nie może użyć akcji reset-confirm.

#### M-02 — Brak polityki DMARC dla `avably.io`

**Status:** potwierdzony black-box  
**Prawdopodobieństwo:** średnie  
**Wpływ biznesowy:** średni; podszywanie się pod domenę może wspierać phishing klientów i szkodzić dostarczalności wiadomości.

**Dowód:**

- DNS publikuje SPF `v=spf1 include:mx.ovh.com ~all`.
- `_dmarc.avably.io` nie zwraca rekordu TXT. Wildcard DNS kieruje nazwę do hostingu, ale nie stanowi polityki DMARC.
- Nie można było rzetelnie potwierdzić DKIM bez znajomości aktywnego selektora dostawcy.

**Bezpieczna reprodukcja:** `dig TXT _dmarc.avably.io` — brak polityki `v=DMARC1`.

**Zalecenie:**

1. Potwierdzić SPF i DKIM dla rzeczywistego dostawcy wysyłki oraz zgodność domen From/Return-Path.
2. Wdrożyć DMARC etapowo: `p=none` z raportami do kontrolowanej skrzynki, przeanalizować legalne źródła, następnie `quarantine` i docelowo `reject`.
3. Nie publikować adresu raportowego w publicznym raporcie audytowym.

### Low

#### L-01 — Nagłówki bezpieczeństwa nie obejmują wszystkich odpowiedzi statycznych

**Status:** potwierdzony black-box i white-box  
**Prawdopodobieństwo:** niskie  
**Wpływ biznesowy:** niski; dotyczy głównie odpowiedzi 404, `robots.txt`, `sitemap.xml` i zasobów statycznych, a nie stron z danymi.

**Dowód:**

- Główne strony dynamiczne mają pełny zestaw nagłówków.
- Wybrane odpowiedzi statyczne/404 nie miały CSP, `X-Content-Type-Options`, Referrer-Policy, Permissions-Policy ani XFO; jedna statyczna odpowiedź 404 miała `Access-Control-Allow-Origin: *` bez danych wrażliwych.
- `apps/panel/proxy.ts:85-86` i `apps/storefront/proxy.ts:270-271` wyłączają z proxy `_next/static`, `_next/image`, favicon i ścieżki z rozszerzeniem.

**Bezpieczna reprodukcja:** wykonać `HEAD` do losowego nieistniejącego pliku i porównać nagłówki z `/en/login`.

**Zalecenie:** ustawić bazowe nagłówki również na poziomie `next.config`/hostingu dla wszystkich odpowiedzi. CSP dla surowych obrazów nie jest konieczne, ale `nosniff`, HSTS i spójna polityka informacji zwrotnej powinny być globalne. Nie otwierać CORS dla odpowiedzi zawierających dane.

### Informational

#### I-01 — Brak `/.well-known/security.txt`

Endpoint odpowiada `404`. Przed publicznym startem warto opublikować kontakt bezpieczeństwa, okres ważności, preferowany język i zasady zgłaszania zgodnie z RFC 9116.

#### I-02 — Brak rekordów CAA oraz MTA-STS/TLS-RPT

CAA nie jest obowiązkowe, a obecny certyfikat jest poprawny. Rekord ograniczyłby jednak listę urzędów mogących wystawiać certyfikaty. MTA-STS i TLS-RPT mogą zwiększyć odporność transportu poczty po uporządkowaniu SPF/DKIM/DMARC.

#### I-03 — Checklista przed zdjęciem testowej bramki

Basic Auth i endpoint narzędzia review są uzasadnione w środowisku testowym. Przed startem publicznym należy potwierdzić: wyłączenie trybu review, właściwe env Turnstile po stronie build-time i server-side, działanie rate-limit runtime, opublikowanie `security.txt` oraz monitoring publicznego API v1. API v1 ma pozostać dostępne bez Basic Auth, ale wyłącznie z ważnym kluczem tenantowym.

## 8. Pozytywne zabezpieczenia

- CSP jest generowane per żądanie z 128-bitowym nonce (`packages/security/src/index.ts:21-25`), używa `strict-dynamic`, blokuje ramkowanie i obiekty oraz nie dopuszcza `unsafe-inline` dla skryptów.
- Produkcyjny ekran logowania renderuje widżet Turnstile; próba bez tokenu jest odrzucana. Login ma świadome zachowanie dla awarii dostawcy, a rejestracja/reset są fail-closed (`packages/security/src/turnstile.ts:52-90`).
- Rate-limit tras auth jest współdzielony w Postgresie, tabela nie ma grantów publicznych ani polityk RLS, a funkcja ma walidowane capy (`0052_auth_rate_limits.sql`).
- Superadministrator wymaga claimu oraz AAL2/MFA (`apps/panel/lib/auth.ts:185-223`).
- `safeNextPath` odrzuca URL absolutny, `//` i backslash; black-box nie potwierdził open redirect.
- Publiczne API v1 wyprowadza tenant wyłącznie ze zweryfikowanego klucza; surowy klucz jest hashowany SHA-256 przed RPC, w bazie pozostaje wyłącznie hash i prefiks. Klucz odwołany jest nierozróżnialny od nieznanego.
- Brak klucza i jeden syntetyczny nieprawidłowy klucz dały jednolite `401` dla API; preflight z obcego originu nie otworzył CORS.
- Wycena i dobór egzemplarzy checkoutu odbywają się po stronie bazy; klient nie ustala ceny ani `tenant_id` w ścieżce API.
- Polityki Storage używają krótkich biletów związanych z tenantem/użytkownikiem i ścisłą ścieżką. Finalizator sprawdza metadane i magic bytes, a niezgodny plik usuwa.
- Rejestry dokumentów i zdarzeń kaucji są append-only dla zwykłej sesji.
- Cron routes są chronione bearerem i porównaniem stałoczasowym. Podpisy webhooków używają raw body i okna czasowego; Stripe ma trwałą idempotencję po identyfikatorze zdarzenia.
- Service-role jest ograniczony bramką repo do webhooków, jobów i fabryki klienta; storefront nie ma go w env.
- Rich text nie przyjmuje surowego HTML, schematy linków są allowlistowane, wartości w szablonach są escapowane, a podglądy wiadomości są sandboxowane.
- Wtyczka WordPress trzyma klucz API wyłącznie po stronie PHP, używa nonce dla publicznych akcji AJAX, whitelistuje parametry i odpowiedzi, odrzuca prywatne/nietypowe hosty, wymaga HTTPS i nie podąża za przekierowaniami z nagłówkiem `Authorization`.
- DNSSEC jest aktywny. Certyfikaty są ważne, a TLS 1.2/1.3 działa poprawnie.

## 9. Elementy nieweryfikowalne bez dodatkowego dostępu

1. **Żywa izolacja dwóch tenantów i mutacja RLS** — potrzebne są dwa kontrolowane konta testowe, każde w osobnym testowym tenantcie. Należy sprawdzić odczyt, zapis, IDOR po `document_id`, Storage oraz natychmiastową utratę dostępu po usunięciu członka.
2. **Superadmin po odebraniu roli** — potrzebne jest kontrolowane konto superadmina i zgoda na tymczasową zmianę roli w środowisku testowym.
3. **Rzeczywiste ustawienia Supabase Auth** — TTL, `secure_password_change`, sesje i redirect allowlist w hostowanym projekcie mogą różnić się od `config.toml`.
4. **Zmienne Vercel/Cloudflare** — potwierdzono zachowanie HTTP, ale nie odczytano paneli konfiguracyjnych ani alertów.
5. **DKIM i pełna dostarczalność poczty** — potrzebny aktywny selektor lub nagłówki kontrolowanej wiadomości testowej.
6. **Płatności i webhooks end-to-end** — nie finalizowano płatności ani nie testowano infrastruktury Stripe.
7. **Rezerwacja przez ważny klucz API** — wymaga kontrolowanego klucza i zgody na utworzenie syntetycznego zamówienia; obecnie sprawdzono wyłącznie odmowy bez klucza.
8. **Certificate Transparency** — zewnętrzne zapytanie do indeksu CT nie zwróciło użytecznego wyniku w czasie audytu; nie wykonywano masowego skanowania subdomen.

## 10. Wyniki testów lokalnych i CI

- Pełny sekwencyjny przebieg: **9/9 zadań zakończonych sukcesem**.
- Panel: **131 plików testowych zaliczonych, 21 pominiętych; 1675 testów zaliczonych, 169 pominiętych**.
- Storefront: **29 plików zaliczonych, 2 pominięte; 424 testy zaliczone, 11 pominiętych**.
- Pominięcia dotyczą głównie testów integracyjnych wymagających lokalnego Supabase/sekretów testowych.
- Pierwszy przebieg równoległy miał pojedynczy timeout 5 s w teście PDF PL. Izolowany pakiet PDF przeszedł 15/15, a pełny przebieg sekwencyjny przeszedł; to niestabilność czasowa testu, nie wykryta luka.
- Produkcyjny build panelu i bramka `audit-browser-env-inlining.sh` przeszły z syntetycznymi publicznymi wartościami env.
- `audit-public-env.sh` i `audit-service-role.sh` przeszły.
- `pnpm audit --audit-level high`: brak znanych podatności.
- Najnowszy workflow CI dla dokładnego commita `eb321151…` zakończył się sukcesem: [GitHub Actions run 31326774598](https://github.com/avably/rental-platform/actions/runs/31326774598).

## 11. Priorytetowy plan napraw

### W ciągu 24 godzin

- Nie promować wdrożenia testowego do produkcji bez świadomej decyzji właściciela wobec H-01 i H-02.
- Dla H-01 opisać procedurę awaryjnego odcinania kont i skrócić TTL access tokenu jako tymczasową redukcję okna.
- Dla H-02 włączyć alarmy na gwałtowny wzrost `pending/unpaid`, zweryfikować limity tenantów i zaplanować automatyczne wygaszanie porzuconych zamówień. Nie zwiększać limitów do wartości skrajnych przed naprawą granicy zaufania.
- Włączyć `secure_password_change` najpierw na środowisku testowym i przejść pełny reset hasła.
- Opublikować DMARC `p=none` z kontrolowanym adresem raportowym po potwierdzeniu legalnych źródeł poczty.

### W ciągu 7 dni

- Wdrożyć live-check członkostwa i superadmina w RLS/guardach oraz test cofnięcia dostępu bez odświeżania JWT.
- Zaprojektować zaufaną granicę checkoutu, odebrać bezpośredni zapis roli `anon` i zachować bazowy throttle jako drugą linię obrony.
- Rozdzielić sesję recovery od zwykłej sesji i wymagać recent auth/MFA dla zmiany hasła.
- Ujednolicić nagłówki odpowiedzi statycznych.
- Wykonać kontrolowany test dwóch tenantów, w tym pobranie cudzego `document_id`, bez danych klientów.

### W ciągu 30 dni

- Doprowadzić DMARC do `quarantine`, a następnie `reject` po analizie raportów i wyrównaniu DKIM/SPF.
- Dodać `security.txt`, rozważyć CAA, MTA-STS i TLS-RPT.
- Dodać automatyczne testy DAST dla odmów auth/API, nagłówków, CORS i open redirect na środowisku testowym.
- Ustawić okresowe skanowanie zależności i sekretów oraz alerty dla zmian grantów `anon`, `SECURITY DEFINER`, RLS i Storage.
- Przejrzeć maksymalny czas sesji i timeout bezczynności w hostowanym Supabase; rotację refresh tokenów uzupełnić o procedurę unieważniania sesji po zmianie uprawnień.

## 12. Podsumowanie końcowe

Avably ma dobrą bazę zabezpieczeń: silne nagłówki, defensywne RLS, MFA superadmina, dobre wzorce uploadu, webhooków i nowych kluczy API. Największe ryzyka są skupione w dwóch granicach zaufania: **claim JWT nie jest bieżącym stanem uprawnień** oraz **publiczne RPC bazy nie może polegać na bramkach istniejących wyłącznie w Server Action**. Zamknięcie tych dwóch problemów przed produkcyjnym startem istotnie obniży ryzyko naruszenia izolacji tenantów i nadużyć operacyjnych.
