/**
 * Doręczenie faktury: wysyłka + ślad w historii (D3, ADR-076).
 *
 * ============== DLACZEGO TO OSOBNY, CZYSTY MODUŁ ==============
 *
 * Bo tu siedzi JEDYNA reguła, którą to zadanie może złamać po cichu:
 * wysyłka faktury MUSI iść przez `sendAndLog`. Wywołanie `transport.send`
 * wprost wyglądałoby identycznie z ekranu — klient dostałby maila,
 * a operator zobaczyłby „wysłano" — i różniłoby się wyłącznie tym, czego
 * na ekranie nie widać: brakiem wpisu w historii albo wpisem BEZ TREŚCI
 * (regresja D10/ADR-073, gdzie treść bierze się z tego samego obiektu
 * wiadomości, który dostaje transport).
 *
 * Wydzielone tak, żeby dało się to sprawdzić bez bazy, bez sieci i bez
 * przeglądarki: `transport` i `recorder` wchodzą argumentem, a test liczy,
 * co dostał rejestrator. To jest bramka, którą pilnuje dowód mutacyjny.
 *
 * ============== BEZ KLUCZA IDEMPOTENCJI — ŚWIADOMIE ==============
 *
 * Umowa (ADR-061) chroni próbę wysyłki kluczem, bo dokument jest utrwalony
 * i „ta sama umowa drugi raz" to zwykle dwuklik. Tu jest odwrotnie: plik
 * wybiera człowiek ze swojego dysku przy każdej wysyłce, więc druga wysyłka
 * jest DECYZJĄ (korekta, poprawiony PDF, drugi adres). Klucz musiałby więc
 * i tak być inny za każdym razem — czyli nie chroniłby niczego, a wpisałby
 * `invoice` w gałąź CHECK-a `email_logs_contract_shape` przeznaczoną dla
 * umowy. Przed dwuklikiem broni tu potwierdzenie decyzji (ADR-033).
 */
import { sendAndLog, type EmailLogRecorder, type EmailTransport, type Locale } from "@avably/core";

import { buildInvoiceEmail } from "./invoice-email";

export interface InvoiceServiceDeps {
  transport: EmailTransport;
  /** Brak rejestratora = wysyłka bez śladu (wyłącznie testy jednostkowe). */
  recorder?: EmailLogRecorder;
}

export interface SendInvoiceInput {
  orderId: string;
  locale: Locale;
  tenantName: string;
  customerName: string;
  customerEmail: string;
  orderNumber: string;
  bytes: Uint8Array;
  filename: string;
  replyTo?: string;
  fromEmail?: string;
}

export interface SendInvoiceResult {
  /** Powód, dla którego wiadomość NIE wyszła. Brak = wyszła. */
  sendError?: string;
  /**
   * Powód, dla którego nie ma wpisu w historii. NIGDY nie unieważnia
   * wysyłki — sklejenie obu kazałoby operatorowi wysłać fakturę drugi raz.
   */
  logIssue?: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "nieznany błąd";

export async function sendInvoice(
  deps: InvoiceServiceDeps,
  input: SendInvoiceInput,
): Promise<SendInvoiceResult> {
  const email = buildInvoiceEmail({
    locale: input.locale,
    tenantName: input.tenantName,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    orderNumber: input.orderNumber,
    bytes: input.bytes,
    filename: input.filename,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.fromEmail ? { fromEmail: input.fromEmail } : {}),
  });

  const result = await sendAndLog({
    transport: deps.transport,
    ...(deps.recorder ? { recorder: deps.recorder } : {}),
    email,
    kind: "invoice",
    orderId: input.orderId,
  });

  return {
    ...(result.sendError !== undefined ? { sendError: errorMessage(result.sendError) } : {}),
    ...(result.logIssue ? { logIssue: result.logIssue } : {}),
  };
}
