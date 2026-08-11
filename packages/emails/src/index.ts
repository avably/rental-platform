export {
  EmailConfirmation,
  type EmailConfirmationProps,
} from "./templates/email-confirmation";
export {
  PasswordChanged,
  type PasswordChangedProps,
} from "./templates/password-changed";
export {
  PasswordReset,
  type PasswordResetProps,
} from "./templates/password-reset";
export {
  OrganizationInvitation,
  type InvitationRole,
  type OrganizationInvitationProps,
} from "./templates/organization-invitation";
export {
  NewOrderNotification,
  type NewOrderNotificationProps,
} from "./templates/new-order-notification";
export { RentalCancelled } from "./templates/rental-cancelled";
export { RentalConfirmed } from "./templates/rental-confirmed";
export type { RentalLifecycleEmailProps } from "./templates/rental-lifecycle-email";
export { RentalPickedUp } from "./templates/rental-picked-up";
export { RentalReadyForPickup } from "./templates/rental-ready-for-pickup";
export { RentalReturned } from "./templates/rental-returned";
export {
  ReturnLabelEmail,
  type ReturnLabelEmailProps,
} from "./templates/return-label";
export {
  PickupReturnReminderEmail,
  type PickupReturnReminderEmailProps,
} from "./templates/pickup-return-reminder";
export {
  RentalContractEmail,
  type RentalContractEmailProps,
} from "./templates/rental-contract";
export {
  ContactMessageEmail,
  type ContactMessageEmailProps,
} from "./templates/contact-message";
export {
  SaasPaymentFailed,
  type SaasPaymentFailedProps,
} from "./templates/saas-payment-failed";
export { EMAIL_MESSAGES, emailMessages, type EmailMessages } from "./messages";
export {
  renderContactMessage,
  renderEmailConfirmation,
  renderNewOrderNotification,
  renderOrganizationInvitation,
  renderPasswordChanged,
  renderPasswordReset,
  renderRentalCancelled,
  renderRentalConfirmed,
  renderRentalPickedUp,
  renderRentalReadyForPickup,
  renderRentalReturned,
  renderReturnLabel,
  renderPickupReturnReminder,
  renderRentalContractEmail,
  renderSaasPaymentFailed,
  type RenderedEmail,
} from "./render";
