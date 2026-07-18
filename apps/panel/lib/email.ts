/**
 * Złożenie i wysyłka e-maila zaproszenia na WSPÓLNYM transporcie (ADR-033/036).
 *
 * Wymiana reliktu sprzed Zadania 8b (surowy fetch + inline HTML + cichy
 * dev-skip). Trzy warstwy 8b reużyte: szablon 8a (renderOrganizationInvitation),
 * port transportu (resendTransport, wstrzykiwany) i nadawca platformy
 * (platformFromAddress). Semantyka niedostępności = lustro ADR-033: brak klucza
 * to JAWNY powód niewysłania, nigdy udawany sukces (ADR-036 D1).
 *
 * Nadawca (ADR-036 D2): pole From = nazwa tenanta (tenants.name) + adres
 * platformy, dokładnie jak w e-mailach cyklu najmu. email_sender wnosi tylko
 * reply_to; jego BRAK jest legalny (fallback: bez reply_to) — nazwa najemcy to
 * nie obca marka, więc podstawienie nie łamie zakazu z ADR-033.
 *
 * NIE RZUCA (jak sendRentalEmailForTransition): zwraca powód niewysłania albo
 * undefined. Rekord zaproszenia powstaje przed wysyłką i poczta go nie cofa.
 */
import {
  DEFAULT_TENANT_LOCALE,
  EMAIL_SENDER_KEY,
  EmailConfigError,
  emailSenderFromSettings,
  isLocale,
  platformFromAddress,
  sendAndLog,
  type EmailAvailability,
  type EmailLogRecorder,
  type EmailTransport,
  type Locale,
  type OutgoingEmail,
  type TenantSettingRow,
} from "@avably/core";
import {
  emailMessages,
  renderOrganizationInvitation,
  type InvitationRole,
} from "@avably/emails";

export interface InvitationEmailInput {
  to: string;
  acceptUrl: string;
  locale: Locale;
  /** tenants.name — nazwa w polu From i w treści (ADR-036 D2). */
  organizationName: string;
  role: InvitationRole;
  replyTo?: string;
  /** Nadpisanie adresu platformy (test); domyślnie env/stała z @avably/core. */
  fromEmail?: string;
}

export async function buildInvitationEmail(
  input: InvitationEmailInput,
): Promise<OutgoingEmail> {
  const { html, text } = await renderOrganizationInvitation({
    acceptanceUrl: input.acceptUrl,
    locale: input.locale,
    organizationName: input.organizationName,
    role: input.role,
  });

  return {
    from: platformFromAddress(
      input.organizationName,
      input.fromEmail ? { fromEmail: input.fromEmail } : {},
    ),
    to: input.to,
    subject: emailMessages(input.locale).organizationInvitation.heading,
    html,
    text,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  };
}

export interface SendInvitationEmailInput {
  to: string;
  acceptUrl: string;
  locale: Locale;
  organizationName: string;
  role: InvitationRole;
  /** Wiersze tenant_settings dla klucza email_sender (może być pusto). */
  settings: TenantSettingRow[];
  availability: EmailAvailability;
  transport: EmailTransport;
  /** Historia wysyłek (0021/ADR-045); brak = wysyłka bez logu. */
  recorder?: EmailLogRecorder;
  fromEmail?: string;
}

/** Bezpieczne locale tenanta — nieznana wartość spada na domyślne (jak 8b). */
export function invitationLocale(raw: string | null | undefined): Locale {
  return isLocale(raw ?? "") ? (raw as Locale) : DEFAULT_TENANT_LOCALE;
}

/**
 * Wysyłka zaproszenia. Zwraca POWÓD niewysłania albo undefined (wysłano).
 * NIGDY nie rzuca — rekord zaproszenia jest już utrwalony, poczta go nie cofa.
 */
export async function sendInvitationEmail(
  input: SendInvitationEmailInput,
): Promise<string | undefined> {
  if (!input.availability.available) return input.availability.reason;

  // reply_to z email_sender: BRAK klucza jest legalny (fallback D2), OBECNY
  // ale wadliwy → uczciwy powód. Rozróżnienie po obecności wiersza — bez tego
  // emailSenderFromSettings([]) rzuciłoby EmailConfigError „brak nazwy" i
  // zablokowało wysyłkę tak jak w 8b, czego dla zaproszeń świadomie nie chcemy.
  let replyTo: string | undefined;
  if (input.settings.some((row) => row.key === EMAIL_SENDER_KEY)) {
    try {
      replyTo = emailSenderFromSettings(input.settings).replyTo;
    } catch (err) {
      if (err instanceof EmailConfigError) {
        return `${err.message} Zaproszenie nie zostało wysłane e-mailem.`;
      }
      throw err;
    }
  }

  let email: OutgoingEmail;
  try {
    email = await buildInvitationEmail({
      to: input.to,
      acceptUrl: input.acceptUrl,
      locale: input.locale,
      organizationName: input.organizationName,
      role: input.role,
      ...(replyTo ? { replyTo } : {}),
      ...(input.fromEmail ? { fromEmail: input.fromEmail } : {}),
    });
  } catch (err) {
    return `Zaproszenie utworzone, ale e-mail nie wyszedł: ${
      err instanceof Error ? err.message : "nieznany błąd"
    }`;
  }

  // orderId celowo BEZ wartości: zaproszenie nie dotyczy żadnego zamówienia
  // i kolumna email_logs.order_id jest dla niego nullable z tego właśnie
  // powodu (0021).
  const { sendError, logIssue } = await sendAndLog({
    transport: input.transport,
    recorder: input.recorder,
    email,
    kind: "invitation",
  });

  if (sendError) {
    return `Zaproszenie utworzone, ale e-mail nie wyszedł: ${
      sendError instanceof Error ? sendError.message : "nieznany błąd"
    }`;
  }
  return logIssue;
}
