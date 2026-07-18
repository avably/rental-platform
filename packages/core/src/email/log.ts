/**
 * Historia wysłanych e-maili — port zapisu i wspólny krok „wyślij i zapisz"
 * (Zadanie 2.8, ADR-045).
 *
 * DLACZEGO TO SIEDZI W CORE, A NIE PRZY KAŻDEJ ŚCIEŻCE WYSYŁKI: ścieżek jest
 * sześć w dwóch aplikacjach (cykl najmu, zaproszenia, etykieta zwrotna,
 * przypomnienie, potwierdzenie checkoutu, powiadomienie najemcy), a reguła
 * pochłaniania błędu logowania jest dokładnie jedna. Sześć kopii tej reguły
 * to sześć okazji, żeby jedna z nich pochłonęła o jeden błąd za mało — i
 * wywróciła operację, która JUŻ jest utrwalona.
 *
 * REGUŁA (lustro wzorca 8b o poziom wyżej):
 *   * wysyłka nie blokuje operacji — to ADR-033, tu bez zmian,
 *   * ZAPIS LOGU nie blokuje ani wysyłki, ani operacji. Jeśli INSERT logu
 *     padnie, wiadomość i tak wyszła, tranzycja i tak jest utrwalona, a
 *     awaria rejestru wraca najwyżej jako POWÓD w wyniku akcji.
 *
 * Rejestr, który potrafi wywrócić to, co rejestruje, jest gorszy niż jego
 * brak — dlatego `sendAndLog` nie rzuca NIGDY, a błąd zapisu ma osobne
 * pole w wyniku, żeby wołający nie mógł go pomylić z błędem wysyłki.
 */
import type { EmailTransport, OutgoingEmail } from "./types";

/**
 * Rodzaje wiadomości — kontrakt z CHECK-iem kolumny email_logs.kind (0021).
 * Rozjazd tej listy z migracją kończy się 23514 przy zapisie, nie cichym
 * pominięciem wpisu.
 */
export const EMAIL_LOG_KINDS = [
  "rental_confirmed",
  "rental_ready_for_pickup",
  "rental_picked_up",
  "rental_returned",
  "rental_cancelled",
  "invitation",
  "return_label",
  "pickup_return_reminder",
  "checkout_confirmation",
  "new_order_notification",
] as const;

export type EmailLogKind = (typeof EMAIL_LOG_KINDS)[number];

export const EMAIL_LOG_STATUSES = ["sent", "failed"] as const;
export type EmailLogStatus = (typeof EMAIL_LOG_STATUSES)[number];

export function isEmailLogKind(value: string): value is EmailLogKind {
  return (EMAIL_LOG_KINDS as readonly string[]).includes(value);
}

/** Wpis do zapisania. Kształt lustrzany wobec kolumn tabeli (0021). */
export interface EmailLogEntry {
  kind: EmailLogKind;
  /** Zamówienie, którego dotyczy wiadomość; brak = wiadomość spoza zamówienia. */
  orderId?: string | null;
  recipient: string;
  subject: string;
  status: EmailLogStatus;
  /** Tylko przy sukcesie i tylko gdy dostawca go zwrócił. */
  providerMessageId?: string | null;
  /** Tylko przy porażce — powód, dokładnie ten pokazywany operatorowi. */
  error?: string | null;
}

/**
 * Port zapisu historii. Implementacje: panel pisze sesją członka (RLS
 * tenant_insert), storefront — funkcją SECURITY DEFINER z 0021, bo nie ma
 * klucza service-role.
 *
 * MOŻE RZUCAĆ: wołający (sendAndLog) jest jedynym miejscem, które ten błąd
 * pochłania, i robi to zawsze. Implementacja, która połyka własne błędy w
 * środku, zabrałaby operatorowi informację, że rejestr jest niesprawny.
 */
export interface EmailLogRecorder {
  record(entry: EmailLogEntry): Promise<void>;
}

export interface SendAndLogInput {
  transport: EmailTransport;
  /** Brak rejestratora = wysyłka bez logu (testy jednostkowe, ścieżki dev). */
  recorder?: EmailLogRecorder | undefined;
  email: OutgoingEmail;
  kind: EmailLogKind;
  orderId?: string | null;
}

export interface SendAndLogResult {
  /** Błąd WYSYŁKI — wołający mapuje go na własny komunikat. */
  sendError?: unknown;
  /** Powód niezapisania wpisu w historii. Nigdy nie unieważnia wysyłki. */
  logIssue?: string;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "nieznany błąd";
}

/**
 * Wysyła wiadomość i zapisuje wynik w historii. NIGDY NIE RZUCA.
 *
 * Kolejność jest istotna: log powstaje PO próbie wysyłki i zna jej wynik —
 * inaczej rejestr mówiłby „próbowano", a nie „wyszło / nie wyszło", czyli
 * nie odpowiadałby na pytanie, po które się go otwiera.
 */
export async function sendAndLog(input: SendAndLogInput): Promise<SendAndLogResult> {
  const base = {
    kind: input.kind,
    orderId: input.orderId ?? null,
    recipient: input.email.to,
    subject: input.email.subject,
  };

  let sendError: unknown;
  let entry: EmailLogEntry;

  try {
    const { id } = await input.transport.send(input.email);
    entry = { ...base, status: "sent", providerMessageId: id };
  } catch (err) {
    sendError = err;
    // Powód w rejestrze jest TEN SAM, który operator zobaczy w formularzu —
    // rozjazd obu tekstów zmusiłby go do zgadywania, czy to ten sam problem.
    entry = { ...base, status: "failed", error: message(err) };
  }

  let logIssue: string | undefined;
  if (input.recorder) {
    try {
      await input.recorder.record(entry);
    } catch (err) {
      // JEDYNE miejsce, w którym błąd rejestru jest pochłaniany — i musi być
      // pochłonięty tutaj. Wiadomość albo wyszła, albo nie, a operacja, która
      // to wywołała, jest już utrwalona; awaria dziennika nie może żadnego z
      // tych faktów cofnąć.
      logIssue = `Nie udało się zapisać wpisu w historii wiadomości: ${message(err)}`;
    }
  }

  return {
    ...(sendError !== undefined ? { sendError } : {}),
    ...(logIssue ? { logIssue } : {}),
  };
}
