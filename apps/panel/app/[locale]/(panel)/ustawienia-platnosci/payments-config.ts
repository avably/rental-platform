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
 * Hosty pętli zwrotnej — JEDYNE wartości nagłówka `Host`, którym ufamy.
 *
 * Adres pętli zwrotnej wskazuje maszynę, z której PRZYSZŁO żądanie, więc
 * podstawienie go nie kieruje nikogo poza jego własny komputer. To jest cała
 * różnica między nim a dowolnym innym hostem z nagłówka.
 */
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/**
 * Baza adresów powrotu z onboardingu.
 *
 * ŹRÓDŁEM JEST NASZA KONFIGURACJA (`PANEL_URL` z `brand.ts`), nie nagłówek
 * żądania — ta sama zasada co przy linkach potwierdzających konto: host to
 * tożsamość produktu, nie parametr żądania. Nagłówek `Host` przychodzi od
 * klienta i gdyby decydował, dałoby się wysłać najemcę po onboardingu pod
 * cudzy adres.
 *
 * JEDYNY WYJĄTEK: host pętli zwrotnej. Bez niego weryfikacja w przeglądarce
 * jest niewykonalna — dostawca wymaga adresu bezwzględnego, a każdy worktree
 * biegnie na własnym porcie. Wyjątek nic nie otwiera: `127.0.0.1` u napastnika
 * to jego własna maszyna.
 *
 * DLACZEGO NIE `NODE_ENV` (znaleziono weryfikacją na żywo). Pierwsza wersja
 * brała `PANEL_URL`, gdy `NODE_ENV === "production"` — a `next start` ustawia
 * tę zmienną także dla buildu uruchomionego LOKALNIE. Powrót z prawdziwego
 * onboardingu poszedł więc na produkcyjny host i skończył się 404. `NODE_ENV`
 * odpowiada na pytanie „jak zbudowano", a my pytamy „gdzie to działa" — to
 * dwie różne rzeczy i myliły się tylko dlatego, że zwykle się pokrywają.
 */
export async function panelBaseUrl(): Promise<string> {
  const host = (await headers()).get("host");
  if (host && LOOPBACK_HOST.test(host)) return `http://${host}`;
  return PANEL_URL;
}
