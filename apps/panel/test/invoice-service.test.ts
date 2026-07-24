/**
 * KONTRAKT: doręczenie faktury idzie przez `sendAndLog` (D3, ADR-076;
 * regresja D10/ADR-073).
 *
 * ============== CO TU JEST BRONIONE ==============
 *
 * Ścieżka wysyłki faktury mogłaby zawołać `transport.send` wprost. Z ekranu
 * wyglądałoby to identycznie: klient dostaje maila, operator widzi „wysłano".
 * Różnica siedzi w rzeczach, których na ekranie nie widać:
 *
 *   1. NIE POWSTAŁBY WPIS w historii wiadomości — a to on, i tylko on, jest
 *      źródłem stanu „faktura wysłana" (ADR-076: bez kolumny w `orders`).
 *      Wysyłka bez wpisu to wysyłka, po której panel dalej twierdzi, że
 *      faktury nie wysłano.
 *   2. WPIS BYŁBY BEZ TREŚCI — `sendAndLog` jest JEDYNYM miejscem, które
 *      kopiuje `email.html` do rejestru, i robi to z tego samego obiektu,
 *      który sekundę później dostaje transport (ADR-073). Ścieżka podająca
 *      treść osobno mogłaby podać INNĄ.
 *   3. Porażka wysyłki nie zostawiłaby powodu.
 *
 * Asercje celują więc w to, co dostał REJESTRATOR, a nie w to, co zwróciła
 * funkcja: wynik wygląda tak samo w obu wariantach i niczego nie broni.
 */
import { describe, expect, it } from "vitest";

import type { EmailLogEntry, EmailLogRecorder, EmailTransport, OutgoingEmail } from "@avably/core";

import { sendInvoice } from "@/app/[locale]/(panel)/zamowienia/[id]/invoice-service";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nfaktura\n%%EOF");

const input = {
  orderId: "00000000-0000-4000-8000-000000000001",
  locale: "pl" as const,
  tenantName: "Wypożyczalnia Testowa",
  customerName: "Anna Kowalska",
  customerEmail: "anna@example.com",
  orderNumber: "AV-2026-001",
  bytes: PDF_BYTES,
  filename: "FV-2026-07-123.pdf",
};

function collectingRecorder(): { entries: EmailLogEntry[]; recorder: EmailLogRecorder } {
  const entries: EmailLogEntry[] = [];
  return {
    entries,
    recorder: {
      async record(entry) {
        entries.push(entry);
      },
    },
  };
}

function okTransport(): { sent: OutgoingEmail[]; transport: EmailTransport } {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    transport: {
      async send(email) {
        sent.push(email);
        return { id: "resend-abc" };
      },
    },
  };
}

const failingTransport: EmailTransport = {
  async send() {
    throw new Error("Dostawca poczty odrzucił wysyłkę (HTTP 422).");
  },
};

describe("doręczenie faktury zostawia ślad w historii", () => {
  it("zapisuje wpis kind=invoice ze statusem sent i identyfikatorem dostawcy", async () => {
    const { entries, recorder } = collectingRecorder();
    const { transport } = okTransport();

    const result = await sendInvoice({ transport, recorder }, input);

    expect(result.sendError).toBeUndefined();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("invoice");
    expect(entries[0]!.status).toBe("sent");
    expect(entries[0]!.orderId).toBe(input.orderId);
    expect(entries[0]!.recipient).toBe("anna@example.com");
    expect(entries[0]!.providerMessageId).toBe("resend-abc");
  });

  it("zapisuje TREŚĆ, i to dokładnie tę, którą dostał transport (ADR-073)", async () => {
    const { entries, recorder } = collectingRecorder();
    const { sent, transport } = okTransport();

    await sendInvoice({ transport, recorder }, input);

    // Sedno bramki: identyczność, nie „niepustość". Wpis z treścią wziętą
    // z drugiego renderu też byłby niepusty — i mógłby się różnić od tego,
    // co zobaczył klient.
    expect(sent).toHaveLength(1);
    expect(entries[0]!.body).toBe(sent[0]!.html);
    expect(entries[0]!.body).toContain("AV-2026-001");
    expect((entries[0]!.body ?? "").trim().length).toBeGreaterThan(0);
  });

  it("wysyła ZAŁĄCZNIK, nie sam tekst", async () => {
    const { sent, transport } = okTransport();
    await sendInvoice({ transport }, input);

    expect(sent[0]!.attachments).toHaveLength(1);
    expect(sent[0]!.attachments![0]!.filename).toBe("FV-2026-07-123.pdf");
    expect(sent[0]!.attachments![0]!.content).toBe(PDF_BYTES);
  });

  it("porażka wysyłki też ląduje w historii — z powodem, tym samym co u operatora", async () => {
    const { entries, recorder } = collectingRecorder();

    const result = await sendInvoice({ transport: failingTransport, recorder }, input);

    expect(result.sendError).toBe("Dostawca poczty odrzucił wysyłkę (HTTP 422).");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("failed");
    expect(entries[0]!.error).toBe(result.sendError);
    // Wpis „failed" też niesie treść: w sporze liczy się, co MIAŁO pójść.
    expect((entries[0]!.body ?? "").length).toBeGreaterThan(0);
  });

  it("awaria dziennika NIE przebiera udanej wysyłki w porażkę (ADR-045)", async () => {
    const { transport } = okTransport();
    const brokenRecorder: EmailLogRecorder = {
      async record() {
        throw new Error("brak połączenia z bazą");
      },
    };

    const result = await sendInvoice({ transport, recorder: brokenRecorder }, input);

    // Gdyby to było błędem wysyłki, operator wysłałby fakturę drugi raz.
    expect(result.sendError).toBeUndefined();
    expect(result.logIssue).toContain("brak połączenia z bazą");
  });

  it("wpis faktury NIE zajmuje pól zarezerwowanych dla umowy (CHECK kształtu 0026)", async () => {
    const { entries, recorder } = collectingRecorder();
    const { transport } = okTransport();

    await sendInvoice({ transport, recorder }, input);

    // `email_logs_contract_shape` wymaga NULL-i dla rodzajów innych niż
    // `rental_contract`; wartość w którymkolwiek z tych pól odbiłaby się
    // od bazy kodem 23514 dopiero na produkcji.
    expect(entries[0]!.contractDocumentId ?? null).toBeNull();
    expect(entries[0]!.idempotencyKey ?? null).toBeNull();
  });
});
