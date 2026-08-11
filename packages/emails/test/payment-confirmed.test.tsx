/**
 * Potwierdzenie zaksięgowania płatności (ADR-139) — testy TREŚCI, nie tylko
 * snapshot: mail obiecany przez stronę statusu checkoutu musi nieść numer
 * zamówienia i kwotę, bo bez nich klient nie wie, CO zostało opłacone.
 * Mutacja szablonu, która gubi którykolwiek z tych dwóch faktów, ma się tu
 * spalić (dowód mutacyjny c z briefu ADR-139).
 */
import { describe, expect, it } from "vitest";

import { renderPaymentConfirmed, type PaymentConfirmedEmailProps } from "../src/index";

const plProps = {
  amountPaidFormatted: "1 234,56 zł",
  customerName: "Anna Kowalska",
  locale: "pl",
  orderNumber: "AV-2026-777",
  tenantName: "Wypożyczalnia Północ",
} satisfies PaymentConfirmedEmailProps;

const enProps = {
  amountPaidFormatted: "PLN 1,234.56",
  customerName: "Anna Kowalska",
  locale: "en",
  orderNumber: "AV-2026-777",
  tenantName: "North Rental",
} satisfies PaymentConfirmedEmailProps;

describe("PaymentConfirmedEmail", () => {
  it("PL: niesie numer zamówienia, kwotę, nagłówek i markę TENANTA (nie platformy)", async () => {
    const result = await renderPaymentConfirmed(plProps);

    // Dwa fakty, bez których ta wiadomość nie mówi nic — w OBU wariantach.
    expect(result.html).toContain(plProps.orderNumber);
    expect(result.html).toContain(plProps.amountPaidFormatted);
    expect(result.text).toContain(plProps.orderNumber);

    expect(result.html).toContain("Płatność zaksięgowana");
    expect(result.html).toContain(plProps.customerName);
    expect(result.html).toContain(plProps.tenantName);
    // Klient dostaje wiadomość od wypożyczalni (ADR-036 D2) — bez marki
    // platformy i bez kanonicznych tokenów kolorów.
    expect(result.html).not.toContain("Avably");
    expect(result.html).not.toContain("oklch");
    expect(result.html).not.toContain('lang="en"');
    expect(result.text.trim()).not.toBe("");
    expect(result).toMatchSnapshot();
  });

  it("EN: treść po angielsku, lang=en, te same fakty", async () => {
    const result = await renderPaymentConfirmed(enProps);

    expect(result.html).toContain(enProps.orderNumber);
    expect(result.html).toContain("Payment confirmed");
    expect(result.html).toContain('lang="en"');
    expect(result.html).not.toContain("Płatność");
    expect(result.text).toContain(enProps.orderNumber);
    expect(result).toMatchSnapshot();
  });

  it("ZERO obietnic ponad stan: żadnych deklaracji o wysyłce/wydaniu sprzętu", async () => {
    // Potwierdzamy fakt zaksięgowania — o wydaniu sprzętu mówią maile cyklu
    // najmu. Wiadomość nie może obiecywać kroków, których tor nie wykonuje.
    const result = await renderPaymentConfirmed(plProps);
    for (const promise of ["wyślemy", "wysyłamy", "nadamy", "kurier", "faktur"]) {
      expect(result.html.toLowerCase()).not.toContain(promise);
    }
  });
});
