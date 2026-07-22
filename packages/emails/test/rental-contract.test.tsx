import { describe, expect, it } from "vitest";

import { emailMessages, renderRentalContractEmail } from "../src";

const base = {
  tenantName: "Wypożyczalnia Demo",
  customerName: "Anna Kowalska",
  orderNumber: "AV-2026-042",
};

describe("e-mail z umową najmu", () => {
  it.each([
    ["pl" as const, "Umowa najmu", "w załączniku", "Numer zamówienia"],
    ["en" as const, "Rental agreement", "attached", "Order number"],
  ])("renderuje %s bez marki platformy", async (locale, heading, attachment, numberLabel) => {
    const rendered = await renderRentalContractEmail({ ...base, locale });

    expect(emailMessages(locale).rentalContract.heading).toBe(heading);
    expect(rendered.html).toContain(base.tenantName);
    expect(rendered.html).toContain(base.customerName);
    expect(rendered.html).toContain(base.orderNumber);
    expect(rendered.text).toContain(attachment);
    expect(rendered.text).toContain(numberLabel);
    expect(rendered.html).not.toContain("Avably");
  });

  it.each(["pl", "en"] as const)("snapshot %s", async (locale) => {
    const rendered = await renderRentalContractEmail({ ...base, locale });
    expect(rendered).toMatchSnapshot();
  });
});
