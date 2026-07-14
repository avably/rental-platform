export {
  EmailConfirmation,
  type EmailConfirmationProps,
} from "./templates/email-confirmation";
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
export {
  renderEmailConfirmation,
  renderNewOrderNotification,
  renderOrganizationInvitation,
  renderPasswordReset,
  type RenderedEmail,
} from "./render";
