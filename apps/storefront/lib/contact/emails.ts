import {
  DEFAULT_TENANT_LOCALE,
  isLocale,
  platformFromAddress,
  type EmailAvailability,
  type EmailTransport,
  type Locale,
} from "@avably/core";
import { emailMessages, renderContactMessage } from "@avably/emails";

import type { ContactOutgoingMessage } from "./core";

/**
 * WYSYŁKA WIADOMOŚCI Z FORMULARZA KONTAKTU (E4, ADR-095).
 *
 * Ten sam tor, co reszta poczty produktu (ADR-033): transport Resend i adres
 * nadawcy PLATFORMY z nazwą wypożyczalni. Adres najemcy w polu `From` byłby
 * podszyciem się pod jego domenę — nie mamy jej zweryfikowanej, więc poczta
 * odbiorcy i tak odrzuciłaby taką wiadomość albo wrzuciła do spamu.
 *
 * REPLY-TO = ADRES PISZĄCEGO i to jest cała mechanika odpowiadania: najemca
 * klika „Odpowiedz" w swojej skrzynce i pisze wprost do zainteresowanego,
 * bez logowania się gdziekolwiek. Bez tego nagłówka odpowiedź poszłaby na
 * adres platformy, czyli donikąd.
 *
 * ZERO ZAPISU DO BAZY. Wiadomość nie jest zamówieniem ani zdarzeniem cyklu
 * najmu — nie ma czego korelować, a przechowywanie treści od anonimowych
 * nadawców byłoby zbieraniem danych osobowych „na wszelki wypadek".
 * Historia tej korespondencji mieszka w skrzynce najemcy.
 */
export interface ContactEmailDeps {
  transport: EmailTransport;
  availability: EmailAvailability;
  /** Nazwa wypożyczalni — wchodzi w `From` i w ramkę wiadomości. */
  tenantName: string;
  /** Język NAJEMCY (odbiorcy), nie piszącego: to on tę wiadomość czyta. */
  locale: string;
  /** Nadpisanie adresu platformy (test); domyślnie env/stała z @avably/core. */
  fromEmail?: string;
}

export async function sendContactMessage(
  message: ContactOutgoingMessage,
  deps: ContactEmailDeps,
): Promise<{ delivered: boolean }> {
  // Bez skonfigurowanego transportu nie ma czego próbować (ADR-033: nigdy
  // cichy sukces). Rdzeń zamienia to na status `unavailable`.
  if (!deps.availability.available) return { delivered: false };

  const locale: Locale = isLocale(deps.locale) ? deps.locale : DEFAULT_TENANT_LOCALE;
  const t = emailMessages(locale).contactMessage;

  const { html, text } = await renderContactMessage({
    locale,
    tenantName: deps.tenantName,
    senderName: message.name,
    senderEmail: message.email,
    ...(message.phone ? { senderPhone: message.phone } : {}),
    message: message.message,
  });

  await deps.transport.send({
    from: platformFromAddress(deps.tenantName, deps.fromEmail ? { fromEmail: deps.fromEmail } : {}),
    to: message.to,
    replyTo: message.email,
    subject: t.subject(message.name),
    html,
    text,
  });

  return { delivered: true };
}
