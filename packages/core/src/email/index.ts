export { EMAIL_SENDER_KEY, EmailConfigError, emailSenderFromSettings } from "./tenant-config";
export {
  RESEND_SEND_URL,
  EmailTransportError,
  emailAvailability,
  platformFromAddress,
  resendTransport,
  type EmailTransportOptions,
} from "./transport";
export type { EmailAvailability, EmailSender, EmailTransport, OutgoingEmail } from "./types";
