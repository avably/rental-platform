/**
 * Wspólne stałe i adresy ekranu płatności (Z2, ADR-065).
 *
 * Osobny plik, bo korzystają z niego TRZY miejsca o różnych ograniczeniach:
 * akcje serwerowe, handler powrotu z onboardingu i strona. Dublowanie ścieżek
 * skończyłoby się `return_url`, który wraca gdzie indziej niż `refresh_url`.
 */
import { headers } from "next/headers";

import { PANEL_URL } from "@avably/core";

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

/**
 * Baza adresów powrotu.
 *
 * NA PRODUKCJI WYŁĄCZNIE Z NASZEJ KONFIGURACJI (`PANEL_URL` z `brand.ts`) —
 * ta sama zasada co przy linkach potwierdzających konto: host to tożsamość
 * produktu, nie parametr żądania. Nagłówek `Host` przychodzi od klienta;
 * gdyby produkcja go słuchała, dałoby się skierować powrót z onboardingu
 * na cudzy adres.
 *
 * POZA PRODUKCJĄ z nagłówka, bo inaczej weryfikacja w przeglądarce jest
 * niemożliwa: każdy worktree biegnie na własnym porcie, a dostawca wymaga
 * adresu bezwzględnego. Ryzyko jest zerowe — to lokalna maszyna dewelopera,
 * a w `return_url` nie ma żadnego sekretu (stan i tak odczytujemy sami).
 */
export async function panelBaseUrl(): Promise<string> {
  if (process.env.NODE_ENV === "production") return PANEL_URL;
  const host = (await headers()).get("host");
  return host ? `http://${host}` : "http://127.0.0.1:3000";
}
