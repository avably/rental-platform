import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * BILET FORMULARZA KONTAKTU (E4, ADR-095) — podpisany znacznik czasu z chwili
 * renderu strony.
 *
 * ==================== PO CO PODPIS ====================
 *
 * Warstwa „minimalnego czasu od renderu" broni przed najtańszym botem: takim,
 * który wypełnia i wysyła w tej samej milisekundzie. Gołe pole ukryte
 * z czasem nie broni przed niczym — bot, który przepisuje pola, przepisze
 * i czas, a jeśli będzie chciał, wpisze dowolny. Dopiero PODPIS czyni tę
 * wartość niepodrabialną: serwer wystawia ją przy renderze i rozpoznaje przy
 * odbiorze, a strona nie zna klucza.
 *
 * Bilet niesie SAM CZAS. Nie ma w nim tenanta ani sekcji, bo obu tych rzeczy
 * serwer i tak nie bierze od klienta: tenant przychodzi z nagłówka
 * middleware'u, a adresata wyprowadza się z opublikowanej treści sekcji.
 *
 * ==================== BRAK KLUCZA = WARSTWA JAWNIE WYŁĄCZONA ====================
 *
 * Semantyka jest LUSTREM `verifyTurnstile` (@avably/security): bez skonfigurowanego
 * sekretu weryfikacja przepuszcza, ostrzegając w logu — tak, żeby dev i CI bez
 * sekretów miały działający formularz, a nie zepsuty. Z sekretem jest
 * fail-closed: podrobiony, przeterminowany albo zbyt świeży bilet to odmowa.
 *
 * Trzy pozostałe warstwy (pułapka, CAPTCHA, limit zgłoszeń) są od tej
 * niezależne — wyłączenie jednej nie zdejmuje pozostałych.
 */

/** Sekret podpisu. Nazwa BEZ prefiksu dostawcy — patrz lekcja o kolizji zmiennych systemowych. */
export const CONTACT_TICKET_SECRET_ENV = "AVABLY_FORM_TICKET_SECRET";

/**
 * Ile czasu MUSI minąć między renderem a wysłaniem. Trzy sekundy: człowiek
 * potrzebuje ich na samo przeczytanie etykiet, a skrypt wypełnia formularz
 * w kilkanaście milisekund. Wyżej zaczęlibyśmy odbijać ludzi, którzy mieli
 * treść w schowku.
 */
export const CONTACT_TICKET_MIN_SECONDS = 3;

/**
 * Jak długo bilet jest ważny. Dwie godziny to karta zostawiona otwarta na
 * czas rozmowy albo przerwy; powyżej strona bywa już nieaktualna, a ważny
 * w nieskończoność bilet jest zaproszeniem do zbierania ich na zapas.
 */
export const CONTACT_TICKET_MAX_SECONDS = 2 * 60 * 60;

export type ContactTicketVerdict = "ok" | "invalid" | "too_fast" | "too_old";

function secretOf(secret?: string | undefined): string | undefined {
  // `in`-owy wzorzec z verifyTurnstile: jawne `undefined` od wołającego
  // (test wymuszający dev-skip) nie może spaść na env procesu.
  const value = secret === undefined ? process.env[CONTACT_TICKET_SECRET_ENV] : secret;
  return value ? value : undefined;
}

function sign(issuedAt: number, secret: string): string {
  return createHmac("sha256", secret).update(String(issuedAt)).digest("base64url");
}

/**
 * Bilet na teraz. Wystawiany przy RENDERZE sekcji, czyli raz na wyświetlenie
 * strony — jego czas jest czasem, w którym odwiedzający zobaczył formularz.
 */
export function issueContactTicket(options: { now?: number; secret?: string | undefined } = {}): string {
  const now = options.now ?? Date.now();
  const issuedAt = Math.floor(now / 1000);
  const secret = secretOf(options.secret);
  // Bez sekretu bilet jest samym czasem — weryfikacja i tak go wtedy nie bada.
  return secret ? `${issuedAt}.${sign(issuedAt, secret)}` : String(issuedAt);
}

let warnedDevSkip = false;

/**
 * Werdykt o bilecie. Kolejność sprawdzeń jest istotna: najpierw PODPIS (bo bez
 * niego czas w bilecie jest wartością, którą ktoś sobie wymyślił), potem wiek.
 */
export function verifyContactTicket(
  ticket: string,
  options: { now?: number; secret?: string | undefined } = {},
): ContactTicketVerdict {
  const secret = secretOf(options.secret);
  if (!secret) {
    if (!warnedDevSkip) {
      console.warn(
        `[kontakt] ${CONTACT_TICKET_SECRET_ENV} nie ustawiony — bilet formularza NIE jest weryfikowany.`,
      );
      warnedDevSkip = true;
    }
    return "ok";
  }

  const [rawIssuedAt, signature] = ticket.split(".");
  if (!rawIssuedAt || !signature || !/^\d+$/.test(rawIssuedAt)) return "invalid";

  const expected = Buffer.from(sign(Number(rawIssuedAt), secret));
  const given = Buffer.from(signature);
  // Porównanie stałoczasowe wymaga równych długości — inaczej `timingSafeEqual`
  // rzuca, a nie zwraca fałszu.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";

  const ageSeconds = Math.floor((options.now ?? Date.now()) / 1000) - Number(rawIssuedAt);
  // Bilet z PRZYSZŁOŚCI (zegary się rozjeżdżają, ale nie o godziny) traktujemy
  // jak zbyt świeży — jest nim w sensie, który nas obchodzi: nie upłynął czas.
  if (ageSeconds < CONTACT_TICKET_MIN_SECONDS) return "too_fast";
  if (ageSeconds > CONTACT_TICKET_MAX_SECONDS) return "too_old";
  return "ok";
}
