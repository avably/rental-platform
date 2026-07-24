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
 * Rodzaje wiadomości — kontrakt z CHECK-iem kolumny email_logs.kind (0021,
 * rozszerzonym w 0026 i 0036). Rozjazd tej listy z migracją kończy się 23514
 * przy zapisie, nie cichym pominięciem wpisu.
 *
 * `invoice` (0036, ADR-076) to DORĘCZENIE faktury wystawionej poza systemem:
 * plik wskazany przez operatora idzie do klienta jako załącznik. Nazwa mówi
 * o WIADOMOŚCI, nie o dokumencie — faktury nie wystawiamy ani nie
 * archiwizujemy, więc rodzaj nie ciągnie za sobą ani numeracji, ani
 * odnośnika do dokumentu (inaczej niż `rental_contract`).
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
  "rental_contract",
  "invoice",
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
  /** Dokładny PDF załączony do wiadomości rental_contract. */
  contractDocumentId?: string | null;
  /** Klucz próby wspólny dla bazy i nagłówka Resend. */
  idempotencyKey?: string | null;
  /**
   * Treść HTML TEJ PRÓBY wysyłki — kopia `OutgoingEmail.html` z obiektu,
   * który `sendAndLog` podał transportowi (0035, ADR-073).
   *
   * TO NIE JEST POLE DLA WOŁAJĄCEGO. Wypełnia je `sendAndLog` z wiadomości,
   * którą sam wysyła, i na tym stoi CAŁA gwarancja „w rejestrze jest to, co
   * dostał klient": kopia bierze się z tego samego obiektu, który sekundę
   * później idzie do transportu, więc rozjazd jest niereprezentowalny.
   * Ścieżka przekazująca treść osobno mogłaby przekazać INNĄ — a rejestr,
   * który wygląda na dowód, nie będąc nim, jest gorszy niż jego brak.
   *
   * `undefined` = ta próba treści nie niosła (rejestrator wołany z pominięciem
   * `sendAndLog`). Rejestrator zapisuje wtedy NULL, czyli „nie mamy" —
   * nigdy „pusta wiadomość".
   */
  body?: string | null;
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
  contractDocumentId?: string | null;
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
    contractDocumentId: input.contractDocumentId ?? null,
    idempotencyKey: input.email.idempotencyKey ?? null,
    // Treść bierze się Z TEJ SAMEJ wiadomości, którą za chwilę dostanie
    // transport (ADR-073) — nie z ponownego renderu szablonu. Renderowanie
    // drugi raz „do rejestru" byłoby zgadywaniem: szablon, dane tenanta i
    // cennik zmieniają się w czasie, więc druga kopia potrafi różnić się od
    // tej, którą zobaczył klient, i to bez ostrzeżenia.
    //
    // HTML, NIE TEXT: to wariant, który klient realnie ogląda w kliencie
    // poczty; `text` jest zapasem dla czytników bez HTML i nie odpowiada na
    // pytanie „co klient zobaczył".
    body: input.email.html,
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
