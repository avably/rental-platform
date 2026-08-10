import { createHmac, randomBytes } from "node:crypto";

/**
 * BILET CHECKOUTU (R13, audyt H-02, ADR-125) — zaświadczenie zaufanej granicy,
 * weryfikowane W BAZIE przed jakimkolwiek zapisem.
 *
 * ==================== PO CO BILET ====================
 *
 * `app.public_checkout` ma grant EXECUTE dla roli `anon`, bo sklep jest
 * anonimowy — i musi go mieć. Klucz anon jest jednak PUBLICZNY z definicji
 * (leży w źródle strony), więc bot woła tę funkcję wprost, z pominięciem
 * Server Action, a więc i wszystkich bramek, które w niej stoją: honeypotu,
 * limitu per IP i Turnstile. Powstają trwałe zamówienia `pending`, a te
 * zdejmują egzemplarze z dostępności — spam nie zaśmieca bazy, on WYŁĄCZA
 * FLOTĘ najemcy z oferty.
 *
 * Bilet zamyka tę drogę, nie zamykając samej funkcji: baza wymaga dowodu, że
 * wołający przeszedł zaufaną granicę. Dowodem jest podpis HMAC, którego nie da
 * się wyprodukować bez sekretu — a sekret zna wyłącznie serwer.
 *
 * ==================== DLACZEGO TU, A NIE W BAZIE ====================
 *
 * Bilet bije się LOKALNIE, czystym obliczeniem. Wystawianie go publicznym RPC
 * („daj mi bilet") byłoby tą samą dziurą z jednym krokiem więcej: bot
 * poprosiłby o bilet, dostał i użył. Sekret NIE MOŻE też pojechać do
 * przeglądarki — stąd zmienna serwerowa, bez `NEXT_PUBLIC_`.
 *
 * Nazwa bez prefiksu dostawcy (`AVABLY_`, nie `VERCEL_`) — patrz lekcja
 * o kolizji z systemową zmienną Vercela, która przykrywa własną wartość.
 *
 * ==================== CO BILET WIĄŻE, A CZEGO NIE ====================
 *
 * Wiąże TENANTA, TERMIN WAŻNOŚCI i JEDNORAZOWY NONCE. Nie podpisuje treści
 * zamówienia. To jest świadoma iteracja, nie przeoczenie: kanonizacja tej
 * samej struktury po stronie Node i SQL (kolejność kluczy, format dat i liczb,
 * null vs brak klucza, sortowanie pozycji) to krucha powierzchnia, a każdy
 * rozjazd oznacza masowe odrzucanie PRAWDZIWYCH checkoutów — awarię sprzedaży,
 * nie awarię bezpieczeństwa. Jednorazowość nonce zamyka H-02 sama: bez sekretu
 * nie powstanie ani jeden ważny bilet, a przechwycony bilet działa RAZ.
 *
 * ==================== BRAK KLUCZA = WARSTWA JAWNIE WYŁĄCZONA ====================
 *
 * Semantyka jest LUSTREM `verifyTurnstile` i biletu formularza kontaktu
 * (ADR-095): bez sekretu wystawiamy bilet pusty, a baza bez zasianego klucza
 * i tak go nie bada — dev i CI mają mieć checkout DZIAŁAJĄCY, nie zepsuty.
 *
 * Obie strony muszą być skonfigurowane RAZEM i to jest jedyna asymetria warta
 * zapamiętania: sekret w bazie BEZ sekretu tutaj = każdy checkout odrzucony
 * (fail-closed, awaria sprzedaży); sekret tutaj BEZ sekretu w bazie = bramka
 * otwarta (H-02 nadal czynne). Kolejność wdrożenia jest w migracji 0059.
 */

/** Sekret podpisu. Serwerowy — BEZ `NEXT_PUBLIC_`, bez prefiksu dostawcy. */
export const CHECKOUT_TICKET_SECRET_ENV = "AVABLY_CHECKOUT_TICKET_SECRET";

