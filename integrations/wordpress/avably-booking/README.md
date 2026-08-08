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
- błędy API mapowane na komunikaty bez szczegółów technicznych.
