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
 * `Contact` wskazuje na `admin@avably.io`. W repo/DNS nie ma w chwili pisania
 * (2026-08-09) dowodu na istnienie dedykowanego aliasu `security@avably.io`
 * — patrz ADR-123. Gdy właściciel założy alias, wystarczy podmienić stałą
 * `SECURITY_TXT_CONTACT` poniżej.
 */
import { CANONICAL_SITE_URL } from "@avably/core";

/** Patrz docblock modułu — wymaga ręcznej weryfikacji przy odświeżaniu. */
export const SECURITY_TXT_CONTACT = "admin@avably.io";

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