/**
 * Ile bilet jest ważny. Piętnaście minut jest OGROMNYM zapasem, bo — inaczej
 * niż bilet formularza kontaktu — ten wystawia się przy WYSYŁCE, nie przy
 * renderze: między podpisem a sprawdzeniem w bazie mija jedno wywołanie RPC.
 * Termin nie mierzy więc cierpliwości człowieka, tylko ogranicza okno, w którym
 * bilet przechwycony w locie da się jeszcze użyć. Górną granicę zna też baza
 * (0059) — podniesienie tej wartości powyżej 2 h wymaga zmiany tam.
 */
export const CHECKOUT_TICKET_TTL_SECONDS = 15 * 60;

/** Trzy pola jednego zaświadczenia. `null` = bilet pusty (brak sekretu). */
export interface CheckoutTicket {
  exp: number | null;
  nonce: string | null;
  sig: string | null;
}

/**
 * KANONIZACJA — jedyne miejsce, w którym powstaje podpisywany komunikat.
 * Lustrem jest `app.assert_checkout_ticket` z migracji 0059, która składa ten
 * sam string z własnych wartości. Zgodność obu stron pilnuje wektor wzorcowy
 * (test/checkout-ticket.test.ts i packages/db/test/checkout-ticket.test.ts
 * trzymają te same literały) — rozjazd zapala jeden z nich.
 *
 * `toLowerCase` na tenancie: Postgres wypisuje `uuid::text` małymi literami,
 * a nagłówek middleware'u niesie zwykły string. Bez normalizacji tenant
 * zapisany wielkimi literami dałby inny podpis po każdej stronie.
 */
export function checkoutTicketMessage(tenantId: string, exp: number, nonce: string): string {
  return `${tenantId.trim().toLowerCase()}.${exp}.${nonce}`;
}

function secretOf(options: { secret?: string | undefined }): string | undefined {
  // Wzorzec `in`-owy z verifyTurnstile: o źródle sekretu decyduje OBECNOŚĆ
  // klucza, nie jego wartość. Dzięki temu jawne `{ secret: undefined }`
  // (test wymuszający dev-skip) NIE spada na env procesu — inaczej taki test
  // przechodziłby albo nie w zależności od konfiguracji maszyny, co jest
  // najgorszym rodzajem testu bezpieczeństwa.
  const value = "secret" in options ? options.secret : process.env[CHECKOUT_TICKET_SECRET_ENV];
  return value ? value : undefined;
}

let warnedDevSkip = false;

/**
 * Bilet na TO wywołanie. Wystawiany wyłącznie w zaufanej granicy, PO zaliczonych
 * bramkach powierzchni (Turnstile w sklepie, klucz API w v1, przedsionek
 * same-origin w embedzie) — sąsiedztwo tych dwóch kroków w rdzeniu checkoutu
 * JEST tą własnością bezpieczeństwa, o którą chodzi.
 *
 * Nonce ma 128 bitów z CSPRNG: nie musi być nieodgadywalny (podpis i tak go
 * chroni), musi być NIEPOWTARZALNY, bo powtórzenie odbije się o barierę
 * jednorazowości i odrzuci uczciwego klienta.
 */
export function issueCheckoutTicket(
  tenantId: string,
  options: { now?: number; nonce?: string; secret?: string | undefined } = {},
): CheckoutTicket {
  const secret = secretOf(options);
  if (!secret) {
    if (!warnedDevSkip) {
      console.warn(
        `[checkout] ${CHECKOUT_TICKET_SECRET_ENV} nie ustawiony — bilet checkoutu NIE jest wystawiany.`,
      );
      warnedDevSkip = true;
    }
    return { exp: null, nonce: null, sig: null };
  }

  const exp = Math.floor((options.now ?? Date.now()) / 1000) + CHECKOUT_TICKET_TTL_SECONDS;
  const nonce = options.nonce ?? randomBytes(16).toString("hex");
  const sig = createHmac("sha256", secret)
    .update(checkoutTicketMessage(tenantId, exp, nonce))
    .digest("hex");

  return { exp, nonce, sig };
}
