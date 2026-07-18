import { describe, expect, it, vi } from "vitest";

import type {
  EmailLogEntry,
  EmailLogRecorder,
  EmailSendResult,
  EmailTransport,
  TenantSettingRow,
} from "@avably/core";

import {
  sendPickupReturnReminderEmail,
  sendReturnLabelEmail,
} from "./return-email";

const settings: TenantSettingRow[] = [
  {
    key: "email_sender",
    value: { name: "Wypożyczalnia Demo", reply_to: "kontakt@example.com" },
  } as unknown as TenantSettingRow,
];

const customer = { full_name: "Jan Kowalski", email: "klient@example.com", locale: null };

const available = { available: true } as const;
const unavailable = { available: false, reason: "Brak RESEND_API_KEY." } as const;

function transportSpy(
  impl?: () => Promise<EmailSendResult>,
): EmailTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(impl ?? (async () => ({ id: "resend-1" }))) };
}

/** Rejestrator historii, który zapamiętuje wpisy zamiast pisać do bazy. */
function recorderSpy(): { entries: EmailLogEntry[]; recorder: EmailLogRecorder } {
  const entries: EmailLogEntry[] = [];
  return {
    entries,
    recorder: {
      record: vi.fn(async (entry: EmailLogEntry) => {
        entries.push(entry);
      }),
    },
  };
}

const labelPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const labelBase = {
  customer,
  settings,
  tenantName: "Wypożyczalnia Demo",
  tenantLocale: "pl" as const,
  orderNumber: "AV-2026-001",
  endDate: "2026-08-05",
  shipmentNumber: "GK240610123456",
  labelPdf,
  fromEmail: "Avably <noreply@avably.io>",
};

const reminderBase = {
  customer,
  settings,
  tenantName: "Wypożyczalnia Demo",
  tenantLocale: "pl" as const,
  orderNumber: "AV-2026-001",
  endDate: "2026-08-05",
  locationName: "Magazyn Główny",
  locationAddress: "ul. Składowa 5, 00-001 Warszawa",
  fromEmail: "Avably <noreply@avably.io>",
};

