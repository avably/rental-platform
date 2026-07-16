import { describe, expect, it } from "vitest";

import {
  renderEmailConfirmation,
  renderNewOrderNotification,
  renderOrganizationInvitation,
  renderPasswordReset,
} from "../src/index";

describe("EmailConfirmation", () => {
  it("renderuje CTA, link, branding i wersję tekstową bez oklch", async () => {
    const confirmationUrl =
      "https://app.example.test/auth/confirm?token=confirmation-123";

    const result = await renderEmailConfirmation({
      confirmationUrl,
      locale: "pl",
      recipientName: "Anna",
    });

    expect(result.html).toContain("Potwierdź adres e-mail");
    expect(result.html).toContain(confirmationUrl);
    expect(result.html).toContain("Anna");
    expect(result.html).toContain("Avably");
    expect(result.html).not.toContain('lang="en"');
    expect(result.html).not.toContain("oklch");
    expect(result.text.trim()).not.toBe("");
    expect(result.text).toContain(confirmationUrl);
  });

  it("wariant EN: treść po angielsku i lang=en", async () => {
    const result = await renderEmailConfirmation({
      confirmationUrl: "https://app.example.test/auth/confirm?token=confirmation-123",
      locale: "en",
      recipientName: "Anna",
    });

    expect(result.html).toContain("Confirm your email address");
    expect(result.html).toContain('lang="en"');
    expect(result.html).not.toContain("Potwierdź");
  });
});

describe("PasswordReset", () => {
  it("renderuje bezpieczną instrukcję resetu, CTA i wersję tekstową", async () => {
    const resetUrl = "https://app.example.test/reset?token=reset-123";

    const result = await renderPasswordReset({
      locale: "pl",
      resetUrl,
      recipientName: "Piotr",
    });

    expect(result.html).toContain("Ustaw nowe hasło");
    expect(result.html).toContain("Piotr");
    expect(result.html).toContain(resetUrl);
    expect(result.html).toContain("Jeśli to nie Ty");
    expect(result.html).toContain("Avably");
    expect(result.html).not.toContain("oklch");
    expect(result.text.trim()).not.toBe("");
    expect(result.text).toContain(resetUrl);
  });

  it("wariant EN: instrukcja i CTA po angielsku", async () => {
    const result = await renderPasswordReset({
      locale: "en",
      resetUrl: "https://app.example.test/reset?token=reset-123",
      recipientName: "Piotr",
    });

    expect(result.html).toContain("Set a new password");
    expect(result.html).toContain("If this was not you");
    expect(result.html).toContain('lang="en"');
    expect(result.html).not.toContain("Ustaw nowe hasło");
  });
});

describe("OrganizationInvitation", () => {
  it("renderuje organizację, polską rolę, CTA i wersję tekstową", async () => {
    const acceptanceUrl =
      "https://app.example.test/invitations/accept?token=invite-123";

    const result = await renderOrganizationInvitation({
      acceptanceUrl,
      locale: "pl",
      organizationName: "Wypożyczalnia Północ",
      recipientName: "Jan",
      role: "staff",
    });

    expect(result.html).toContain("Dołącz do organizacji");
    expect(result.html).toContain("Wypożyczalnia Północ");
    expect(result.html).toContain("pracownik");
    expect(result.html).toContain("Jan");
    expect(result.html).toContain(acceptanceUrl);
    expect(result.html).toContain("Avably");
    expect(result.html).not.toContain("oklch");
    expect(result.text.trim()).not.toBe("");
    expect(result.text).toContain("Wypożyczalnia Północ");
    expect(result.text).toContain(acceptanceUrl);
  });

  it("wariant EN: rola tłumaczona razem z treścią", async () => {
    const result = await renderOrganizationInvitation({
      acceptanceUrl: "https://app.example.test/invitations/accept?token=invite-123",
      locale: "en",
      organizationName: "Wypożyczalnia Północ",
      recipientName: "Jan",
      role: "staff",
    });

    expect(result.html).toContain("Join the organization");
    expect(result.html).toContain("Your role");
    expect(result.html).toContain("staff");
    expect(result.html).not.toContain("pracownik");
  });
});

describe("NewOrderNotification", () => {
  it("renderuje placeholder danych zamówienia, CTA i wersję tekstową", async () => {
    const orderUrl = "https://app.example.test/orders/order-123";

    const result = await renderNewOrderNotification({
      customerName: "Alicja Nowak",
      locale: "pl",
      orderNumber: "ZAM-2026-001",
      orderUrl,
      rentalEndDate: "23.07.2026",
      rentalStartDate: "20.07.2026",
      totalAmount: "1 299,00 zł",
    });

    expect(result.html).toContain("Nowe zamówienie");
    expect(result.html).toContain("Zobacz zamówienie");
    expect(result.html).toContain("ZAM-2026-001");
    expect(result.html).toContain("Alicja Nowak");
    expect(result.html).toContain("1 299,00 zł");
    expect(result.html).toContain("20.07.2026");
    expect(result.html).toContain("23.07.2026");
    expect(result.html).toContain(orderUrl);
    expect(result.html).toContain("Avably");
    expect(result.html).not.toContain("oklch");
    expect(result.text.trim()).not.toBe("");
    expect(result.text).toContain("ZAM-2026-001");
    expect(result.text).toContain("Alicja Nowak");
    expect(result.text).toContain("1 299,00 zł");
    expect(result.text).toContain("20.07.2026");
    expect(result.text).toContain("23.07.2026");
    expect(result.text).toContain(orderUrl);
  });

  it("wariant EN: etykiety pól po angielsku, kwota przekazana bez zmian", async () => {
    const result = await renderNewOrderNotification({
      customerName: "Alicja Nowak",
      locale: "en",
      orderNumber: "ZAM-2026-001",
      orderUrl: "https://app.example.test/orders/order-123",
      rentalEndDate: "2026-07-23",
      rentalStartDate: "2026-07-20",
      // Kwota przychodzi sformatowana przez wołającego — pakiet jej nie tłumaczy
      // ani nie przelicza waluty.
      totalAmount: "PLN 1,299.00",
    });

    expect(result.html).toContain("New order");
    expect(result.html).toContain("Rental period");
    expect(result.html).toContain("PLN 1,299.00");
    expect(result.html).not.toContain("Okres wynajmu");
  });
});
