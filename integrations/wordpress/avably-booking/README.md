# Avably Booking — wtyczka WordPress (iteracja 1)

Wtyczka wpina rezerwacje Avably w istniejącą stronę WordPress najemcy:
katalog → produkt → kalendarz dostępności → formularz rezerwacji →
potwierdzenie. Konsumuje publiczne API v1 (ADR-108); wszystkie wywołania
API są **server-side** (PHP → API), przeglądarka rozmawia wyłącznie
z `admin-ajax.php` własnej instalacji.

## Wymagania

- WordPress ≥ 6.5 (blok Gutenberga; tłumaczenia .mo),
- PHP ≥ 8.1,
- zero zależności Composera w runtime,
- konto Avably z wygenerowanym kluczem API (panel → Organizacja →
  Ustawienia API, klucz w formacie `avbl_…`).

## Instalacja

Najprościej: w panelu Avably wejdź w **Integracje** (grupa KANAŁY) i kliknij
**„Pobierz wtyczkę (.zip)"**, a potem w WordPressie **Wtyczki → Dodaj wtyczkę →
Wyślij wtyczkę na serwer**, wgraj plik, kliknij „Zainstaluj teraz" i **„Włącz
wtyczkę"**.

Paczkę można też zbudować ze źródeł repo:

```sh
node scripts/build-wp-plugin-zip.mjs
```

Ręcznie, z katalogu źródeł:

1. Skopiuj katalog `avably-booking/` do `wp-content/plugins/`.
2. Aktywuj wtyczkę **Avably Booking** w wp-admin.
3. Wejdź w **Ustawienia → Avably Booking**:
   - **URL API** — zostaw domyślny (produkcja Avably), chyba że wsparcie
     zaleci inaczej;
   - **Klucz API** — wklej klucz `avbl_…` z panelu Avably. Klucz jest
     przechowywany wyłącznie po stronie serwera (wp_options) i nigdy nie
     trafia do HTML-a ani JS-a przeglądarki; w ustawieniach widać tylko
     prefiks identyfikacyjny.
4. Dodaj na dowolnej stronie **blok „Avably Booking”** albo shortcode
   `[avably_booking]`.

Strony z osadzonym flow są automatycznie oznaczane jako niecache'owalne
(`DONOTCACHEPAGE` + nagłówki no-cache) — wtyczki cache (np. WP Super
Cache) je omijają. Kalendarz i dostępność są zawsze pobierane przez
endpoint ajaxowy, nigdy zapieczone w HTML-u strony.

## Płatności (iteracja 1)

Wyłącznie metody offline kontraktu: **przelew** (`transfer`) i **płatność
przy odbiorze** (`cod`). Checkout online w ramce to osobna iteracja (M4).

## i18n

Text domain `avably-booking`. Stringi źródłowe EN, tłumaczenie PL w
`languages/avably-booking-pl_PL.{po,mo}`. Rekompilacja po zmianie .po:

```sh
docker run --rm -v "$(pwd)":/app -w /app php:8.1-cli \
  php dev/compile-mo.php languages/avably-booking-pl_PL.po
```

## Testy

Jedna komenda (wymaga Dockera, PHP na hoście niepotrzebne):

```sh
./dev/run-tests.sh
```

PHPUnit 10 (phar, pobierany raz do `dev/.cache/`) uruchamia suitę
`tests/cases/` na php:8.1-cli — logika klienta API, mapowanie błędów
kontraktu v1, walidacja formularza, escaping (XSS), whitelisty warstwy
ajaxowej i sanityzacja ustawień.

## Środowisko deweloperskie (żywa instalacja)

```sh
docker compose -f dev/docker-compose.yml up -d   # WP + MySQL (port 8090)
./dev/setup.sh                                    # instalacja WP + Astra + WP Super Cache + strona z blokiem
```

WP-Admin: `http://localhost:8090/wp-admin` (admin / avably-local-admin).
Lokalne API podłączysz ustawiając URL API na
`http://host.docker.internal:<port storefrontu>`.

## Bezpieczeństwo — model zagrożeń

WordPress jest atakowany masowo i automatycznie, więc wtyczka zakłada wrogie
otoczenie. Pięć punktów, które warto znać przed wdrożeniem:

