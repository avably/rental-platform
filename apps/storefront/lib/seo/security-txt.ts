/**
 * `/.well-known/security.txt` wg RFC 9116 (I-01, ADR-123).
 *
 * TREŚĆ IDENTYCZNA DLA WSZYSTKICH DOMEN I TENANTÓW. To kontakt bezpieczeństwa
 * PLATFORMY (Avably), nie najemcy — w przeciwieństwie do `sitemap.xml` i
 * `robots.txt` (ADR-044) ta trasa NIE rozgałęzia się po hoście, nie czyta
 * nagłówka `Host` i nie łączy się z bazą. Jedna stała treść, każdy host.
 *
 * `Expires` jest STAŁĄ wpisaną w kodzie, NIE liczoną w trakcie renderu
 * (np. `Date.now() + rok`) — RFC 9116 §2.5.5 wymaga jednej konkretnej daty
 * w formacie ISODATE (RFC 3339), nie ruchomego okna. Skutek uboczny: pole
 * WYMAGA OKRESOWEGO ODŚWIEŻENIA przez człowieka — patrz ADR-123 i sekcja OPS
 * raportu zadania I-01. Bez tego plik w końcu przekroczy termin ważności i
 * przestanie być zgodny z RFC (choć nadal będzie zwracał 200).
 *
 * `Contact` wskazuje na `security@avably.io` — dedykowany alias, którego
 * RFC 9116 oczekuje. Alias istnieje od 2026-08-10 jako PRZEKIEROWANIE w OVH
 * (MX Plan → Zarządzanie przekierowaniami), założone przez właściciela; nie
 * jest osobną skrzynką, więc dowodu na jego istnienie nie widać ani w repo,
 * ani w rekordach DNS — patrz ADR-123. Do 2026-08-10 pole wskazywało
 * `admin@avably.io`, bo wymyślanie adresu, który odbije się błędem
 * doręczenia, jest gorsze niż brak specjalizacji; uzasadnienie zostaje
 * aktualne na wypadek, gdyby przekierowanie kiedyś zniknęło.
 *
 * `admin@avably.io` NIE jest tu zamiennikiem: w politykach prywatności
 * (`messages/*.json`) występuje jako adres administratora danych (RODO) i to
 * inny kanał niż zgłaszanie podatności.
 */
import { CANONICAL_SITE_URL } from "@avably/core";

/** Patrz docblock modułu — wymaga ręcznej weryfikacji przy odświeżaniu. */
export const SECURITY_TXT_CONTACT = "security@avably.io";

/**
 * ISODATE (RFC 3339) w przyszłości, ok. 12 miesięcy od publikacji
 * (2026-08-09). STAŁA — nie liczyć dynamicznie, patrz docblock modułu.
 */
export const SECURITY_TXT_EXPIRES = "2027-08-09T00:00:00Z";

/** Adres kanoniczny tego dokumentu (RFC 9116 §2.5.6) — jeden, niezależny od hosta żądania. */
export const SECURITY_TXT_CANONICAL = `${CANONICAL_SITE_URL}/.well-known/security.txt`;

export function renderSecurityTxt(): string {
  return [
    `Contact: mailto:${SECURITY_TXT_CONTACT}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    "Preferred-Languages: pl, en",
    `Canonical: ${SECURITY_TXT_CANONICAL}`,
    "",
  ].join("\n");
}