describe("sendReturnLabelEmail", () => {
  it("sukces → brak powodu, PDF dołączony jako załącznik, From z nazwą tenanta", async () => {
    const transport = transportSpy();
    const reason = await sendReturnLabelEmail({ availability: available, transport, ...labelBase });

    expect(reason).toBeUndefined();
    const message = transport.send.mock.calls[0]![0];
    expect(message.from).toBe("Wypożyczalnia Demo <noreply@avably.io>");
    expect(message.to).toBe("klient@example.com");
    expect(message.replyTo).toBe("kontakt@example.com");
    expect(message.attachments).toEqual([
      { filename: "etykieta-zwrotna-GK240610123456.pdf", content: labelPdf },
    ]);
  });

  // MUTACJA (c) — bramka availability (ADR-036): bez klucza Resend transport
  // NIE jest wołany. Usunięcie pierwszej bramki w resolveRecipient pali ten test.
  it("brak klucza Resend → czytelny powód, zero prób wysyłki", async () => {
    const transport = transportSpy();
    const reason = await sendReturnLabelEmail({
      availability: unavailable,
      transport,
      ...labelBase,
    });

    expect(reason).toBe("Brak RESEND_API_KEY.");
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("brak nadawcy tenanta → czytelny błąd konfiguracji, zero prób", async () => {
    const transport = transportSpy();
    const reason = await sendReturnLabelEmail({
      availability: available,
      transport,
      ...labelBase,
      settings: [],
    });

    expect(reason).toContain("niekompletna");
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("klient bez adresu → czytelny powód, zero prób", async () => {
    const transport = transportSpy();
    const reason = await sendReturnLabelEmail({
      availability: available,
      transport,
      ...labelBase,
      customer: { full_name: "Jan", email: "", locale: null },
    });

    expect(reason).toContain("adresu e-mail");
    expect(transport.send).not.toHaveBeenCalled();
  });

  // MUTACJA (b) — wzorzec 8b: błąd transportu NIE wywraca akcji. Zamiana
  // `return` na `throw` w bloku catch pali ten test (rejects zamiast powodu).
  it("odmowa dostawcy → powód zwrócony, wyjątek nie ucieka", async () => {
    const transport = transportSpy(async () => {
      throw new Error("HTTP 422 domain not verified");
    });
    const reason = await sendReturnLabelEmail({ availability: available, transport, ...labelBase });

    expect(reason).toContain("422");
  });

  it("locale klienta wygrywa nad locale tenanta (ADR-037)", async () => {
    const transport = transportSpy();
    await sendReturnLabelEmail({
      availability: available,
      transport,
      ...labelBase,
      tenantLocale: "pl",
      customer: { full_name: "Jan", email: "klient@example.com", locale: "en" },
    });

    const message = transport.send.mock.calls[0]![0];
    expect(message.subject).toBe("Return label for your rental");
  });

  it("brak preferencji klienta (locale null) → język tenanta", async () => {
    const transport = transportSpy();
    await sendReturnLabelEmail({
      availability: available,
      transport,
      ...labelBase,
      tenantLocale: "pl",
    });

    const message = transport.send.mock.calls[0]![0];
    expect(message.subject).toBe("Etykieta zwrotna do Twojego wynajmu");
  });
});

describe("sendPickupReturnReminderEmail", () => {
  it("sukces → brak powodu, adres punktu w treści, bez załącznika", async () => {
    const transport = transportSpy();
    const reason = await sendPickupReturnReminderEmail({
      availability: available,
      transport,
      ...reminderBase,
    });

    expect(reason).toBeUndefined();
    const message = transport.send.mock.calls[0]![0];
    expect(message.attachments).toBeUndefined();
    expect(message.text).toContain("Magazyn Główny");
    expect(message.text).toContain("ul. Składowa 5");
  });

  it("brak klucza Resend → czytelny powód, zero prób wysyłki", async () => {
    const transport = transportSpy();
    const reason = await sendPickupReturnReminderEmail({
      availability: unavailable,
      transport,
      ...reminderBase,
    });

    expect(reason).toBe("Brak RESEND_API_KEY.");
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("odmowa dostawcy → powód zwrócony, wyjątek nie ucieka", async () => {
    const transport = transportSpy(async () => {
      throw new Error("ECONNREFUSED");
    });
    const reason = await sendPickupReturnReminderEmail({
      availability: available,
      transport,
      ...reminderBase,
    });

    expect(reason).toContain("ECONNREFUSED");
  });
});

/**
 * Historia wysyłek (Zadanie 2.8, ADR-045) — ścieżka zwrotów.
 *
 * Wysyłka zwrotów jest AKCJĄ operatora, nie skutkiem tranzycji, ale reguła
 * jest ta sama: etykieta u kuriera została już nadana, więc awaria dziennika
 * nie może przebrać wysłanej wiadomości w niewysłaną.
 */
describe("e-maile zwrotów — historia wysyłek (ADR-045)", () => {
  const orderId = "22222222-2222-4222-8222-222222222222";

  it("etykieta zwrotna: sukces → wpis 'sent' rodzaju return_label", async () => {
    const transport = transportSpy();
    const { recorder, entries } = recorderSpy();

    const reason = await sendReturnLabelEmail({
      availability: available,
      transport,
      recorder,
      orderId,
      ...labelBase,
    });

    expect(reason).toBeUndefined();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "return_label",
      orderId,
      recipient: "klient@example.com",
      status: "sent",
      providerMessageId: "resend-1",
    });
  });

  it("przypomnienie: odmowa dostawcy → wpis 'failed' z powodem", async () => {
    const transport = transportSpy(async () => {
      throw new Error("ECONNREFUSED");
    });
    const { recorder, entries } = recorderSpy();

    const reason = await sendPickupReturnReminderEmail({
      availability: available,
      transport,
      recorder,
      orderId,
      ...reminderBase,
    });

    expect(reason).toContain("ECONNREFUSED");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "pickup_return_reminder", status: "failed", orderId });
    expect(entries[0]!.error).toContain("ECONNREFUSED");
  });

  it("awaria dziennika NIE wywraca wysyłki etykiety — wiadomość poszła", async () => {
    const transport = transportSpy();
    const recorder: EmailLogRecorder = {
      record: vi.fn(async () => {
        throw new Error("brak połączenia z bazą");
      }),
    };

    const reason = await sendReturnLabelEmail({
      availability: available,
      transport,
      recorder,
      orderId,
      ...labelBase,
    });

    expect(transport.send).toHaveBeenCalledOnce();
    expect(reason).toContain("historii wiadomości");
    expect(reason).not.toContain("Nie udało się wysłać etykiety");
  });
});
