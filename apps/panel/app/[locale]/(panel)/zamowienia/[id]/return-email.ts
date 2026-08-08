/**
 * Złożenie i wysyłka e-maili zwrotów (Zadanie 2.5, ADR-043):
 *   (a) return-label — etykieta zwrotna jako ZAŁĄCZNIK PDF,
 *   (b) pickup-return-reminder — przypomnienie o zwrocie w punkcie odbioru.
 *
 * Wzorzec 8b (sendRentalEmailForTransition): funkcje NIGDY NIE RZUCAJĄ —
 * zwracają POWÓD niewysłania albo undefined przy sukcesie. Wysyłka jest
 * akcją operatora, nie skutkiem tranzycji, ale reguła jest ta sama: problem
 * z pocztą (albo z dostawcą etykiety) to uczciwa częściowa porażka pokazana
 * operatorowi, nie wyjątek wywracający akcję (ADR-027/033).
 *
 * Bramki kolejno: dostępność transportu (brak RESEND_API_KEY = jawna
 * niedostępność, NIGDY cichy sukces — ADR-033), adres klienta, nadawca
 * tenanta (email_sender). Locale wysyłki: preferencja KLIENTA
 * (customers.locale) ?? locale tenanta (ADR-037). From = nazwa tenanta.
 *
 * Dane i transport dostaje w argumencie — testuje się bez Supabase, bez
 * sieci i bez API kurierskiego (PDF etykiety wstrzykiwany jako bajty).
 */
import {
  emailMessages,
  renderPickupReturnReminder,
  renderReturnLabel,
} from "@avably/emails";
import {
  EmailConfigError,
  emailSenderFromSettings,
  platformFromAddress,
  sendAndLog,
  type EmailAvailability,
  type EmailLogKind,
  type EmailLogRecorder,
  type EmailSender,
  type EmailTransport,
  type Locale,
  type OutgoingEmail,
  type TenantSettingRow,
} from "@avably/core";

/**
 * Data w locale odbiorcy — szablon dostaje gotowy string (kontrakt 8a).
 * Kotwica UTC jak w rental-email.ts: daty najmu są kalendarzowe (bez strefy),
 * a `new Date("2026-08-01")` w strefie ujemnej cofnęłoby się o dobę.
 */
function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

/** Klient zamówienia w zakresie potrzebnym do złożenia wiadomości. */
export interface ReturnEmailCustomer {
  full_name: string | null;
  email: string;
  locale?: Locale | null;
}

/**
 * Wspólne bramki „czy w ogóle mamy do kogo i czym wysłać". Zwraca nadawcę
 * i adres albo POWÓD niewysłania (string) — kolejność bramek jak w 8b:
 * najpierw to, co wiemy bez renderowania czegokolwiek.
 */
function resolveRecipient(
  availability: EmailAvailability,
  customer: ReturnEmailCustomer | null,
  settings: TenantSettingRow[],
): { sender: EmailSender; email: string; name: string } | string {
  if (!availability.available) {
    // Powód z core jest od U1 neutralny; fallback trzyma to samo brzmienie.
    return (
      availability.reason ??
      "Wysyłka e-maili jest chwilowo niedostępna po stronie platformy — pracujemy nad przywróceniem."
    );
  }

  const email = customer?.email;
  if (!email) {
    return "Zamówienie nie ma adresu e-mail klienta — wiadomość nie została wysłana.";
  }

  let sender: EmailSender;
  try {
    sender = emailSenderFromSettings(settings);
  } catch (err) {
    if (err instanceof EmailConfigError) return `${err.message} Wiadomość nie została wysłana.`;
    throw err;
  }

  // Brak nazwiska nie może dać powitania „Dzień dobry, !" — adres jest
  // brzydszy, ale prawdziwy (wzorzec 8b).
  return { sender, email, name: customer?.full_name ?? email };
}

function fromAndReplyTo(
  sender: EmailSender,
  tenantName: string,
  fromEmail: string | undefined,
): { from: string; replyTo?: string } {
  return {
    from: platformFromAddress(tenantName, fromEmail ? { fromEmail } : {}),
    ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
  };
}

/**
 * Wspólne pola wysyłki dla obu wiadomości zwrotu: dokąd wysłać i gdzie
 * zapisać ślad (0021/ADR-045).
 */
interface DispatchDeps {
  transport: EmailTransport;
  /** Historia wysyłek; brak = wysyłka bez logu (testy jednostkowe). */
  recorder?: EmailLogRecorder;
  /** Zamówienie, do którego przypina się wpis historii. */
  orderId?: string;
}

/**
 * Wysyłka + wpis w historii, wspólna dla obu wiadomości zwrotu.
 *
 * Rozdziela DWA różne niepowodzenia, które wcześniej nie miały jak się
 * różnić: „wiadomość nie wyszła" (powód wysyłki) i „wyszła, ale nie mamy
 * na to śladu" (awaria dziennika). Sklejenie ich kazałoby operatorowi
 * ponawiać wysyłkę, która się udała.
 */
