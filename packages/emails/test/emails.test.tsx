import { describe, expect, it } from "vitest";

import { renderEmailConfirmation } from "../src/index";

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
    expect(result.html).not.toContain("oklch");
    expect(result.text.trim()).not.toBe("");
    expect(result.text).toContain(confirmationUrl);
  });
});
