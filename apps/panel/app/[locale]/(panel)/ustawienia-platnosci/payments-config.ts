/**
 * Wspólne stałe i adresy ekranu płatności (Z2, ADR-065).
 *
 * Osobny plik, bo korzystają z niego TRZY miejsca o różnych ograniczeniach:
 * akcje serwerowe, handler powrotu z onboardingu i strona. Dublowanie ścieżek
 * skończyłoby się `return_url`, który wraca gdzie indziej niż `refresh_url`.
 *
 * Bazę ORIGINU PANELU dla powrotów z przekierowań dostawcy przeniesiono do
 * `@/lib/panel-url` jako `panelBaseUrlFromRequest` (ADR-221): korzystają z niej
 * też akcje billingu w warstwie `lib/`, a import z folderu trasy do `lib/*`
 * byłby zależnością odwróconą.
 */
export const PAYMENT_SETTINGS_PATH = "/ustawienia-platnosci";
export const PAYMENT_RETURN_PATH = `${PAYMENT_SETTINGS_PATH}/powrot`;

/**
 * Kraj rejestracji konta Connect.
 *
 * DZIŚ STAŁA, ŚWIADOMIE. `public.tenants` nie ma kolumny kraju, a zgadywanie
 * go z czegokolwiek innego (adres punktu odbioru, waluta) byłoby zgadywaniem
 * podstawy prawnej rozliczenia najemcy. Sprzedaż startuje w Polsce, więc
 * stała jest prawdziwa dla każdego dzisiejszego najemcy — i jest JEDNYM
 * miejscem do zmiany, gdy najemca dostanie własny kraj rejestracji.
 * Wartości nie da się podać z formularza: kraj konta jest nieodwracalny
 * u dostawcy, więc pomyłka klienta byłaby trwała.
 */
export const CONNECT_ACCOUNT_COUNTRY = "PL";
