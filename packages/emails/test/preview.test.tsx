import { describe, expect, it } from "vitest";

import EmailConfirmationPreview from "../preview/email-confirmation";
import NewOrderNotificationPreview from "../preview/new-order-notification";
import OrganizationInvitationPreview from "../preview/organization-invitation";
import PasswordResetPreview from "../preview/password-reset";
import PickupReturnReminderPreview from "../preview/pickup-return-reminder";
import RentalCancelledPreview from "../preview/rental-cancelled";
import RentalConfirmedPreview from "../preview/rental-confirmed";
import RentalPickedUpPreview from "../preview/rental-picked-up";
import RentalReadyForPickupPreview from "../preview/rental-ready-for-pickup";
import RentalReturnedPreview from "../preview/rental-returned";
import ReturnLabelPreview from "../preview/return-label";

describe("React Email Preview", () => {
  it("udostępnia przykładowe propsy dla wszystkich jedenastu szablonów", () => {
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
    expect(RentalConfirmedPreview.PreviewProps.tenantName).toBe(
      "Wypożyczalnia Północ",
    );
    expect(RentalReadyForPickupPreview.PreviewProps.pickupLocationName).toBe(
      "Magazyn Główny",
    );
    expect(RentalPickedUpPreview.PreviewProps.orderNumber).toBe("AV-2026-001");
    expect(RentalReturnedPreview.PreviewProps.orderNumber).toBe("AV-2026-001");
    expect(RentalCancelledPreview.PreviewProps.orderNumber).toBe("AV-2026-001");
    expect(ReturnLabelPreview.PreviewProps.shipmentNumber).toBe("GK240610123456");
    expect(PickupReturnReminderPreview.PreviewProps.locationName).toBe(
      "Magazyn Główny",
    );
  });
});
