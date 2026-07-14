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
      recipientName: "Anna",
    });

    expect(result.html).toContain("Potwierdź adres e-mail");
    expect(result.html).toContain(confirmationUrl);
    expect(result.html).toContain("Anna");
    expect(result.html).toContain("&lt;NAZWA&gt;");
    expect(result.html).not.toContain('lang="en"');
    expect(result.html).not.toContain("oklch");
    expect(result.text.trim()).not.toBe("");
    expect(result.text).toContain(confirmationUrl);
  });
});

describe("PasswordReset", () => {
  it("renderuje bezpieczną instrukcję resetu, CTA i wersję tekstową", async () => {
    const resetUrl = "https://app.example.test/reset?token=reset-123";

    const result = await renderPasswordReset({
      resetUrl,
      recipientName: "Piotr",
    });

    expect(result.html).toContain("Ustaw nowe hasło");
    expect(result.html).toContain("Piotr");
    expect(result.html).toContain(resetUrl);
    expect(result.html).toContain("Jeśli to nie Ty");
    expect(result.html).toContain("&lt;NAZWA&gt;");
    expect(result.html).not.toContain("oklch");
    expect(result.text.trim()).not.toBe("");
    expect(result.text).toContain(resetUrl);
  });
});

describe("OrganizationInvitation", () => {
  it("renderuje organizację, polską rolę, CTA i wersję tekstową", async () => {
    const acceptanceUrl =
      "https://app.example.test/invitations/accept?token=invite-123";

    const result = await renderOrganizationInvitation({
      acceptanceUrl,
      organizationName: "Wypożyczalnia Północ",
      recipientName: "Jan",
      role: "staff",
    });

    expect(result.html).toContain("Dołącz do organizacji");
    expect(result.html).toContain("Wypożyczalnia Północ");
    expect(result.html).toContain("pracownik");
    expect(result.html).toContain("Jan");
    expect(result.html).toContain(acceptanceUrl);
    expect(result.html).toContain("&lt;NAZWA&gt;");
    expect(result.html).not.toContain("oklch");
    expect(result.text.trim()).not.toBe("");
    expect(result.text).toContain("Wypożyczalnia Północ");
    expect(result.text).toContain(acceptanceUrl);
  });
});

describe("NewOrderNotification", () => {
  it("renderuje placeholder danych zamówienia, CTA i wersję tekstową", async () => {
    const orderUrl = "https://app.example.test/orders/order-123";

    const result = await renderNewOrderNotification({
      customerName: "Alicja Nowak",
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
    expect(result.html).toContain("&lt;NAZWA&gt;");
    expect(result.html).not.toContain("oklch");
    expect(result.text.trim()).not.toBe("");
    expect(result.text).toContain("ZAM-2026-001");
    expect(result.text).toContain("Alicja Nowak");
    expect(result.text).toContain("1 299,00 zł");
    expect(result.text).toContain("20.07.2026");
    expect(result.text).toContain("23.07.2026");
    expect(result.text).toContain(orderUrl);
  });
});