async function dispatch(
  deps: DispatchDeps,
  message: OutgoingEmail,
  kind: EmailLogKind,
  failurePrefix: string,
): Promise<string | undefined> {
  const { sendError, logIssue } = await sendAndLog({
    transport: deps.transport,
    recorder: deps.recorder,
    email: message,
    kind,
    orderId: deps.orderId ?? null,
  });
  if (sendError) {
    return `${failurePrefix}: ${sendError instanceof Error ? sendError.message : "nieznany błąd"}`;
  }
  return logIssue;
}

export interface SendReturnLabelInput extends DispatchDeps {
  availability: EmailAvailability;
  customer: ReturnEmailCustomer | null;
  settings: TenantSettingRow[];
  tenantName: string;
  /** Locale tenanta (już zsanityzowane); fallback, gdy klient nie ma preferencji. */
  tenantLocale: Locale;
  orderNumber: string;
  endDate: string;
  shipmentNumber: string;
  /** Nazwa przewoźnika, gdy znana (rejestr jej nie utrwala). */
  carrierName?: string;
  /** Bajty etykiety PDF z API kurierskiego — trafiają jako załącznik. */
  labelPdf: Uint8Array;
  fromEmail?: string;
}

/**
 * Wysyłka e-maila z etykietą zwrotną. NIE RZUCA — zwraca powód albo undefined.
 */
export async function sendReturnLabelEmail(
  input: SendReturnLabelInput,
): Promise<string | undefined> {
  const recipient = resolveRecipient(input.availability, input.customer, input.settings);
  if (typeof recipient === "string") return recipient;

  const locale = input.customer?.locale ?? input.tenantLocale;

  let message: OutgoingEmail;
  try {
    const { html, text } = await renderReturnLabel({
      locale,
      tenantName: input.tenantName,
      customerName: recipient.name,
      orderNumber: input.orderNumber,
      endDate: formatDate(input.endDate, locale),
      shipmentNumber: input.shipmentNumber,
      ...(input.carrierName ? { carrierName: input.carrierName } : {}),
    });

    message = {
      ...fromAndReplyTo(recipient.sender, input.tenantName, input.fromEmail),
      to: recipient.email,
      // Temat = nagłówek szablonu w locale odbiorcy (spójność z treścią bez
      // duplikowania tekstów — jak buildRentalEmail).
      subject: emailMessages(locale).returnLabel.heading,
      html,
      text,
      attachments: [
        { filename: `etykieta-zwrotna-${input.shipmentNumber}.pdf`, content: input.labelPdf },
      ],
    };
  } catch (err) {
    return `Nie udało się wysłać etykiety zwrotnej: ${
      err instanceof Error ? err.message : "nieznany błąd"
    }`;
  }

  return dispatch(input, message, "return_label", "Nie udało się wysłać etykiety zwrotnej");
}

export interface SendPickupReturnReminderInput extends DispatchDeps {
  availability: EmailAvailability;
  customer: ReturnEmailCustomer | null;
  settings: TenantSettingRow[];
  tenantName: string;
  tenantLocale: Locale;
  orderNumber: string;
  endDate: string;
  locationName: string;
  locationAddress: string;
  /** Telefon/godziny punktu — dziś kartoteka ich nie ma (dług ADR-043). */
  phone?: string;
  openingHours?: string;
  fromEmail?: string;
}

/**
 * Wysyłka przypomnienia o zwrocie w punkcie odbioru. NIE RZUCA — powód albo
 * undefined.
 */
export async function sendPickupReturnReminderEmail(
  input: SendPickupReturnReminderInput,
): Promise<string | undefined> {
  const recipient = resolveRecipient(input.availability, input.customer, input.settings);
  if (typeof recipient === "string") return recipient;

  const locale = input.customer?.locale ?? input.tenantLocale;

  let message: OutgoingEmail;
  try {
    const { html, text } = await renderPickupReturnReminder({
      locale,
      tenantName: input.tenantName,
      customerName: recipient.name,
      orderNumber: input.orderNumber,
      endDate: formatDate(input.endDate, locale),
      locationName: input.locationName,
      locationAddress: input.locationAddress,
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.openingHours ? { openingHours: input.openingHours } : {}),
    });

    message = {
      ...fromAndReplyTo(recipient.sender, input.tenantName, input.fromEmail),
      to: recipient.email,
      subject: emailMessages(locale).pickupReturnReminder.heading,
      html,
      text,
    };
  } catch (err) {
    return `Nie udało się wysłać przypomnienia o zwrocie: ${
      err instanceof Error ? err.message : "nieznany błąd"
    }`;
  }

  return dispatch(
    input,
    message,
    "pickup_return_reminder",
    "Nie udało się wysłać przypomnienia o zwrocie",
  );
}
