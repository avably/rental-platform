/**
 * Doręczenie faktury — bramki pliku i złożenie wiadomości (D3, ADR-076).
 *
 * Trzy rzeczy, których nie sprawdza żaden inny test w repo:
 *
 *  (a) ODMOWA MA POWÓD I JEST PODJĘTA PRZED WYSYŁKĄ. Zły typ i zbyt duży
 *      plik muszą rozstrzygnąć się na czystej funkcji, żeby akcja mogła
 *      odmówić bez tworzenia wiersza w `email_logs` — `sendAndLog` loguje
 *      TAKŻE porażki, więc odmowa po jego stronie zaśmieciłaby historię
 *      zdarzeniami, które nigdy nie opuściły panelu.
 *
 *  (b) TYP JEST SPRAWDZANY DWA RAZY. `File.type` bierze się w przeglądarce
 *      z ROZSZERZENIA, więc dowolny plik przemianowany na `.pdf` deklaruje
 *      się jako `application/pdf`. Bramka na nagłówku `%PDF-` jest jedyną,
 *      która to łapie.
 *
 *  (c) WIADOMOŚĆ NIESIE ZAŁĄCZNIK, A NIE SAM TEKST — i to bajty, które
 *      wskazał operator. Ten test odróżnia „wysłaliśmy fakturę" od
 *      „wysłaliśmy ładny e-mail o fakturze".
 */
import { describe, expect, it } from "vitest";

import {
  INVOICE_MAX_BYTES,
  INVOICE_MAX_MB,
  buildInvoiceEmail,
  checkInvoiceFile,
  invoiceAttachmentFilename,
} from "@/app/[locale]/(panel)/zamowienia/[id]/invoice-email";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nfaktura testowa\n%%EOF");
const NOT_PDF_BYTES = new TextEncoder().encode("PK to jest zip");

const baseInput = {
  locale: "pl" as const,
  tenantName: "Wypożyczalnia Testowa",
  customerName: "Anna Kowalska",
  customerEmail: "anna@example.com",
  orderNumber: "AV-2026-001",
  bytes: PDF_BYTES,
  filename: "FV-2026-07-123.pdf",
};

describe("bramki pliku faktury", () => {
  it("przepuszcza PDF o dopuszczalnym rozmiarze i z poprawnym nagłówkiem", () => {
    expect(
      checkInvoiceFile({ size: PDF_BYTES.byteLength, type: "application/pdf" }, PDF_BYTES),
    ).toBeNull();
  });

  it("odmawia bez pliku i przy pliku pustym", () => {
    expect(checkInvoiceFile(null)).toBe("missing");
    expect(checkInvoiceFile(undefined)).toBe("missing");
    expect(checkInvoiceFile({ size: 0, type: "application/pdf" })).toBe("empty");
  });

  it("odmawia przy zadeklarowanym typie innym niż PDF", () => {
    expect(checkInvoiceFile({ size: 1024, type: "image/png" })).toBe("type");
    expect(checkInvoiceFile({ size: 1024, type: "" })).toBe("type");
    expect(checkInvoiceFile({ size: 1024, type: "application/x-pdf" })).toBe("type");
  });

  it("odmawia plikowi, który TYLKO PODAJE SIĘ za PDF (nagłówek nie zgadza się)", () => {
    // Sedno bramki (b): deklaracja jest poprawna, więc pierwsza bramka
    // przepuszcza — łapie dopiero odczyt pierwszych bajtów.
    expect(checkInvoiceFile({ size: 999, type: "application/pdf" })).toBeNull();
    expect(checkInvoiceFile({ size: 999, type: "application/pdf" }, NOT_PDF_BYTES)).toBe("type");
  });

  it("odmawia powyżej limitu i przepuszcza dokładnie na limicie", () => {
    expect(checkInvoiceFile({ size: INVOICE_MAX_BYTES, type: "application/pdf" })).toBeNull();
    expect(checkInvoiceFile({ size: INVOICE_MAX_BYTES + 1, type: "application/pdf" })).toBe("size");
  });

  it("limit pokazywany operatorowi to ta sama liczba co limit egzekwowany", () => {
    // Rozjazd tych dwóch znaczyłby odmowę z powodem, który nie jest prawdziwy.
    expect(INVOICE_MAX_MB * 1024 * 1024).toBe(INVOICE_MAX_BYTES);
  });

  it("rozmiar rozstrzyga się PRZED treścią — bajtów ponadwymiarowego pliku nie czytamy", () => {
    expect(
      checkInvoiceFile({ size: INVOICE_MAX_BYTES + 1, type: "application/pdf" }, NOT_PDF_BYTES),
    ).toBe("size");
  });
});