1. **Nonce chroni przed CSRF, nie przed odczytem.** Każda z trzech akcji
   ajaxowych (`availability`, `month`, `reserve`) wymaga poprawnego nonce'a
   WP. Bez niego żądanie kończy się odmową **zanim wtyczka dotknie API** —
   obca strona nie złoży rezerwacji w imieniu Twojego odwiedzającego ani nie
   użyje Twojej instalacji jako darmowego proxy do naszego API. Nonce nie
   jest sekretem i jego obecność w HTML-u jest normalna.
2. **Klucz API jest server-side, bo przeglądarka to teren wroga.** Klucz żyje
   w `wp_options` (bez autoloadu) i wychodzi wyłącznie nagłówkiem
   `Authorization` z PHP do naszego API. Nie ma go w HTML-u strony, w JS-ie
   ani w odpowiedziach ajaxowych — gdyby był, każdy odwiedzający mógłby
   składać rezerwacje i czytać katalog poza Twoją stroną.
3. **Przejęcie konta administratora WP = przejęcie integracji.** Admin może
   odczytać opcje bazy, więc traktuj klucz jak hasło do sklepu: przy podejrzeniu
   włamania **odwołaj klucz w panelu Avably** (Organizacja → Ustawienia API) i
   wygeneruj nowy. Odwołanie działa natychmiast i nie rusza Twoich zamówień.
   Wtyczka ogranicza szkody: pole URL API odrzuca adresy prywatne i loopback
   (żeby przejęty admin nie zamienił serwera w skaner sieci wewnętrznej), a
   klucz nigdy nie wraca do formularza, więc nie da się go „podejrzeć" w HTML-u.
   Bramka adresu nie daje się obejść nietypowym zapisem liczbowym: dopuszczamy
   wyłącznie kanoniczny zapis dziesiętny (`203.0.113.10`), więc odpadają formy
   ósemkowe (`0177.0.0.1`), szesnastkowe (`0x7f.0.0.1`), jednoliczbowe
   (`2130706433`), skrócone (`127.1`), z wiodącymi zerami (`192.168.001.001`)
   oraz IPv4 osadzone w IPv6 (`::ffff:127.0.0.1`).
4. **Dane rezerwującego są przelotem.** Imię, e-mail i telefon lecą wyłącznie
   do API Avably. Wtyczka nie zapisuje ich w bazie WordPressa ani w logach —
   wyciek z bazy WP nie ujawni danych Twoich klientów, bo ich tam nie ma.
   Odinstalowanie usuwa zapisany klucz.
5. **Nadużycia formularza są dławione dwustopniowo.** Wtyczka odcina
   nadmiarowe rezerwacje per odwiedzający (10/h), a nasze API dokłada limit per
   klucz (30 rezerwacji/h). Pierwszy stopień jest konieczny, bo dla API cały
   ruch z Twojej strony wygląda jak jeden adres IP — bez niego jeden bot
   mógłby wyczerpać godzinny budżet całego sklepu.

## Bezpieczeństwo (warunki zamknięcia M2 §5)

- klucz API nigdy nie wychodzi do przeglądarki (payload frontowy ma
  zamknięty kształt — pilnowany testem),
- endpoint ajaxowy to NIE otwarte proxy: trzy akcje, ścisły whitelist
  parametrów (UUID/daty/pola formularza), nonce na każdej akcji; ścieżki
  API są stałymi klienta,
- dane osobowe rezerwującego lecą wyłącznie do API Avably — wtyczka nie
  zapisuje ich w bazie WordPressa ani nie loguje,
- każda treść z API renderowana przez `esc_html`/`esc_attr` (PHP) lub
  `textContent` (JS),
- błędy API mapowane na komunikaty bez szczegółów technicznych;
- pole „URL API" odrzuca adresy prywatne/loopback we wszystkich formach zapisu
  (dziesiętnej, ósemkowej, szesnastkowej, skróconej i IPv4-w-IPv6) — anty-SSRF.
  W środowisku deweloperskim, gdzie API stoi pod adresem lokalnym, dopuść je
  jawnie w `wp-config.php`:

  ```php
  define( 'AVABLY_BOOKING_ALLOW_PRIVATE_HOSTS', true );
  ```
