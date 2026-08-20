/**
 * Jedno źródło prawdy o bazie adresu PANELU dla linków składanych server-side
 * (ADR-050, ADR-190). DWA warianty, bo „gdzie żyje panel" ma dwa konteksty:
 *   - `panelBaseUrl()` — link do PÓŹNIEJSZEJ dostawy (mail, zaproszenie),
 *     bez żywego żądania; bazę rozstrzyga NODE_ENV,
 *   - `panelBaseUrlFromRequest()` — POWRÓT z przekierowania dostawcy w obrębie
 *     żądania (onboarding, Checkout/Portal abonamentu — ADR-221); host żądania
 *     z wyjątkiem pętli zwrotnej, bo NODE_ENV myli `next start` z produkcją.
 *
 * Funkcja urodziła się w account-email-hook.ts jako `callbackBaseUrl` — nazwa
 * opisywała jedyny ówczesny przypadek użycia (link potwierdzający konto).
 * Dziś przypadki są dwa i oba znaczą to samo „gdzie żyje panel":
 *   1. linki potwierdzające konto (`/auth/confirm`, account-email-hook.ts),
 *   2. linki akceptacji zaproszenia (`/zaproszenie/<token>`,
 *      zaproszenia/actions.ts, ADR-190).
 *
 * HOST LINKU TO NASZA TOŻSAMOŚĆ PRODUKTU (brand.ts), NIE PARAMETR ŻĄDANIA.
 * Ta zasada kosztowała już dwie blokady onboardingu, za każdym razem z tą samą
 * niemą sygnaturą (wysyłka wygląda na udaną, link prowadzi w 404/obce API,
 * jedynym sygnałem jest skarga człowieka):
 *   - ADR-050: baza linku potwierdzającego brana z `email_data.site_url`
 *     payloadu hooka — link wychodził na host projektu Supabase,
 *   - ADR-190: baza linku zaproszenia brana z `siteUrl()` — czyli z kanonu
 *     MARKETINGOWEGO (`www.avably.io`), na którym trasa `/zaproszenie/…`
 *     nie istnieje. `siteUrl()` jest poprawne dla linków marketingowych;
 *     defekt polegał na wołaniu go tam, gdzie celem jest panel.
 *
 * ŚWIADOMIE BEZ NOWEJ ZMIENNEJ ŚRODOWISKOWEJ (w tym bez `NEXT_PUBLIC_…`,
 * która i tak jest stałą build-time): `PANEL_URL` już jest jednym źródłem
 * prawdy, a zmienna dokładałaby kolejne miejsce, w którym host może się
 * rozjechać — i którego brak byłby znowu niemy.
 *
 * Fallback poza produkcją NIE może być kanonem ani `PANEL_URL`: dev i testy
 * muszą trafiać we własny serwer, inaczej lokalne potwierdzenia i zaproszenia
 * prowadziłyby na produkcję (lustro rozumowania z `siteUrl()`).
 */
import { headers } from "next/headers";

import { PANEL_URL } from "@avably/core";

/** Baza linku poza produkcją. Dev i testy muszą trafiać we własny serwer. */
const LOCAL_PANEL_BASE = "http://127.0.0.1:3000";

/**
 * WARIANT „link składany do PÓŹNIEJSZEJ dostawy" (mail konta, zaproszenie).
 * Nie ma tu żywego żądania, którego host cokolwiek by znaczył, więc bazę
 * rozstrzyga NODE_ENV: prod → `PANEL_URL`, dev/test → własny serwer.
 */
export function panelBaseUrl(): string {
  return process.env.NODE_ENV === "production" ? PANEL_URL : LOCAL_PANEL_BASE;
}

/**
 * Hosty pętli zwrotnej — JEDYNE wartości nagłówka `Host`, którym ufamy.
 *
 * Adres pętli zwrotnej wskazuje maszynę, z której PRZYSZŁO żądanie, więc
 * podstawienie go nie kieruje nikogo poza jego własny komputer. To jest cała
 * różnica między nim a dowolnym innym hostem z nagłówka.
 */
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/**
 * WARIANT „powrót z przekierowania DOSTAWCY w obrębie ŻĄDANIA" (onboarding
 * Connect — ADR-065; powroty po Checkoutcie/Portalu abonamentu — ADR-221).
 *
 * Różni się od `panelBaseUrl()` świadomie: NIE bierze NODE_ENV, tylko host
 * żądania z wyjątkiem pętli zwrotnej. `next start` ustawia NODE_ENV=production
 * także dla buildu uruchomionego LOKALNIE, więc wariant NODE_ENV odsyłałby
 * lokalną weryfikację przekierowania na produkcję i kończył 404 (regresja
 * znaleziona na żywo, ADR-065). Host żądania odpowiada na pytanie „gdzie to
 * REALNIE działa", którego NODE_ENV nie zna.
 *
 * ŹRÓDŁEM POZA PĘTLĄ ZWROTNĄ JEST NASZA KONFIGURACJA (`PANEL_URL`), nie
 * nagłówek: `Host` przychodzi od klienta i gdyby decydował, dałoby się wysłać
 * najemcę pod cudzy adres. Wyjątek pętli zwrotnej nic nie otwiera —
 * `127.0.0.1` u napastnika to jego własna maszyna — a jest niezbędny, bo
 * dostawca wymaga adresu bezwzględnego, a każdy worktree biegnie na swoim porcie.
 */
export async function panelBaseUrlFromRequest(): Promise<string> {
  const host = (await headers()).get("host");
  if (host && LOOPBACK_HOST.test(host)) return `http://${host}`;
  return PANEL_URL;
}
