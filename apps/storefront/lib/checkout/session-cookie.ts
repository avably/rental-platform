/**
 * Uchwyt do WŁASNEGO checkoutu, przenoszony między krokiem płatności a
 * powrotem od dostawcy (Z3, ADR-066).
 *
 * DLACZEGO CIASTECZKO, A NIE PARAMETR URL. Po powrocie z płatności musimy
 * wiedzieć, o które zamówienie chodzi. Adres wraca od DOSTAWCY, więc wszystko,
 * co w nim umieścimy, przechodzi przez cudzy system, ląduje w historii
 * przeglądarki, w logach serwera i w nagłówku `Referer` każdego zasobu na
 * stronie powrotu. Token uprawniający do odczytu zamówienia nie ma tam czego
 * szukać. Ciasteczko `httpOnly` nie jest widoczne dla skryptów strony, nie
 * pokazuje się w adresie i jedzie wyłącznie do naszego origin.
 *
 * `SameSite=Lax`, nie `Strict`: powrót od dostawcy to nawigacja GET z OBCEJ
 * witryny. Przy `Strict` przeglądarka nie dołączyłaby ciasteczka i strona
 * powrotu nie miałaby jak rozpoznać zamówienia — użytkownik zobaczyłby
 * „nie znaleziono", mimo że właśnie zapłacił. `Lax` dokładnie ten przypadek
 * dopuszcza, nie otwierając ciasteczka na żądania pisane z obcych stron.
 *
 * TO NIE JEST SESJA. Nie ma tu tożsamości, uprawnień ani niczego, co
 * przeżywa checkout: to jednorazowy uchwyt do JEDNEGO zamówienia, ważny
 * godziny. Token w środku jest tym samym `checkout_log_token` z 0021 —
 * odpowiedzią na pytanie „czy to ty składałeś to zamówienie".
 */

export const CHECKOUT_COOKIE = "avably_checkout";

/**
 * Dwie godziny. Płatność BLIK-iem trwa minutę, przelewem P24 — kilka minut,
 * a klient bywa odrywany od komputera. Doba byłaby uchwytem leżącym
 * w przeglądarce długo po tym, jak przestał być potrzebny.
 */
export const CHECKOUT_COOKIE_MAX_AGE_SECONDS = 2 * 60 * 60;

export interface CheckoutHandle {
  orderId: string;
  token: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCheckoutHandle(handle: CheckoutHandle): string {
  return `${handle.orderId}.${handle.token}`;
}

/**
 * Odczyt jest WALIDACJĄ, nie parsowaniem. Wartość ciasteczka przychodzi od
 * klienta i może być czymkolwiek — łącznie z próbą wstrzyknięcia czegoś
 * w zapytanie do bazy. Przepuszczamy wyłącznie parę UUID-ów; wszystko inne
 * to `null`, czyli „nie ma czego pokazać", a nie błąd do zaraportowania.
 */
export function decodeCheckoutHandle(value: string | undefined | null): CheckoutHandle | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [orderId, token] = parts;
  if (!orderId || !token) return null;
  if (!UUID.test(orderId) || !UUID.test(token)) return null;
  return { orderId, token };
}
