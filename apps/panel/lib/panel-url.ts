/**
 * Jedno źródło prawdy o bazie adresu PANELU dla linków składanych server-side
 * (ADR-050, ADR-190).
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
import { PANEL_URL } from "@avably/core";

/** Baza linku poza produkcją. Dev i testy muszą trafiać we własny serwer. */
const LOCAL_PANEL_BASE = "http://127.0.0.1:3000";

export function panelBaseUrl(): string {
  return process.env.NODE_ENV === "production" ? PANEL_URL : LOCAL_PANEL_BASE;
}
