import {
  contactRecipient,
  parseContactMessage,
  type ContactStructuredContent,
  type ContactSubmitInput,
  type ContactSubmitResult,
} from "@avably/core/site";

import type { ContactTicketVerdict } from "./ticket";

/**
 * RDZEŃ AKCJI KONTAKTU (E4, ADR-095) — bez `next/headers`, bez sieci i bez
 * klienta Supabase, więc cała KOLEJNOŚĆ BRAMEK jest testowalna wprost
 * (wzorzec: lib/checkout/core.ts, lib/waitlist/core.ts).
 *
 * ==================== CZTERY WARSTWY, JEDNA KOLEJNOŚĆ ====================
 *
 *   1. LIMIT ZGŁOSZEŃ — pierwszy, bo jest najtańszy i chroni wszystko za sobą
 *      (łącznie z weryfikatorem CAPTCHY, za który płacimy przelotem do
 *      dostawcy). Ta sama decyzja co w waitliście.
 *   2. BILET — podpisany znacznik czasu z chwili renderu. Przed odczytem
 *      strony, bo zgłoszenie bez ważnego biletu nie zasługuje na zapytanie
 *      do bazy.
 *   3. PUŁAPKA — wypełniona znaczy bot. Odpowiedź jest TAKA SAMA jak przy
 *      sukcesie i wychodzi PRZED odczytem sekcji oraz przed walidacją: gdyby
 *      bot dostał tu „błąd pola", nauczyłby się reguły po pierwszej próbie.
 *   4. CAPTCHA — po walidacji, przed wysyłką. Weryfikacja kosztuje przelot,
 *      więc nie płacimy za nią przy zgłoszeniu, które i tak odpada na formie.
 *
 * Między nimi stoją dwie bramki nie-antyspamowe: ODCZYT SEKCJI (bez adresata
 * nie ma dokąd wysłać) i WALIDACJA (ta sama funkcja, co w przeglądarce).
 *
 * ==================== ADRESAT NIE POCHODZI OD KLIENTA ====================
 *
 * Wejście niesie `sectionId`, a nie adres. Sekcję czyta `loadSection`
 * z OPUBLIKOWANEJ strony tego tenanta, a adresata wyprowadza z jej treści
 * `contactRecipient`. Formularz przyjmujący adres byłby otwartą bramką do
 * rozsyłki cudzej poczty z naszej domeny — i nie ma na to bezpiecznej wersji.
 */

export interface ContactDeps {
  /** Klucz limitu (IP żądania). */
  ip: string;
  checkRateLimit: (
    key: string,
    opts: { limit: number; windowSeconds: number },
  ) => Promise<{ success: boolean }>;
  verifyTicket: (ticket: string) => ContactTicketVerdict;
  /**
   * Sekcja kontaktu z OPUBLIKOWANEJ strony tenanta albo `null`, gdy takiej
   * sekcji nie ma (skasowana, nieopublikowana, innego typu).
   */
  loadSection: (sectionId: string) => Promise<ContactStructuredContent | null>;
  /** Weryfikacja CAPTCHY (ADR-032) — semantykę konfiguracji niesie akcja. */
  verifyCaptcha: (token: string | undefined) => Promise<{ ok: boolean }>;
  /**
   * Wysyłka wiadomości. Rzuca przy niepowodzeniu — rdzeń mapuje to na
   * `server_error`, bo dla piszącego to jest awaria, a nie jego błąd.
   * `false` w wyniku znaczy „poczta niedostępna" (brak konfiguracji).
   */
  send: (message: ContactOutgoingMessage) => Promise<{ delivered: boolean }>;
}

export interface ContactOutgoingMessage {
  to: string;
  name: string;
  email: string;
  phone?: string;
  message: string;
}

/**
 * Limit celowo ciasny: formularz kontaktowy to kilka wiadomości dziennie na
 * sklep, nie przepływ. Pięć na godzinę per IP zostawia zapas na wspólne NAT-y
 * i na człowieka, który pomylił się w adresie, a odcina masową rozsyłkę.
 * Ta sama para liczb, co w waitliście — bo to ten sam rodzaj ruchu.
 */
export const CONTACT_RATE_LIMIT = { limit: 5, windowSeconds: 3600 } as const;

export async function submitContactCore(
  input: ContactSubmitInput,
  deps: ContactDeps,
): Promise<ContactSubmitResult> {
  const limit = await deps.checkRateLimit(`contact:ip:${deps.ip}`, CONTACT_RATE_LIMIT);
  if (!limit.success) return { status: "rate_limited" };

  if (deps.verifyTicket(input.ticket) !== "ok") return { status: "expired" };

  // PUŁAPKA. Cicha akceptacja: ani wysyłki, ani odróżnialnej odpowiedzi.
  if (input.trap.trim() !== "") return { status: "sent" };

  const section = await deps.loadSection(input.sectionId);
  if (!section || !section.showForm) return { status: "unavailable" };
  const to = contactRecipient(section);
  if (!to) return { status: "unavailable" };

  /*
   * Walidacja czyta `askPhone` z OPUBLIKOWANEJ sekcji, nie z wejścia. Gdyby
   * decydowało wejście, wystarczyłoby nie przysłać tego pola, żeby ominąć
   * wymóg, który operator włączył.
   */
  const parsed = parseContactMessage(
    {
      name: input.name,
      email: input.email,
      message: input.message,
      ...(section.askPhone ? { phone: input.phone ?? "" } : {}),
    },
    section.askPhone,
  );
  // Pytamy o `ok`, a nie o rozmiar mapy błędów: wejście z nieznanym kluczem
  // odpada na `.strict()`, choć żadne POLE nie jest wtedy winne (mapa pusta).
  if (!parsed.ok) return { status: "validation_error", fields: parsed.fields };

  const captcha = await deps.verifyCaptcha(input.captchaToken);
  if (!captcha.ok) return { status: "captcha_failed" };

  try {
    const outcome = await deps.send({
      to,
      name: input.name.trim(),
      email: input.email.trim(),
      ...(section.askPhone && input.phone ? { phone: input.phone.trim() } : {}),
      message: input.message.trim(),
    });
    // Niedostępna poczta to STAN konfiguracji, nie awaria żądania — i tak ma
    // być nazwana, żeby piszący wiedział, że ma sięgnąć po telefon.
    return outcome.delivered ? { status: "sent" } : { status: "unavailable" };
  } catch (error) {
    // Szczegóły zostają w logu serwera: treść błędu dostawcy potrafi zawierać
    // adres nadawcy, czyli dane osobowe, i nie ma prawa opuścić serwera.
    console.error("[kontakt] wysyłka wiadomości nie powiodła się", error);
    return { status: "server_error" };
  }
}