describe("nazwa załącznika", () => {
  it("zachowuje nazwę operatora (niesie numer faktury, którego my nie znamy)", () => {
    expect(invoiceAttachmentFilename("FV-2026-07-123.pdf", "AV-2026-001")).toBe(
      "FV-2026-07-123.pdf",
    );
  });

  it("usuwa znaki, którymi dałoby się rozbić nagłówek wiadomości", () => {
    const name = invoiceAttachmentFilename('fak\r\ntura"; x=1/../etc.pdf', "AV-2026-001");
    expect(name).not.toMatch(/[\r\n"';/\\]/);
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("wraca do nazwy własnej, gdy po oczyszczeniu nie zostaje nic", () => {
    expect(invoiceAttachmentFilename('"""', "AV-2026-001")).toBe("faktura-AV-2026-001.pdf");
    expect(invoiceAttachmentFilename(".pdf", "AV-2026-001")).toBe("faktura-AV-2026-001.pdf");
  });

  it("nie dubluje rozszerzenia", () => {
    expect(invoiceAttachmentFilename("faktura.PDF", "AV-2026-001")).toBe("faktura.pdf");
  });
});

describe("wiadomość z fakturą", () => {
  it("niesie DOKŁADNIE te bajty, które wskazał operator, pod jego nazwą", () => {
    const email = buildInvoiceEmail(baseInput);
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments![0]!.filename).toBe("FV-2026-07-123.pdf");
    expect(email.attachments![0]!.content).toBe(PDF_BYTES);
  });

  it("idzie na adres klienta zamówienia i niesie numer zamówienia w temacie", () => {
    const email = buildInvoiceEmail(baseInput);
    expect(email.to).toBe("anna@example.com");
    expect(email.subject).toContain("AV-2026-001");
  });

  it("mówi „przesyłamy fakturę”, a NIE „wystawiliśmy fakturę” (ADR-076)", () => {
    const { html, text } = buildInvoiceEmail(baseInput);
    for (const variant of [html, text]) {
      expect(variant).toContain("Przesyłamy fakturę");
      expect(variant).not.toMatch(/wystawi/i);
    }
  });

  it("jest w języku ODBIORCY, nie operatora", () => {
    const en = buildInvoiceEmail({ ...baseInput, locale: "en" });
    expect(en.subject).toBe("Invoice for order AV-2026-001");
    expect(en.html).toContain("Please find the invoice");
    expect(en.html).toContain('lang="en-US"');
  });

  it("ma wariant tekstowy niosący to samo co HTML", () => {
    const email = buildInvoiceEmail(baseInput);
    expect(email.text).toContain("AV-2026-001");
    expect(email.text).toContain("Anna Kowalska");
    expect(email.text).not.toContain("<");
  });

  it("escapuje dane wchodzące do HTML-a (treść ląduje w rejestrze i w podglądzie)", () => {
    const email = buildInvoiceEmail({
      ...baseInput,
      customerName: '<img src=x onerror="alert(1)">',
      tenantName: "Wypożyczalnia <b>X</b>",
    });
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("<b>X</b>");
    expect(email.html).toContain("&lt;img");
  });

  it("żaden atrybut style nie jest rozbity cudzysłowem w środku", () => {
    // REGRESJA ZŁAPANA NA ŻYWYM ŻĄDANIU DO DOSTAWCY, nie w kodzie: lista
    // krojów zawiera „Segoe UI" i w wersji z CUDZYSŁOWAMI zamykała atrybut
    // `style="…"` w połowie deklaracji. W samym źródle wyglądało to
    // poprawnie, a w wysłanej wiadomości znikało tło i marginesy.
    const { html } = buildInvoiceEmail(baseInput);
    for (const [, value] of html.matchAll(/style="([^"]*)"/g)) {
      // Wartość ucięta na cudzysłowie kończy się w środku deklaracji —
      // poprawna zawsze domyka ostatnią własność wartością.
      expect(value).not.toMatch(/:\s*$/);
      expect(value).toMatch(/^[^"]*$/);
    }
    // Kontrola pozytywna: gdyby atrybutów nie było, pętla wyżej nic nie broni.
    expect([...html.matchAll(/style="([^"]*)"/g)].length).toBeGreaterThan(5);
    // I wprost: pełna deklaracja `font-family` musi przetrwać w JEDNYM atrybucie.
    expect(html).toContain("font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;margin:0");
  });

  it("nadawca to nazwa tenanta przy adresie platformy (ADR-033)", () => {
    const email = buildInvoiceEmail({ ...baseInput, fromEmail: "poczta@avably.io" });
    expect(email.from).toBe("Wypożyczalnia Testowa <poczta@avably.io>");
  });

  it("dokłada replyTo tylko wtedy, gdy tenant go ma", () => {
    expect(buildInvoiceEmail(baseInput).replyTo).toBeUndefined();
    expect(buildInvoiceEmail({ ...baseInput, replyTo: "biuro@example.pl" }).replyTo).toBe(
      "biuro@example.pl",
    );
  });

  it("NIE niesie klucza idempotencji — druga wysyłka jest decyzją, nie dublem", () => {
    expect(buildInvoiceEmail(baseInput).idempotencyKey).toBeUndefined();
  });
});
