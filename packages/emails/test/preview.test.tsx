import { describe, expect, it } from "vitest";

import EmailConfirmationPreview from "../preview/email-confirmation";
import NewOrderNotificationPreview from "../preview/new-order-notification";
import OrganizationInvitationPreview from "../preview/organization-invitation";
import PasswordResetPreview from "../preview/password-reset";

describe("React Email Preview", () => {
  it("udostępnia przykładowe propsy dla wszystkich czterech szablonów", () => {
    expect(EmailConfirmationPreview.PreviewProps.confirmationUrl).toContain(
      "example.test",
    );
    expect(PasswordResetPreview.PreviewProps.resetUrl).toContain("example.test");
    expect(OrganizationInvitationPreview.PreviewProps.organizationName).toBe(
      "Wypożyczalnia Północ",
    );
    expect(NewOrderNotificationPreview.PreviewProps.orderNumber).toBe(
      "ZAM-2026-001",
    );
  });
});
