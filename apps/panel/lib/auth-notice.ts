/**
 * Komunikat, z którym użytkownik WRACA na ekran logowania (ADR-153, N2).
 *
 * Dwa najczęstsze realne przejścia panelu kończyły się na `/login` z
 * parametrem, którego ekran NIE CZYTAŁ — więc na gołym formularzu, bez słowa
 * wyjaśnienia:
 *   • `/auth/confirm` przy wygasłym/zużytym/obcym linku → `?error=link_expired`
 *     (komunikat `authError.linkExpired` był napisany i przetłumaczony,
 *     tylko nikt go nie wyświetlał),
 *   • udana zmiana hasła → `?reset=ok` i całkowita cisza.
 *
 * ALLOWLISTA, NIE ODBICIE. Parametr adresu jest wejściem od dowolnej osoby
 * (wystarczy podesłać link), więc jego treść NIGDY nie trafia na ekran —
 * wartość spoza tej mapy daje `null`, czyli brak komunikatu. Dzięki temu
 * `/login?error=<cokolwiek>` nie jest tablicą ogłoszeniową dla napastnika
 * ani wektorem wstrzyknięcia treści w nasz interfejs.
 *
 * Funkcja jest CZYSTA i bez Reacta — bramka CI może ją odpytać wprost,
 * a ekran wyłącznie tłumaczy zwrócony klucz.
 */

/** Ton komunikatu — decyduje o roli ARIA i kolorze na ekranie. */
export type LoginNoticeTone = "error" | "success";

export interface LoginNotice {
  tone: LoginNoticeTone;
  /** Pełna ścieżka klucza w messages/{pl,en}.json. */
  messageKey: "authError.linkExpired" | "login.resetDone";
}

/**
 * Kody `?error=` emitowane przez `app/auth/confirm/route.ts`.
 *
 * `invalid_link` i `link_expired` dostają TEN SAM komunikat świadomie:
 * dla człowieka to jeden przypadek („link z maila nie zadziałał, poproś
 * o nowy"), a rozróżnianie ich niczego mu nie ułatwia.
 */
const ERROR_NOTICES: Readonly<Record<string, LoginNotice>> = {
  link_expired: { tone: "error", messageKey: "authError.linkExpired" },
  invalid_link: { tone: "error", messageKey: "authError.linkExpired" },
};

/** Wartości `?reset=` — dziś jedna, ustawiana po udanej zmianie hasła. */
const RESET_NOTICES: Readonly<Record<string, LoginNotice>> = {
  ok: { tone: "success", messageKey: "login.resetDone" },
};

/**
 * Komunikat dla parametrów adresu ekranu logowania albo `null`.
 *
 * Sukces ma pierwszeństwo przed błędem: `?reset=ok` powstaje w NASZYM
 * przekierowaniu po udanym zapisie hasła, więc gdyby w adresie został jeszcze
 * stary `?error=`, prawdą o tym, co się przed chwilą stało, jest sukces.
 */
export function loginNotice(params: {
  error?: string | string[] | undefined;
  reset?: string | string[] | undefined;
}): LoginNotice | null {
  const reset = single(params.reset);
  if (reset && RESET_NOTICES[reset]) return RESET_NOTICES[reset];

  const error = single(params.error);
  if (error && ERROR_NOTICES[error]) return ERROR_NOTICES[error];

  return null;
}

/**
 * Powtórzony parametr (`?error=a&error=b`) przychodzi jako tablica — bierzemy
 * PIERWSZĄ wartość, zamiast sklejać ją do napisu „a,b", który i tak nie
 * trafiłby w allowlistę, ale zamazywałby intencję.
 */
function single(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}
