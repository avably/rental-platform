/**
 * Powiadomienie e-mail o ZMIANIE hasła (R14/M-01, ADR-122).
 *
 * Wysyłane po każdej UDANEJ zmianie hasła — użytkownik, któremu ktoś zmienił
 * hasło, musi się o tym dowiedzieć natychmiast, bo powiadomienie jest jego
 * jedynym sygnałem przejęcia (pozostałe sesje są już wtedy unieważnione).
 *
 * Nadawca = PLATFORMA (jak w account-email-hook): to korespondencja Avably
 * z użytkownikiem, żaden tenant tu nie występuje. Zero zapisu do email_logs
 * z tego samego powodu, co w ADR-048 — tamta tabela jest per-tenant, a ta
 * wiadomość dotyczy KONTA.
 *
 * NIE RZUCA (wzorzec sendInvitationEmail/ADR-033): hasło jest już zmienione
 * i sesje unieważnione — awaria poczty nie może cofnąć ani przerwać tego
 * faktu. Zwraca POWÓD niewysłania albo undefined; wołający loguje powód
 * server-side. Cichy fałszywy sukces nie istnieje: brak klucza transportu
 * to jawna niedostępność (emailAvailability), nie udawana wysyłka.
 */
import {
  platformFromAddress,
  PRODUCT_NAME,
  type EmailAvailability,
  type EmailTransport,
  type Locale,
  type OutgoingEmail,
} from "@avably/core";
import { emailMessages, renderPasswordChanged } from "@avably/emails";

import { callbackBaseUrl } from "@/lib/account-email-hook";

export interface PasswordChangedEmailInput {
  to: string;
  locale: Locale;
  /** Nadpisanie bazy linku (test); domyślnie callbackBaseUrl (ADR-050). */
  baseUrl?: string;
}

export async function buildPasswordChangedEmail(
  input: PasswordChangedEmailInput,
): Promise<OutgoingEmail> {
  // Jedyny link w wiadomości: formularz PROŚBY o reset — bez tokenu.
  // Baza z naszej konfiguracji (brand), nigdy z żądania (lekcja ADR-050).
  const resetRequestUrl = new URL("/reset", input.baseUrl ?? callbackBaseUrl()).toString();
  const { html, text } = await renderPasswordChanged({
    locale: input.locale,
    resetRequestUrl,
  });

  return {
    from: platformFromAddress(PRODUCT_NAME),
    to: input.to,
    subject: emailMessages(input.locale).passwordChanged.heading,
    html,
    text,
  };
}

export interface SendPasswordChangedEmailInput extends PasswordChangedEmailInput {
  availability: EmailAvailability;
  transport: EmailTransport;
}

/**
 * Wysyłka powiadomienia. Zwraca POWÓD niewysłania albo undefined (wysłano).
 * NIGDY nie rzuca — zmiana hasła jest faktem, poczta go nie warunkuje.
 */
export async function sendPasswordChangedEmail(
  input: SendPasswordChangedEmailInput,
): Promise<string | undefined> {
  if (!input.availability.available) return input.availability.reason;

  try {
    const email = await buildPasswordChangedEmail(input);
    await input.transport.send(email);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : "nieznany błąd wysyłki";
  }
}
